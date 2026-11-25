# Planejamento Arquitetural — Gerenciamento de Pacotes, Servidor Local de Artefatos, Dependências (Python/Go) e Auto-Atualização

> **Projeto:** JARVIS AI Hub (Control Plane Node.js 22 + SQLite WAL + Worker Python 3.11 + Edge Gateway Go 1.23)  
> **Objetivo:** Reduzir drasticamente a latência de instalação de pacotes modulares, agentes, servidores MCP, apps, integrações e runtimes (Python/Go/Node), eliminando dependência direta da internet em tempo de instalação e garantindo reprodutibilidade entre ambientes (Local, LAN/Desktop, Docker e VPS).

---

## 1. Diagnóstico do Cenário Atual e Gargalos

Atualmente, o JARVIS AI Hub opera com um ecossistema poliglota distribuído em cinco camadas de entrega:

1. **Pacotes Modulares & Agentes (`packsRouter.ts`, `modulePackEngine.ts`, `AgentCore`)**: Catálogo embutido + pacotes personalizados em SQLite, mas sem registro central de artefatos pré-empacotados com assinatura e cache de versões anteriores.
2. **Servidores MCP & Integrações (`brainRouter.ts`, `integrationsRouter.ts`)**: Ferramentas nativas e conectores `stdio`/`http`, onde servidores externos frequentemente dependem de `npx`/`uvx` baixando pacotes sob demanda a cada execução.
3. **Apps & Templates (`AppBuilder`, `AndroidMobileHub`, `.jarvis-pack`)**: Artefatos gerados sob demanda sem espelhamento de dependências base.
4. **Runtime Python (`server/brain/python_worker.py`)**: Hoje roda com biblioteca padrão (zero `pip` obrigatório), porém a evolução para embeddings neurais, OCR, PDF/Excel avançado ou ferramentas MCP em Python sofre com builds lentos de wheels e conflitos de `venv`.
5. **Runtime Go (`jarvis-edge-go` no pacote Docker/VPS)**: Compilar módulos Go no destino exige toolchain Go instalado e acesso constante a `proxy.golang.org`, aumentando o tempo de provisionamento em máquinas de usuários finais.
6. **Atualização do Próprio Programa (Core Hub)**: Sem canal versionado com manifesto assinado, pré-backup automático do SQLite e rollback atômico em caso de falha pós-update.

---

## 2. Arquitetura Proposta: Servidor Local de Artefatos & Cache ("JARVIS Artifact Hub")

A solução central é introduzir um **Servidor Intermediário de Artefatos & Proxy Pull-Through** (que pode rodar tanto em uma VPS central da equipe quanto em um nó local na LAN/Docker como espelho offline-first). Os clientes e instâncias do JARVIS **nunca baixam diretamente da internet pública durante uma instalação**: eles consultam primeiro o Artifact Hub, que serve artefatos já armazenados, validados por SHA-256 e prontos para uso imediato.

