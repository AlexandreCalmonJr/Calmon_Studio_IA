# JARVIS AI Hub — Documentação de Arquitetura do Sistema (`v3.0.1`)

> Plataforma full-stack pessoal de orquestração multi-agente, engenharia de software, memória híbrida (FTS5 + vetores + Markdown editável), modelos locais e nuvem (BYOK criptografado), voz, PWA e microsserviços poliglotas.

---

## 1. Visão Geral & Stack Tecnológica

O projeto adota uma **arquitetura dual-mode** (roda localmente **sem Docker** com SQLite WAL nativo, ou em **stack completa Docker Compose** com PostgreSQL + `pgvector`, Redis, Ollama, Worker Python e Gateway Go).

| Camada | Tecnologias | Responsabilidade |
| :--- | :--- | :--- |
| **Frontend (SPA + PWA)** | React 19, TypeScript 5.7, Vite 6, `vite-plugin-pwa`, Lucide Icons, Recharts, QRCode | Interface Obsidian Studio com 20+ módulos de domínio, streaming SSE/fetch, voz e instalação PWA. |
| **Design System** | CSS puro com Custom Properties (`src/index.css`) — **Obsidian Studio** | Paleta escura cool-obsidian, acento único laranja JARVIS (`#f97316`), bordas hairline `1px` e tipografia tabular. |
| **Backend Principal ("Cérebro")** | Node.js 22+, Express 5, `tsx`, WebSockets (`ws`), `@google/genai`, `node:sqlite` | ~200 rotas `/api/v1/*`, autenticação de sessão, cofre criptografado AES-256-GCM + Cookie `HttpOnly`, roteamento multi-provedor e geração de artefatos (`exceljs`, `jspdf`, `pptxgenjs`, `jszip`). |
| **Banco Local (Padrão)** | SQLite WAL + **FTS5** + vetores (`.jarvis-brain/brain.db`) + Markdown (`MEMORY.md`, `SOUL.md`) | 22 tabelas relacionais/virtuais, busca híbrida lexical + semântica, filas seriais por sessão e backups em disco. |
| **Nuvem / Identidade** | Firebase SDK 13 (`firebase-blueprint.json`, `firestore.rules`) | Autenticação Google, identidade do assistente, perfis privados isolados e memórias compartilhadas por família (*households*). |
| **Worker Python (RAG)** | Python 3.11, FastAPI, Uvicorn, SQLAlchemy, LangChain, LangGraph, Sentence-Transformers, ChromaDB | Serviço dedicado (`services/python-worker`, porta `8001`) + ponte local (`server/brain/python_worker.py`) compatível com OpenClaw. |
| **Gateway & Crawler Go** | Go 1.23 (`services/go-gateway`, porta `8080`, stdlib `net/http`) | Proxy reverso de alta concorrência, rate limiting, health checks agregados e crawler web assíncrono. |
| **Testes & Verificação** | `node:test` via `npx tsx --test`, TypeScript (`tsc --noEmit`), Playwright | Testes unitários determinísticos de lógica pura e backend + testes de regras Firestore + E2E. |

---

## 2. Estrutura de Pastas e Arquivos

