import { AgentMascotMeta, humanizeLabel } from './chat';

export interface AgentVersionSnapshot {
  version: number;
  saved_at: string;
  summary: string;
  snapshot: {
    name: string;
    proper_name: string;
    handle: string;
    mission: string;
    system_prompt: string;
    preferred_model: string;
    routing_policy: 'auto_hybrid' | 'local_only' | 'online_only';
    autonomy_level: 'read_only' | 'ask_approval' | 'autonomous';
    is_read_only: boolean;
    strict_focus: boolean;
    strict_topic: string;
    delegation_targets: string[];
    allowed_tools: string[];
    mascot: AgentMascotMeta;
  };
}

export interface AgentInfo {
  role: string;
  name: string;
  proper_name?: string;
  handle?: string;
  category?: 'orchestration' | 'security' | 'studies' | 'creative' | 'business' | 'dev' | 'data' | string;
  mission: string;
  preferred_model: string;
  routing_policy?: 'auto_hybrid' | 'local_only' | 'online_only';
  autonomy_level?: 'read_only' | 'ask_approval' | 'autonomous';
  is_read_only: boolean;
  strict_focus?: boolean;
  strict_topic?: string;
  delegation_targets?: string[];
  allowed_tools: string[];
  system_prompt?: string;
  assigned_key_id?: string;
  mascot?: AgentMascotMeta;
  is_custom?: boolean;
  template_id?: string;
  installed_skills?: string[];
  version?: number;
  updated_at?: string;
}

export interface AgentMemoryItem {
  id: string;
  agent_role: string;
  category: string;
  key: string;
  content: string;
  context?: string;
  importance: number;
  created_at: string;
  updated_at: string;
}

export interface SkillInfo {
  id: string;
  name: string;
  version: string;
  origin: string;
  license: string;
  description: string;
  domain: string;
  allowed_tools: string[];
  required_permissions: string[];
  assigned_agents: string[];
  content_hash: string;
  is_approved: boolean;
  is_revoked: boolean;
  instructions: string;
  templates?: Record<string, string>;
  created_at?: string;
  updated_at?: string;
}

export const AGENT_ROLE_LABELS: Record<string, string> = {
  jarvis_master: 'Maestro Orquestrador',
  sentinel_security: 'Sentinela de Segurança',
  english_tutor: 'Professora de Inglês',
  math_tutor: 'Tutor de Matemática',
  presentation_creator: 'Criador de PowerPoint',
  document_specialist: 'Especialista em PDFs & Trabalhos',
  finance_business: 'Analista de Finanças & Negócios',
  flow_architect: 'Flow Architect (Criação de Fluxos)',
  software_architect: 'Arquiteto de Software',
  project_manager: 'Gerente de Projetos',
  research_analyst: 'Pesquisador Web & Relatórios',
  project_designer_planner: 'Designer & Planejador de Projetos',
  ux_ui_designer: 'Designer Visual & Imagens',
  frontend_mobile_developer: 'Desenvolvedor Frontend & Mobile',
  backend_developer: 'Desenvolvedor Backend (APIs)',
  qa_engineer: 'Engenheiro de QA & Testes',
  code_reviewer: 'Revisor de Código Sênior',
  data_scientist: 'Cientista de Dados',
  business_intelligence: 'Business Intelligence (BI)',
  data_engineering_intelligence: 'Engenheiro de Inteligência de Dados',
  data_engineer_pipelines: 'Engenheiro de Pipelines & ETL',
  devops_engineer: 'Engenheiro DevOps & CI/CD',
  network_infrastructure_engineer: 'Engenheiro de Redes & Infra',
  cybersecurity_engineer: 'Engenheiro de Cibersegurança',
  automation_engineer: 'Engenheiro de Automação',
  threat_modeling_security_architect: 'Arquiteto de Modelagem de Ameaças',
  secure_code_auditor: 'Auditor de Código Seguro',
  api_security_specialist: 'Especialista em Segurança de APIs',
  identity_access_management: 'Gestão de Identidade e Acesso (IAM)',
  software_supply_chain_security: 'Segurança da Cadeia de Suprimentos',
  soc_incident_response: 'Resposta a Incidentes SOC',
  ai_security_red_team: 'Red Team de Segurança de IA',
  privacy_data_protection: 'Privacidade & Proteção de Dados',
};

export const getAgentLabel = (role: string): string => {
  if (!role) return 'Especialista';
  const clean = role.toLowerCase().trim();
  if (AGENT_ROLE_LABELS[clean]) return AGENT_ROLE_LABELS[clean];
  return clean
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
};

export const MODEL_LABELS: Record<string, string> = {
  auto: 'Automático (Agente)',
  auto_hybrid: 'Híbrido (Local + Gemini)',
  'gemini-4-hydrogen': 'Gemini 4 Hydrogen (Online)',
  'gemini-3.1-flash-lite': 'Gemini 3.1 Flash Lite (Online)',
  'gemini-4-neon': 'Gemini 4 Neon (Online)',
  'gemini-4-carbon': 'Gemini 4 Carbon (Online)',
  'gemini-4-argon': 'Gemini 4 Argon (Online)',
};

export const getModelLabel = (model?: string | null): string => {
  const original = (model || '').trim();
  if (!original) return MODEL_LABELS.auto_hybrid;
  return MODEL_LABELS[original.toLowerCase()] || original;
};

export const MEMORY_CATEGORY_LABELS: Record<string, string> = {
  coding_style: 'Estilo de Código',
  test_preference: 'Padrão de Teste',
  architecture_rule: 'Regra Arquitetural',
  security_policy: 'Diretriz de Segurança',
  user_preference: 'Preferência do Usuário',
};