```text
                        ┌──────────────────────────────────────────────────────┐
                        │           Fontes Upstream (Sincronização)            │
                        │  GitHub Releases · PyPI · proxy.golang.org · npm     │
                        └──────────────────────────┬───────────────────────────┘
                                                   │ Sync agendado / Pull-through
                                                   │ (Allowlist HTTPS + SHA-256)
                                                   ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                        JARVIS ARTIFACT HUB (Servidor de Cache & Registry)                │
│                                                                                          │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌──────────────────────────────────┐  │
│  │  Pack & Agent Store │  │  MCP & Apps Store   │  │   Dependency Mirrors (Cache)     │  │
│  │  /registry/packs/   │  │  /registry/mcp/     │  │  • /pypi/simple  (Python Wheels) │  │
│  │  /registry/agents/  │  │  /registry/apps/    │  │  • /goproxy/     (Go Modules)    │  │
│  │  manifest.json      │  │  /registry/plugins/ │  │  • /binaries/    (Go Static Bin) │  │
│  │  (Ed25519 + SHA256) │  │  (Pinned Digests)   │  │  • /npm/         (Node Tarballs) │  │
│  └──────────┬──────────┘  └──────────┬──────────┘  └────────────────┬─────────────────┘  │
│             └────────────────────────┴──────────────────────────────┘                    │
│                                      │                                                   │
│                       Storage CAS (Content-Addressable Storage)                          │
│                   /var/lib/jarvis-artifacts/blobs/sha256/<digest>                        │
│                 + Índice SQLite/PostgreSQL + LRU GC com Pinning de Versões               │
└──────────────────────────────────────┬───────────────────────────────────────────────────┘
                                       │ LAN / HTTPS (Zero-compile, Download Direto)
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                 Instâncias JARVIS AI Hub (Local SQLite · Docker · VPS)                   │
│                                                                                          │
│  BrainServerHubView ──► GET /api/v1/packs/updates (Badge de Versões & Drift)             │
│  PackStudioAdminView ──► POST /api/v1/admin/packs/updates/apply (Update 1-Clique Admin)  │
│  Local Cache Dir (~/.jarvis-cache/) ──► Instalação Instantânea (< 300ms) + Rollback       │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Modelo de Armazenamento Content-Addressable (CAS)

Todos os artefatos são indexados por hash criptográfico **SHA-256** para deduplicação total e imutabilidade:

```text
/var/lib/jarvis-artifacts/
├── index/
│   ├── releases.json               # Manifesto de versões do JARVIS Hub Core
│   ├── releases.json.sig           # Assinatura Ed25519 do manifesto
│   ├── packs-catalog.json          # Catálogo unificado de Pacotes, Agentes, Skills e MCPs
│   └── checksums.sha256            # Índice global de integridade
├── blobs/
│   └── sha256/
│       ├── 9f/9f86d081...tar.zst   # Pacotes .jarvis-pack comprimidos com Zstandard
│       └── 4b/4b227777...whl       # Wheels Python pré-compiladas
├── mirrors/
│   ├── pypi/simple/                # Índice PEP 503 para uv/pip (offline wheelhouse)
│   ├── goproxy/                    # Cache compatível com protocolo GOPROXY
│   ├── binaries/                   # Binários Go/MCP estáticos por OS/Arch (linux/arm64, amd64, win)
│   └── npm/                        # Proxy Verdaccio / tarballs verificados
└── snapshots/
    └── channels/
        ├── stable.json             # Canal de produção testado
        └── canary.json             # Canal beta para validação no Pack Studio