```text
/
├── server.ts                         # Servidor Express + Vite middleware (dev) / dist (prod) + WS (/ws) + ~200 rotas /api/v1/*
├── vite.config.ts                    # Vite 6 + React + VitePWA + proteção HMR/WS desabilitado
├── index.html                        # Entry HTML + Google Fonts (Plus Jakarta Sans, DM Sans, JetBrains Mono) + meta/OG
├── package.json                      # Scripts dev/start/build/lint/test e dependências
├── Dockerfile                        # Multi-stage Node 22 Alpine (build + runner não-root + healthcheck)
├── docker-compose.yml                # Stack completa: Brain API, Postgres pgvector, Redis, Ollama, Python Worker, Go Gateway
├── firebase-blueprint.json           # Schema das coleções Firestore
├── firestore.rules                   # Regras de segurança RBAC e isolamento por ownerId
├── security_spec.md                  # Especificação de segurança do Hub
├── .env.example                      # Modelo de variáveis de ambiente (sem segredos)
│
├── server/                           # Motores e módulos do Backend Node.js/TypeScript
│   ├── providerEngine.ts             # Criptografia AES-256-GCM, Cookie HttpOnly, anti-SSRF, ping & chat externo + ping Gemini
│   ├── providerEngine.test.ts        # Testes unitários do cofre, cookie, anti-SSRF e Web Crypto
│   ├── hybridAiEngine.ts             # Roteamento híbrido (Gemini, Ollama local, Hugging Face, provedores externos)
│   ├── brainServer.ts                # Bootstrap do modo do Cérebro (local_sqlite vs docker_postgres)
│   ├── artifactEngine.ts             # Geração de relatórios estruturados e mesa-redonda multi-agente
│   ├── mediaEngine.ts                # Geração e gestão de mídia criativa
│   ├── spreadsheetServer.ts          # Geração e leitura de planilhas Excel (exceljs)
│   ├── appBuilderServer.ts           # Geração/preview de projetos web/Android
│   ├── androidAppServer.ts           # Pareamento QR Code e ponte mobile Android
│   ├── githubImporterServer.ts       # Inspeção de repositórios GitHub e importação de skills
│   ├── integrationsEngine.ts         # Conectores externos (GitHub, Figma, etc.)
│   └── brain/                        # Núcleo do Cérebro SQLite WAL + OpenClaw/Hermes/GrokBot
│       ├── models.ts                 # DDL completo (22 tabelas + índices) e tipos do Cérebro
│       ├── sqliteBrainStore.ts       # Driver transacional node:sqlite, migrações seguras, backups e .jarvis-pack
│       ├── workspaceMemoryStore.ts   # Memória editável MEMORY.md / SOUL.md + busca híbrida FTS5 + vetores + confinamento
│       ├── sessionLaneQueue.ts       # Fila serial por sessão (single-writer lane queue)
│       ├── pythonWorkerBridge.ts     # Ponte Node -> Worker Python local/remoto
│       ├── python_worker.py          # Script Python embarcado para fallback local
│       └── brainRouter.ts            # Rotas /api/v1/brain/* (perfis, memória, lanes, MCP)
│
├── services/                         # Microsserviços Poliglotas (Docker / VPS)
│   ├── python-worker/                # FastAPI + LangChain/LangGraph + ChromaDB + SQLAlchemy (porta 8001)
│   │   ├── app/{main,config,rag_graph,vector_store}.py
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   └── go-gateway/                   # Gateway reverso de alta concorrência + Crawler Go 1.23 (porta 8080)
│       ├── main.go
│       ├── go.mod
│       ├── internal/{config,proxy,middleware,crawler}/
│       └── Dockerfile
│
└── src/                              # Frontend React 19 + TypeScript (Feature-Sliced)
    ├── main.tsx, App.tsx, router.ts, api.ts, types.ts, index.css
    ├── context/AssistantIdentityContext.tsx
    ├── hooks/{useChatStream,useWakeWordListener}.ts
    ├── data/agentsCatalog.ts
    ├── shared/
    │   ├── layout/{PageHeader,PageShell,StateFeedback}.tsx
    │   ├── navigation/{PrimaryRail,DynamicIsland,AgentDock}.tsx
    │   ├── common/{Modal,ConfirmDialog,CommandPalette,Toast,CodeViewer,DiffViewer,ApprovalPromptHost,UserProfileModal,SetupWizardModal,MascotAvatar}.tsx
    │   └── pwa/{PWAInstallButton,usePWAInstall}.ts
    ├── services/
    │   ├── api/                      # 23 módulos tipados de chamada REST (/api/v1/*)
    │   ├── providerHealthMetrics.ts  # Classificação pura de latência, barras de sinal 0-4 e resumo agregado
    │   ├── providerPingValidation.ts # Máquina de estados pré-salvamento com fingerprint FNV-1a
    │   ├── secureVaultCrypto.ts      # Web Crypto API (AES-GCM 256-bit) + scrubber de chaves legadas em localStorage
    │   ├── sessionTransport.ts       # Wrapper apiFetch com credentials: 'include'
    │   ├── accountScope.ts           # Isolamento de chaves de UI por conta
    │   └── *Engine.ts (+ *.test.ts)  # Motores puros (secondBrain, multiOrchestrator, sentinelSecurity, hardwareAdvisor, etc.)
    └── features/                     # 20+ módulos de telas
        ├── auth/                     # AuthGate (login, cadastro, Google)
        ├── overview/                 # Painel inicial + gráficos Recharts
        ├── chat/                     # ChatMaster, streaming, Markdown, ArtifactCanvas, histórico
        ├── settings/                 # SettingsView, ThirdPartyApiKeysCard, ProviderConnectionHealthStrip
        ├── models/                   # Gestor de Modelos, KeyVault, Arena, HuggingFace, Hardware Advisor
        ├── brain/                    # BrainServerHubView, memória Markdown, MCP, lanes Python
        ├── agents/                   # Central de Agentes, criador, templates, playground, rotas
        ├── knowledge/                # Segundo Cérebro, mapa mental, documentos, federação de assistentes
        ├── workflows/                # Editor visual de fluxos multi-agente
        ├── tasks/                    # Gerenciador de tarefas
        ├── coding/                   # Coding Agent + IDE workspace
        ├── workspace/                # Projetos locais, viewer de arquivos, webhooks
        ├── studio/ & studios/        # App Builder, Creative Media, Backend, Design e Quality Studios
        ├── security/ & approvals/    # Sentinel SOC, DevSecOps, matriz de permissões, aprovações humanas
        └── hardware/, companion/, mobile/, github/, office/, skills/, usage/, logs/, executive/, learning/
```

