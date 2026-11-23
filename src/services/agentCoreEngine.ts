/**
 * Motor puro do Schema de Núcleo Individual de Agentes (Agent Core Schema).
 *
 * Cada agente no Hub possui seu próprio núcleo autônomo isolado:
 * - Loop de orquestração próprio (direct, react, plan_execute_verify, plan_critique_blueprint)
 * - Provedor/modelo primário e fallback independentes
 * - Política de autonomia, limite de passos, profundidade de delegação e orçamento diário
 * - Workspace isolado com SOUL.md e MEMORY.md próprios
 * - Lista própria de servidores MCP permitidos e agendamento cron opcional
 */

export type AgentOrchestrationMode =
  | 'direct'
  | 'react'
  | 'plan_execute_verify'
  | 'plan_critique_blueprint';

export type AgentAutonomyPolicy = 'ask' | 'auto_safe' | 'auto';

export type AgentCoreStatus = 'active' | 'paused';

export interface AgentCoreConfig {
  agent_role: string;
  workspace_slug: string;
  orchestration_mode: AgentOrchestrationMode;
  max_steps: number;
  max_delegation_depth: number;
  primary_provider: string;
  primary_model: string;
  fallback_provider: string;
  fallback_model: string;
  autonomy_policy: AgentAutonomyPolicy;
  daily_budget_usd: number;
  allowed_mcp_servers: string[];
  soul_markdown: string;
  memory_markdown: string;
  cron_schedule: string | null;
  pack_id: string | null;
  status: AgentCoreStatus;
  updated_at: string;
}

export interface AgentCorePatch {
  orchestration_mode?: AgentOrchestrationMode | string;
  max_steps?: number;
  max_delegation_depth?: number;
  primary_provider?: string;
  primary_model?: string;
  fallback_provider?: string;
  fallback_model?: string;
  autonomy_policy?: AgentAutonomyPolicy | string;
  daily_budget_usd?: number;
  allowed_mcp_servers?: string[];
  soul_markdown?: string;
  memory_markdown?: string;
  cron_schedule?: string | null;
  pack_id?: string | null;
  status?: AgentCoreStatus | string;
}

export interface AgentCoreSeedMeta {
  name?: string;
  proper_name?: string;
  handle?: string;
  mission?: string;
  preferred_model?: string;
  pack_id?: string | null;
}

export interface AgentCoreReadiness {
  completenessPct: number;
  hasSoul: boolean;
  hasMemory: boolean;
  hasFallback: boolean;
  hasMcp: boolean;
  orchestrationLabel: string;
  autonomyLabel: string;
}

export const ORCHESTRATION_MODE_LABELS: Record<AgentOrchestrationMode, string> = {
  direct: 'Direto (1 passo)',
  react: 'ReAct (Pensar → Ferramenta → Observar)',
  plan_execute_verify: 'Planejar → Executar → Verificar',
  plan_critique_blueprint: 'Planejar → Criticar → Blueprint',
};

export const AUTONOMY_POLICY_LABELS: Record<AgentAutonomyPolicy, string> = {
  ask: 'Sempre pedir aprovação',
  auto_safe: 'Autônomo em leitura/ações seguras',
  auto: 'Autonomia completa com teto de custo',
};

export const ALLOWED_ORCHESTRATION_MODES: readonly AgentOrchestrationMode[] = [
  'direct',
  'react',
  'plan_execute_verify',
  'plan_critique_blueprint',
] as const;

export const ALLOWED_AUTONOMY_POLICIES: readonly AgentAutonomyPolicy[] = [
  'ask',
  'auto_safe',
  'auto',
] as const;

export const ALLOWED_PROVIDERS: readonly string[] = [
  'gemini',
  'openai',
  'anthropic',
  'deepseek',
  'groq',
  'openrouter',
  'ollama',
] as const;

export const KNOWN_MCP_SERVERS: ReadonlyArray<{ id: string; label: string; scope: string }> = [
  { id: 'mcp_local_workspace', label: 'Workspace Local (Leitura/Escrita)', scope: 'arquivos' },
  { id: 'mcp_git_inspector', label: 'Git & Repositório', scope: 'código' },
  { id: 'mcp_sqlite_readonly', label: 'SQLite & Schema Inspector', scope: 'dados' },
  { id: 'mcp_audit_readonly', label: 'Auditoria & Logs (Somente Leitura)', scope: 'segurança' },
  { id: 'mcp_web_research', label: 'Pesquisa Documental & Docs', scope: 'pesquisa' },
] as const;

