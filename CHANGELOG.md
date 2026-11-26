# Changelog — Calmon Studio

## v3.1.0 (2026-11-26)

### Novidades
- **Suporte completo a NVIDIA NIM & Roteamento Multimodal:**
  - Descoberta automática de catálogo ao cadastrar chave de API, classificando modelos para chat, raciocínio, código, visão, voz (TTS/ASR), imagem e vídeo.
  - Painel de recomendações automáticas do melhor modelo por agente e por tipo de mídia.
- **Estúdio Criativo Multi-Provedor:**
  - Removida a exclusividade do Google Gemini no Estúdio Criativo e na geração de vídeo/imagem; o sistema agora roteia para o provedor/chave ativa configurado pelo usuário.
  - Chat com detecção natural de intenção de mídia (imagem, vídeo, PDF, PPTX, planilhas) e renderização inline aprimorada.
- **Assistente de Setup (Local / Híbrido):**
  - Modal de configuração inicial alinhado ao design system do Calmon Studio (`Modal`, tokens CSS e tema claro/escuro), guiando a escolha entre modo Local (Ollama) ou Híbrido (API Key + catálogo).
- **Gestão de Cotas Multi-Chave com Persistência SQLite:**
  - Controle de limite diário de tokens por chave, registro de consumo e rotação automática em caso de `429`/rate limit, persistidos em SQLite (`token_quota_buckets`).
- **Importador de Skills Multi-Skill (`npx skills add`):**
  - Suporte no Hub de Integrações e backend para comandos `npx skills add <owner/repo> --skill <nome>` e descoberta recursiva de `SKILL.md` em repositórios como `NVIDIA/skills` (ex.: `rag-blueprint`).
- **Desktop & Empacotamento:**
  - Ícone nativo `512x512` (`build/icon.png`) configurado no `electron-builder` para Windows, Linux e macOS.

### Correções
- Corrigida importação inválida em `server/routes/packsRouter.ts` (`mergeCatalogWithCustomPacks`) que bloqueava o `build:server`.
- Removida chamada órfã de cota em `server/routes/modelsRouter.ts`.

---

## v3.0.1
- Rebrand para **Calmon Studio**, workflow CI/CD para Windows (`.exe`), Linux (`AppImage`) e macOS (`.dmg`/`.zip`) e publicação automática no GitHub Releases.
