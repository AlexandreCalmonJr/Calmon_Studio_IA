# Calmon Studio

**Calmon Studio** é uma plataforma **Local-First** de IA e orquestração multi-agente com workspace estilo Manus, banco SQLite WAL embarcado (com opção de escala para PostgreSQL + `pgvector` e Redis), suporte a modelos locais via **Ollama** (incluindo a persona **Calmon IA**) e provedores em nuvem (**NVIDIA NIM, Google Gemini, OpenAI, Anthropic, DeepSeek, Groq, OpenRouter**).

---

## Principais Recursos

- **Assistente de Setup & Modo Local/Híbrido:** Na inicialização, escolha entre modo **100% Local (Ollama)** ou **Híbrido (Nuvem + Local)**, importe chaves de API com descoberta automática de catálogo e receba recomendações do melhor modelo por agente e mídia.
- **Gestão de Cotas Multi-Chave:** Cadastre múltiplas chaves do mesmo provedor com limite diário de tokens persistido em SQLite e rotação automática em caso de rate limit (`429`) ou esgotamento.
- **Chat & Workspace Vivo:** Painel lateral com linha do tempo por etapa, checkpoints duráveis, retomada pós-queda, replay, renderização inline de mídia e visualização/download de artefatos.
- **Estúdio Criativo Multi-Provedor:** Geração de imagens, vídeos, áudio/TTS, documentos e apresentações sem exclusividade de provedor — compatível com **NVIDIA NIM**, **Google Gemini**, **OpenAI** e endpoints configurados.
- **Geração Real de Documentos:**
  - Planilhas **`.xlsx`** (ExcelJS com fórmulas reais) e **`.csv`** (100% offline).
  - Apresentações **`.pptx`** e relatórios **`.pdf`** (pptxgenjs / jsPDF).
- **Importador de Skills Multi-Skill (`npx skills add`):** Importe pacotes `SKILL.md` de repositórios GitHub simples ou multi-skill (ex.: `npx skills add NVIDIA/skills --skill rag-blueprint`) direto para seus agentes e Context Sets.
- **Segurança & Multi-Usuário:** Sessões persistentes em SQLite com cookies `HttpOnly`, cofre **AES-256-GCM**, proteção CSRF, RBAC (`admin`, `developer`, `auditor`), rate limiting e auditoria.
- **Ecossistema Extensível:** Pacotes modulares, registry remoto (`PACK_REGISTRY_URL`), supervisor MCP (`stdio` / HTTP), agendador persistente e conectores de canais (Telegram, Discord, Slack, WhatsApp).

---

## Para Testers — Como usar o `.exe` no Windows

1. Baixe **`Calmon-Studio-3.1.0-x64-nsis.exe`** (instalador) ou **`Calmon-Studio-3.1.0-x64-portable.exe`** na aba **Releases** do repositório.
2. Abra o aplicativo (não precisa instalar Node.js, Docker ou Git).
3. Na tela inicial, clique em **"Criar conta pessoal"** para criar seu usuário local em segundos.
4. Para conversar com a IA, escolha uma das opções em **Modelos & Provedores**:
   - **Nuvem (mais rápido em PCs sem GPU):** cole uma chave gratuita do **Google Gemini** (Google AI Studio) ou OpenAI/Groq.
   - **100% Offline (Local):** instale o [Ollama](https://ollama.com) e baixe um modelo leve (`ollama pull llama3.2:3b`).

### Como reportar um bug
Caso encontre algum problema, acesse **Logs do Servidor** (ou `GET /api/v1/system/diagnostics-bundle`) para exportar o diagnóstico sanitizado (sem chaves de API ou senhas) e envie junto com a descrição do ocorrido.

---

## Desenvolvimento Local (Linux / macOS / Windows)

**Pré-requisitos:** Node.js `>= 22.0.0` (usa `node:sqlite` nativo).

```bash
# 1. Instalar dependências
npm install

# 2. Copiar variáveis de ambiente (opcional em dev)
cp .env.example .env

# 3. Rodar servidor + frontend em desenvolvimento
npm run dev
```

Acesse `http://127.0.0.1:3000`.

### Scripts úteis

| Comando | Descrição |
|---|---|
| `npm run dev` | Inicia backend + Vite dev server na porta `3000` |
| `npm run typecheck` | Verifica TypeScript (`tsc --noEmit`) |
| `npm test -- --run` | Executa toda a suíte de testes automatizados |
| `npm run build` | Compila frontend React para `dist/` |
| `npm run build:server` | Empacota backend para `dist-server/server.mjs` |
| `npm run desktop:dev` | Compila e abre a janela Electron localmente |
| `npm run desktop:win` | Gera instalador `.exe` + Portable (Windows) |
| `npm run desktop:linux` | Gera `AppImage` (Linux) |

---

## Criando o modelo local `Calmon IA` no Ollama

Com o Ollama instalado na sua máquina:

```bash
ollama pull llama3.2:3b
ollama create calmon-ia -f models/Modelfile.calmon-ia
```

O modelo `calmon-ia:latest` aparecerá automaticamente na lista de modelos locais do Calmon Studio.

---

## Modo Produção com Docker (Opcional)

Para rodar com **PostgreSQL 16 (`pgvector`) + Redis 7 + Python Worker**:

```bash
cp .env.example .env
# Defina POSTGRES_PASSWORD e JWT_SECRET no .env
docker compose --profile python-worker up -d
```

---

## Arquitetura de Pastas

```text
├── electron/               # Shell Desktop Electron (main.mjs, preload.cjs)
├── server/
│   ├── brain/              # SQLite WAL, migrations e repositórios em repos/
│   ├── infra/              # Adaptadores Postgres, Redis, S3/GCS, Sandbox, MCP e Canais
│   ├── routes/             # Routers Express por domínio (/api/v1/*)
│   └── state/              # Gerenciamento modular de sessão, hardware e telemetria
├── src/
│   ├── features/           # Telas React por domínio (Chat, Brain, Store, Settings, etc.)
│   ├── shared/             # Shell, TopBar, Dock, barramento tipado (appBus.ts)
│   └── styles/             # Tokens de tema Claro/Escuro e módulos CSS
└── services/               # Workers poliglotas opcionais (Python FastAPI / Go Gateway)
```