export const AGENT_CORE_PRESETS: Record<string, Partial<AgentCoreConfig>> = {
  jarvis_master: {
    orchestration_mode: 'plan_execute_verify',
    max_steps: 10,
    max_delegation_depth: 3,
    primary_provider: 'gemini',
    primary_model: 'gemini-2.5-flash',
    fallback_provider: 'openai',
    fallback_model: 'gpt-4.1-mini',
    autonomy_policy: 'auto_safe',
    daily_budget_usd: 10,
    allowed_mcp_servers: ['mcp_local_workspace', 'mcp_audit_readonly'],
    soul_markdown: [
      '# SOUL — Maestro Orquestrador',
      '',
      '## Identidade',
      'Você coordena o Hub, decompõe objetivos complexos e delega subtarefas aos núcleos especialistas mantendo coerência e segurança.',
      '',
      '## Princípios de Operação',
      '- Prefira delegar tarefas técnicas profundas para o agente especialista mais adequado.',
      '- Nunca execute ações destrutivas sem confirmação explícita do usuário.',
      '- Resuma resultados com clareza, próximos passos e riscos reais.',
    ].join('\n'),
    memory_markdown: [
      '# MEMORY — Maestro Orquestrador',
      '',
      '- Priorizar respostas diretas em português do Brasil.',
      '- Manter rastreabilidade de delegações entre núcleos.',
    ].join('\n'),
  },
  architect: {
    orchestration_mode: 'plan_critique_blueprint',
    max_steps: 12,
    max_delegation_depth: 2,
    primary_provider: 'gemini',
    primary_model: 'gemini-2.5-pro',
    fallback_provider: 'anthropic',
    fallback_model: 'claude-3-7-sonnet-latest',
    autonomy_policy: 'auto_safe',
    daily_budget_usd: 15,
    allowed_mcp_servers: ['mcp_local_workspace', 'mcp_git_inspector', 'mcp_sqlite_readonly'],
    pack_id: 'engineering_architecture',
    soul_markdown: [
      '# SOUL — Vetor (Arquiteto de Sistemas)',
      '',
      '## Missão',
      'Projetar arquiteturas resilientes, modulares e evolutivas usando C4 Model, ADRs (Architecture Decision Records), contratos de dados explícitos e análise objetiva de trade-offs.',
      '',
      '## Protocolo de Raciocínio',
      '1. Levantamento de requisitos funcionais e não-funcionais (latência, escala, custo, privacidade).',
      '2. Proposta de arquitetura em camadas (Contexto → Contêineres → Componentes → Schema).',
      '3. Crítica ativa: identifique gargalos, pontos únicos de falha e riscos de acoplamento.',
      '4. Entrega do Blueprint final + ADR numerada pronta para implementação.',
    ].join('\n'),
    memory_markdown: [
      '# MEMORY — Vetor (Arquiteto de Sistemas)',
      '',
      '- Stack principal do Hub: React 19 + Vite + Express + SQLite WAL (com caminho limpo para Postgres/Supabase).',
      '- Padrão adotado: núcleos isolados por agente (`agent_cores`) e módulos instaláveis (`installed_packs`).',
    ].join('\n'),
  },
  qa_engineer: {
    orchestration_mode: 'plan_execute_verify',
    max_steps: 8,
    max_delegation_depth: 1,
    primary_provider: 'gemini',
    primary_model: 'gemini-2.5-flash',
    fallback_provider: 'openai',
    fallback_model: 'gpt-4.1-mini',
    autonomy_policy: 'auto_safe',
    daily_budget_usd: 6,
    allowed_mcp_servers: ['mcp_local_workspace', 'mcp_git_inspector'],
    pack_id: 'engineering_architecture',
    soul_markdown: [
      '# SOUL — Lia (Engenheira de QA & Confiabilidade)',
      '',
      '## Missão',
      'Garantir qualidade ponta a ponta com testes unitários determinísticos, cenários de borda, verificação de acessibilidade e cobertura de regressões.',
    ].join('\n'),
    memory_markdown: [
      '# MEMORY — Lia (QA)',
      '',
      '- Validar sempre caminhos felizes, entradas inválidas e persistência após reload.',
    ].join('\n'),
  },
  dev_fullstack: {
    orchestration_mode: 'react',
    max_steps: 14,
    max_delegation_depth: 2,
    primary_provider: 'gemini',
    primary_model: 'gemini-2.5-pro',
    fallback_provider: 'deepseek',
    fallback_model: 'deepseek-chat',
    autonomy_policy: 'auto_safe',
    daily_budget_usd: 12,
    allowed_mcp_servers: ['mcp_local_workspace', 'mcp_git_inspector', 'mcp_sqlite_readonly'],
    pack_id: 'fullstack_dev',
    soul_markdown: [
      '# SOUL — Dante (Engenheiro Full-Stack)',
      '',
      '## Missão',
      'Transformar especificações e ADRs em código limpo, modular, tipado e testado de ponta a ponta (Frontend + API + Banco de Dados).',
    ].join('\n'),
    memory_markdown: [
      '# MEMORY — Dante (Full-Stack)',
      '',
      '- Separar lógica pura testável em módulos dedicados antes de acoplar em componentes React.',
    ].join('\n'),
  },
  code_reviewer: {
    orchestration_mode: 'plan_critique_blueprint',
    max_steps: 8,
    max_delegation_depth: 1,
    primary_provider: 'gemini',
    primary_model: 'gemini-2.5-flash',
    fallback_provider: 'anthropic',
    fallback_model: 'claude-3-5-haiku-latest',
    autonomy_policy: 'ask',
    daily_budget_usd: 5,
    allowed_mcp_servers: ['mcp_git_inspector', 'mcp_audit_readonly'],
    pack_id: 'fullstack_dev',
    soul_markdown: [
      '# SOUL — Nina (Revisora de Código & Git)',
      '',
      '## Missão',
      'Revisar diffs e pull requests focando em legibilidade, contratos de API, tratamento de erros e manutenção de longo prazo.',
    ].join('\n'),
    memory_markdown: [
      '# MEMORY — Nina (Code Review)',
      '',
      '- Apontar sempre severidade (Alta/Média/Baixa) e sugestão prática de correção.',
    ].join('\n'),
  },
  security_sentinel: {
    orchestration_mode: 'plan_critique_blueprint',
    max_steps: 10,
    max_delegation_depth: 1,
    primary_provider: 'gemini',
    primary_model: 'gemini-2.5-pro',
    fallback_provider: 'anthropic',
    fallback_model: 'claude-3-7-sonnet-latest',
    autonomy_policy: 'ask',
    daily_budget_usd: 8,
    allowed_mcp_servers: ['mcp_audit_readonly', 'mcp_git_inspector'],
    pack_id: 'security_soc',
    soul_markdown: [
      '# SOUL — Sentinela (AppSec & Guardrails)',
      '',
      '## Missão',
      'Auditar rotas, isolamento de sessão, queries SQL, limites de arquivos e cofres de segredos garantindo segurança por padrão.',
    ].join('\n'),
    memory_markdown: [
      '# MEMORY — Sentinela (AppSec)',
      '',
      '- Toda query SQL deve ser parametrizada; nenhuma chave privada pode vazar ao cliente.',
    ].join('\n'),
  },
  creative_director: {
    orchestration_mode: 'plan_execute_verify',
    max_steps: 8,
    max_delegation_depth: 2,
    primary_provider: 'gemini',
    primary_model: 'gemini-2.5-flash',
    fallback_provider: 'openai',
    fallback_model: 'gpt-4.1-mini',
    autonomy_policy: 'auto_safe',
    daily_budget_usd: 8,
    allowed_mcp_servers: ['mcp_local_workspace', 'mcp_web_research'],
    pack_id: 'creative_productivity',
    soul_markdown: [
      '# SOUL — Maya (Diretora Criativa & Documentos)',
      '',
      '## Missão',
      'Estruturar relatórios, planilhas, apresentações e roteiros visuais com alto padrão editorial e clareza executiva.',
    ].join('\n'),
    memory_markdown: [
      '# MEMORY — Maya (Criativo)',
      '',
      '- Entregar sempre estrutura escaneável com objetivos claros e próximos passos.',
    ].join('\n'),
  },
  local_infra: {
    orchestration_mode: 'react',
    max_steps: 8,
    max_delegation_depth: 1,
    primary_provider: 'ollama',
    primary_model: 'qwen2.5-coder:7b',
    fallback_provider: 'gemini',
    fallback_model: 'gemini-2.5-flash',
    autonomy_policy: 'auto_safe',
    daily_budget_usd: 4,
    allowed_mcp_servers: ['mcp_local_workspace', 'mcp_sqlite_readonly'],
    pack_id: 'voice_mobile_local',
    soul_markdown: [
      '# SOUL — Orion (Infraestrutura Local & Mobile)',
      '',
      '## Missão',
      'Configurar execução local-first (Ollama, SQLite WAL, Docker), pareamento mobile/PWA e otimização de latência e VRAM.',
    ].join('\n'),
    memory_markdown: [
      '# MEMORY — Orion (Infra Local)',
      '',
      '- Priorizar privacidade local e sincronização resiliente com dispositivos pareados.',
    ].join('\n'),
  },
};

