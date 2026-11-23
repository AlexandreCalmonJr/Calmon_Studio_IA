"""Serviço FastAPI do Worker Python 3.11 (RAG LangGraph + ChromaDB + OpenClaw)."""

from __future__ import annotations

import hmac
import sys
import time
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from . import __version__
from .config import settings
from .rag_graph import OpenClawRagGraph, extract_hermes_facts
from .vector_store import OpenClawVectorStore

app = FastAPI(
    title="JARVIS Python 3.11 RAG Worker",
    version=__version__,
    description="Serviço FastAPI + LangChain/LangGraph + ChromaDB + SQLAlchemy compatível com OpenClaw.",
)

store = OpenClawVectorStore()
rag_graph = OpenClawRagGraph(store)
STARTED_AT = time.time()


def verify_internal_token(x_worker_token: str | None = Header(default=None)) -> None:
    expected = settings.internal_worker_token
    if not expected:
        return
    if not x_worker_token or not hmac.compare_digest(x_worker_token, expected):
        raise HTTPException(status_code=401, detail="Token interno do worker inválido.")


class IngestRequest(BaseModel):
    workspace_slug: str = Field(default="default", min_length=1, max_length=64)
    source_ref: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=200_000)
    metadata: dict[str, Any] = Field(default_factory=dict)


class QueryRequest(BaseModel):
    workspace_slug: str = Field(default="default", min_length=1, max_length=64)
    query: str = Field(min_length=1, max_length=2_000)
    top_k: int = Field(default=6, ge=1, le=20)


class ExtractFactsRequest(BaseModel):
    transcript: str = Field(min_length=10, max_length=50_000)


class OpenClawSyncRequest(BaseModel):
    workspace_slug: str = Field(default="default", min_length=1, max_length=64)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "online",
        "service": settings.service_name,
        "version": __version__,
        "python_version": sys.version.split()[0],
        "graph_engine": rag_graph.engine_name,
        "uptime_seconds": int(time.time() - STARTED_AT),
        "storage": store.diagnostics(),
        "providers_configured": settings.configured_providers(),
    }


@app.post("/rag/ingest", dependencies=[Depends(verify_internal_token)])
def rag_ingest(payload: IngestRequest) -> dict[str, Any]:
    return store.ingest_document(
        workspace_slug=payload.workspace_slug,
        source_ref=payload.source_ref,
        content=payload.content,
        metadata=payload.metadata,
    )


@app.post("/rag/query", dependencies=[Depends(verify_internal_token)])
def rag_query(payload: QueryRequest) -> dict[str, Any]:
    t0 = time.perf_counter()
    result = rag_graph.run(
        workspace_slug=payload.workspace_slug,
        query=payload.query,
        top_k=payload.top_k,
    )
    return {
        "workspace_slug": payload.workspace_slug,
        "query": payload.query,
        "engine": rag_graph.engine_name,
        "hits": result.get("retrieved_chunks", []),
        "context_markdown": result.get("context_markdown", ""),
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 2),
    }


@app.post("/rag/extract-facts", dependencies=[Depends(verify_internal_token)])
def rag_extract_facts(payload: ExtractFactsRequest) -> dict[str, Any]:
    facts = extract_hermes_facts(payload.transcript)
    return {"facts": facts, "count": len(facts)}


@app.post("/openclaw/sync", dependencies=[Depends(verify_internal_token)])
def openclaw_sync(payload: OpenClawSyncRequest) -> dict[str, Any]:
    return store.sync_openclaw_markdown_dir(payload.workspace_slug, settings.openclaw_memory_dir)
