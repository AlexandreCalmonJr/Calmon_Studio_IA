# Prompt Mestre para Recriar o JARVIS AI Hub do Zero

> Copie e cole o prompt abaixo em um novo projeto/conversa para recriar uma aplicação com a mesma arquitetura, stack, design system Obsidian Studio, banco híbrido SQLite WAL + FTS5 + vetores, cofre criptografado de APIs e microsserviços Python/Go.

---

```markdown
Crie uma aplicação web full-stack de produção chamada **JARVIS AI Hub** — um sistema operacional pessoal multi-agente em português (PT-BR), com arquitetura modular, estética **Obsidian Studio** e suporte a modo local sem Docker (**SQLite WAL + FTS5 + vetores**) além de empacotamento Docker com microsserviços **Python 3.11** e **Go 1.23**.

### 1. Stack e Arquitetura Geral
- **Frontend**: React 19, TypeScript, Vite 6, PWA (`vite-plugin-pwa`), `lucide-react`, `recharts`, `qrcode`.
- **Estilização**: CSS puro com Custom Properties em `src/index.css` (**sem Tailwind**), seguindo o Design System **Obsidian Studio**:
  - Superfícies escuras cool-slate: `#0b0d12` (canvas), `#10131a` (cards), `#141821` (subcards), bordas hairline `1px solid rgba(255,255,255,0.08)`.
  - Acento único disciplinado: Laranja `#f97316` (`#d9480f` em CTAs, `#fb923c` em destaques).
  - Cores semânticas apenas para estado (sempre pareadas com texto/ícone): Verde `#4ade80`, Âmbar `#fbbf24`, Vermelho `#f87171`.
  - Fontes: `Plus Jakarta Sans` (títulos), `DM Sans` (corpo), `JetBrains Mono` com `tabular-nums` (métricas, latências, modelos e código).
  - Zero clutter visual: sem pills estáticos em metadados (usar texto limpo com separador `·`), sem bordas grossas à esquerda (`border-l-4`), sem pontos pulsantes decorativos, elevação em nível único.
- **Backend Principal**: Node.js 22+, Express 5 (`server.ts`, porta `3000`), WebSocket (`/ws` via `ws`), `@google/genai` (chave `GEMINI_API_KEY` exclusivamente no servidor) e `node:sqlite` nativo.
- **Arquitetura de Pastas**:
  - `src/features/` organizado por domínio (`auth`, `overview`, `chat`, `settings`, `models`, `brain`, `agents`, `knowledge`, `workflows`, `tasks`, `coding`, `workspace`, `studio`, `studios`, `security`, `approvals`, `hardware`, `companion`, `mobile`, `github`, `skills`, `usage`, `logs`).
  - `src/services/api/` com clientes REST tipados + módulos puros desacoplados testados com `node:test` (`npx tsx --test`).
  - `server/` com motores especializados (`providerEngine.ts`, `hybridAiEngine.ts`, `brainServer.ts`, `artifactEngine.ts`, `spreadsheetServer.ts`) e `server/brain/` (`models.ts`, `sqliteBrainStore.ts`, `workspaceMemoryStore.ts`, `sessionLaneQueue.ts`, `pythonWorkerBridge.ts`, `brainRouter.ts`).

### 2. Banco de Dados & Memória Híbrida (OpenClaw / Hermes / GrokBot)
- **SQLite WAL local** em `.jarvis-brain/brain.db` com consultas estritamente parametrizadas e tabelas para:
  - Identidade e perfis do Cérebro (`brain_identity`, `brain_profiles`, `paired_devices`).
  - Conversas, especialistas, skills e tarefas (`chat_sessions`, `chat_messages`, `agents`, `skills`, `agent_skills`, `workflows`, `workflow_runs`).
  - **Memória editável em Markdown** por workspace isolado (`MEMORY.md` e `SOUL.md` em `agent_workspaces` e `markdown_memory_files`) com confinamento de caminho contra path traversal.
  - **Busca híbrida FTS5 + vetores** (`memory_entries`, `memory_chunks`, `memory_chunks_fts` FTS5, `memory_embeddings`).
  - **Filas seriais por sessão** (`session_lane_jobs` / single-writer queue), **Protocolo MCP nativo** (`mcp_servers`, `mcp_tool_logs`) e auditoria (`audit_logs`).
  - **Cofre de credenciais de terceiros** (`provider_vault_keys`) com chaves criptografadas e telemetria real de saúde (`last_tested_at`, `last_test_status`, `last_test_message`, `last_latency_ms`, `last_status_code`).
