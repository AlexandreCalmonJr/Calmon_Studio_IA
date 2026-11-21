/**
 * Fase 8 — Motor Puro da Arquitetura do Servidor ("Cérebro") Dual-Mode & Multi-Cérebros.
 *
 * Gera artefatos reais para rodar o JARVIS AI Hub em:
 *   1. Modo Local Sem Docker (SQLite WAL + sqlite-vec em pasta única — ideal para usuários comuns)
 *   2. Modo Docker Completo (PostgreSQL 16 + pgvector + Redis + Ollama opcional + Caddy HTTPS)
 *
 * Também centraliza a validação segura de URLs de Cérebros, portabilidade (.jarvis-pack)
 * e documentação comparativa de arquitetura e mapa completo da API /api/v1.
 */

export type BrainMode = 'local_sqlite' | 'docker_postgres' | 'cloud';

export interface BrainConnectionProfile {
  id: string;
  name: string;
  baseUrl: string;
  mode: BrainMode;
  databaseEngine: string;
  description: string;
  isDefault?: boolean;
  isLocalCurrent?: boolean;
  status: 'online' | 'offline' | 'checking';
  latencyMs: number | null;
  lastCheckedAt: string | null;
  capabilities: string[];
  version?: string;
}

export interface BrainDeploymentOptions {
  brainName: string;
  mode: 'local_sqlite' | 'docker_postgres';
  port: number;
  enableOllama: boolean;
  enableRemoteGateway: boolean;
  enablePythonWorker: boolean;
  dataDir: string;
  postgresDb: string;
  assistantName: string;
}

export interface GeneratedServerArtifact {
  path: string;
  language: 'yaml' | 'dockerfile' | 'env' | 'typescript' | 'bash' | 'caddy' | 'markdown';
  description: string;
  content: string;
}

export interface JarvisBrainPackAgent {
  role: string;
  name: string;
  handle: string;
  description: string;
  system_prompt: string;
  installed_skills?: string[];
  is_custom?: boolean;
}

export interface JarvisBrainPackSkill {
  id: string;
  name: string;
  description: string;
  domain: string;
  instructions?: string;
  assigned_agents?: string[];
}

export interface JarvisBrainPackWorkflow {
  id: string;
  title: string;
  description: string;
  schedule_cron?: string;
  schedule_enabled?: boolean;
  nodes?: unknown[];
  edges?: unknown[];
}

export interface JarvisBrainPackKnowledge {
  name: string;
  category: string;
  content: string;
  file_type?: string;
}

export interface JarvisBrainPack {
  schemaVersion: '1.0';
  format: 'jarvis-brain-pack';
  exportedAt: string;
  sourceBrain: {
    name: string;
    mode: BrainMode;
    databaseEngine: string;
    version: string;
  };
  agents: JarvisBrainPackAgent[];
  skills: JarvisBrainPackSkill[];
  workflows: JarvisBrainPackWorkflow[];
  knowledge: JarvisBrainPackKnowledge[];
}

export interface LanguageArchitectureRow {
  stack: string;
  strengths: string[];
  tradeoffs: string;
  recommendedRole: string;
  isPrimary?: boolean;
}

export interface ApiRouteReference {
  group: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  summary: string;
  auth: 'JWT / Sessão' | 'Público (Health)';
}

export const DEFAULT_DEPLOYMENT_OPTIONS: BrainDeploymentOptions = {
  brainName: 'Cérebro JARVIS Principal',
  mode: 'docker_postgres',
  port: 3000,
  enableOllama: true,
  enableRemoteGateway: true,
  enablePythonWorker: false,
  dataDir: '~/JARVIS-Brain',
  postgresDb: 'jarvis_brain',
  assistantName: 'JARVIS',
};

export const SERVER_LANGUAGE_COMPARISON: LanguageArchitectureRow[] = [
  {
    stack: 'TypeScript + Node.js 22 LTS (Express / Fastify + Drizzle ORM)',
    strengths: [
      'Mesma linguagem e tipos compartilhados ponta a ponta com o Hub React e o App Android',
      'SDK oficial @google/genai de primeira classe com streaming SSE/WebSocket ultra-eficiente',
      'Mesmo código-fonte roda direto sem Docker (SQLite WAL) OU em container Docker enxuto (~90 MB)',
      'Ecossistema maduro para gerar Excel (.xlsx), pacotes .zip, QR Code e automações locais',
    ],
    tradeoffs: 'Para pipelines científicos pesados de ML/OCR puro, delega melhor a um worker auxiliar.',
    recommendedRole: 'Linguagem Principal Recomendada (Cérebro Core)',
    isPrimary: true,
  },
  {
    stack: 'Python + FastAPI (Worker Auxiliar Opcional)',
    strengths: [
      'Ecossistema imbatível para OCR pesado, Data Science, áudio avançado e automações científicas',
      'Validação limpa com Pydantic v2 e integração direta com GPU/PyTorch',
    ],
    tradeoffs: 'Mais pesado para empacotar como instalador leve sem Docker no PC de usuários comuns.',
    recommendedRole: 'Worker Opcional no Modo Docker Avançado (--profile python-worker)',
  },
  {
    stack: 'Go (Fiber / Gin)',
    strengths: [
      'Binário único minúsculo e baixíssimo consumo de memória RAM sob alta concorrência',
    ],
    tradeoffs: 'SDKs multimodais e geração rica de planilhas/templates exigem mais código manual.',
    recommendedRole: 'Apenas se evoluir para gateway multi-tenant de milhares de usuários simultâneos',
  },
];

