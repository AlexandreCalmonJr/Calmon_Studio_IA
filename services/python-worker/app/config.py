"""Configurações centralizadas do Worker Python 3.11 (variáveis de ambiente apenas no servidor)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class WorkerSettings:
    service_name: str = "jarvis-python-worker"
    port: int = int(os.getenv("PYTHON_WORKER_PORT", "8001"))
    database_url: str = os.getenv("DATABASE_URL", "sqlite:////app/storage/brain_rag.db")
    chroma_persist_dir: Path = Path(os.getenv("CHROMA_PERSIST_DIR", "/app/storage/chroma"))
    openclaw_memory_dir: Path = Path(os.getenv("OPENCLAW_MEMORY_DIR", "/app/storage/workspaces/default"))
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    internal_worker_token: str = os.getenv("INTERNAL_WORKER_TOKEN", "").strip()
    chunk_size_chars: int = int(os.getenv("RAG_CHUNK_SIZE", "1200"))
    chunk_overlap_chars: int = int(os.getenv("RAG_CHUNK_OVERLAP", "180"))

    def configured_providers(self) -> dict[str, bool]:
        """Informa apenas presença booleana de chaves externas configuradas no ambiente."""
        return {
            "openai": bool(os.getenv("OPENAI_API_KEY", "").strip()),
            "anthropic": bool(os.getenv("ANTHROPIC_API_KEY", "").strip()),
            "deepseek": bool(os.getenv("DEEPSEEK_API_KEY", "").strip()),
            "groq": bool(os.getenv("GROQ_API_KEY", "").strip()),
            "openrouter": bool(os.getenv("OPENROUTER_API_KEY", "").strip()),
            "gemini": bool(os.getenv("GEMINI_API_KEY", "").strip()),
            "ollama": bool(os.getenv("OLLAMA_HOST", "").strip()),
        }


settings = WorkerSettings()
