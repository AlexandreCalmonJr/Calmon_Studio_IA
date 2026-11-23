/**
 * Motor puro de Pacotes Modulares (Module Pack Engine).
 *
 * Transforma capacidades do Hub (Engenharia, Desenvolvimento Full-Stack, Segurança,
 * Produtividade Criativa, Voz & Cérebro Local) em pacotes instaláveis na Loja.
 * Cada pacote desbloqueia:
 *  - Telas/módulos na navegação lateral
 *  - Agentes especialistas pré-configurados com Núcleo Individual (AgentCore)
 *  - Habilidades (Skills) e Trilhas de Estudo / Guias (Knowledge)
 *  - Presets de MCP e fluxos sugeridos
 */

export type ModulePackCategory =
  | 'engineering'
  | 'development'
  | 'security'
  | 'productivity'
  | 'infrastructure';

export interface PackBundledAgentSpec {
  role: string;
  name: string;
  proper_name: string;
  handle: string;
  category: string;
  mission: string;
  preferred_model: string;
  autonomy_level: 'read_only' | 'ask_approval' | 'autonomous';
  installed_skills: string[];
  allowed_tools: string[];
  mascot_color: string;
}

export interface PackStudyTrackSpec {
  id: string;
  title: string;
  level: 'essencial' | 'intermediario' | 'avancado';
  summary: string;
  document_name: string;
  markdown_content: string;
}

export interface ModulePackDefinition {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: ModulePackCategory;
  category_label: string;
  version: string;
  tabs: string[];
  tab_labels: Record<string, string>;
  agents: PackBundledAgentSpec[];
  skills: string[];
  mcp_presets: string[];
  workflows: string[];
  study_tracks: PackStudyTrackSpec[];
  recommended?: boolean;
  is_custom?: boolean;
  created_by?: string;
}

export interface ModulePackWithState extends ModulePackDefinition {
  installed: boolean;
  installed_at: string | null;
}

export interface CustomPackDraftInput {
  id?: string;
  name: string;
  tagline?: string;
  description?: string;
  category?: ModulePackCategory | string;
  version?: string;
  tabs?: string[];
  agents?: Array<Partial<PackBundledAgentSpec>>;
  skills?: string[];
  mcp_presets?: string[];
  workflows?: string[];
  study_tracks?: Array<Partial<PackStudyTrackSpec>>;
}

export interface SelectableModuleTab {
  id: string;
  label: string;
  group: string;
}

export const ALL_MODULAR_TABS_CATALOG: readonly SelectableModuleTab[] = [
  { id: 'architecture', label: 'Agente de Arquitetura', group: 'Engenharia & Arquitetura' },
  { id: 'backend_studio', label: 'Backend Studio', group: 'Engenharia & Arquitetura' },
  { id: 'design', label: 'Design Studio', group: 'Engenharia & Arquitetura' },
  { id: 'quality', label: 'Qualidade QA', group: 'Engenharia & Arquitetura' },
  { id: 'executive_report', label: 'Relatório ROI', group: 'Engenharia & Arquitetura' },
  { id: 'coding', label: 'IDE & Código', group: 'Desenvolvimento' },
  { id: 'workspace', label: 'Projetos', group: 'Desenvolvimento' },
  { id: 'github_import', label: 'Importar GitHub', group: 'Desenvolvimento' },
  { id: 'app_builder', label: 'Construtor de Apps', group: 'Desenvolvimento' },
  { id: 'security', label: 'Sentinela & Segurança', group: 'Segurança & Governança' },
  { id: 'approvals', label: 'Aprovações', group: 'Segurança & Governança' },
  { id: 'server_logs', label: 'Logs do Servidor', group: 'Segurança & Governança' },
  { id: 'usage', label: 'Uso & Custos', group: 'Segurança & Governança' },
  { id: 'creative_studio', label: 'Estúdio Criativo', group: 'Produtividade' },
  { id: 'office', label: 'Escritório Vivo', group: 'Produtividade' },
  { id: 'models', label: 'Modelos & Chaves', group: 'Produtividade' },
  { id: 'skills', label: 'Habilidades', group: 'Produtividade' },
  { id: 'android_app', label: 'App Mobile Android', group: 'Voz & Local' },
  { id: 'companion', label: 'Voz & Companion', group: 'Voz & Local' },
  { id: 'brain_server', label: 'Cérebros & Servidor', group: 'Voz & Local' },
  { id: 'advisor', label: 'Hardware', group: 'Voz & Local' },
] as const;