const MAX_MARKDOWN_LENGTH = 24000;

export function normalizeAgentRoleSlug(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

export function isValidAgentRoleSlug(role: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,63}$/.test(role);
}

export function deriveAgentWorkspaceSlug(agentRole: string): string {
  const safe = normalizeAgentRoleSlug(agentRole) || 'agent';
  return `agent_${safe}`;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number, decimals = 0): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const clamped = Math.min(max, Math.max(min, num));
  if (decimals <= 0) return Math.round(clamped);
  const factor = Math.pow(10, decimals);
  return Math.round(clamped * factor) / factor;
}

function sanitizeProvider(raw: unknown, fallback: string): string {
  const clean = String(raw || '').trim().toLowerCase();
  if (ALLOWED_PROVIDERS.includes(clean)) return clean;
  return fallback;
}

function sanitizeModel(raw: unknown, fallback: string): string {
  const clean = String(raw || '').trim().slice(0, 120);
  return clean || fallback;
}

function sanitizeMcpServers(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  const unique = new Set<string>();
  for (const item of raw) {
    const clean = String(item || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '')
      .slice(0, 64);
    if (clean) unique.add(clean);
  }
  return Array.from(unique).slice(0, 20);
}

function sanitizeCronSchedule(raw: unknown, fallback: string | null): string | null {
  if (raw === null || raw === '') return null;
  if (raw === undefined) return fallback;
  const clean = String(raw).trim().slice(0, 80);
  return clean || null;
}