export const UNIFIED_API_ROUTE_MAP: ApiRouteReference[] = [
  { group: 'Cérebro & Multi-Brain', method: 'GET', path: '/api/v1/brain/info', summary: 'Identidade, modo (SQLite/Docker), mDNS e contadores do Cérebro', auth: 'JWT / Sessão' },
  { group: 'Cérebro & Multi-Brain', method: 'GET', path: '/api/v1/brain/health', summary: 'Saúde, latência, banco, Gemini, Ollama e Redis (Docker Healthcheck)', auth: 'Público (Health)' },
  { group: 'Cérebro & Multi-Brain', method: 'GET', path: '/api/v1/brain/profiles', summary: 'Lista todos os Cérebros cadastrados (Local, Docker, Nuvem)', auth: 'JWT / Sessão' },
  { group: 'Cérebro & Multi-Brain', method: 'POST', path: '/api/v1/brain/profiles/:id/activate', summary: 'Alterna o Cérebro ativo com 1 clique', auth: 'JWT / Sessão' },
  { group: 'Cérebro & Multi-Brain', method: 'POST', path: '/api/v1/brain/export', summary: 'Exporta pacote portátil .jarvis-pack.json (sem segredos)', auth: 'JWT / Sessão' },
  { group: 'Cérebro & Multi-Brain', method: 'POST', path: '/api/v1/brain/import', summary: 'Importa e mescla .jarvis-pack.json (ex.: SQLite → Docker)', auth: 'JWT / Sessão' },
  { group: 'Cérebro & Multi-Brain', method: 'POST', path: '/api/v1/brain/bundle.zip', summary: 'Baixa o pacote completo Dual-Mode (docker-compose + Dockerfile + SQLite)', auth: 'JWT / Sessão' },

  { group: 'Autenticação & App Android', method: 'POST', path: '/api/v1/auth/login', summary: 'Autenticação com sessão segura e controle de papel (RBAC)', auth: 'JWT / Sessão' },
  { group: 'Autenticação & App Android', method: 'POST', path: '/api/v1/devices/pair/init', summary: 'Gera QR Code efêmero (10 min, uso único) para pareamento Android', auth: 'JWT / Sessão' },
  { group: 'Autenticação & App Android', method: 'POST', path: '/api/v1/devices/pair/confirm', summary: 'Confirma pareamento e grava chave revogável no Android Keystore', auth: 'JWT / Sessão' },
  { group: 'Autenticação & App Android', method: 'DELETE', path: '/api/v1/devices/:id', summary: 'Revoga o acesso de qualquer celular ou tablet instantaneamente', auth: 'JWT / Sessão' },
  { group: 'Autenticação & App Android', method: 'POST', path: '/api/v1/android-app/package.zip', summary: 'Empacota o projeto oficial Capacitor 6 + Kotlin/XML para APK/AAB', auth: 'JWT / Sessão' },

  { group: 'Chat, Voz & Agentes', method: 'POST', path: '/api/v1/chat/stream', summary: 'Streaming em tempo real com roteamento de agentes e Mesa Redonda (/debate)', auth: 'JWT / Sessão' },
  { group: 'Chat, Voz & Agentes', method: 'DELETE', path: '/api/v1/chat/sessions/:id', summary: 'Exclusão definitiva de conversas salvas (incluindo /debate)', auth: 'JWT / Sessão' },
  { group: 'Chat, Voz & Agentes', method: 'GET', path: '/api/v1/agents', summary: 'Lista agentes instalados, personalizados e templates disponíveis', auth: 'JWT / Sessão' },
  { group: 'Chat, Voz & Agentes', method: 'PUT', path: '/api/v1/skills/:id/agents', summary: 'Vínculo bidirecional Habilidades ↔ Agentes em tempo real', auth: 'JWT / Sessão' },
  { group: 'Chat, Voz & Agentes', method: 'POST', path: '/api/v1/voice/turn', summary: 'Turno conversacional mãos-livres ("Ei [Nome]") com resposta falada', auth: 'JWT / Sessão' },

  { group: 'Estúdios, Apps & GitHub', method: 'POST', path: '/api/v1/spreadsheets/generate', summary: 'Gera planilhas Excel reais (.xlsx com fórmulas) e .csv', auth: 'JWT / Sessão' },
  { group: 'Estúdios, Apps & GitHub', method: 'POST', path: '/api/v1/media/images', summary: 'Criação e edição multimodal com Gemini Image Studio', auth: 'JWT / Sessão' },
  { group: 'Estúdios, Apps & GitHub', method: 'POST', path: '/api/v1/media/videos', summary: 'Geração de vídeos curtos com Gemini Omni Flash (Interactions API)', auth: 'JWT / Sessão' },
  { group: 'Estúdios, Apps & GitHub', method: 'POST', path: '/api/v1/apps/scaffold', summary: 'Construtor de Apps Android (.apk) & Windows (.exe) em pacote .zip', auth: 'JWT / Sessão' },
  { group: 'Estúdios, Apps & GitHub', method: 'POST', path: '/api/v1/github/inspect', summary: 'Leitura somente-leitura de repositórios públicos do GitHub', auth: 'JWT / Sessão' },
  { group: 'Estúdios, Apps & GitHub', method: 'POST', path: '/api/v1/github/incorporate', summary: 'Incorpora repo como Habilidade, Agente ou Base de Conhecimento', auth: 'JWT / Sessão' },

  { group: 'Fluxos, Memória & Segurança', method: 'POST', path: '/api/v1/workflows/:id/run', summary: 'Executa fluxos visuais multi-agentes e registra log por etapa', auth: 'JWT / Sessão' },
  { group: 'Fluxos, Memória & Segurança', method: 'POST', path: '/api/v1/knowledge/search', summary: 'Busca semântica no Segundo Cérebro (sqlite-vec / pgvector)', auth: 'JWT / Sessão' },
  { group: 'Fluxos, Memória & Segurança', method: 'POST', path: '/api/v1/approvals/:id/decide', summary: 'Aprovação humana 1-toque para ações sensíveis (Kira Sentinela)', auth: 'JWT / Sessão' },
];

