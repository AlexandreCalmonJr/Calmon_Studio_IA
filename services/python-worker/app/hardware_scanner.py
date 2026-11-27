"""Scanner de especificações de hardware (CPU, RAM, GPU) portado para o Python Worker."""

from __future__ import annotations

import json
import logging
import os
import platform
import subprocess
import time
from typing import Any

logger = logging.getLogger(__name__)

_cached_specs: dict[str, Any] | None = None
_last_scan_time: float = 0.0
CACHE_TTL_SECONDS = 15.0


def _read_memory_fallback() -> dict[str, Any]:
    try:
        import psutil

        vm = psutil.virtual_memory()
        return {
            "total_gb": round(vm.total / (1024**3), 2),
            "available_gb": round(vm.available / (1024**3), 2),
            "used_gb": round((vm.total - vm.available) / (1024**3), 2),
            "percent": vm.percent,
        }
    except ImportError:
        return {"total_gb": 16.0, "available_gb": 8.0, "used_gb": 8.0, "percent": 50.0}


def _cpu_load_fallback() -> float:
    try:
        import psutil

        return float(psutil.cpu_percent(interval=None))
    except ImportError:
        return 0.0


def scan_hardware() -> dict[str, Any]:
    """Coleta informações de CPU, RAM e GPU do host local com cache de 15s."""
    global _cached_specs, _last_scan_time

    now = time.time()
    if _cached_specs and (now - _last_scan_time) < CACHE_TTL_SECONDS:
        _cached_specs["ram"] = _read_memory_fallback()
        _cached_specs["cpu"]["current_load_percent"] = _cpu_load_fallback()
        return _cached_specs

    ram_info = _read_memory_fallback()
    cpu_name = platform.processor() or "Processador x86_64"
    physical_cores = os.cpu_count() or 4
    logical_cores = os.cpu_count() or 8
    max_clock_mhz = 0

    try:
        import psutil

        physical_cores = psutil.cpu_count(logical=False) or physical_cores
        logical_cores = psutil.cpu_count(logical=True) or logical_cores
    except ImportError:
        pass

    if platform.system() == "Windows":
        try:
            ps_cmd = (
                "Get-CimInstance Win32_Processor | "
                "Select-Object -Property Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed | "
                "ConvertTo-Json"
            )
            proc = subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps_cmd],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if proc.returncode == 0 and proc.stdout.strip():
                data = json.loads(proc.stdout)
                if isinstance(data, list):
                    data = data[0]
                if data.get("Name"):
                    cpu_name = str(data["Name"]).strip()
                if data.get("NumberOfCores"):
                    physical_cores = int(data["NumberOfCores"])
                if data.get("NumberOfLogicalProcessors"):
                    logical_cores = int(data["NumberOfLogicalProcessors"])
                if data.get("MaxClockSpeed"):
                    max_clock_mhz = int(data["MaxClockSpeed"])
        except Exception as exc:
            logger.debug("Falha ao consultar CPU via WMI: %s", exc)

    gpus: list[dict[str, Any]] = []
    has_nvidia_cuda = False

    if platform.system() == "Windows":
        try:
            ps_gpu_cmd = (
                "Get-CimInstance Win32_VideoController | "
                "Select-Object -Property Name, AdapterRAM | ConvertTo-Json"
            )
            proc_gpu = subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps_gpu_cmd],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if proc_gpu.returncode == 0 and proc_gpu.stdout.strip():
                gpu_data = json.loads(proc_gpu.stdout)
                if isinstance(gpu_data, dict):
                    gpu_data = [gpu_data]
                for g in gpu_data:
                    g_name = str(g.get("Name") or "Dispositivo de Vídeo").strip()
                    raw_ram = g.get("AdapterRAM") or 0
                    vram_gb = round(int(raw_ram) / (1024**3), 2) if raw_ram else 0.0
                    is_nvidia = "nvidia" in g_name.lower()
                    if is_nvidia:
                        has_nvidia_cuda = True
                    gpus.append({"name": g_name, "vram_gb": vram_gb, "nvidia": is_nvidia})
        except Exception as exc:
            logger.debug("Falha ao consultar GPU via WMI: %s", exc)

    _cached_specs = {
        "os": f"{platform.system()} {platform.release()}",
        "cpu": {
            "name": cpu_name,
            "physical_cores": physical_cores,
            "logical_cores": logical_cores,
            "max_clock_mhz": max_clock_mhz,
            "current_load_percent": _cpu_load_fallback(),
            "architecture": platform.machine(),
        },
        "ram": ram_info,
        "gpus": gpus,
        "has_nvidia_cuda": has_nvidia_cuda,
    }
    _last_scan_time = now
    return _cached_specs

