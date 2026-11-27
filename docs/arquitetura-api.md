# Arquitetura & Catálogo de APIs — Calmon Studio

## 1. Servidor Principal (Express + WebSocket `/ws`)
- **Bind padrão:** `127.0.0.1:3000` (ou `0.0.0.0` quando `JARVIS_ALLOW_LAN=1`).
- **Controle Remoto (KDE Connect):**
  - `GET /api/v1/remote/status` — Status do host e clipboard.
  - `POST /api/v1/remote/input` — Mouse/teclado/scroll (também via WebSocket `type: "remote_input"`).
  - `POST /api/v1/remote/media` — Controles de mídia e volume.
  - `GET/POST /api/v1/remote/clipboard` — Sincronização bidirecional de área de transferência.
  - `POST /api/v1/remote/system-action` — Ações Nível 1 e Nível 2 (Admin/Biometria).
  - `POST /api/v1/remote/upload` — Recebimento de arquivos em `Downloads/CalmonReceive`.
  - `POST /api/v1/remote/notification` — Espelhamento de notificações Android no Desktop.
- **Sincronização Desktop ⇄ Mobile:**
  - `GET/POST /api/v1/sync/delta` — Sync incremental de agentes, conversas, skills, mídias e status da IA do Desktop.
- **Telemetria & Workspace:**
  - `POST /api/v1/system/client-errors` — Registro centralizado de erros do cliente no `ServerLogsView`.
  - `POST /api/v1/workspace/symbols` — Indexação AST via Python Worker.

## 2. WebSocket `/ws`
- Requer sessão autenticada em produção para `remote_input` e permissão `admin` para `terminal_exec` (`git`, `node`, `npm`, `npx`, `python`, `pytest`).