export const UNIFIED_SCHEMA_TABLES = [
  { name: 'brain_identity', role: 'Identidade, modo (local_sqlite / docker_postgres), versão e políticas padrão' },
  { name: 'users & paired_devices', role: 'Contas RBAC, celulares Android pareados por QR Code e tokens revogáveis' },
  { name: 'agents & agent_versions', role: 'Agentes instalados/criados, mascote, modelo preferido, prompt e histórico' },
  { name: 'skills & agent_skills', role: 'Habilidades nativas, customizadas ou do GitHub + tabela pivô N:N' },
  { name: 'chat_sessions & chat_messages', role: 'Conversas, debates (/debate), anexos e exclusão em cascata' },
  { name: 'knowledge_documents & chunks', role: 'Cadernos, PDFs e repos GitHub com vetores (sqlite-vec / pgvector)' },
  { name: 'workflows & workflow_runs', role: 'Fluxos visuais, agendamentos Cron e histórico de execuções' },
  { name: 'media_assets & generated_artifacts', role: 'Planilhas .xlsx, imagens, vídeos e pacotes .zip Android/Windows' },
  { name: 'approvals & audit_logs', role: 'Fila de aprovações humanas e trilha imutável da Kira Sentinela' },
];

function isPrivateLanOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) {
    return true;
  }
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(host)) return true; // Tailscale CGNAT
  return false;
}

function isBlockedMetadataHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === '169.254.169.254' ||
    host.startsWith('169.254.') ||
    host === 'metadata.google.internal' ||
    host === 'metadata.goog' ||
    host === '0.0.0.0' ||
    host === '::' ||
    host.startsWith('fe80:')
  ) {
    return true;
  }
  return false;
}

/**
 * Valida URL de um Cérebro JARVIS antes de salvar ou testar conexão.
 * - Exige HTTPS para servidores remotos.
 * - Permite HTTP apenas para localhost, rede local (192.168.x.x / 10.x.x.x / 172.16-31.x.x / Tailscale) ou mDNS (.local).
 * - Bloqueia esquemas perigosos, credenciais embutidas na URL e endereços de metadados de nuvem.
 */
export function validateBrainProfileUrl(rawUrl: string): {
  valid: boolean;
  normalizedUrl: string;
  isLocalLan: boolean;
  error?: string;
} {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return { valid: false, normalizedUrl: '', isLocalLan: false, error: 'Informe o endereço do servidor do Cérebro.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      normalizedUrl: '',
      isLocalLan: false,
      error: 'Endereço inválido. Use algo como http://localhost:3000 ou https://meu-cerebro.ts.net',
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      valid: false,
      normalizedUrl: '',
      isLocalLan: false,
      error: 'Use apenas conexões http:// (rede local) ou https:// (remoto).',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      normalizedUrl: '',
      isLocalLan: false,
      error: 'Não inclua usuário ou senha no endereço do servidor.',
    };
  }

  if (isBlockedMetadataHost(parsed.hostname)) {
    return {
      valid: false,
      normalizedUrl: '',
      isLocalLan: false,
      error: 'Este endereço reservado não é permitido como servidor de Cérebro.',
    };
  }

  const localLan = isPrivateLanOrLocalHost(parsed.hostname);
  if (parsed.protocol === 'http:' && !localLan) {
    return {
      valid: false,
      normalizedUrl: '',
      isLocalLan: false,
      error: 'Servidores externos precisam usar HTTPS seguro (https://). HTTP é liberado apenas na sua rede local.',
    };
  }

  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  const normalizedUrl = `${parsed.protocol}//${parsed.host}${cleanPath === '/' ? '' : cleanPath}`;
  return { valid: true, normalizedUrl, isLocalLan: localLan };
}