export const getMemoryCategoryLabel = (category: string): string => {
  const clean = (category || '').toLowerCase().trim();
  if (MEMORY_CATEGORY_LABELS[clean]) return MEMORY_CATEGORY_LABELS[clean];
  return clean
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
};

export interface ToolDescriptor {
  id: string;
  label: string;
  description: string;
  category: 'filesystem' | 'execution' | 'analysis' | 'security' | 'multiagent' | 'git';
}

export const TOOL_DESCRIPTORS: Record<string, ToolDescriptor> = {
  read_file: {
    id: 'read_file',
    label: 'Leitura de Arquivo',
    description: 'Leitura segura de arquivos locais dentro do workspace autorizado',
    category: 'filesystem',
  },
  list_directory: {
    id: 'list_directory',
    label: 'Exploração de Pastas',
    description: 'Listagem e navegação de arquivos e diretórios da aplicação',
    category: 'filesystem',
  },
  run_tests: {
    id: 'run_tests',
    label: 'Execução de Testes',
    description: 'Execução isolada de suites de testes automatizados (pytest, flutter test, etc.)',
    category: 'execution',
  },
  run_linter: {
    id: 'run_linter',
    label: 'Análise de Código (Linter)',
    description: 'Validação de estilo, tipagem e padrões de código estáticos',
    category: 'analysis',
  },
  propose_patch: {
    id: 'propose_patch',
    label: 'Proposta de Código / Patch',
    description: 'Criação e edição segura de código com controle de diff e aprovação',
    category: 'filesystem',
  },
  scan_secrets: {
    id: 'scan_secrets',
    label: 'Varredura de Segredos',
    description: 'Detecção preventiva de chaves, tokens e senhas no código fonte',
    category: 'security',
  },
  inspect_diff: {
    id: 'inspect_diff',
    label: 'Inspeção de Diffs',
    description: 'Análise detalhada de alterações de código linha por linha',
    category: 'analysis',
  },
  inspect_manifest: {
    id: 'inspect_manifest',
    label: 'Inspeção de Manifestos',
    description: 'Análise de dependências e manifestos de pacotes (package.json, pubspec, pyproject)',
    category: 'analysis',
  },
  inspect_dataset: {
    id: 'inspect_dataset',
    label: 'Inspeção de Dados / Schema',
    description: 'Análise exploratória de datasets, esquemas de tabelas e metadados',
    category: 'analysis',
  },
  validate_data: {
    id: 'validate_data',
    label: 'Validação de Dados',
    description: 'Verificação de integridade, anomalias e conformidade de dados',
    category: 'analysis',
  },
  delegate_agent: {
    id: 'delegate_agent',
    label: 'Delegação Multi-Agente',
    description: 'Handoff de tarefas especializadas para agentes secundários',
    category: 'multiagent',
  },
  request_approval: {
    id: 'request_approval',
    label: 'Solicitação de Aprovação',
    description: 'Encaminhamento de ações de alto impacto ao Approval Center com Kill Switch',
    category: 'security',
  },
  query_audit: {
    id: 'query_audit',
    label: 'Consulta de Auditoria',
    description: 'Acesso ao registro imutável de eventos e ações de segurança',
    category: 'security',
  },
  search_code: {
    id: 'search_code',
    label: 'Busca em Código',
    description: 'Pesquisa semântica e por regex em arquivos do projeto',
    category: 'filesystem',
  },
  git_status: {
    id: 'git_status',
    label: 'Status do Git',
    description: 'Inspeção do estado atual do repositório Git local',
    category: 'git',
  },
  git_diff: {
    id: 'git_diff',
    label: 'Diffs do Git',
    description: 'Visualização de alterações pendentes ou commits no repositório',
    category: 'git',
  },
};

export const getToolLabel = (tool?: string | null): string => {
  if (!tool) return 'Ferramenta';
  const clean = tool.toLowerCase().trim();
  if (TOOL_DESCRIPTORS[clean]) {
    return TOOL_DESCRIPTORS[clean].label;
  }
  return clean
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
};

export const getToolDescription = (tool?: string | null): string => {
  const clean = (tool || '').toLowerCase().trim();
  return TOOL_DESCRIPTORS[clean]?.description || 'Ferramenta do ecossistema sandbox';
};

export const formatFriendlyText = (text: string): string => {
  if (!text) return '';
  const clean = text.trim().replace(/^['"`]+|['"`]+$/g, '');
  if (clean.startsWith('sess_')) {
    return 'Conversa Ativa';
  }
  const lower = clean.toLowerCase();
  if (TOOL_DESCRIPTORS[lower]) {
    return TOOL_DESCRIPTORS[lower].label;
  }
  if (AGENT_ROLE_LABELS[lower]) {
    return AGENT_ROLE_LABELS[lower];
  }
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/i.test(clean)) {
    return humanizeLabel(clean);
  }
  return text;
};

export const sanitizeUserFacingText = (text: string): string => {
  if (!text) return '';
  let res = text;
  Object.keys(TOOL_DESCRIPTORS).forEach((toolKey) => {
    const label = TOOL_DESCRIPTORS[toolKey].label;
    const regex = new RegExp(`['"\`]${toolKey}['"\`]`, 'gi');
    res = res.replace(regex, `"${label}"`);
  });
  res = res.replace(/\bsess_[a-zA-Z0-9_-]+\b/g, 'Sessão Ativa');
  return res;
};
