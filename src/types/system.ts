import { humanizeLabel } from './chat';

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'offline';
  components: {
    security_core: string;
    approval_engine: string;
    model_runtime: string;
    inference_queue: {
      active: number;
      waiting: number;
    };
    kill_switch: {
      global_killed: boolean;
    };
  };
}

export interface ApprovalRequestItem {
  id: string;
  task_id: string;
  agent_role: string;
  operation: string;
  impact_summary: string;
  affected_resources: string[];
  proposed_diff?: string;
  reversible: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  requested_at: string;
}

const PROJECT_TYPE_LABELS: Record<string, string> = {
  web: 'Web (HTML/JS)',
  python: 'Python (FastAPI)',
  java: 'Java (Maven)',
  csharp: '.NET / C#',
  go: 'Go (Golang)',
  kotlin: 'Kotlin (Gradle)',
  flutter: 'Flutter Mobile',
};

export const getProjectTypeLabel = (type?: string | null): string => {
  const clean = (type || '').toLowerCase().trim();
  if (!clean) return 'Projeto';
  return PROJECT_TYPE_LABELS[clean] || humanizeLabel(clean);
};

const FILE_TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF',
  doc: 'Word',
  docx: 'Word',
  txt: 'Texto',
  md: 'Markdown',
  markdown: 'Markdown',
  py: 'Python',
  js: 'JavaScript',
  jsx: 'React (JSX)',
  ts: 'TypeScript',
  tsx: 'React (TSX)',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  csv: 'CSV',
  xls: 'Excel',
  xlsx: 'Excel',
  ppt: 'PowerPoint',
  pptx: 'PowerPoint',
  zip: 'ZIP',
};

export const getFileTypeLabel = (type?: string | null): string => {
  const clean = (type || '').toLowerCase().trim().replace(/^\./, '');
  if (!clean) return 'Tipo desconhecido';
  return FILE_TYPE_LABELS[clean] || clean.toUpperCase();
};

const CATEGORY_LABELS: Record<string, string> = {
  geral: 'Geral',
  anotacoes: 'Anotações',
  projeto: 'Projeto',
  privado: 'Privado',
  style_guide: 'Guia de Estilo',
  qa_guideline: 'Diretriz de QA',
  valores_nulos_e_vazios: 'Valores Nulos e Vazios',
  tipagem_e_valores_negativos: 'Tipagem e Valores Negativos',
  caracteres_especiais_e_unicode: 'Caracteres Especiais e Unicode',
  payload_gigante_e_overflow: 'Payload Gigante e Overflow',
  simulacao_injecao: 'Simulação de Injeção',
};

export const getCategoryLabel = (category?: string | null): string => {
  const clean = (category || '').toLowerCase().trim();
  if (!clean) return 'Geral';
  return CATEGORY_LABELS[clean] || humanizeLabel(clean);
};

const OPERATION_LABELS: Record<string, string> = {
  model_selected: 'Seleção de Modelo',
  inference_completed: 'Inferência Concluída',
  sensitive_data_local_containment: 'Dados Sensíveis Contidos Localmente',
  online_budget_exceeded_fallback: 'Orçamento Online Excedido (Fallback Local)',
  external_inference_authorized: 'Inferência Externa Autorizada',
  online_chat_completed: 'Conversa Online Concluída',
  online_inference_completed: 'Inferência Online Concluída',
  online_gateway_outage_fallback: 'Falha no Gateway Online (Fallback Local)',
  online_stream_interrupted: 'Stream Online Interrompido',
  stream_usage_unavailable: 'Métricas de Stream Indisponíveis',
  project_deleted: 'Projeto Excluído',
  project_rollback_executed: 'Rollback do Projeto Executado',
  project_scaffolded: 'Projeto Criado',
  project_file_modified: 'Arquivo do Projeto Modificado',
  project_dockerized: 'Projeto Dockerizado',
  proactive_code_patch_application: 'Aplicação de Correção Proativa',
  proactive_finding_reported: 'Achado Proativo Registrado',
  resource_budget_warning: 'Aviso de Orçamento de Recursos',
  inter_agent_cycle_limit_hit: 'Limite de Ciclo entre Agentes Atingido',
  inter_agent_message_dispatched: 'Mensagem entre Agentes Enviada',
  approval_request_created: 'Solicitação de Aprovação Criada',
  approval_request_consumed: 'Solicitação de Aprovação Consumida',
  self_approval_attempt_blocked: 'Autoatribuição de Aprovação Bloqueada',
  approval_request_approved: 'Solicitação de Aprovação Aprovada',
  approval_request_rejected: 'Solicitação de Aprovação Rejeitada',
  workspace_project_create_approved: 'Criação de Projeto no Workspace Aprovada',
  project_registered_in_allowlist: 'Projeto Registrado na Lista de Permissões',
  project_mode_changed: 'Modo do Projeto Alterado',
  path_traversal_blocked: 'Tentativa de Acesso a Caminho Bloqueada',
  mobile_device_paired: 'Dispositivo Móvel Emparelhado',
  revoked_device_access_blocked: 'Acesso de Dispositivo Revogado Bloqueado',
  mobile_device_revoked: 'Dispositivo Móvel Revogado',
  kill_switch_trigger_global: 'Kill Switch Global Acionado',
  kill_switch_reset_global: 'Kill Switch Global Reiniciado',
  task_cancelled: 'Tarefa Cancelada',
  tool_blocked: 'Ferramenta Bloqueada',
  qa_security_pipeline_run: 'Pipeline de QA e Segurança Executado',
};