export function createDefaultBrainProfiles(currentOrigin = 'http://localhost:3000'): BrainConnectionProfile[] {
  const safeOrigin = validateBrainProfileUrl(currentOrigin).valid
    ? validateBrainProfileUrl(currentOrigin).normalizedUrl
    : 'http://localhost:3000';
  const now = new Date().toISOString();

  return [
    {
      id: 'brain_local_primary',
      name: 'Esta Máquina · Local (Sem Docker)',
      baseUrl: safeOrigin,
      mode: 'local_sqlite',
      databaseEngine: 'SQLite WAL + sqlite-vec',
      description: 'Banco local leve em pasta única (~/JARVIS-Brain). Ideal para uso direto sem precisar instalar Docker.',
      isDefault: true,
      isLocalCurrent: true,
      status: 'online',
      latencyMs: 4,
      lastCheckedAt: now,
      capabilities: ['sqlite-wal', 'gemini-cloud', 'excel-xlsx', 'apps-zip', 'github-import', 'android-qr'],
      version: '3.8.0-dual',
    },
    {
      id: 'brain_docker_home',
      name: 'Casa · Docker (PostgreSQL + pgvector)',
      baseUrl: 'http://192.168.1.50:3000',
      mode: 'docker_postgres',
      databaseEngine: 'PostgreSQL 16 + pgvector + Redis',
      description: 'Container completo com busca vetorial massiva, fila Redis para fluxos e Ollama opcional com GPU.',
      isDefault: false,
      isLocalCurrent: false,
      status: 'offline',
      latencyMs: null,
      lastCheckedAt: null,
      capabilities: ['postgres-pgvector', 'redis-queue', 'ollama-local', 'caddy-https', 'mdns-local'],
      version: '3.8.0-docker',
    },
    {
      id: 'brain_remote_tailscale',
      name: 'Acesso Remoto · Tailscale / VPS HTTPS',
      baseUrl: 'https://meu-jarvis.ts.net',
      mode: 'cloud',
      databaseEngine: 'PostgreSQL 16 + Caddy HTTPS',
      description: 'Conecte o navegador e o App Android de qualquer lugar com túnel criptografado sem abrir portas no roteador.',
      isDefault: false,
      isLocalCurrent: false,
      status: 'offline',
      latencyMs: null,
      lastCheckedAt: null,
      capabilities: ['https-tls', 'tailscale-vpn', 'android-push', 'auto-backup'],
      version: '3.8.0-docker',
    },
  ];
}

export function validateJarvisBrainPack(raw: unknown): {
  valid: boolean;
  pack?: JarvisBrainPack;
  error?: string;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: 'Arquivo inválido: o pacote .jarvis-pack precisa ser um objeto JSON.' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== 'jarvis-brain-pack' || obj.schemaVersion !== '1.0') {
    return {
      valid: false,
      error: 'Formato não reconhecido. Selecione um arquivo exportado pelo JARVIS (schemaVersion 1.0).',
    };
  }

  const rawAgents = Array.isArray(obj.agents) ? obj.agents.slice(0, 80) : [];
  const rawSkills = Array.isArray(obj.skills) ? obj.skills.slice(0, 120) : [];
  const rawWorkflows = Array.isArray(obj.workflows) ? obj.workflows.slice(0, 60) : [];
  const rawKnowledge = Array.isArray(obj.knowledge) ? obj.knowledge.slice(0, 100) : [];

  const agents: JarvisBrainPackAgent[] = rawAgents
    .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === 'object'))
    .map((a) => ({
      role: String(a.role || '').trim().replace(/[^a-z0-9_-]/gi, '_').slice(0, 60),
      name: String(a.name || '').trim().slice(0, 80),
      handle: String(a.handle || '').trim().slice(0, 40),
      description: String(a.description || '').trim().slice(0, 400),
      system_prompt: String(a.system_prompt || '').trim().slice(0, 4000),
      installed_skills: Array.isArray(a.installed_skills)
        ? a.installed_skills.map((s) => String(s).trim().slice(0, 80)).filter(Boolean).slice(0, 20)
        : [],
      is_custom: Boolean(a.is_custom),
    }))
    .filter((a) => a.role.length >= 2 && a.name.length >= 2);

  const skills: JarvisBrainPackSkill[] = rawSkills
    .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
    .map((s) => ({
      id: String(s.id || `skill_imp_${Math.random().toString(36).slice(2, 8)}`).trim().slice(0, 80),
      name: String(s.name || '').trim().slice(0, 90),
      description: String(s.description || '').trim().slice(0, 400),
      domain: String(s.domain || 'geral').trim().slice(0, 40),
      instructions: String(s.instructions || '').trim().slice(0, 3000),
      assigned_agents: Array.isArray(s.assigned_agents)
        ? s.assigned_agents.map((r) => String(r).trim().slice(0, 60)).filter(Boolean).slice(0, 25)
        : [],
    }))
    .filter((s) => s.name.length >= 2);

  const workflows: JarvisBrainPackWorkflow[] = rawWorkflows
    .filter((w): w is Record<string, unknown> => Boolean(w && typeof w === 'object'))
    .map((w) => ({
      id: String(w.id || `wf_imp_${Math.random().toString(36).slice(2, 8)}`).trim().slice(0, 80),
      title: String(w.title || '').trim().slice(0, 100),
      description: String(w.description || '').trim().slice(0, 400),
      schedule_cron: typeof w.schedule_cron === 'string' ? w.schedule_cron.trim().slice(0, 40) : '0 8 * * *',
      schedule_enabled: Boolean(w.schedule_enabled),
      nodes: Array.isArray(w.nodes) ? w.nodes.slice(0, 30) : [],
      edges: Array.isArray(w.edges) ? w.edges.slice(0, 50) : [],
    }))
    .filter((w) => w.title.length >= 2);

  const knowledge: JarvisBrainPackKnowledge[] = rawKnowledge
    .filter((k): k is Record<string, unknown> => Boolean(k && typeof k === 'object'))
    .map((k) => ({
      name: String(k.name || '').trim().slice(0, 120),
      category: String(k.category || 'geral').trim().slice(0, 40),
      content: String(k.content || '').slice(0, 40000),
      file_type: String(k.file_type || 'md').trim().slice(0, 16),
    }))
    .filter((k) => k.name.length >= 2 && k.content.length > 0);

  const src = (obj.sourceBrain && typeof obj.sourceBrain === 'object' ? obj.sourceBrain : {}) as Record<string, unknown>;
  const modeRaw = String(src.mode || 'local_sqlite');
  const mode: BrainMode =
    modeRaw === 'docker_postgres' || modeRaw === 'cloud' ? modeRaw : 'local_sqlite';

  return {
    valid: true,
    pack: {
      schemaVersion: '1.0',
      format: 'jarvis-brain-pack',
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
      sourceBrain: {
        name: String(src.name || 'Cérebro Importado').trim().slice(0, 80),
        mode,
        databaseEngine: String(src.databaseEngine || 'SQLite WAL').trim().slice(0, 60),
        version: String(src.version || '3.8.0').trim().slice(0, 24),
      },
      agents,
      skills,
      workflows,
      knowledge,
    },
  };
}

