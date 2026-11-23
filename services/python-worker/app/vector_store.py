"""Armazenamento híbrido compatível com OpenClaw: SQLAlchemy (SQLite WAL / Postgres) + ChromaDB + SentenceTransformers."""

from __future__ import annotations

import hashlib
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import settings

try:
    from sqlalchemy import Column, DateTime, Float, Integer, String, Text, create_engine, text
    from sqlalchemy.orm import declarative_base, sessionmaker
    HAS_SQLALCHEMY = True
except ImportError:  # pragma: no cover
    HAS_SQLALCHEMY = False

try:
    import chromadb
    HAS_CHROMADB = True
except ImportError:  # pragma: no cover
    HAS_CHROMADB = False

try:
    from sentence_transformers import SentenceTransformer
    HAS_SENTENCE_TRANSFORMERS = True
except ImportError:  # pragma: no cover
    HAS_SENTENCE_TRANSFORMERS = False

ALLOWED_OPENCLAW_FILES = ("SOUL.md", "MEMORY.md", "USER.md")
TOKEN_RE = re.compile(r"[a-zA-Z0-9À-ÿ_]{2,}", re.UNICODE)


def _fallback_embed(text_input: str, dims: int = 128) -> list[float]:
    """Vetorização determinística local quando o modelo SentenceTransformers ainda não foi carregado."""
    vec = [0.0] * dims
    tokens = TOKEN_RE.findall(text_input.lower())
    if not tokens:
        return vec
    for tok in tokens:
        digest = hashlib.blake2b(tok.encode("utf-8"), digest_size=8).digest()
        bucket = int.from_bytes(digest[:4], "little") % dims
        sign = 1.0 if (digest[4] & 1) == 0 else -1.0
        vec[bucket] += sign
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [round(v / norm, 6) for v in vec]


def _chunk_markdown(content: str, max_chars: int = 1200, overlap: int = 180) -> list[dict[str, str]]:
    """Fatia documentos Markdown preservando cabeçalhos OpenClaw (## / ###)."""
    sections: list[tuple[str, str]] = []
    heading = "Geral"
    buf: list[str] = []
    for line in content.splitlines():
        if line.lstrip().startswith("#"):
            if buf:
                sections.append((heading, "\n".join(buf).strip()))
                buf = []
            heading = line.lstrip("#").strip() or "Seção"
            buf.append(line)
        else:
            buf.append(line)
    if buf:
        sections.append((heading, "\n".join(buf).strip()))

    chunks: list[dict[str, str]] = []
    for sec_heading, body in sections:
        if not body:
            continue
        if len(body) <= max_chars:
            chunks.append({"heading": sec_heading, "text": body})
            continue
        start = 0
        while start < len(body):
            end = min(len(body), start + max_chars)
            piece = body[start:end].strip()
            if piece:
                chunks.append({"heading": sec_heading, "text": piece})
            if end >= len(body):
                break
            start = max(0, end - overlap)
    return chunks


if HAS_SQLALCHEMY:
    Base = declarative_base()

    class OpenClawDocumentRow(Base):
        __tablename__ = "openclaw_rag_documents"

        id = Column(String(64), primary_key=True)
        workspace_slug = Column(String(64), index=True, nullable=False, default="default")
        source_ref = Column(String(255), index=True, nullable=False)
        heading = Column(String(255), nullable=False, default="Geral")
        content = Column(Text, nullable=False)
        content_hash = Column(String(64), nullable=False)
        token_estimate = Column(Integer, nullable=False, default=0)
        created_at = Column(DateTime(timezone=True), nullable=False)