export const getOperationLabel = (operation?: string | null): string => {
  const clean = (operation || '').toLowerCase().trim();
  if (!clean) return 'Operação';
  return OPERATION_LABELS[clean] || humanizeLabel(clean);
};

const STATUS_LABELS: Record<string, string> = {
  success: 'Sucesso',
  failed: 'Falha',
  failure: 'Falha',
  pending: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  revoked: 'Revogado',
  contained_local: 'Contido Localmente',
  fallback_local: 'Fallback Local',
  authorized: 'Autorizado',
  blocked: 'Bloqueado',
  sent: 'Enviado',
  estimated: 'Estimado',
  consumed: 'Consumido',
  denied: 'Negado',
  registered: 'Registrado',
  updated: 'Atualizado',
  triggered: 'Acionado',
  reset: 'Reiniciado',
  cancelled: 'Cancelado',
  gate_passed: 'Gate Aprovado',
  gate_blocked: 'Gate Bloqueado',
  awaiting_approval: 'Aguardando Aprovação',
  recorded: 'Registrado',
  throttled: 'Limitado',
  modified: 'Modificado',
  applied: 'Aplicado',
  approval_required: 'Aprovação Necessária',
  completed: 'Concluído',
  error: 'Erro',
  timeout: 'Tempo Limite',
  active: 'Ativo',
  inactive: 'Inativo',
  deleted: 'Excluído',
  healthy: 'Saudável',
  degraded: 'Degradado',
  offline: 'Offline',
  online: 'Online',
};

export const getStatusLabel = (status?: string | null): string => {
  const clean = (status || '').toLowerCase().trim();
  if (!clean) return 'Desconhecido';
  return STATUS_LABELS[clean] || humanizeLabel(clean);
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Crítica',
  high: 'Alta',
  warning: 'Aviso',
  medium: 'Média',
  low: 'Baixa',
  info: 'Informativa',
};

export const getSeverityLabel = (severity?: string | null): string => {
  const clean = (severity || '').toLowerCase().trim();
  if (!clean) return 'Informativa';
  return SEVERITY_LABELS[clean] || humanizeLabel(clean);
};

const RISK_LABELS: Record<string, string> = {
  critical: 'Crítico',
  high: 'Alto',
  medium: 'Médio',
  low: 'Baixo',
};

export const getRiskLabel = (risk?: string | null): string => {
  const clean = (risk || '').toLowerCase().trim();
  if (!clean) return 'Baixo';
  return RISK_LABELS[clean] || humanizeLabel(clean);
};

const FINDING_TYPE_LABELS: Record<string, string> = {
  sql_injection: 'Injeção de SQL',
  command_injection: 'Injeção de Comandos',
  xss: 'Cross-site Scripting (XSS)',
  hardcoded_secret: 'Segredo Embutido no Código',
  hardcoded_credential: 'Credencial Embutida no Código',
  missing_index: 'Índice Ausente',
};

export const getFindingTypeLabel = (type?: string | null): string => {
  const clean = (type || '').toLowerCase().trim();
  if (!clean) return 'Achado';
  return FINDING_TYPE_LABELS[clean] || humanizeLabel(clean);
};

const USER_ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  developer: 'Desenvolvedor',
  auditor: 'Auditor',
};

export const getUserRoleLabel = (role?: string | null): string => {
  const clean = (role || '').toLowerCase().trim();
  if (!clean) return 'Utilizador';
  return USER_ROLE_LABELS[clean] || humanizeLabel(clean);
};
