"""Adaptador opcional de STT local (Whisper / faster-whisper) para o Python Worker."""

from __future__ import annotations

import base64
import os
import tempfile
import time
from pathlib import Path
from typing import Any


class LocalSTTAdapter:
    """Transcreve áudio localmente via faster-whisper quando disponível."""

    def __init__(self, model_name: str = "base"):
        self.model_name = model_name
        self._model = None

    def transcribe_base64(self, audio_base64: str, language: str = "pt") -> dict[str, Any]:
        if not audio_base64.strip():
            return {"ok": True, "text": "", "duration_seconds": 0.0, "confidence": 0.0, "available": True}

        try:
            audio_bytes = base64.b64decode(audio_base64, validate=True)
        except Exception:
            return {"ok": False, "error": "Áudio base64 inválido.", "available": True}

        try:
            from faster_whisper import WhisperModel
        except ImportError:
            return {
                "ok": False,
                "available": False,
                "error": "STT local indisponível; instale 'faster-whisper' no Python Worker.",
            }

        start = time.perf_counter()
        if self._model is None:
            self._model = WhisperModel(
                os.getenv("JARVIS_STT_MODEL", self.model_name),
                device=os.getenv("JARVIS_STT_DEVICE", "cpu"),
                compute_type=os.getenv("JARVIS_STT_COMPUTE_TYPE", "int8"),
                download_root=os.getenv("JARVIS_MODEL_DIR") or None,
            )

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as audio_file:
            audio_file.write(audio_bytes)
            audio_path = Path(audio_file.name)

        try:
            segments, info = self._model.transcribe(str(audio_path), language=language, vad_filter=True)
            segments = list(segments)
            text = " ".join(segment.text.strip() for segment in segments).strip()
            confidence = (
                max(0.0, min(1.0, 1.0 - (sum(s.no_speech_prob for s in segments) / len(segments))))
                if segments
                else 0.0
            )
            detected_lang = info.language or language
        finally:
            audio_path.unlink(missing_ok=True)

        return {
            "ok": True,
            "available": True,
            "text": text,
            "language": detected_lang,
            "confidence": round(confidence, 4),
            "duration_seconds": round(time.perf_counter() - start, 4),
        }