export function buildDefaultAgentCore(
  agentRole: string,
  meta?: AgentCoreSeedMeta,
  now = new Date().toISOString()
): AgentCoreConfig {
  const safeRole = normalizeAgentRoleSlug(agentRole) || 'custom_agent';
  const preset = AGENT_CORE_PRESETS[safeRole] || {};
  const displayName = meta?.proper_name || meta?.name || safeRole;
  const mission =
    meta?.mission || 'Atuar com autonomia controlada, precisão técnica e memória dedicada.';

  const defaultSoul = [
    `# SOUL — ${displayName}`,
    '',
    '## Missão',
    mission,
    '',
    '## Diretrizes do Núcleo',
    '- Operar com clareza, objetividade e rigor técnico.',
    '- Registrar aprendizados relevantes na memória do agente.',
    '- Respeitar a política de autonomia e o teto de custo configurado.',
  ].join('\n');

  const defaultMemory = [
    `# MEMORY — ${displayName}`,
    '',
    `- Papel: ${safeRole}${meta?.handle ? ` (${meta.handle})` : ''}`,
    '- Contexto persistente isolado deste núcleo.',
  ].join('\n');

  return {
    agent_role: safeRole,
    workspace_slug: deriveAgentWorkspaceSlug(safeRole),
    orchestration_mode: preset.orchestration_mode || 'plan_execute_verify',
    max_steps: preset.max_steps ?? 8,
    max_delegation_depth: preset.max_delegation_depth ?? 2,
    primary_provider: preset.primary_provider || 'gemini',
    primary_model: preset.primary_model || meta?.preferred_model || 'gemini-2.5-flash',
    fallback_provider: preset.fallback_provider || 'openai',
    fallback_model: preset.fallback_model || 'gpt-4.1-mini',
    autonomy_policy: preset.autonomy_policy || 'auto_safe',
    daily_budget_usd: preset.daily_budget_usd ?? 5,
    allowed_mcp_servers: preset.allowed_mcp_servers
      ? [...preset.allowed_mcp_servers]
      : ['mcp_local_workspace'],
    soul_markdown: preset.soul_markdown || defaultSoul,
    memory_markdown: preset.memory_markdown || defaultMemory,
    cron_schedule: preset.cron_schedule ?? null,
    pack_id: meta?.pack_id ?? preset.pack_id ?? null,
    status: preset.status || 'active',
    updated_at: now,
  };
}

