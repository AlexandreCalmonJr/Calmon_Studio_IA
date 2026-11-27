"""Indexador sintático leve (AST Python + TS/JS) para o Python Worker."""

from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Any

_IGNORED_DIRS = {"node_modules", ".git", ".venv", "venv", "dist", "dist-server", "release", "__pycache__", "build"}
_TS_SYMBOL_RE = re.compile(
    r"^\s*(?:export\s+)?(?:async\s+)?(function|class|interface|type|const)\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)


def index_workspace_symbols(root_path: str, max_files: int = 300) -> dict[str, Any]:
    root = Path(root_path).resolve()
    if not root.exists() or not root.is_dir():
        return {"ok": False, "error": "Diretório de projeto inválido.", "files_scanned": 0, "symbols": []}

    symbols: list[dict[str, Any]] = []
    files_scanned = 0

    for path in root.rglob("*"):
        if files_scanned >= max_files:
            break
        if any(part in _IGNORED_DIRS for part in path.parts):
            continue
        if not path.is_file():
            continue

        suffix = path.suffix.lower()
        if suffix not in {".py", ".ts", ".tsx", ".js", ".jsx"}:
            continue

        files_scanned += 1
        rel = str(path.relative_to(root)).replace("\\", "/")
        try:
            source = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue

        if suffix == ".py":
            try:
                tree = ast.parse(source)
                for node in ast.walk(tree):
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                        kind = "class" if isinstance(node, ast.ClassDef) else "function"
                        symbols.append(
                            {
                                "name": node.name,
                                "kind": kind,
                                "file": rel,
                                "line": int(getattr(node, "lineno", 1)),
                            }
                        )
            except SyntaxError:
                continue
        else:
            for match in _TS_SYMBOL_RE.finditer(source):
                line = source.count("\n", 0, match.start()) + 1
                symbols.append(
                    {
                        "name": match.group(2),
                        "kind": match.group(1),
                        "file": rel,
                        "line": line,
                    }
                )

    return {
        "ok": True,
        "root": str(root),
        "files_scanned": files_scanned,
        "count": len(symbols),
        "symbols": symbols[:1500],
    }

