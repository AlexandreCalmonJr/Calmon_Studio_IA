"""Grafo RAG com LangChain & LangGraph compatível com memória OpenClaw/Hermes."""

from __future__ import annotations

import re
from typing import Any, TypedDict

from .vector_store import OpenClawVectorStore

try:
    from langgraph.graph import END, StateGraph
    HAS_LANGGRAPH = True
except ImportError:  # pragma: no cover
    HAS_LANGGRAPH = False


class RagWorkflowState(TypedDict, total=False):
    workspace_slug: str
    query: str
    top_k: int
    retrieved_chunks: list[dict[str, Any]]
    context_markdown: str
    extracted_facts: list[dict[str, Any]]


USER_PREF_RE = re.compile(
    r"\b(prefir|gosto|sempre me|meu nome|meu email|meu hor[aá]rio|portugu[eê]s|idioma)\b",
    re.IGNORECASE,
)


def extract_hermes_facts(transcript: str) -> list[dict[str, Any]]:
    """Classifica sentenças duráveis em camadas 'user' (preferências) e 'memory' (técnico)."""
    sentences = [s.strip() for s in re.split(r"[.!?\n]+", transcript) if len(s.strip()) >= 16]
    facts: list[dict[str, Any]] = []
    for sentence in sentences[:12]:
        scope = "user" if USER_PREF_RE.search(sentence) else "memory"
        words = [w.lower() for w in re.findall(r"[a-zA-Z0-9À-ÿ_-]{4,}", sentence)]
        tags = list(dict.fromkeys(words))[:4]
        facts.append(
            {
                "scope": scope,
                "title": sentence[:72].rstrip(" ,;:"),
                "content": sentence,
                "tags": tags,
                "confidence": 0.9 if scope == "user" else 0.85,
            }
        )
    return facts


class OpenClawRagGraph:
    """Pipeline LangGraph: retrieve -> assemble_context -> extract_facts."""

    def __init__(self, store: OpenClawVectorStore) -> None:
        self.store = store
        self._compiled = self._build_graph() if HAS_LANGGRAPH else None

    def _node_retrieve(self, state: RagWorkflowState) -> RagWorkflowState:
        hits = self.store.query(
            workspace_slug=state.get("workspace_slug", "default"),
            query_text=state.get("query", ""),
            top_k=int(state.get("top_k", 6)),
        )
        return {**state, "retrieved_chunks": hits}

    def _node_assemble_context(self, state: RagWorkflowState) -> RagWorkflowState:
        chunks = state.get("retrieved_chunks") or []
        blocks = [
            f"### [{c['source_ref']} · {c['heading']}] (score {c['score']})\n{c['snippet']}"
            for c in chunks
        ]
        return {**state, "context_markdown": "\n\n".join(blocks)}

    def _build_graph(self) -> Any:
        graph = StateGraph(RagWorkflowState)
        graph.add_node("retrieve", self._node_retrieve)
        graph.add_node("assemble_context", self._node_assemble_context)
        graph.set_entry_point("retrieve")
        graph.add_edge("retrieve", "assemble_context")
        graph.add_edge("assemble_context", END)
        return graph.compile()

    def run(self, *, workspace_slug: str, query: str, top_k: int = 6) -> RagWorkflowState:
        initial: RagWorkflowState = {
            "workspace_slug": workspace_slug,
            "query": query,
            "top_k": top_k,
        }
        if self._compiled is not None:
            return self._compiled.invoke(initial)
        state = self._node_retrieve(initial)
        return self._node_assemble_context(state)

    @property
    def engine_name(self) -> str:
        return "langgraph" if self._compiled is not None else "sequential_fallback"