---

## 3. Arquitetura de Banco de Dados

### A. SQLite Local (`node:sqlite` em modo WAL — `.jarvis-brain/brain.db`)
Definido em `server/brain/models.ts` com **22 tabelas**:

1. **Identidade & Perfis**: `brain_identity`, `brain_profiles`, `paired_devices`
2. **Conversas & Especialistas**: `chat_sessions`, `chat_messages`, `agents`, `skills`, `agent_skills`
3. **Memória Híbrida & Documentos (OpenClaw / Hermes)**:
   - `knowledge_documents`, `agent_workspaces`
   - `markdown_memory_files` (`MEMORY.md`, `SOUL.md` editáveis por workspace)
   - `memory_entries`, `memory_chunks`, `memory_chunks_fts` *(Virtual Table FTS5 para busca lexical BM25)*, `memory_embeddings` *(vetores para busca semântica)*
4. **Orquestração, Filas & Protocolo MCP**: `workflows`, `workflow_runs`, `session_lane_jobs`, `mcp_servers`, `mcp_tool_logs`
5. **Segurança, Auditoria & Cofre**:
   - `audit_logs`
   - `provider_vault_keys` — credenciais criptografadas em **AES-256-GCM** (`encrypted_api_key`), `masked_key`, `base_url`, `default_model`, `is_default`, e telemetria real de saúde (`last_tested_at`, `last_test_status`, `last_test_message`, `last_latency_ms`, `last_status_code`).

### B. Firebase Firestore (`firebase-blueprint.json` + `firestore.rules`)
- `/users/{userId}` (`UserIdentity`): nome do assistente, saudação, modo (`simple`/`engineering`), tema.
- `/users/{userId}/private/{docId}` (`UserPrivateProfile`): dados privados (PII) e diretrizes de resposta (restrito ao dono/admin).
- `/households/{householdId}` + `members/{memberId}` + `shared_memories/{memoryId}`: colaboração familiar entre assistentes.
- `/admins/{adminId}`: controle RBAC de administradores.