- Backup real em disco e exportação/importação transacional `.jarvis-pack`.
- Sem dados mockados no backend: toda listagem, status de saúde, latência e execução deve refletir estado real do servidor e do banco.

### 3. Gestão Multi-Provedor (BYOK), Segurança e Saúde de Conexão (`SettingsView`)
- **Cofre Protegido da Sessão** (`ThirdPartyApiKeysCard`) para **Anthropic (Claude)**, **OpenAI (GPT)**, **DeepSeek** e provedores compatíveis expansíveis (**Groq**, **OpenRouter**, **xAI Grok**, **Custom HTTPS**).
- **Google Gemini** permanece 100% gerenciado pelas variáveis de ambiente do servidor (nunca pedir chave Gemini na UI).
- **Blindagem de Segredos**:
  - Nunca gravar chaves em texto claro no `localStorage` ou `sessionStorage` (incluir limpeza automática de chaves legadas e metadados cifrados via Web Crypto API AES-GCM 256-bit).
  - Criptografar chaves no backend com **AES-256-GCM** (`KEYVAULT_MASTER_KEY` / `JWT_SECRET`) e selar em **Cookie HttpOnly** (`jarvis_provider_vault`, `SameSite`, `Secure` em HTTPS).
  - Validação anti-SSRF nas URLs customizadas (somente HTTPS, bloqueando localhost, IPs privados e endpoints de metadados de nuvem) e redação de chaves em mensagens de erro.
- **Teste de Conexão (Ping) antes de salvar**:
  - Toggle *"Validar (ping) antes de salvar"* ativado por padrão.
  - Botões **Testar Chave (Ping)** e **Validar e Salvar** que chamam `POST /api/v1/settings/provider-keys/:provider/test` no backend, exibindo feedback visual verde/vermelho com host, HTTP status, latência em `ms` e chips clicáveis de modelos detectados (com fallback manual *"Salvar mesmo assim"* em caso de erro).
- **Indicador Visual de Latência e Saúde de Conexão** (`ProviderConnectionHealthStrip`):
  - **Inline** logo abaixo do seletor de modelo (`Modelo Padrão`) em cada provedor configurado: 4 barras de sinal, rótulo textual (`Excelente`, `Estável`, `Lenta`, `Erro`, `Aguardando medição`), barra proporcional de latência, `ms` tabular, código HTTP e tempo relativo.
  - **Painel consolidado** logo abaixo dos seletores de modelo listando **todos os provedores configurados** (Google Gemini do servidor + provedores externos ativos), com resumo agregado (total, saudáveis, alertas, latência média, provedor mais rápido), botão **Medir Todos** (`POST /api/v1/settings/provider-keys/health` em paralelo no backend) e botão **Ping** individual.

### 4. Microsserviços Poliglotas & Empacotamento Docker
- **`services/python-worker/`**: serviço **Python 3.11 + FastAPI** (porta `8001`) com **LangChain / LangGraph**, **SQLAlchemy**, **Sentence-Transformers** e **ChromaDB** para ingestão e RAG compatível com OpenClaw (`requirements.txt` + `Dockerfile`).
- **`services/go-gateway/`**: serviço **Go 1.23** (`main.go` + `go.mod` + `internal/{config,proxy,middleware,crawler}` + `Dockerfile`, porta `8080`) atuando como gateway reverso de alta concorrência, rate limiter, health checks e crawler web.
- **`Dockerfile`** multi-stage (Node 22 Alpine, usuário não-root) e **`docker-compose.yml`** com PostgreSQL 16 `pgvector`, Redis 7, Ollama (perfil `local-ai`), Python Worker (perfil `python-worker`) e Go Gateway (perfil `go-gateway`).

### 5. Qualidade & Verificação Obrigatória
- Escrever testes unitários com `node:test` (`npx tsx --test`) para criptografia do cofre, anti-SSRF, validação pré-salvamento, classificação de latência/saúde e store SQLite.
- Garantir `tsc --noEmit` e `npm run build` sem erros e validar visualmente todas as telas em navegador real.
```