```

---

## 3. Estratégia por Domínio

### 3.1 Pacotes Modulares, Agentes e Habilidades

| Aspecto | Estratégia Recomendada |
| :--- | :--- |
| **Formato do Pacote** | Bundle imutável `<pack_id>-<semver>.jarvis-pack.tar.zst` contendo `manifest.json`, specs dos agentes (`SOUL.md`, modelo recomendado, políticas de autonomia), skills aprovadas, presets MCP e trilhas Markdown. |
| **Versionamento** | **SemVer estrito (`MAJOR.MINOR.PATCH`)** separado por entidade: versão do Pacote (`installed_packs.version`) e versão do Runtime/Blueprint do Agente (`agents.version` + `AgentCore`). |
| **Detecção de Drift** | O `BrainServerHubView` consulta `GET /api/v1/packs/updates`, comparando versões instaladas no SQLite contra o registro local/espelho e sinalizando via badge na UI quantos pacotes e agentes têm atualização disponível. |
| **Aplicação Segura** | Somente administradores/desenvolvedores (`requirePackStudioRole`) disparam o update pelo `PackStudioAdminView` (`POST /api/v1/admin/packs/updates/apply`), atualizando o registro no SQLite, migrando modelos legados, re-provisionando skills/trilhas e gravando trilha na tabela `audit_logs`. |
| **Rollback** | Cada atualização preserva o snapshot anterior em `agent_versions` e no cache local (`~/.jarvis-cache/packs/<id>/<prev_ver>`), permitindo reversão em < 1 segundo. |

### 3.2 Servidores MCP, Apps e Integrações

- **Servidores MCP pré-empacotados (Zero `npx`/`uvx` em runtime)**:
  - Em vez de executar `npx -y @modelcontextprotocol/server-*` baixando dezenas de megabytes na hora da chamada, o Artifact Hub pré-empacota servidores MCP aprovados em bundles auto-contidos (Node SEA / tarball com `node_modules` congelado ou binário Go/Rust) com digest SHA-256 fixo.
  - O Gateway MCP (`brainRouter.ts`) verifica o digest antes de iniciar o processo `stdio` e mantém a obrigatoriedade de aprovação administrativa (`is_approved = 1`).
- **Apps & Integrações**:
  - Templates do `AppBuilder`, SDK do `AndroidMobileHub` e conectores (`integrationsCatalog.ts`) passam a consumir manifests versionados do `/registry/apps/` e `/registry/integrations/`, permitindo atualizar schemas de conectores (GitHub, Notion, Slack, webhooks) sem exigir reinstalação completa do servidor.

### 3.3 Otimização de Dependências Python (Worker Local & RAG)

O Worker Python (`server/brain/python_worker.py`) já opera com zero dependências obrigatórias para o núcleo FTS5 + vetores leves. Para plugins avançados (embeddings locais, OCR, parsing científico, MCPs Python):

1. **Gerenciador Unificado (`uv`) + Lockfile Determinístico**:
   - Substituir `pip install` solto por `uv` com `pyproject.toml` + `uv.lock` (hashes SHA-256 obrigatórios).
   - Criação de ambientes virtuais isolados por perfil/pacote (`~/.jarvis-brain/venvs/<pack_id>`) com hardlinks instantâneos a partir do cache global (`UV_CACHE_DIR`).
2. **Wheelhouse Local & Espelho PEP 503 (`/mirrors/pypi/simple/`)**:
   - O servidor de artefatos mantém um espelho pull-through (ex.: `devpi` ou handler HTTP leve PEP 503) pré-populado com **wheels binárias pré-compiladas** (`manylinux`, `musllinux`, `macosx`, `win_amd64`), evitando compilação C/Rust (`gcc`/`cargo`) na máquina do usuário.
   - Configuração automática nas instâncias JARVIS:
     ```env
     UV_INDEX_URL=http://<artifact-hub>:8090/mirrors/pypi/simple/
     UV_OFFLINE=true # habilitado em modo air-gapped / LAN
     PIP_INDEX_URL=http://<artifact-hub>:8090/mirrors/pypi/simple/
     ```
3. **Warm-up de Pacotes Críticos**:
   - Quando um pacote modular declara `python_extras` no `manifest.json`, o Artifact Hub já empacota um wheelhouse fechado para aquele pacote; a instalação local apenas extrai wheels locais em milissegundos.

### 3.4 Otimização de Dependências Go (Edge Gateway & Crawlers)

No ecossistema Go, existem dois momentos distintos — **build** (desenvolvimento/CI) e **execução** (usuário final/servidor):

1. **Para Usuários Finais & Servidores (Zero Toolchain Go)**:
   - O usuário **nunca precisa instalar Go** nem baixar módulos na máquina local.
   - O CI/Artifact Hub compila previamente binários estáticos (`CGO_ENABLED=0`) para as matrizes alvo:
     - `jarvis-edge-linux-amd64`
     - `jarvis-edge-linux-arm64` (Raspberry Pi, Apple Silicon Docker, ARM VPS)
     - `jarvis-edge-windows-amd64.exe`
     - `jarvis-edge-darwin-arm64`
   - Os binários são publicados em `/binaries/go/jarvis-edge/<semver>/` acompanhados de `.sha256` e `.sig`. A instalação baixa apenas ~10–14 MB diretamente do servidor de cache local.
2. **Para Builds Customizados & Desenvolvedores (`GOPROXY` Pull-Through)**:
   - O Artifact Hub expõe um proxy de módulos compatível com o protocolo `GOPROXY` (ex.: **Athens** ou proxy Go leve integrado em `/goproxy/`):
     ```env
     GOPROXY=http://<artifact-hub>:8090/goproxy,off
     GOSUMDB=sum.golang.org # validado no primeiro pull e congelado no cache
     ```
   - Garante builds Docker/Go 100% reproduzíveis mesmo sem acesso à internet externa e reduz o tempo de `go mod download` de dezenas de segundos para < 1 segundo em LAN.

---

## 4. Arquitetura de Auto-Atualização do Programa (JARVIS AI Hub Core)

Para atualizar o próprio JARVIS AI Hub com segurança — sem corromper o banco SQLite ou derrubar agentes em produção — define-se um fluxo transacional em **5 etapas**:

1. **Verificação (Poll / On-Demand)**:
   - O Hub consulta `GET <ARTIFACT_HUB>/index/releases.json` + `releases.json.sig` no canal configurado (`stable` ou `canary`).
   - Compara `package.json.version` atual com `latest_version`, exibindo badge de atualização no `BrainServerHubView` e detalhes do changelog no `PackStudioAdminView`.
2. **Pré-Backup Obrigatório (Safety Gate)**:
   - Antes de aplicar qualquer atualização do núcleo ou migração de schema, o servidor executa automaticamente `store.createSqliteBackup()` (`VACUUM INTO`) salvando um ponto de restauração consistente em `backups/pre-update-vX.Y.Z.db`.
3. **Download & Verificação Criptográfica**:
   - Baixa o bundle da nova versão do Artifact Hub para um diretório temporário isolado (`releases/staging/vX.Y.Z`).
   - Valida **assinatura Ed25519** do manifesto e **hash SHA-256** do tarball/imagem antes de extrair qualquer arquivo.
4. **Ativação por Modo de Implantação**:
   - **Modo Local (Sem Docker)**: Troca atômica de symlink (`current -> releases/vX.Y.Z`) + reinício controlado pelo supervisor (`systemd` / `pm2` / launcher nativo).
   - **Modo Docker / VPS**: Pull da imagem versionada a partir do registry espelho local (`localhost:5000/jarvis-hub:vX.Y.Z`), nunca usando `:latest` mutável, seguido de `docker compose up -d --no-deps --wait`.
5. **Health Probe & Rollback Automático**:
   - Após o boot, o updater consulta `GET /api/v1/system/health` e `GET /api/v1/brain/health` (verificando `sqlite_integrity === 'ok'`) por até 30 segundos.
   - Se o health check falhar, o supervisor reverte imediatamente o symlink/tag para `vPrev` e restaura o snapshot pré-update caso uma migração de banco tenha sido iniciada.

---

## 5. Segurança, Governança e Confiabilidade

- **Integridade Ponta a Ponta**: Nenhum pacote, agente, binário Go, wheel Python ou release do Hub é instalado sem correspondência exata de `SHA-256` e assinatura do manifesto.
- **Isolamento de Rede (Anti-SSRF)**: O Artifact Hub só sincroniza a partir de uma allowlist estrita de domínios upstream (`pypi.org`, `files.pythonhosted.org`, `proxy.golang.org`, `registry.npmjs.org`, `github.com`), bloqueando endereços privados/loopback/metadata (`169.254.169.254`, `127.0.0.0/8`, `10.0.0.0/8`).
- **Controle de Acesso (RBAC)**:
  - Leitura de status de versões (`GET /api/v1/packs/updates`): usuários autenticados (`requireAuth`).
  - Execução de updates (`POST /api/v1/admin/packs/updates/apply`) e publicação de pacotes: restrito a `admin` e `developer` (`requirePackStudioRole`), com registro imutável em `audit_logs`.
- **Política de Retenção & Garbage Collection (LRU + Pinning)**:
  - Mantém sempre as últimas **3 versões estáveis** de cada pacote/binário fixadas (pinned) para rollback imediato e aplica limpeza LRU automática para artefatos órfãos quando o disco ultrapassar 80% da cota.

---

## 6. Plano de Implantação em Ondas

| Onda | Escopo | Entregáveis Principais | Status |
| :--- | :--- | :--- | :--- |
| **Onda 1** | **Detecção de Versões & Updates Admin no Hub** | Motor puro SemVer (`packageVersionEngine.ts`), API `GET /api/v1/packs/updates`, aplicação admin `POST /api/v1/admin/packs/updates/apply`, badge de atualização no `BrainServerHubView` e painel de disparo no `PackStudioAdminView`. | **Implementado nesta entrega** |
| **Onda 2** | **Serviço Standalone JARVIS Artifact Hub (Cache Local)** | Container/serviço dedicado de cache CAS (`/blobs/sha256/`), espelho local de `.jarvis-pack.tar.zst`, manifests assinados com Ed25519 e sincronização LAN/offline. | Planejado |
| **Onda 3** | **Espelhos Poliglotas (Python Wheelhouse + Go `GOPROXY` & Binários)** | Proxy PEP 503 para `uv`/`pip`, proxy `GOPROXY` + pipeline de binários Go estáticos multi-arquitetura e cache de servidores MCP pré-empacotados. | Planejado |
| **Onda 4** | **Auto-Updater Transacional do Core Hub** | Manifesto `releases.json` assinado, pré-backup automático SQLite (`VACUUM INTO`), swap atômico Local/Docker e rollback automático guiado por health-check. | Planejado |