function sanitizeDbName(name: string): string {
  const clean = String(name || 'jarvis_brain')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+/, '')
    .slice(0, 40);
  return clean || 'jarvis_brain';
}

/**
 * Gera os 8 arquivos reais do Servidor Dual-Mode (Local SQLite sem Docker + Docker Compose PostgreSQL/pgvector/Redis/Ollama).
 * Nunca embute segredos ou senhas reais — usa exclusivamente variáveis de ambiente (${VAR}).
 */
export function buildDualModeServerArtifacts(
  partial?: Partial<BrainDeploymentOptions>
): GeneratedServerArtifact[] {
  const opts: BrainDeploymentOptions = {
    ...DEFAULT_DEPLOYMENT_OPTIONS,
    ...partial,
    port: Math.min(65535, Math.max(1024, Number(partial?.port || DEFAULT_DEPLOYMENT_OPTIONS.port) || 3000)),
    postgresDb: sanitizeDbName(partial?.postgresDb || DEFAULT_DEPLOYMENT_OPTIONS.postgresDb),
    brainName: String(partial?.brainName || DEFAULT_DEPLOYMENT_OPTIONS.brainName).trim().slice(0, 64) || DEFAULT_DEPLOYMENT_OPTIONS.brainName,
    assistantName: String(partial?.assistantName || DEFAULT_DEPLOYMENT_OPTIONS.assistantName).trim().slice(0, 32) || 'JARVIS',
    dataDir: String(partial?.dataDir || DEFAULT_DEPLOYMENT_OPTIONS.dataDir).trim().slice(0, 120) || '~/JARVIS-Brain',
  };

  const ollamaBlock = opts.enableOllama
    ? `
  # Motor local opcional de modelos privados (ativar com: docker compose --profile local-ai up -d)
  jarvis-ollama:
    image: ollama/ollama:latest
    container_name: jarvis-ollama
    profiles: ["local-ai"]
    restart: unless-stopped
    ports:
      - "11434:11434"
    volumes:
      - jarvis_ollama_models:/root/.ollama
`
    : '';

  const gatewayBlock = opts.enableRemoteGateway
    ? `
  # Proxy HTTPS automático para acesso remoto seguro do App Android (ativar com: --profile remote)
  jarvis-gateway:
    image: caddy:2-alpine
    container_name: jarvis-gateway
    profiles: ["remote"]
    restart: unless-stopped
    depends_on:
      - jarvis-brain-api
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - jarvis_caddy_data:/data
      - jarvis_caddy_config:/config
`
    : '';

  const pythonWorkerBlock = opts.enablePythonWorker
    ? `
  # Worker Python FastAPI opcional para OCR pesado e automações científicas (--profile python-worker)
  jarvis-python-worker:
    image: python:3.12-slim
    container_name: jarvis-python-worker
    profiles: ["python-worker"]
    restart: unless-stopped
    environment:
      - REDIS_URL=redis://jarvis-brain-redis:6379
    command: ["sh", "-c", "echo 'Worker Python pronto para fila Redis' && sleep infinity"]
`
    : '';

  const extraVolumes = [
    opts.enableOllama ? '  jarvis_ollama_models:' : '',
    opts.enableRemoteGateway ? '  jarvis_caddy_data:\n  jarvis_caddy_config:' : '',
  ]
    .filter(Boolean)
    .join('\n');

  const dockerCompose = `# JARVIS AI Hub — Cérebro Dual-Mode (Docker Compose Avançado)
# Suba o núcleo completo com: docker compose up -d
# Com IA local Ollama:          docker compose --profile local-ai up -d
# Com HTTPS remoto (Caddy):     docker compose --profile remote up -d

services:
  jarvis-brain-api:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: jarvis-brain-api
    restart: unless-stopped
    ports:
      - "\${PORT:-${opts.port}}:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - BRAIN_MODE=docker_postgres
      - BRAIN_NAME=\${BRAIN_NAME:-${opts.brainName}}
      - ASSISTANT_NAME=\${ASSISTANT_NAME:-${opts.assistantName}}
      - DATABASE_URL=postgresql://\${POSTGRES_USER:-jarvis}:\${POSTGRES_PASSWORD:?Defina POSTGRES_PASSWORD no .env}@jarvis-brain-db:5432/\${POSTGRES_DB:-${opts.postgresDb}}
      - REDIS_URL=redis://jarvis-brain-redis:6379
      - GEMINI_API_KEY=\${GEMINI_API_KEY:-}
      - GITHUB_TOKEN=\${GITHUB_TOKEN:-}
      - OLLAMA_HOST=\${OLLAMA_HOST:-http://jarvis-ollama:11434}
      - JWT_SECRET=\${JWT_SECRET:?Defina JWT_SECRET no .env}
      - MDNS_ENABLED=true
    depends_on:
      jarvis-brain-db:
        condition: service_healthy
      jarvis-brain-redis:
        condition: service_healthy
    volumes:
      - jarvis_brain_storage:/app/storage
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/v1/brain/health"]
      interval: 20s
      timeout: 5s
      retries: 3

  jarvis-brain-db:
    image: pgvector/pgvector:pg16
    container_name: jarvis-brain-db
    restart: unless-stopped
    environment:
      - POSTGRES_USER=\${POSTGRES_USER:-jarvis}
      - POSTGRES_PASSWORD=\${POSTGRES_PASSWORD:?Defina POSTGRES_PASSWORD no .env}
      - POSTGRES_DB=\${POSTGRES_DB:-${opts.postgresDb}}
    volumes:
      - jarvis_pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-jarvis} -d \${POSTGRES_DB:-${opts.postgresDb}}"]
      interval: 10s
      timeout: 5s
      retries: 5

  jarvis-brain-redis:
    image: redis:7-alpine
    container_name: jarvis-brain-redis
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - jarvis_redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
${ollamaBlock}${gatewayBlock}${pythonWorkerBlock}
volumes:
  jarvis_brain_storage:
  jarvis_pg_data:
  jarvis_redis_data:
${extraVolumes}
`;

  const dockerfile = `# Imagem multi-stage ultra-leve (~90MB) para o Cérebro JARVIS em TypeScript/Node 22
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/storage && chown -R node:node /app
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server.ts ./server.ts
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/src/services ./src/services

USER node
EXPOSE 3000

HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \\
  CMD wget -qO- http://127.0.0.1:3000/api/v1/brain/health || exit 1

CMD ["npx", "tsx", "server.ts"]
`;

  const envExample = `# ==========================================================
# JARVIS AI Hub — Configuração do Servidor ("Cérebro")
# Copie para .env e preencha apenas o necessário.
# NUNCA faça commit do arquivo .env com chaves reais!
# ==========================================================

# Escolha o modo do banco:
#   local_sqlite    -> Sem Docker (salva tudo em ~/JARVIS-Brain/brain.db)
#   docker_postgres -> Com Docker Compose (PostgreSQL 16 + pgvector + Redis)
BRAIN_MODE=${opts.mode}
BRAIN_NAME=${opts.brainName}
ASSISTANT_NAME=${opts.assistantName}
PORT=${opts.port}

# Modo Local (Sem Docker)
SQLITE_DATA_DIR=${opts.dataDir}
SQLITE_DB_PATH=${opts.dataDir}/brain.db

# Modo Docker (PostgreSQL + pgvector + Redis)
POSTGRES_USER=jarvis
POSTGRES_PASSWORD=
POSTGRES_DB=${opts.postgresDb}
DATABASE_URL=
REDIS_URL=redis://localhost:6379

# Segurança da Sessão (gere uma string aleatória longa)
JWT_SECRET=

# Provedores de IA & Integrações (ficam SOMENTE no servidor)
GEMINI_API_KEY=
GITHUB_TOKEN=
OLLAMA_HOST=http://127.0.0.1:11434
`;

  const drizzleSchema = `/**
 * Modelagem de Dados Unificada — JARVIS Brain (SQLite Local & PostgreSQL Docker)
 *
 * Mantém o mesmo contrato de entidades nos dois motores:
 *   - Modo Comum (Sem Docker): SQLite WAL + sqlite-vec
 *   - Modo Avançado (Docker):  PostgreSQL 16 + pgvector
 */

export interface BrainIdentityRow {
  id: string;
  name: string;
  mode: 'local_sqlite' | 'docker_postgres';
  schema_version: string;
  assistant_name: string;
  created_at: string;
}

export interface PairedDeviceRow {
  id: string;
  user_id: string;
  device_name: string;
  platform: 'android' | 'desktop' | 'web';
  token_hash: string;
  revoked_at: string | null;
  last_seen_at: string;
}

export interface AgentRow {
  role: string;
  name: string;
  handle: string;
  description: string;
  system_prompt: string;
  preferred_model: string;
  autonomy_level: 'confirm' | 'auto_safe' | 'autonomous';
  is_custom: boolean;
  version: number;
  updated_at: string;
}

export interface SkillRow {
  id: string;
  name: string;
  origin: 'system' | 'custom' | 'github';
  domain: string;
  description: string;
  instructions: string;
  is_approved: boolean;
  updated_at: string;
}

export interface AgentSkillLinkRow {
  agent_role: string;
  skill_id: string;
  linked_at: string;
}

export interface ChatSessionRow {
  id: string;
  user_id: string;
  title: string;
  mode: 'standard' | 'agent' | 'debate';
  created_at: string;
  updated_at: string;
}

export interface KnowledgeDocumentRow {
  id: string;
  name: string;
  category: string;
  content: string;
  embedding_dim: number;
  indexed_at: string;
}

export interface WorkflowRow {
  id: string;
  title: string;
  description: string;
  schedule_cron: string | null;
  schedule_enabled: boolean;
  graph_json: string;
  updated_at: string;
}

export const SQL_BOOTSTRAP_SQLITE = \`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS brain_identity (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'local_sqlite',
  schema_version TEXT NOT NULL DEFAULT '1.0',
  assistant_name TEXT NOT NULL DEFAULT '${opts.assistantName}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paired_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  role TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  description TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  preferred_model TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
  autonomy_level TEXT NOT NULL DEFAULT 'confirm',
  is_custom INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'custom',
  domain TEXT NOT NULL DEFAULT 'geral',
  description TEXT NOT NULL,
  instructions TEXT NOT NULL,
  is_approved INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_skills (
  agent_role TEXT NOT NULL REFERENCES agents(role) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL,
  PRIMARY KEY (agent_role, skill_id)
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'standard',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  agent_role TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  schedule_cron TEXT,
  schedule_enabled INTEGER NOT NULL DEFAULT 0,
  graph_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
\`;
`;

  const dualDriver = `/**
 * Adaptador Dual-Mode do Cérebro JARVIS
 * Detecta automaticamente se deve abrir SQLite Local (sem Docker) ou PostgreSQL (Docker).
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export interface ActiveBrainDriverInfo {
  mode: 'local_sqlite' | 'docker_postgres';
  engine: string;
  location: string;
  vectorSupport: string;
  queueBackend: string;
}

export function resolveBrainDriverFromEnv(env = process.env): ActiveBrainDriverInfo {
  const hasPostgres = Boolean(env.DATABASE_URL && env.DATABASE_URL.startsWith('postgres'));
  const explicitDocker = env.BRAIN_MODE === 'docker_postgres';

  if (explicitDocker || hasPostgres) {
    return {
      mode: 'docker_postgres',
      engine: 'PostgreSQL 16 + pgvector',
      location: 'Container Docker (jarvis-brain-db:5432)',
      vectorSupport: 'pgvector HNSW',
      queueBackend: env.REDIS_URL ? 'Redis 7' : 'In-Memory Queue',
    };
  }

  const rawDir = env.SQLITE_DATA_DIR || '${opts.dataDir}';
  const expandedDir = rawDir.startsWith('~/')
    ? path.join(os.homedir(), rawDir.slice(2))
    : rawDir;

  if (!fs.existsSync(expandedDir)) {
    fs.mkdirSync(expandedDir, { recursive: true });
  }

  const dbPath = path.join(expandedDir, 'brain.db');
  return {
    mode: 'local_sqlite',
    engine: 'SQLite WAL + sqlite-vec',
    location: dbPath,
    vectorSupport: 'sqlite-vec (embarcado)',
    queueBackend: 'Agendador Local Nativo',
  };
}
`;

  const startLocalScript = `#!/usr/bin/env bash
set -euo pipefail

# Inicia o Cérebro JARVIS diretamente na máquina (SEM Docker) com banco SQLite local.
DATA_DIR="\${SQLITE_DATA_DIR:-$HOME/JARVIS-Brain}"
mkdir -p "$DATA_DIR/media" "$DATA_DIR/spreadsheets" "$DATA_DIR/backups"

export BRAIN_MODE="local_sqlite"
export BRAIN_NAME="${opts.brainName}"
export ASSISTANT_NAME="${opts.assistantName}"
export SQLITE_DATA_DIR="$DATA_DIR"
export PORT="\${PORT:-${opts.port}}"

echo "============================================================"
echo "  JARVIS Brain · Modo Local (Sem Docker)"
echo "  Banco de dados: $DATA_DIR/brain.db (SQLite WAL)"
echo "  URL Local:      http://localhost:$PORT"
echo "  mDNS Wi-Fi:     _jarvis-brain._tcp.local"
echo "============================================================"

npm install --no-audit --no-fund
npm run dev
`;

  const caddyfile = `# Gateway HTTPS Automático para o Cérebro JARVIS (Modo Docker --profile remote)
# Substitua seu-dominio.exemplo.com pelo domínio apontado para o seu servidor
# ou use Tailscale Serve (tailscale serve https / http://127.0.0.1:${opts.port}) sem abrir portas!

{\n  email seu-email@exemplo.com\n}

seu-cerebro.exemplo.com {
  encode zstd gzip
  reverse_proxy jarvis-brain-api:3000 {
    flush_interval -1
  }
}
`;

  const readme = `# ${opts.brainName} — Guia do Servidor Dual-Mode (Sem Docker vs. Docker)

Este pacote permite rodar o **Cérebro do JARVIS** exatamente do jeito que faz sentido para você — usando **o mesmo código-fonte em TypeScript + Node.js 22 LTS** e o mesmo contrato de API \`/api/v1\`:

---

## Opção 1 — Usuário Comum (Sem Docker, direto na máquina)
Ideal para quem quer instalar rápido no próprio notebook ou PC sem configurar contêineres.

- **Banco de Dados**: SQLite em modo WAL + \`sqlite-vec\` salvo em pasta única (\`${opts.dataDir}/brain.db\`).
- **Backup fácil**: basta copiar a pasta \`${opts.dataDir}\` ou clicar em **Exportar .jarvis-pack** no Hub.
- **Como iniciar**:
  \`\`\`bash
  cp .env.example .env
  chmod +x scripts/start-local-brain.sh
  ./scripts/start-local-brain.sh
  \`\`\`

---

## Opção 2 — Usuário Avançado (Docker Compose Completo)
Ideal para rodar em um Mini PC, NAS, servidor doméstico ou VPS com alta escala e fila assíncrona.

- **Serviços incluídos**:
  1. \`jarvis-brain-api\` — API TypeScript + SSE/WebSocket (porta \`${opts.port}\`)
  2. \`jarvis-brain-db\` — **PostgreSQL 16 + pgvector**
  3. \`jarvis-brain-redis\` — Fila de jobs, fluxos agendados e cache rápido
  4. \`jarvis-ollama\` *(opcional \`--profile local-ai\`)* — Modelos privados 100% offline
  5. \`jarvis-gateway\` *(opcional \`--profile remote\`)* — HTTPS automático com Caddy
- **Como iniciar**:
  \`\`\`bash
  cp .env.example .env
  # Preencha POSTGRES_PASSWORD, JWT_SECRET e GEMINI_API_KEY no arquivo .env
  docker compose up -d
  # Ou com IA local Ollama:
  docker compose --profile local-ai up -d
  \`\`\`

---

## Conectando Múltiplos Cérebros (Web + App Android)
1. No Hub Web ou no App Android, abra **Cérebros & Servidor**.
2. Cadastre quantos cérebros quiser (*Notebook Local*, *Casa Docker*, *Escritório HTTPS*).
3. Alterne entre eles com **1 clique** — ou migre seus agentes, habilidades, fluxos e memória do **SQLite Local → Docker PostgreSQL** usando **Exportar / Importar \`.jarvis-pack.json\`**.
`;

  return [
    {
      path: 'docker-compose.yml',
      language: 'yaml',
      description: 'Stack Docker completa: API Node 22 + PostgreSQL 16/pgvector + Redis + perfis Ollama/Caddy',
      content: dockerCompose,
    },
    {
      path: 'Dockerfile',
      language: 'dockerfile',
      description: 'Imagem de produção multi-stage Node.js 22 Alpine (~90MB, usuário não-root e healthcheck)',
      content: dockerfile,
    },
    {
      path: '.env.example',
      language: 'env',
      description: 'Variáveis de ambiente Dual-Mode (sem segredos embutidos — copie para .env)',
      content: envExample,
    },
    {
      path: 'src/db/schema.ts',
      language: 'typescript',
      description: 'Modelagem unificada (brain_identity, devices, agents, skills, chats, knowledge, workflows)',
      content: drizzleSchema,
    },
    {
      path: 'src/db/driver.ts',
      language: 'typescript',
      description: 'Adaptador automático: abre SQLite WAL local ou PostgreSQL Docker conforme ambiente',
      content: dualDriver,
    },
    {
      path: 'scripts/start-local-brain.sh',
      language: 'bash',
      description: 'Inicializador 1-comando para usuários comuns rodarem sem Docker (SQLite local)',
      content: startLocalScript,
    },
    {
      path: 'Caddyfile',
      language: 'caddy',
      description: 'Proxy reverso HTTPS automático para conectar o App Android de qualquer lugar',
      content: caddyfile,
    },
    {
      path: 'README_CEREBRO_DUAL_MODE.md',
      language: 'markdown',
      description: 'Guia completo em português: Modo Local vs Docker, mDNS e migração .jarvis-pack',
      content: readme,
    },
  ];
}
