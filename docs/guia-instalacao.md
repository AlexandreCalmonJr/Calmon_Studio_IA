# Guia de Instalação & Execução — Calmon Studio

## 1. Desktop (Windows, Linux e macOS)
- **Windows:** execute `Calmon-Studio-3.1.0-x64-Setup.exe` (instalador) ou `Calmon-Studio-3.1.0-x64-Portable.exe` (portátil).
- O aplicativo inicia minimizável na **Bandeja do Sistema (Tray)**, com atalho global **`Ctrl + Shift + Space`** e auto-updater conectado às Releases do GitHub.

## 2. Mobile Android (`.apk`)
- Instale `android/app/build/outputs/apk/debug/app-debug.apk` no seu celular Android.
- **Pareamento no Wi-Fi (LAN):**
  1. No PC, inicie com `JARVIS_ALLOW_LAN=1` para liberar o acesso na rede local.
  2. No celular, abra a aba **Controle** (`/remote`) e toque em **Buscar no Wi-Fi** (descoberta UDP porta `41234`) ou informe `http://<IP-DO-PC>:3000`.
- **Acesso fora de casa:** use **Tailscale** apontando para a URL segura do seu PC.

## 3. Python Worker Opcional (`:8001`)
- O aplicativo funciona sem Python instalado; quando disponível localmente em `services/python-worker`, habilita `/hardware/scan`, `/voice/transcribe` (`faster-whisper`), `/code/symbols` e RAG (`/rag/query`):
  ```cmd
  cd services/python-worker
  uvicorn app.main:app --host 127.0.0.1 --port 8001
  ```