export const MODULAR_TAB_LABEL_MAP: Record<string, string> = Object.fromEntries(
  ALL_MODULAR_TABS_CATALOG.map((item) => [item.id, item.label])
);

export interface InstalledPackSummary {
  totalPacks: number;
  installedCount: number;
  unlockedModulesCount: number;
  bundledAgentsCount: number;
  studyTracksCount: number;
}

/**
 * Telas núcleo que permanecem sempre disponíveis no Hub,
 * independentemente dos pacotes instalados na Loja.
 */
export const CORE_ALWAYS_VISIBLE_TABS: readonly string[] = [
  'overview',
  'chat',
  'agents',
  'tasks',
  'workflows',
  'knowledge',
  'store',
  'pack_studio',
  'architecture',
  'learning',
  'settings',
  'not_found',
] as const;

/**
 * Pacote inicial instalado automaticamente em bancos novos para manter
 * a navegação enxuta enquanto os pacotes especializados ficam prontos na Loja.
 */
export const DEFAULT_PREINSTALLED_PACK_IDS: readonly string[] = [
  'creative_productivity',
] as const;

export const MODULE_PACK_CATEGORY_LABELS: Record<ModulePackCategory, string> = {
  engineering: 'Engenharia & Arquitetura',
  development: 'Desenvolvimento Full-Stack',
  security: 'Segurança & Governança',
  productivity: 'Produtividade & Criativo',
  infrastructure: 'Voz, Mobile & Local',
};