export function sanitizeAgentCorePatch(
  base: AgentCoreConfig,
  patch: AgentCorePatch,
  now = new Date().toISOString()
): AgentCoreConfig {
  const nextOrchestration = ALLOWED_ORCHESTRATION_MODES.includes(
    patch.orchestration_mode as AgentOrchestrationMode
  )
    ? (patch.orchestration_mode as AgentOrchestrationMode)
    : base.orchestration_mode;

  const nextAutonomy = ALLOWED_AUTONOMY_POLICIES.includes(
    patch.autonomy_policy as AgentAutonomyPolicy
  )
    ? (patch.autonomy_policy as AgentAutonomyPolicy)
    : base.autonomy_policy;

  const nextStatus: AgentCoreStatus =
    patch.status === 'active' || patch.status === 'paused' ? patch.status : base.status;

  const soul =
    typeof patch.soul_markdown === 'string'
      ? patch.soul_markdown.slice(0, MAX_MARKDOWN_LENGTH)
      : base.soul_markdown;

  const memory =
    typeof patch.memory_markdown === 'string'
      ? patch.memory_markdown.slice(0, MAX_MARKDOWN_LENGTH)
      : base.memory_markdown;

  return {
    agent_role: base.agent_role,
    workspace_slug: base.workspace_slug || deriveAgentWorkspaceSlug(base.agent_role),
    orchestration_mode: nextOrchestration,
    max_steps: clampNumber(patch.max_steps, base.max_steps, 1, 30, 0),
    max_delegation_depth: clampNumber(patch.max_delegation_depth, base.max_delegation_depth, 0, 5, 0),
    primary_provider: sanitizeProvider(patch.primary_provider, base.primary_provider),
    primary_model: sanitizeModel(patch.primary_model, base.primary_model),
    fallback_provider: sanitizeProvider(patch.fallback_provider, base.fallback_provider),
    fallback_model: sanitizeModel(patch.fallback_model, base.fallback_model),
    autonomy_policy: nextAutonomy,
    daily_budget_usd: clampNumber(patch.daily_budget_usd, base.daily_budget_usd, 0, 500, 2),
    allowed_mcp_servers:
      patch.allowed_mcp_servers !== undefined
        ? sanitizeMcpServers(patch.allowed_mcp_servers, base.allowed_mcp_servers)
        : [...base.allowed_mcp_servers],
    soul_markdown: soul,
    memory_markdown: memory,
    cron_schedule: sanitizeCronSchedule(patch.cron_schedule, base.cron_schedule),
    pack_id: patch.pack_id !== undefined ? (patch.pack_id ? String(patch.pack_id).slice(0, 64) : null) : base.pack_id,
    status: nextStatus,
    updated_at: now,
  };
}

export function evaluateAgentCoreReadiness(core: AgentCoreConfig): AgentCoreReadiness {
  const hasSoul = core.soul_markdown.trim().length >= 30;
  const hasMemory = core.memory_markdown.trim().length >= 20;
  const hasFallback = Boolean(core.fallback_provider && core.fallback_model);
  const hasMcp = core.allowed_mcp_servers.length > 0;
  const hasPrimary = Boolean(core.primary_provider && core.primary_model);

  const checks = [hasPrimary, hasSoul, hasMemory, hasFallback, hasMcp];
  const passed = checks.filter(Boolean).length;
  const completenessPct = Math.round((passed / checks.length) * 100);

  return {
    completenessPct,
    hasSoul,
    hasMemory,
    hasFallback,
    hasMcp,
    orchestrationLabel: ORCHESTRATION_MODE_LABELS[core.orchestration_mode] || core.orchestration_mode,
    autonomyLabel: AUTONOMY_POLICY_LABELS[core.autonomy_policy] || core.autonomy_policy,
  };
}
