# Segurança, Permissões Administrativas & Banco de Dados

## 1. Governança em 2 Níveis para Ações Remotas
- **Nível 1 (Uso Diário):** Bloquear tela (`lock_screen`), listar serviços (`list_services`), mídia e trackpad — execução imediata para usuário autenticado.
- **Nível 2 (Administrativo):** Suspender PC (`power_sleep`), reiniciar serviços (`restart_service`), `winget_list` e comandos `admin_powershell` — **exigem `biometric_approved: true` (confirmação nativa no Android) + perfil `admin`**, ou entram na fila do `ApprovalCenter` com registro em `auditLogs`.

## 2. Proteção de Rede & Rate Limiting
- **Rate Limiter (`server/rateLimiter.ts`):** protege `/api/v1/voice/transcribe`, `/api/v1/remote/system-action`, `/api/v1/remote/upload` e autenticação contra abuso.
- **Cofre Criptografado:** chaves de provedores são cifradas com **AES-256-GCM** e isoladas por `owner_user_id`.

## 3. Persistência & Migrações SQLite WAL
- O banco `.jarvis-brain/brain.db` utiliza **SQLite WAL** com tabela `schema_migrations` versionada, índices compostos em `(session_id, created_at)`, limpeza automática de sessões expiradas (90 dias) e `PRAGMA wal_checkpoint(TRUNCATE)` no encerramento limpo.