export const MODULE_PACK_CATALOG: readonly ModulePackDefinition[] = [
  {
    id: 'engineering_architecture',
    name: 'Engenharia & Arquitetura',
    tagline: 'Arquiteto de Sistemas (Vetor), ADRs, C4 Model, Backend Studio e QA.',
    description:
      'Instala o núcleo autônomo do Arquiteto de Sistemas e da Engenheira de QA junto com os estúdios de Backend, Design de Arquitetura, Qualidade e Relatórios de ROI.',
    category: 'engineering',
    category_label: MODULE_PACK_CATEGORY_LABELS.engineering,
    version: '1.2.0',
    recommended: true,
    tabs: ['backend_studio', 'design', 'quality', 'executive_report'],
    tab_labels: {
      backend_studio: 'Backend Studio',
      design: 'Design Studio',
      quality: 'Qualidade QA',
      executive_report: 'Relatório ROI',
    },
    agents: [
      {
        role: 'architect',
        name: 'Arquiteto de Sistemas',
        proper_name: 'Vetor',
        handle: '@arquiteto',
        category: 'engineering',
        mission:
          'Desenhar arquiteturas escaláveis, ADRs, diagramas C4, contratos de banco de dados e análises de trade-offs antes do código.',
        preferred_model: 'gemini-2.5-pro',
        autonomy_level: 'ask_approval',
        installed_skills: [
          'Arquitetura C4 & ADRs',
          'Modelagem de Dados & Contratos',
          'Análise de Trade-offs & Escala',
        ],
        allowed_tools: ['read_file', 'inspect_schema', 'write_adr'],
        mascot_color: '#f97316',
      },
      {
        role: 'qa_engineer',
        name: 'Engenheira de QA & Confiabilidade',
        proper_name: 'Lia',
        handle: '@qa',
        category: 'engineering',
        mission:
          'Criar planos de teste determinísticos, validar regressões, contratos de API e qualidade de experiência ponta a ponta.',
        preferred_model: 'gemini-2.5-flash',
        autonomy_level: 'ask_approval',
        installed_skills: ['Testes Unitários & Contrato', 'Checklist de Regressão E2E'],
        allowed_tools: ['read_file', 'run_checks'],
        mascot_color: '#38bdf8',
      },
    ],
    skills: [
      'Arquitetura C4 & ADRs',
      'Modelagem de Dados & Contratos',
      'Análise de Trade-offs & Escala',
      'Testes Unitários & Contrato',
    ],
    mcp_presets: ['mcp_local_workspace', 'mcp_git_inspector', 'mcp_sqlite_readonly'],
    workflows: ['Revisão de Arquitetura + ADR Automática', 'Pipeline de Validação QA pré-release'],
    study_tracks: [
      {
        id: 'track_system_design_c4',
        title: 'Trilha: System Design, C4 Model e ADRs na Prática',
        level: 'intermediario',
        summary:
          'Como documentar decisões técnicas sem burocracia usando C4 (Contexto, Contêineres, Componentes) e ADRs versionadas.',
        document_name: 'trilha-engenharia-arquitetura-c4.md',
        markdown_content: [
          '# Trilha: System Design, C4 Model e ADRs na Prática',
          '',
          '## 1. Quando criar uma ADR',
          'Sempre que uma decisão alterar persistência, fronteiras de módulo, autenticação ou custo operacional.',
          '',
          '## 2. Estrutura mínima de uma ADR',
          '- Contexto e problema real',
          '- Alternativas avaliadas com prós e contras',
          '- Decisão escolhida e consequências',
          '- Critérios objetivos para revisitar a decisão',
          '',
          '## 3. Camadas C4',
          '1. Contexto do Sistema (atores e integrações externas)',
          '2. Contêineres (SPA, API, SQLite/Postgres, workers)',
          '3. Componentes (motores de domínio, serviços, adaptadores)',
        ].join('\n'),
      },
      {
        id: 'track_sqlite_to_postgres',
        title: 'Trilha: Evolução Local-First (SQLite WAL → Postgres/Supabase)',
        level: 'avancado',
        summary:
          'Estratégia de repositório e schema para começar local com zero latência e escalar para nuvem sem reescrever regras.',
        document_name: 'trilha-evolucao-sqlite-postgres.md',
        markdown_content: [
          '# Trilha: Evolução Local-First (SQLite WAL → Postgres/Supabase)',
          '',
          '## Padrão de Portabilidade',
          '- Isolar toda regra de domínio em serviços TypeScript puros.',
          '- Manter tabelas com chaves primárias explícitas (`TEXT`) e timestamps ISO-8601.',
          '- Usar queries parametrizadas para facilitar migração para Postgres/Supabase.',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'fullstack_dev',
    name: 'Desenvolvimento Full-Stack',
    tagline: 'IDE & Código, Projetos, GitHub Import, App Builder e árvore de estudos dev.',
    description:
      'Desbloqueia todo o ecossistema de desenvolvimento de software: IDE assistida, workspaces de projeto, importação de repositórios GitHub, Construtor de Apps e agentes full-stack.',
    category: 'development',
    category_label: MODULE_PACK_CATEGORY_LABELS.development,
    version: '1.3.0',
    recommended: true,
    tabs: ['coding', 'workspace', 'github_import', 'app_builder'],
    tab_labels: {
      coding: 'IDE & Código',
      workspace: 'Projetos',
      github_import: 'Importar GitHub',
      app_builder: 'Construtor de Apps',
    },
    agents: [
      {
        role: 'dev_fullstack',
        name: 'Engenheiro Full-Stack',
        proper_name: 'Dante',
        handle: '@dante',
        category: 'development',
        mission:
          'Implementar interfaces React/TypeScript, APIs REST seguras, bancos de dados e testes automatizados de ponta a ponta.',
        preferred_model: 'gemini-2.5-pro',
        autonomy_level: 'ask_approval',
        installed_skills: [
          'React & TypeScript Modular',
          'APIs Node.js & SQLite/Postgres',
          'Refatoração & Performance Web',
        ],
        allowed_tools: ['read_file', 'edit_file', 'run_tests'],
        mascot_color: '#22c55e',
      },
      {
        role: 'code_reviewer',
        name: 'Revisora de Código & Git',
        proper_name: 'Nina',
        handle: '@nina',
        category: 'development',
        mission:
          'Auditar commits, diffs e pull requests apontando bugs lógicos, contratos quebrados e melhorias de clareza.',
        preferred_model: 'gemini-2.5-flash',
        autonomy_level: 'read_only',
        installed_skills: ['Code Review Estruturado', 'Higiene de Commits & PRs'],
        allowed_tools: ['read_file', 'git_diff'],
        mascot_color: '#a855f7',
      },
    ],
    skills: [
      'React & TypeScript Modular',
      'APIs Node.js & SQLite/Postgres',
      'Code Review Estruturado',
      'Refatoração & Performance Web',
    ],
    mcp_presets: ['mcp_local_workspace', 'mcp_git_inspector', 'mcp_sqlite_readonly'],
    workflows: ['Importar Repositório → Mapear Arquitetura → Gerar Plano', 'Revisão Automática de PR'],
    study_tracks: [
      {
        id: 'track_fullstack_tree',
        title: 'Árvore de Desenvolvimento Full-Stack (Frontend → API → Banco)',
        level: 'essencial',
        summary:
          'Mapa progressivo de estudos cobrindo componentes modulares, estado assíncrono, REST/WebSockets e modelagem relacional.',
        document_name: 'arvore-desenvolvimento-fullstack.md',
        markdown_content: [
          '# Árvore de Desenvolvimento Full-Stack',
          '',
          '## Nível 1 — Fundamentos Tipados',
          '- TypeScript estrito, contratos de API compartilhados e lógica pura separada da UI.',
          '',
          '## Nível 2 — Backend & Persistência',
          '- Express modular, validação de entrada, SQLite WAL e autenticação por sessão.',
          '',
          '## Nível 3 — Entrega Contínua',
          '- Testes unitários com `node:test`, lint estrito e verificação em navegador real.',
        ].join('\n'),
      },
      {
        id: 'track_backend_patterns',
        title: 'Trilha Backend: Filas Seriais, Cofre de Chaves e Observabilidade',
        level: 'intermediario',
        summary:
          'Padrões práticos para APIs confiáveis com criptografia AES-256-GCM, health checks e logs estruturados.',
        document_name: 'trilha-backend-padroes-producao.md',
        markdown_content: [
          '# Trilha Backend: Padrões de Produção',
          '',
          '- Nunca exponha chaves de terceiros no cliente; use proxy autenticado no servidor.',
          '- Utilize filas seriais por sessão para evitar condições de corrida em memória compartilhada.',
          '- Registre latência e códigos de status para monitorar saúde de provedores externos.',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'security_soc',
    name: 'Segurança, Auditoria & Governança',
    tagline: 'Sentinela AppSec, Central de Aprovações, Logs do Servidor e Controle de Custos.',
    description:
      'Ativa os módulos de governança e defesa do Hub: auditoria de permissões, aprovações de ações críticas, telemetria de custos por modelo e logs em tempo real.',
    category: 'security',
    category_label: MODULE_PACK_CATEGORY_LABELS.security,
    version: '1.1.0',
    tabs: ['security', 'approvals', 'server_logs', 'usage'],
    tab_labels: {
      security: 'Sentinela & Segurança',
      approvals: 'Aprovações',
      server_logs: 'Logs do Servidor',
      usage: 'Uso & Custos',
    },
    agents: [
      {
        role: 'security_sentinel',
        name: 'Analista AppSec & Guardrails',
        proper_name: 'Sentinela',
        handle: '@sentinela',
        category: 'security',
        mission:
          'Revisar controles de acesso, isolamento de dados, validação de entrada e limites de autonomia de todos os agentes.',
        preferred_model: 'gemini-2.5-pro',
        autonomy_level: 'read_only',
        installed_skills: ['Threat Modeling & OWASP', 'Auditoria de Guardrails & Cofre'],
        allowed_tools: ['read_audit_logs', 'inspect_routes'],
        mascot_color: '#ef4444',
      },
    ],
    skills: ['Threat Modeling & OWASP', 'Auditoria de Guardrails & Cofre', 'Governança FinOps de LLM'],
    mcp_presets: ['mcp_audit_readonly', 'mcp_git_inspector'],
    workflows: ['Auditoria Semanal de Permissões e Custos'],
    study_tracks: [
      {
        id: 'track_appsec_agents',
        title: 'Trilha AppSec para Agentes Autônomos e APIs',
        level: 'intermediario',
        summary:
          'Boas práticas para proteger tool calling, evitar path traversal, parametrizar SQL e limitar gastos por agente.',
        document_name: 'trilha-seguranca-agentes-apis.md',
        markdown_content: [
          '# Trilha AppSec para Agentes Autônomos e APIs',
          '',
          '- Escopo mínimo de ferramentas MCP por núcleo de agente.',
          '- Teto diário de orçamento (`daily_budget_usd`) e limite de passos (`max_steps`).',
          '- Validação de slugs e confinamento estrito de diretórios de workspace.',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'creative_productivity',
    name: 'Produtividade & Estúdio Criativo',
    tagline: 'Planilhas, Documentos, Escritório Vivo, Modelos e Catálogo de Habilidades.',
    description:
      'Conjunto essencial para o dia a dia: estúdio criativo para planilhas e mídia, escritório colaborativo de agentes, gestão de modelos e biblioteca de habilidades.',
    category: 'productivity',
    category_label: MODULE_PACK_CATEGORY_LABELS.productivity,
    version: '1.1.0',
    tabs: ['creative_studio', 'office', 'models', 'skills'],
    tab_labels: {
      creative_studio: 'Estúdio Criativo',
      office: 'Escritório Vivo',
      models: 'Modelos & Chaves',
      skills: 'Habilidades',
    },
    agents: [
      {
        role: 'creative_director',
        name: 'Diretora Criativa & Documentos',
        proper_name: 'Maya',
        handle: '@maya',
        category: 'productivity',
        mission:
          'Criar documentos executivos, planilhas organizadas, roteiros e materiais visuais prontos para apresentação.',
        preferred_model: 'gemini-2.5-flash',
        autonomy_level: 'ask_approval',
        installed_skills: ['Planilhas & Relatórios', 'Direção Editorial & Roteiros'],
        allowed_tools: ['read_file', 'generate_document'],
        mascot_color: '#eab308',
      },
    ],
    skills: ['Planilhas & Relatórios', 'Direção Editorial & Roteiros'],
    mcp_presets: ['mcp_local_workspace', 'mcp_web_research'],
    workflows: ['Resumo Executivo Semanal'],
    study_tracks: [
      {
        id: 'track_prompt_ops',
        title: 'Guia de Produtividade: SOUL.md, Memória e Prompts Reutilizáveis',
        level: 'essencial',
        summary:
          'Como estruturar instruções permanentes por agente para economizar tempo e manter consistência nas entregas.',
        document_name: 'guia-produtividade-soul-memoria.md',
        markdown_content: [
          '# Guia de Produtividade: SOUL.md e Memória por Agente',
          '',
          '- Use `SOUL.md` para regras imutáveis de tom, método e critérios de qualidade.',
          '- Use `MEMORY.md` para fatos vivos do projeto, preferências e decisões recentes.',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'voice_mobile_local',
    name: 'Voz, Mobile & Cérebro Local',
    tagline: 'App Android (QR & APK), Voz/Companion, Cérebros SQLite/Docker e Hardware.',
    description:
      'Habilita operação local-first e multi-dispositivo: pareamento com Android, interface de voz PWA, gestão de múltiplos cérebros (Local/Docker) e consultor de hardware para Ollama.',
    category: 'infrastructure',
    category_label: MODULE_PACK_CATEGORY_LABELS.infrastructure,
    version: '1.0.0',
    tabs: ['android_app', 'companion', 'brain_server', 'advisor'],
    tab_labels: {
      android_app: 'App Mobile Android',
      companion: 'Voz & Companion',
      brain_server: 'Cérebros & Servidor',
      advisor: 'Hardware',
    },
    agents: [
      {
        role: 'local_infra',
        name: 'Especialista em Infra & Cérebro Local',
        proper_name: 'Orion',
        handle: '@orion',
        category: 'infrastructure',
        mission:
          'Otimizar execução local com Ollama, sincronização de cérebros SQLite/Docker e pareamento seguro com celular.',
        preferred_model: 'gemini-2.5-flash',
        autonomy_level: 'ask_approval',
        installed_skills: ['Tuning de VRAM & Ollama', 'Sincronização Multi-Cérebro'],
        allowed_tools: ['read_hardware', 'inspect_brain'],
        mascot_color: '#14b8a6',
      },
    ],
    skills: ['Tuning de VRAM & Ollama', 'Sincronização Multi-Cérebro'],
    mcp_presets: ['mcp_local_workspace', 'mcp_sqlite_readonly'],
    workflows: ['Backup Automático SQLite + Verificação de Saúde'],
    study_tracks: [
      {
        id: 'track_local_first_ollama',
        title: 'Trilha Local-First: Ollama, Quantização e Sync Multi-Dispositivo',
        level: 'intermediario',
        summary:
          'Como escolher modelos locais por faixa de VRAM/RAM e configurar fallback automático para nuvem.',
        document_name: 'trilha-local-first-ollama.md',
        markdown_content: [
          '# Trilha Local-First: Ollama e Fallback Híbrido',
          '',
          '- Configure o modelo local no provedor primário do agente e um modelo nuvem no fallback.',
          '- Mantenha backups SQLite regulares via `VACUUM INTO`.',
        ].join('\n'),
      },
    ],
  },
];

export function normalizePackSlug(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

const VALID_PACK_CATEGORIES: readonly ModulePackCategory[] = [
  'engineering',
  'development',
  'security',
  'productivity',
  'infrastructure',
] as const;

export function sanitizeCustomPackInput(
  input: CustomPackDraftInput,
  createdBy = 'admin'
): ModulePackDefinition {
  const name = String(input.name || '').trim().slice(0, 80);
  if (name.length < 3) {
    throw new Error('Informe um nome de pacote com pelo menos 3 caracteres.');
  }

  const rawId = normalizePackSlug(input.id || name);
  const id = rawId.length >= 3 ? rawId : `pack_${Date.now().toString(36)}`;
  if (MODULE_PACK_CATALOG.some((p) => p.id === id)) {
    throw new Error(`O identificador "${id}" pertence a um pacote oficial. Escolha outro ID.`);
  }

  const category: ModulePackCategory = VALID_PACK_CATEGORIES.includes(
    input.category as ModulePackCategory
  )
    ? (input.category as ModulePackCategory)
    : 'engineering';

  const allowedTabIds = new Set(ALL_MODULAR_TABS_CATALOG.map((t) => t.id));
  const tabs = Array.from(
    new Set(
      (Array.isArray(input.tabs) ? input.tabs : [])
        .map((t) => String(t || '').trim())
        .filter((t) => allowedTabIds.has(t))
    )
  ).slice(0, 12);

  const tab_labels: Record<string, string> = {};
  for (const tabId of tabs) {
    tab_labels[tabId] = MODULAR_TAB_LABEL_MAP[tabId] || tabId;
  }

  const rawAgents = Array.isArray(input.agents) ? input.agents : [];
  const agents: PackBundledAgentSpec[] = rawAgents
    .slice(0, 8)
    .map((ag, idx) => {
      const properName = String(ag.proper_name || ag.name || `Agente ${idx + 1}`)
        .trim()
        .slice(0, 40);
      const roleBase = normalizePackSlug(ag.role || `${id}_${properName}`) || `${id}_agent_${idx + 1}`;
      const rawHandle = String(ag.handle || `@${normalizePackSlug(properName).replace(/_/g, '')}`)
        .trim()
        .slice(0, 32);
      const handle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;
      const autonomy: PackBundledAgentSpec['autonomy_level'] =
        ag.autonomy_level === 'read_only' || ag.autonomy_level === 'autonomous'
          ? ag.autonomy_level
          : 'ask_approval';
      return {
        role: roleBase,
        name: String(ag.name || properName).trim().slice(0, 64),
        proper_name: properName,
        handle,
        category,
        mission:
          String(ag.mission || `Especialista dedicado do pacote ${name}.`)
            .trim()
            .slice(0, 280),
        preferred_model: String(ag.preferred_model || 'gemini-2.5-flash').trim().slice(0, 80),
        autonomy_level: autonomy,
        installed_skills: Array.isArray(ag.installed_skills)
          ? ag.installed_skills.map((s) => String(s).trim()).filter(Boolean).slice(0, 10)
          : [],
        allowed_tools: Array.isArray(ag.allowed_tools)
          ? ag.allowed_tools.map((t) => String(t).trim()).filter(Boolean).slice(0, 10)
          : ['read_file'],
        mascot_color: String(ag.mascot_color || '#f97316').trim().slice(0, 16),
      };
    });

  const skills = Array.from(
    new Set(
      (Array.isArray(input.skills) ? input.skills : [])
        .map((s) => String(s || '').trim().slice(0, 64))
        .filter(Boolean)
    )
  ).slice(0, 16);

  const mcp_presets = Array.from(
    new Set(
      (Array.isArray(input.mcp_presets) ? input.mcp_presets : ['mcp_local_workspace'])
        .map((m) => String(m || '').trim().slice(0, 64))
        .filter(Boolean)
    )
  ).slice(0, 10);

  const workflows = Array.from(
    new Set(
      (Array.isArray(input.workflows) ? input.workflows : [])
        .map((w) => String(w || '').trim().slice(0, 100))
        .filter(Boolean)
    )
  ).slice(0, 10);

  const rawTracks = Array.isArray(input.study_tracks) ? input.study_tracks : [];
  const study_tracks: PackStudyTrackSpec[] = rawTracks
    .slice(0, 8)
    .filter((t) => String(t.title || '').trim().length >= 3)
    .map((t, idx) => {
      const title = String(t.title || '').trim().slice(0, 120);
      const trackSlug = normalizePackSlug(t.id || title) || `track_${idx + 1}`;
      const docName =
        String(t.document_name || `${id}-${trackSlug}.md`)
          .trim()
          .replace(/[^a-zA-Z0-9._-]+/g, '-')
          .slice(0, 120);
      const level: PackStudyTrackSpec['level'] =
        t.level === 'essencial' || t.level === 'avancado' ? t.level : 'intermediario';
      const summary = String(t.summary || `Guia de estudo do pacote ${name}.`).trim().slice(0, 260);
      const markdown_content = String(
        t.markdown_content || `# ${title}\n\n${summary}`
      ).slice(0, 20000);
      return {
        id: trackSlug,
        title,
        level,
        summary,
        document_name: docName.endsWith('.md') ? docName : `${docName}.md`,
        markdown_content,
      };
    });

  return {
    id,
    name,
    tagline:
      String(input.tagline || `Pacote personalizado com ${tabs.length} módulos e ${agents.length} agente(s).`)
        .trim()
        .slice(0, 160),
    description:
      String(
        input.description ||
          `Pacote modular criado no Estúdio Dev/Admin para organizar agentes, módulos e conhecimento sob medida.`
      )
        .trim()
        .slice(0, 480),
    category,
    category_label: MODULE_PACK_CATEGORY_LABELS[category],
    version: String(input.version || '1.0.0').trim().slice(0, 24) || '1.0.0',
    tabs,
    tab_labels,
    agents,
    skills,
    mcp_presets,
    workflows,
    study_tracks,
    is_custom: true,
    created_by: createdBy,
  };
}

export function mergeCatalogWithCustomPacks(
  customPacks: readonly ModulePackDefinition[] = []
): ModulePackDefinition[] {
  const byId = new Map<string, ModulePackDefinition>();
  for (const pack of MODULE_PACK_CATALOG) {
    byId.set(pack.id, pack);
  }
  for (const custom of customPacks) {
    if (!byId.has(custom.id)) {
      byId.set(custom.id, { ...custom, is_custom: true });
    }
  }
  return Array.from(byId.values());
}

export function getModulePackById(
  packId: string,
  customPacks: readonly ModulePackDefinition[] = []
): ModulePackDefinition | undefined {
  return mergeCatalogWithCustomPacks(customPacks).find((p) => p.id === packId);
}

export function isValidModulePackId(
  packId: string,
  customPacks: readonly ModulePackDefinition[] = []
): boolean {
  return mergeCatalogWithCustomPacks(customPacks).some((p) => p.id === packId);
}

export function getUnlockedTabsForPacks(
  installedPackIds: readonly string[],
  customPacks: readonly ModulePackDefinition[] = []
): string[] {
  const unlocked = new Set<string>(CORE_ALWAYS_VISIBLE_TABS);
  const installedSet = new Set(installedPackIds);

  for (const pack of mergeCatalogWithCustomPacks(customPacks)) {
    if (installedSet.has(pack.id)) {
      for (const tab of pack.tabs) {
        unlocked.add(tab);
      }
    }
  }
  return Array.from(unlocked);
}

export function isTabUnlockedByPacks(
  tabId: string,
  installedPackIds: readonly string[],
  customPacks: readonly ModulePackDefinition[] = []
): boolean {
  if ((CORE_ALWAYS_VISIBLE_TABS as readonly string[]).includes(tabId)) {
    return true;
  }
  const allPacks = mergeCatalogWithCustomPacks(customPacks);
  const providingPacks = allPacks.filter((pack) => pack.tabs.includes(tabId));
  if (providingPacks.length === 0) return true;
  return providingPacks.some((pack) => installedPackIds.includes(pack.id));
}

export function findPackProvidingTab(
  tabId: string,
  customPacks: readonly ModulePackDefinition[] = []
): ModulePackDefinition | undefined {
  return mergeCatalogWithCustomPacks(customPacks).find((pack) => pack.tabs.includes(tabId));
}

export function summarizeInstalledPacks(
  installedPackIds: readonly string[],
  customPacks: readonly ModulePackDefinition[] = []
): InstalledPackSummary {
  const catalog = mergeCatalogWithCustomPacks(customPacks);
  const installedSet = new Set(installedPackIds);
  const activePacks = catalog.filter((pack) => installedSet.has(pack.id));

  const tabSet = new Set<string>();
  let bundledAgentsCount = 0;
  let studyTracksCount = 0;

  for (const pack of activePacks) {
    pack.tabs.forEach((t) => tabSet.add(t));
    bundledAgentsCount += pack.agents.length;
    studyTracksCount += pack.study_tracks.length;
  }

  return {
    totalPacks: catalog.length,
    installedCount: activePacks.length,
    unlockedModulesCount: tabSet.size,
    bundledAgentsCount,
    studyTracksCount,
  };
}