### C. Stack Docker de Produção (`docker-compose.yml`)
- **PostgreSQL 16 + `pgvector`** (`jarvis-brain-db`) + **Redis 7 AOF** (`jarvis-brain-redis`) + **ChromaDB** (no Python Worker) + **Ollama** (perfil `local-ai`).

---

## 4. Fluxos Críticos & Principais Funções

### Cofre de Chaves de Terceiros, Ping Pré-Salvamento & Saúde de Conexão
1. **Armazenamento Seguro**:
   - `PUT /api/v1/settings/provider-keys/:provider` valida a URL HTTPS (`validateProviderBaseUrl`, anti-SSRF), criptografa a chave com **AES-256-GCM** (`encryptProviderSecret`), persiste em `provider_vault_keys` e sela o envelope em **Cookie HttpOnly** (`jarvis_provider_vault`).
   - No navegador, `scrubLegacyPlaintextApiKeys()` remove qualquer resquício antigo em `localStorage` e `saveEncryptedSessionVaultMeta()` armazena apenas metadados criptografados via **Web Crypto API (AES-GCM 256-bit)**.
   - Google Gemini permanece **100% gerenciado no servidor** via `GEMINI_API_KEY`.
2. **Validação Pré-Salvamento (Ping)**:
   - `POST /api/v1/settings/provider-keys/:provider/test` executa chamada leve `GET .../models` diretamente do backend (`testExternalProviderConnection`), oculta qualquer chave ecoada em mensagens de erro e devolve `ok`, `status_code`, `latency_ms`, `endpoint_host` e `models_detected`.
   - `providerPingValidation.ts` compara um fingerprint não-reversível FNV-1a da chave/URL digitada para impedir salvamento acidental sem ping quando o modo *"Validar (ping) antes de salvar"* está ativo (com opção manual *"Salvar mesmo assim"*).
3. **Monitoramento de Latência & Saúde**:
   - `POST /api/v1/settings/provider-keys/health` executa sondagens reais em paralelo para **todos os provedores configurados** + Google Gemini (`testGeminiServerConnection` usando cabeçalho `x-goog-api-key`), persistindo `last_latency_ms` e `last_status_code` no SQLite.
   - `ProviderInlineHealthBar` (logo abaixo de cada seletor `Modelo Padrão`) e `ProviderConnectionHealthStrip` (matriz consolidada abaixo dos seletores) classificam cada provedor com `classifyProviderHealth()` em 5 níveis (`Excelente ≤ 350 ms`, `Estável ≤ 900 ms`, `Lenta > 900 ms`, `Erro`, `Aguardando medição`) usando 4 barras de sinal + barra proporcional + números tabulares.

---

## 5. Design System — "Obsidian Studio" (`src/index.css`)

- **Superfícies Cool Obsidian**: `#0b0d12` (`--bg-primary`), `#10131a` (`--bg-secondary`), `#141821` (`--bg-tertiary`), `#181d27` (`--bg-surface`).
- **Acento Único**: Laranja JARVIS `#f97316` (`--accent-color`), `#d9480f` (`--accent-btn`), `#fb923c` (`--accent-light`).
- **Estados Semânticos** *(sempre acompanhados de texto/ícone, nunca apenas cor)*: Verde `#22c55e`/`#4ade80`, Âmbar `#f59e0b`/`#fbbf24`, Vermelho `#ef4444`/`#f87171`.
- **Tipografia**: `Plus Jakarta Sans` (títulos), `DM Sans` (corpo), `JetBrains Mono` + `font-variant-numeric: tabular-nums` (latências, modelos, códigos e tabelas).
- **Layout**: Rail esquerdo (`244px` / `68px`), Topbar/Dynamic Island (`52px`), Dock direito (`56px`), elevação em nível único com bordas hairline `1px rgba(255,255,255,0.08)` e zero clutter de pills estáticos.
