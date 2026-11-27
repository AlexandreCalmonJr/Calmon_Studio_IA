# Changelog — Calmon Studio

## v3.2.0 (2026-11-27)

### Novidades
- **Fim do PWA & App Mobile Android Nativo (Capacitor):**
  - Removido `vite-plugin-pwa`, `manifest.json` e `src/shared/pwa/`; fila offline migrada para `src/shared/network/`.
  - Projeto Android nativo (`android/`) com todas as 28 rotas do Calmon Studio, `ForegroundService`, Widget na tela inicial (`CalmonRemoteWidget`) e recebimento `ACTION_SEND`.
  - Ponte C++/NDK (`calmon_native_llm`) compilada via CMake para validação de modelos `.gguf` offline e configuração de Keystore Release.
- **Controle Remoto Estilo KDE Connect & Executor Admin:**
  - Trackpad WebSocket `/ws` com scroll de 2 dedos e Worker Win32 persistente via `stdin`.
  - **Screen Peek** ("Ver Tela do PC"), **Wake-on-LAN** (UDP porta 9), **Ring My Phone** ("Tocar Celular"), **Modo Apresentação** (Slides), **Sensor de Bateria** e **Descoberta LAN (UDP 41234)**.
  - Ações Administrativas Nível 2 protegidas por **Biometria Nativa** no Android e auditoria.
- **Sincronização Total Desktop ⇄ Mobile & Fallback de IA:**
  - `GET/POST /api/v1/sync/delta` sincronizando agentes, sessões de chat, skills e mídias; fallback automático para a IA do Desktop quando não houver modelo local no celular.
- **Auto-Updater Multi-Plataforma & Desktop Spotlight:**
  - `electron-updater` + `latest*.yml` (Windows/Linux/macOS), `checkAppUpdate`/`downloadAndInstallApk` (Android) e `UpdateBanner` global.
  - Atalho global **`Ctrl + Shift + Space`** com mini-janela flutuante *Always-on-Top*, Modo Tray turbinado e notificações nativas.
- **IA Avançada, Banco, Segurança & Documentação:**
  - Daemon pós-conversa do Hermes (`hermesDaemon.ts`), helper de *git worktree* (`worktreeAgentLoop.ts`), suporte `.calmonrules`/`CLAUDE.md` e bloco colapsável `<think>`.
  - Rate Limiting em rotas remotas/voz, `schema_migrations` versionado no SQLite, `PageShell.tsx`, `useVoiceCapture.ts`, `docs/` técnicos e tutoriais no `LearningCenterView`.