class OpenClawVectorStore:
    """Camada unificada SQLAlchemy + ChromaDB + SentenceTransformers compatível com OpenClaw."""

    def __init__(self) -> None:
        self._embedder: Any = None
        self._chroma_client: Any = None
        self._engine: Any = None
        self._session_factory: Any = None
        self._init_sql()
        self._init_chroma()

    def _init_sql(self) -> None:
        if not HAS_SQLALCHEMY:
            return
        db_url = settings.database_url
        if db_url.startswith("sqlite:///"):
            raw_path = db_url.replace("sqlite:///", "", 1)
            Path(raw_path).parent.mkdir(parents=True, exist_ok=True)
        self._engine = create_engine(db_url, future=True, pool_pre_ping=True)
        Base.metadata.create_all(self._engine)
        if db_url.startswith("sqlite"):
            with self._engine.connect() as conn:
                conn.execute(text("PRAGMA journal_mode=WAL;"))
                conn.execute(text("PRAGMA busy_timeout=5000;"))
                conn.commit()
        self._session_factory = sessionmaker(bind=self._engine, expire_on_commit=False)

    def _init_chroma(self) -> None:
        if not HAS_CHROMADB:
            return
        settings.chroma_persist_dir.mkdir(parents=True, exist_ok=True)
        self._chroma_client = chromadb.PersistentClient(path=str(settings.chroma_persist_dir))

    def _get_embedder(self) -> Any:
        if self._embedder is None and HAS_SENTENCE_TRANSFORMERS:
            self._embedder = SentenceTransformer(settings.embedding_model)
        return self._embedder

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        embedder = self._get_embedder()
        if embedder is not None:
            vectors = embedder.encode(texts, normalize_embeddings=True)
            return [v.tolist() for v in vectors]
        return [_fallback_embed(t) for t in texts]

    def _collection_for(self, workspace_slug: str) -> Any:
        if self._chroma_client is None:
            return None
        safe_slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", workspace_slug).strip("_") or "default"
        return self._chroma_client.get_or_create_collection(
            name=f"jarvis_openclaw_{safe_slug}",
            metadata={"hnsw:space": "cosine"},
        )

    def ingest_document(
        self,
        *,
        workspace_slug: str,
        source_ref: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        chunks = _chunk_markdown(
            content,
            max_chars=settings.chunk_size_chars,
            overlap=settings.chunk_overlap_chars,
        )
        if not chunks:
            return {"workspace_slug": workspace_slug, "source_ref": source_ref, "chunks_indexed": 0}

        texts = [c["text"] for c in chunks]
        embeddings = self.embed_texts(texts)
        now = datetime.now(timezone.utc)
        ids: list[str] = []
        metadatas: list[dict[str, Any]] = []

        for idx, chunk in enumerate(chunks):
            chunk_hash = hashlib.sha256(f"{workspace_slug}:{source_ref}:{idx}:{chunk['text']}".encode("utf-8")).hexdigest()
            chunk_id = f"chk_{chunk_hash[:24]}"
            ids.append(chunk_id)
            meta = {
                "workspace_slug": workspace_slug,
                "source_ref": source_ref,
                "heading": chunk["heading"],
                "chunk_index": idx,
                **(metadata or {}),
            }
            metadatas.append(meta)

        if self._session_factory is not None:
            with self._session_factory() as session:
                session.query(OpenClawDocumentRow).filter(
                    OpenClawDocumentRow.workspace_slug == workspace_slug,
                    OpenClawDocumentRow.source_ref == source_ref,
                ).delete()
                for cid, chunk in zip(ids, chunks):
                    session.add(
                        OpenClawDocumentRow(
                            id=cid,
                            workspace_slug=workspace_slug,
                            source_ref=source_ref,
                            heading=chunk["heading"],
                            content=chunk["text"],
                            content_hash=hashlib.sha256(chunk["text"].encode("utf-8")).hexdigest(),
                            token_estimate=max(1, len(chunk["text"]) // 4),
                            created_at=now,
                        )
                    )
                session.commit()

        collection = self._collection_for(workspace_slug)
        if collection is not None:
            collection.upsert(ids=ids, documents=texts, embeddings=embeddings, metadatas=metadatas)

        return {
            "workspace_slug": workspace_slug,
            "source_ref": source_ref,
            "chunks_indexed": len(chunks),
            "vector_backend": "chromadb" if collection is not None else "local_hash",
            "embedding_model": settings.embedding_model if HAS_SENTENCE_TRANSFORMERS else "deterministic-128d",
        }

    def query(
        self,
        *,
        workspace_slug: str,
        query_text: str,
        top_k: int = 6,
    ) -> list[dict[str, Any]]:
        limit = max(1, min(20, top_k))
        collection = self._collection_for(workspace_slug)
        if collection is not None and collection.count() > 0:
            q_vec = self.embed_texts([query_text])[0]
            res = collection.query(query_embeddings=[q_vec], n_results=min(limit, collection.count()))
            docs = (res.get("documents") or [[]])[0]
            metas = (res.get("metadatas") or [[]])[0]
            dists = (res.get("distances") or [[]])[0]
            ids = (res.get("ids") or [[]])[0]
            hits: list[dict[str, Any]] = []
            for cid, doc, meta, dist in zip(ids, docs, metas, dists):
                similarity = max(0.0, round(1.0 - float(dist), 4))
                hits.append(
                    {
                        "chunk_id": cid,
                        "source_ref": str((meta or {}).get("source_ref", "MEMORY.md")),
                        "heading": str((meta or {}).get("heading", "Geral")),
                        "snippet": doc[:480],
                        "score": similarity,
                    }
                )
            return hits

        if self._session_factory is not None:
            q_tokens = set(TOKEN_RE.findall(query_text.lower()))
            with self._session_factory() as session:
                rows = (
                    session.query(OpenClawDocumentRow)
                    .filter(OpenClawDocumentRow.workspace_slug == workspace_slug)
                    .all()
                )
            scored: list[dict[str, Any]] = []
            for row in rows:
                r_tokens = set(TOKEN_RE.findall(row.content.lower()))
                overlap = len(q_tokens & r_tokens) / max(1, len(q_tokens))
                if overlap > 0:
                    scored.append(
                        {
                            "chunk_id": row.id,
                            "source_ref": row.source_ref,
                            "heading": row.heading,
                            "snippet": row.content[:480],
                            "score": round(overlap, 4),
                        }
                    )
            scored.sort(key=lambda item: item["score"], reverse=True)
            return scored[:limit]

        return []

    def sync_openclaw_markdown_dir(self, workspace_slug: str, base_dir: Path) -> dict[str, Any]:
        """Sincroniza SOUL.md, MEMORY.md e USER.md confinados ao diretório OpenClaw."""
        resolved_base = base_dir.resolve()
        synced: list[dict[str, Any]] = []
        for filename in ALLOWED_OPENCLAW_FILES:
            candidate = (resolved_base / filename).resolve()
            if not str(candidate).startswith(str(resolved_base) + "/") or not candidate.is_file():
                continue
            content = candidate.read_text(encoding="utf-8")
            synced.append(
                self.ingest_document(
                    workspace_slug=workspace_slug,
                    source_ref=filename,
                    content=content,
                    metadata={"openclaw_file": filename},
                )
            )
        return {
            "workspace_slug": workspace_slug,
            "files_synced": len(synced),
            "details": synced,
        }

    def diagnostics(self) -> dict[str, Any]:
        return {
            "sqlalchemy_available": HAS_SQLALCHEMY,
            "chromadb_available": HAS_CHROMADB,
            "sentence_transformers_available": HAS_SENTENCE_TRANSFORMERS,
            "embedding_model": settings.embedding_model,
            "chroma_persist_dir": str(settings.chroma_persist_dir),
        }
