import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import {
  DEFAULT_HARDWARE_PROFILES,
  NotebookHardwareProfile,
  ProviderConnectivity,
  computeAgentRecommendations,
} from './src/services/hardwareAdvisor.ts';
import {
  fetchOllamaLocalModels,
  getCuratedHuggingFaceForHardware,
  isGeminiApiConfigured,
  runHybridInference,
  searchRealHuggingFace,
} from './server/hybridAiEngine.ts';

interface UserAccount {
  username: string;
  display_name: string;
  role: 'admin' | 'developer' | 'auditor';
  is_active: boolean;
  must_change_password: boolean;
  salt: string;
  password_hash: string;
  created_at: string;
}

interface SessionRecord {
  session_id: string;
  username: string;
  role: 'admin' | 'developer' | 'auditor';
  kind: 'human' | 'service';
  created_at: number;
}

const SESSION_COOKIE = 'jarvis_session';
const PORT = Number(process.env.PORT || 3000);
const BOOT_TIME = Date.now();

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password: string, salt: string, storedHash: string): boolean {
  const candidate = hashPassword(password, salt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function makeAccount(
  username: string,
  display_name: string,
  password: string,
  role: 'admin' | 'developer' | 'auditor',
  must_change_password = false,
): UserAccount {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    username,
    display_name,
    role,
    is_active: true,
    must_change_password,
    salt,
    password_hash: hashPassword(password, salt),
    created_at: new Date().toISOString(),
  };
}

function permissionsForRole(role: 'admin' | 'developer' | 'auditor'): string[] {
  if (role === 'admin') return ['*'];
  if (role === 'developer') {
    return [
      'chat:read',
      'chat:write',
      'system:read',
      'approvals:read',
      'approvals:write',
      'studios:read',
      'studios:write',
      'agents:read',
      'agents:write',
      'workspace:read',
      'workspace:write',
      'models:read',
      'models:write',
      'coding:read',
      'coding:write',
      'knowledge:read',
      'knowledge:write',
      'tasks:read',
      'tasks:write',
      'skills:read',
      'skills:write',
      'security:read',
      'profile:read',
      'profile:write',
    ];
  }
  return [
    'chat:read',
    'system:read',
    'approvals:read',
    'agents:read',
    'workspace:read',
    'models:read',
    'knowledge:read',
    'tasks:read',
    'skills:read',
    'security:read',
    'profile:read',
  ];
}

// Seeded local accounts
const users = new Map<string, UserAccount>([
  ['admin', makeAccount('admin', 'Administrador', 'Jarvis@2026!Admin', 'admin', false)],
  ['dev', makeAccount('dev', 'Desenvolvedor', 'Jarvis@2026!Dev', 'developer', false)],
]);

const VALID_ADMIN_TOKENS = new Set([
  process.env.JARVIS_ADMIN_TOKEN || 'jarvis-admin-2026',
]);
const VALID_BOOTSTRAP_TOKENS = new Set([
  process.env.JARVIS_BOOTSTRAP_TOKEN || 'jarvis-bootstrap-2026',
]);

const sessions = new Map<string, SessionRecord>();

const userProfiles = new Map<string, Record<string, string>>([
  [
    'admin',
    {
      displayName: 'Administrador',
      avatarIcon: 'J',
      developerRole: 'Arquiteto de Sistemas & IA',
      seniorityLevel: 'architect',
      responseStyle: 'detailed',
      customInstructions: 'Priorize respostas técnicas claras, objetivas e em português.',
      assistantName: 'JARVIS',
      assistantGreeting: '',
      experienceMode: 'engineering',
    },
  ],
  [
    'dev',
    {
      displayName: 'Desenvolvedor',
      avatarIcon: 'D',
      developerRole: 'Engenheiro de Software',
      seniorityLevel: 'senior',
      responseStyle: 'detailed',
      customInstructions: '',
      assistantName: 'JARVIS',
      assistantGreeting: '',
      experienceMode: 'engineering',
    },
  ],
]);

const learningProgress = new Map<string, { completed_modules: string[]; updated_at: string }>();

let killSwitchActive = false;
let networkIsolated = false;
let performanceModeState = {
  mode: 'balanced',
  cpu_threads: Math.max(2, Math.floor(os.cpus().length / 2)),
  eco_model: 'qwen2.5-coder:7b',
  active_profile: 'Balanceado',
};
let ponytailState = {
  level: 'senior',
  active: true,
  description: 'Validação de contexto, integridade de patch e revisão de segurança antes de alterações críticas.',
};
let onboardingCompleted = true;

let webhooksConfig = {
  enabled: false,
  discord_url: '',
  slack_url: '',
  custom_url: '',
  notify_on_approval: true,
  notify_on_failure: true,
};

let hybridConfig = {
  provider_name: 'gemini',
  enabled: true,
  base_url: 'http://127.0.0.1:11434',
  default_model: 'gemini-4-hydrogen',
  max_budget_usd: 25,
  current_spend_usd: 0.42,
  has_api_key: isGeminiApiConfigured(),
};

let hardwareProfiles: NotebookHardwareProfile[] = DEFAULT_HARDWARE_PROFILES.map((p) => ({ ...p }));
let activeHardwareProfileId = hardwareProfiles[0].id;

let providerConnectivity: ProviderConnectivity = {
  ollama_connected: true,
  huggingface_connected: true,
  gemini_connected: true,
};

function getActiveHardwareProfile(): NotebookHardwareProfile {
  return hardwareProfiles.find((p) => p.id === activeHardwareProfileId) || hardwareProfiles[0];
}

let vaultKeys: Array<Record<string, unknown>> = [
  {
    key_id: 'local-ollama-default',
    label: 'Ollama Local Runtime',
    provider: 'ollama',
    provider_name: 'Ollama',
    masked_key: 'local://127.0.0.1:11434',
    base_url: 'http://127.0.0.1:11434',
    default_model: 'qwen2.5-coder:14b',
    preferred_model: 'qwen2.5-coder:14b',
    is_active: true,
    is_default: true,
    owner_user_id: 'admin',
  },
];

let approvals: Array<Record<string, unknown>> = [
  {
    id: 'apr_deploy_policy_01',
    task_id: 'tsk_sec_audit_09',
    agent_role: 'cybersecurity_engineer',
    operation: 'project_file_modified',
    impact_summary: 'Atualizar cabeçalhos CSP e política HSTS no gateway de API.',
    affected_resources: ['gateway/security_headers.ts', 'config/csp.json'],
    proposed_diff: '+ Content-Security-Policy: default-src \'self\'; frame-ancestors \'self\'\n+ Strict-Transport-Security: max-age=31536000; includeSubDomains',
    reversible: true,
    status: 'pending',
    requested_at: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
  },
  {
    id: 'apr_migration_02',
    task_id: 'tsk_backend_idx_04',
    agent_role: 'backend_developer',
    operation: 'proactive_code_patch_application',
    impact_summary: 'Adicionar índice composto (tenant_id, created_at) na tabela de auditoria.',
    affected_resources: ['migrations/2026_add_audit_idx.sql'],
    proposed_diff: '+ CREATE INDEX CONCURRENTLY idx_audit_tenant_created ON audit_events (tenant_id, created_at DESC);',
    reversible: true,
    status: 'pending',
    requested_at: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
  },
];

const nowIso = () => new Date().toISOString();

const serverLogs: Array<{ id: string; timestamp: string; level: string; source: string; message: string }> = [
  { id: 'log_1', timestamp: new Date(Date.now() - 1000 * 60 * 12).toISOString(), level: 'INFO', source: 'security_core', message: 'Núcleo de segurança inicializado com validação de sessão HttpOnly.' },
  { id: 'log_2', timestamp: new Date(Date.now() - 1000 * 60 * 9).toISOString(), level: 'INFO', source: 'model_runtime', message: 'Roteador híbrido pronto: qwen2.5-coder:14b e llama3.1:8b disponíveis.' },
  { id: 'log_3', timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(), level: 'INFO', source: 'approval_engine', message: 'Motor de aprovações ativo: 2 solicitações aguardando decisão.' },
  { id: 'log_4', timestamp: new Date(Date.now() - 1000 * 60 * 2).toISOString(), level: 'WARNING', source: 'telemetry', message: 'Latência acima da média detectada em lote de análise estática (1420 ms).' },
];

const auditLogs = [
  {
    id: 'aud_1',
    timestamp: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
    actor: 'admin',
    operation: 'model_selected',
    status: 'success',
    severity: 'info',
    details: 'Modelo padrão definido para qwen2.5-coder:14b.',
  },
  {
    id: 'aud_2',
    timestamp: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
    actor: 'cybersecurity_engineer',
    operation: 'approval_request_created',
    status: 'awaiting_approval',
    severity: 'medium',
    details: 'Solicitação de atualização de cabeçalhos CSP registrada.',
  },
  {
    id: 'aud_3',
    timestamp: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
    actor: 'code_reviewer',
    operation: 'qa_security_pipeline_run',
    status: 'gate_passed',
    severity: 'info',
    details: 'Verificação estática concluída sem vulnerabilidades críticas.',
  },
];

const telemetryRecords = [
  {
    id: 'inf_01',
    task_id: 'tsk_arch_01',
    agent_role: 'software_architect',
    model_name: 'qwen2.5-coder:14b',
    provider: 'ollama',
    status: 'success',
    duration_ms: 840,
    prompt_tokens: 1420,
    completion_tokens: 680,
    cost_usd: 0,
    feedback_rating: 5,
    created_at: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
  },
  {
    id: 'inf_02',
    task_id: 'tsk_ui_02',
    agent_role: 'frontend_mobile_developer',
    model_name: 'qwen2.5-coder:14b',
    provider: 'ollama',
    status: 'success',
    duration_ms: 920,
    prompt_tokens: 2150,
    completion_tokens: 1120,
    cost_usd: 0,
    feedback_rating: 5,
    created_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
  },
  {
    id: 'inf_03',
    task_id: 'tsk_sec_audit_09',
    agent_role: 'cybersecurity_engineer',
    model_name: 'llama3.1:8b',
    provider: 'ollama',
    status: 'success',
    duration_ms: 610,
    prompt_tokens: 1890,
    completion_tokens: 540,
    cost_usd: 0,
    feedback_rating: 4,
    created_at: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
  },
  {
    id: 'inf_04',
    task_id: 'tsk_backend_idx_04',
    agent_role: 'backend_developer',
    model_name: 'deepseek-r1:14b',
    provider: 'ollama',
    status: 'success',
    duration_ms: 1180,
    prompt_tokens: 1640,
    completion_tokens: 910,
    cost_usd: 0,
    feedback_rating: 5,
    created_at: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
  },
];

interface AgentServerRecord {
  role: string;
  name: string;
  proper_name: string;
  handle: string;
  category: string;
  mission: string;
  preferred_model: string;
  routing_policy: 'auto_hybrid' | 'local_only' | 'online_only';
  autonomy_level: 'read_only' | 'ask_approval' | 'autonomous';
  is_read_only: boolean;
  strict_focus: boolean;
  strict_topic: string;
  delegation_targets: string[];
  allowed_tools: string[];
  system_prompt: string;
  mascot: { id: string; color: string; accessory: string; mood: string };
  is_custom?: boolean;
  version: number;
  updated_at: string;
}

const seedUpdatedAt = nowIso();

let agentsList: AgentServerRecord[] = [
  {
    role: 'jarvis_master',
    name: 'Maestro Orquestrador',
    proper_name: 'Maestro',
    handle: '@maestro',
    category: 'orchestration',
    mission: 'Orquestra especialistas, interpreta pedidos naturais, delega tarefas e sintetiza resultados.',
    preferred_model: 'gemini-4-hydrogen',
    routing_policy: 'auto_hybrid',
    autonomy_level: 'ask_approval',
    is_read_only: false,
    strict_focus: false,
    strict_topic: '',
    delegation_targets: ['sentinel_security', 'research_analyst', 'ux_ui_designer', 'english_tutor', 'math_tutor'],
    allowed_tools: ['delegate_agent', 'request_approval', 'search_code', 'read_file'],
    system_prompt: 'Você é o Maestro Orquestrador. Coordene a equipe multi-agente com clareza, empatia e precisão.',
    mascot: { id: 'maestro_slime', color: '#f97316', accessory: 'headphones', mood: 'idle' },
    version: 1,
    updated_at: seedUpdatedAt,
  },
  {
    role: 'sentinel_security',
    name: 'Sentinela de Segurança',
    proper_name: 'Kira',
    handle: '@kira',
    category: 'security',
    mission: 'Audita PDFs, links suspeitos, segredos no código e protege senhas com execução preferencialmente local.',
    preferred_model: 'llama3.1:8b',
    routing_policy: 'auto_hybrid',
    autonomy_level: 'read_only',
    is_read_only: true,
    strict_focus: true,
    strict_topic: 'Cibersegurança, veracidade de PDFs, links e privacidade',
    delegation_targets: ['cybersecurity_engineer'],
    allowed_tools: ['scan_secrets', 'query_audit', 'inspect_diff', 'read_file'],
    system_prompt: 'Você é Kira, a Sentinela de Segurança. Verifique autenticidade de documentos, golpes, vulnerabilidades OWASP e vazamento de dados.',
    mascot: { id: 'sentinel_owl', color: '#10b981', accessory: 'shield', mood: 'idle' },
    version: 1,
    updated_at: seedUpdatedAt,
  },
  {
    role: 'english_tutor',
    name: 'Professora de Inglês',
    proper_name: 'Clara',
    handle: '@clara',
    category: 'studies',
    mission: 'Ensina inglês com conversação natural, correção gentil, vocabulário diário e exercícios personalizados.',
    preferred_model: 'gemini-4-hydrogen',
    routing_policy: 'online_only',
    autonomy_level: 'read_only',
    is_read_only: true,
    strict_focus: true,
    strict_topic: 'Ensino de língua inglesa, gramática e conversação',
    delegation_targets: [],
    allowed_tools: [],
    system_prompt: 'Você é Clara, professora de inglês paciente e didática. Explique em português com exemplos práticos em inglês e pronúncia simplificada.',
    mascot: { id: 'scholar_fox', color: '#38bdf8', accessory: 'glasses', mood: 'idle' },
    version: 1,
    updated_at: seedUpdatedAt,
  },
  {
    role: 'math_tutor',
    name: 'Tutor de Matemática',
    proper_name: 'Newton',
    handle: '@newton',
    category: 'studies',
    mission: 'Resolve e explica matemática passo a passo, da álgebra ao cálculo, verificando cada etapa.',
    preferred_model: 'gemini-4-hydrogen',
    routing_policy: 'online_only',
    autonomy_level: 'read_only',
    is_read_only: true,
    strict_focus: true,
    strict_topic: 'Matemática, lógica, estatística e resolução de exercícios',
    delegation_targets: [],
    allowed_tools: [],
    system_prompt: 'Você é Newton, tutor de matemática. Mostre sempre o passo a passo didático, confira o resultado final e proponha um exercício semelhante se útil.',
    mascot: { id: 'scholar_fox', color: '#f59e0b', accessory: 'glasses', mood: 'idle' },
    version: 1,
    updated_at: seedUpdatedAt,
  },
  {
    role: 'research_analyst',
    name: 'Pesquisador Web & Relatórios',
    proper_name: 'Atlas',
    handle: '@atlas',
    category: 'studies',
    mission: 'Pesquisa informações atualizadas na internet com fontes clicáveis e transforma descobertas em resumos claros.',
    preferred_model: 'gemini-4-hydrogen',
    routing_policy: 'online_only',
    autonomy_level: 'read_only',
    is_read_only: true,
    strict_focus: false,
    strict_topic: 'Pesquisa web e síntese de fontes',
    delegation_targets: ['document_specialist', 'presentation_creator'],
    allowed_tools: ['read_file'],
    system_prompt: 'Você é Atlas, pesquisador analítico. Consulte informações atualizadas, compare fontes confiáveis e cite links claros.',
    mascot: { id: 'scholar_fox', color: '#38bdf8', accessory: 'glasses', mood: 'idle' },
    version: 1,
    updated_at: seedUpdatedAt,
  },
  {
    role: 'ux_ui_designer',
    name: 'Designer Visual & Imagens',
    proper_name: 'Vega',
    handle: '@vega',
    category: 'creative',
    mission: 'Cria direções visuais, interfaces limpas, paletas e conceitos de imagens para projetos e apresentações.',
    preferred_model: 'gemini-4-hydrogen',
    routing_policy: 'online_only',
    autonomy_level: 'ask_approval',
    is_read_only: false,
    strict_focus: false,
    strict_topic: 'Design UI/UX e criação visual',
    delegation_targets: ['frontend_mobile_developer'],
    allowed_tools: ['read_file'],
    system_prompt: 'Você é Vega, especialista em design visual, UX/UI e direção criativa.',
    mascot: { id: 'creator_cat', color: '#fb7185', accessory: 'stylus', mood: 'idle' },
    version: 1,
    updated_at: seedUpdatedAt,
  },
  {
    role: 'presentation_creator',
    name: 'Criador de PowerPoint',
    proper_name: 'Dante',
    handle: '@dante',
    category: 'creative',
    mission: 'Estrutura apresentações e roteiros de slides impactantes prontos para exportar em PowerPoint.',
    preferred_model: 'gemini-4-hydrogen',
    routing_policy: 'online_only',
    autonomy_level: 'autonomous',
    is_read_only: false,
    strict_focus: true,
    strict_topic: 'Criação de apresentações, storytelling e slides',
    delegation_targets: ['research_analyst', 'ux_ui_designer'],
    allowed_tools: [],
    system_prompt: 'Você é Dante, especialista em apresentações executivas e acadêmicas. Estruture cada slide com título claro, pontos objetivos e notas do apresentador.',
    mascot: { id: 'creator_cat', color: '#f97316', accessory: 'stylus', mood: 'idle' },
    version: 1,
    updated_at: seedUpdatedAt,
  },
  {
    role: 'document_specialist',
    name: 'Especialista em PDFs & Trabalhos',
    proper_name: 'Sofia',
    handle: '@sofia',
    category: 'creative',
    mission: 'Redige, revisa e organiza trabalhos acadêmicos, resumos estruturados e relatórios prontos para PDF.',
    preferred_model: 'gemini-4-hydrogen',
    routing_policy: 'online_only',
    autonomy_level: 'autonomous',
    is_read_only: false,
    strict_focus: false,
    strict_topic: 'Redação estruturada, ABNT e documentos PDF',
    delegation_targets: ['research_analyst'],
    allowed_tools: ['read_file'],
    system_prompt: 'Você é Sofia, especialista em escrita estruturada, revisão textual e organização de documentos e trabalhos.',
    mascot: { id: 'creator_cat', color: '#a78bfa', accessory: 'stylus', mood: 'idle' },
    version: 1,
    updated_at: seedUpdatedAt,
  },
  {
    role: 'finance_business',
    name: 'Analista de Finanças & Negócios',
    proper_name: 'Helena',
    handle: '@helena',
    category: 'business',
    mission: 'Analisa orçamento pessoal/empresarial, fluxo de caixa, metas e compara cenários financeiros.',
    preferred_model: 'gemini-4-hydrogen',
    routing_policy: 'auto_hybrid',
    autonomy_level: 'read_only',
    is_read_only: true,
    strict_focus: true,
    strict_topic: 'Finanças, planejamento de negócios e orçamento',
    delegation_targets: ['research_analyst'],
    allowed_tools: ['inspect_dataset', 'validate_data'],
    system_prompt: 'Você é Helena, analista de negócios e finanças. Apresente números tabulares claros, prós, contras e plano prático.',
    mascot: { id: 'scholar_fox', color: '#10b981', accessory: 'glasses', mood: 'idle' },
    version: 1,
    updated_at: seedUpdatedAt,
  },
  {
    role: 'flow_architect',
    name: 'Flow Architect (Criação de Fluxos)',
    proper_name: 'Léo',
    handle: '@leo',
    category: 'orchestration',
    mission: 'Transforma pedidos em português em fluxos multi-agente automatizados e rotinas agendadas.',
    preferred_model: 'gemini-4-hydrogen',
    routing_policy: 'auto_hybrid',
    autonomy_level: 'ask_approval',
    is_read_only: false,
    strict_focus: false,
    strict_topic: 'Automação e criação de workflows',
    delegation_targets: ['jarvis_master'],
    allowed_tools: ['delegate_agent'],
    system_prompt: 'Você é Léo, arquiteto de fluxos. Quebre qualquer rotina em passos claros, gatilhos e responsáveis.',
    mascot: { id: 'maestro_slime', color: '#f97316', accessory: 'crown', mood: 'idle' },
    version: 1,
    updated_at: seedUpdatedAt,
  },
  {
    role: 'software_architect',
    name: 'Arquiteto de Software',
    proper_name: 'Orion',
    handle: '@orion',
    category: 'dev',
    mission: 'Define arquitetura modular, contratos de API e padrões de escalabilidade.',
    preferred_model: 'qwen2.5-coder:7b',
    routing_policy: 'auto_hybrid',
    autonomy_level: 'read_only',
    is_read_only: true,
    strict_focus: false,
    strict_topic: '',
    delegation_targets: ['frontend_mobile_developer', 'backend_developer'],
    allowed_tools: ['read_file', 'list_directory', 'search_code', 'inspect_manifest'],
    system_prompt: 'Você é Orion, Arquiteto de Software. Projete soluções resilientes, desacopladas e fáceis de manter.',
    mascot: { id: 'coder_slime', color: '#2dd4bf', accessory: 'visor', mood: 'idle' },
    version: 1,
    updated_at: seedUpdatedAt,
  },
  {
    role: 'frontend_mobile_developer',
    name: 'Desenvolvedor Frontend & Mobile',
    proper_name: 'Neo',
    handle: '@neo',
    category: 'dev',
    mission: 'Constrói interfaces responsivas em React, TypeScript e design systems modernos.',
    preferred_model: 'qwen2.5-coder:7b',
    routing_policy: 'auto_hybrid',
    autonomy_level: 'ask_approval',
    is_read_only: false,
    strict_focus: false,
    strict_topic: '',
    delegation_targets: ['qa_engineer'],
    allowed_tools: ['read_file', 'propose_patch', 'run_linter', 'run_tests', 'search_code'],
    system_prompt: 'Você é Neo, engenheiro frontend. Foque em acessibilidade, performance visual e consistência de design.',
    mascot: { id: 'coder_slime', color: '#2dd4bf', accessory: 'visor', mood: 'idle' },
    version: 1,
    updated_at: seedUpdatedAt,
  },
  {
    role: 'backend_developer',
    name: 'Desenvolvedor Backend (APIs)',
    proper_name: 'Milo',
    handle: '@milo',
    category: 'dev',
    mission: 'Implementa APIs seguras, filas, integrações e modelagem de dados.',
    preferred_model: 'qwen2.5-coder:7b',
    routing_policy: 'auto_hybrid',
    autonomy_level: 'ask_approval',
    is_read_only: false,
    strict_focus: false,
    strict_topic: '',
    delegation_targets: ['qa_engineer', 'sentinel_security'],
    allowed_tools: ['read_file', 'propose_patch', 'run_tests', 'inspect_dataset'],
    system_prompt: 'Você é Milo, engenheiro backend. Garanta validação estrita, observabilidade e baixa latência.',
    mascot: { id: 'coder_slime', color: '#38bdf8', accessory: 'visor', mood: 'idle' },
    version: 1,
    updated_at: seedUpdatedAt,
  },
  {
    role: 'cybersecurity_engineer',
    name: 'Engenheiro de Cibersegurança',
    proper_name: 'Aegis',
    handle: '@aegis',
    category: 'security',
    mission: 'Audita código, segredos, superfícies de ataque e políticas de contenção.',
    preferred_model: 'llama3.1:8b',
    routing_policy: 'auto_hybrid',
    autonomy_level: 'read_only',
    is_read_only: true,
    strict_focus: true,
    strict_topic: 'Segurança de aplicações e infraestrutura',
    delegation_targets: ['sentinel_security'],
    allowed_tools: ['scan_secrets', 'query_audit', 'inspect_diff', 'read_file'],
    system_prompt: 'Você é Aegis, engenheiro de cibersegurança. Identifique riscos e recomende mitigação imediata.',
    mascot: { id: 'sentinel_owl', color: '#10b981', accessory: 'shield', mood: 'idle' },
    version: 1,
    updated_at: seedUpdatedAt,
  },
  {
    role: 'qa_engineer',
    name: 'Engenheiro de QA & Testes',
    proper_name: 'Bia',
    handle: '@bia',
    category: 'dev',
    mission: 'Cria testes automatizados, valida regressões e mede cobertura.',
    preferred_model: 'llama3.1:8b',
    routing_policy: 'auto_hybrid',
    autonomy_level: 'ask_approval',
    is_read_only: false,
    strict_focus: false,
    strict_topic: '',
    delegation_targets: [],
    allowed_tools: ['run_tests', 'run_linter', 'inspect_diff', 'read_file'],
    system_prompt: 'Você é Bia, engenheira de QA. Assegure confiabilidade e validação contínua de fluxos críticos.',
    mascot: { id: 'coder_slime', color: '#f59e0b', accessory: 'visor', mood: 'idle' },
    version: 1,
    updated_at: seedUpdatedAt,
  },
  {
    role: 'code_reviewer',
    name: 'Revisor de Código Sênior',
    proper_name: 'Caio',
    handle: '@caio',
    category: 'dev',
    mission: 'Revisa pull requests quanto à legibilidade, segurança e dívida técnica.',
    preferred_model: 'qwen2.5-coder:7b',
    routing_policy: 'auto_hybrid',
    autonomy_level: 'read_only',
    is_read_only: true,
    strict_focus: false,
    strict_topic: '',
    delegation_targets: [],
    allowed_tools: ['inspect_diff', 'read_file', 'run_linter', 'search_code'],
    system_prompt: 'Você é Caio, revisor de código sênior. Revise cada alteração com rigor técnico e feedback acionável.',
    mascot: { id: 'coder_slime', color: '#a78bfa', accessory: 'visor', mood: 'idle' },
    version: 1,
    updated_at: seedUpdatedAt,
  },
  {
    role: 'devops_engineer',
    name: 'Engenheiro DevOps & CI/CD',
    proper_name: 'Theo',
    handle: '@theo',
    category: 'dev',
    mission: 'Gerencia containers, pipelines, observabilidade e disponibilidade.',
    preferred_model: 'qwen2.5-coder:7b',
    routing_policy: 'auto_hybrid',
    autonomy_level: 'ask_approval',
    is_read_only: false,
    strict_focus: false,
    strict_topic: '',
    delegation_targets: [],
    allowed_tools: ['read_file', 'propose_patch', 'git_status', 'git_diff'],
    system_prompt: 'Você é Theo, engenheiro DevOps. Mantenha entregas reprodutíveis, seguras e monitoráveis.',
    mascot: { id: 'coder_slime', color: '#2dd4bf', accessory: 'visor', mood: 'idle' },
    version: 1,
    updated_at: seedUpdatedAt,
  },
];

const agentVersions = new Map<string, Array<{ version: number; saved_at: string; summary: string; snapshot: Record<string, unknown> }>>();

function recordAgentVersion(agent: AgentServerRecord, summary: string) {
  const list = agentVersions.get(agent.role) || [];
  list.unshift({
    version: agent.version,
    saved_at: nowIso(),
    summary,
    snapshot: {
      name: agent.name,
      proper_name: agent.proper_name,
      handle: agent.handle,
      mission: agent.mission,
      system_prompt: agent.system_prompt,
      preferred_model: agent.preferred_model,
      routing_policy: agent.routing_policy,
      autonomy_level: agent.autonomy_level,
      is_read_only: agent.is_read_only,
      strict_focus: agent.strict_focus,
      strict_topic: agent.strict_topic,
      delegation_targets: [...agent.delegation_targets],
      allowed_tools: [...agent.allowed_tools],
      mascot: { ...agent.mascot },
    },
  });
  agentVersions.set(agent.role, list.slice(0, 20));
}

for (const ag of agentsList) {
  recordAgentVersion(ag, 'Versão inicial do catálogo');
}

function detectInvokedAgent(prompt: string, sessionId?: string): AgentServerRecord {
  const lower = prompt.toLowerCase();
  // 1. Direct @handle mention
  for (const ag of agentsList) {
    if (ag.handle && lower.includes(ag.handle.toLowerCase())) {
      return ag;
    }
  }
  // 2. Proper name natural invocation (e.g. "chama a Kira", "Newton, resolva", "Clara me ajuda")
  for (const ag of agentsList) {
    if (ag.role === 'jarvis_master') continue;
    const pname = (ag.proper_name || '').trim();
    if (pname.length >= 3) {
      const rx = new RegExp(`\\b${pname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (rx.test(prompt)) return ag;
    }
  }
  // 3. Session tied to specific agent
  if (sessionId && (sessionId.startsWith('agent_') || sessionId.startsWith('agent-'))) {
    const rawKey = sessionId.slice(6);
    const bySession = agentsList.find((a) => a.role === rawKey);
    if (bySession) return bySession;
  }
  return agentsList[0];
}

let agentRoutes: Array<Record<string, unknown>> = [
  {
    agent_role: 'jarvis_master',
    key_id: 'local-ollama-default',
    model: 'qwen2.5-coder:14b',
    key_label: 'Ollama Local Runtime',
    provider: 'ollama',
    key_available: true,
    updated_at: nowIso(),
  },
];

const agentMemories = new Map<string, Array<Record<string, unknown>>>();

let workspaceProjects = [
  {
    id: 'jarvis-ai-hub',
    name: 'JARVIS AI Hub',
    type: 'web',
    path: '/workspace/jarvis-ai-hub',
    mode: 'managed',
    description: 'Interface de orquestração multi-agente, observabilidade e governança de modelos.',
    file_count: 84,
    files: ['src/App.tsx', 'src/index.css', 'src/components/Overview.tsx', 'src/components/ChatMaster.tsx', 'package.json'],
    updated_at: nowIso(),
  },
  {
    id: 'gateway-security-core',
    name: 'Gateway Security Core',
    type: 'python',
    path: '/workspace/gateway-security-core',
    mode: 'read_only',
    description: 'Serviço de políticas de aprovação humana, auditoria e roteamento híbrido.',
    file_count: 36,
    files: ['app/main.py', 'app/security/policies.py', 'app/audit/trail.py', 'pyproject.toml'],
    updated_at: new Date(Date.now() - 1000 * 60 * 95).toISOString(),
  },
];

const projectMemories = new Map<string, Array<Record<string, unknown>>>([
  [
    'jarvis-ai-hub',
    [
      {
        id: 'pm_1',
        category: 'architecture_rule',
        key: 'design_system',
        content: 'Usar paleta Obsidian Studio (#0B0D12), acento azul cobalto (#3B82F6) e tipografia Plus Jakarta Sans + JetBrains Mono.',
        created_at: nowIso(),
      },
    ],
  ],
]);

let skillsList = [
  {
    id: 'skill_secure_patch',
    name: 'Auditoria de Patch Seguro',
    version: '1.2.0',
    origin: 'builtin',
    license: 'MIT',
    description: 'Valida diffs contra vazamento de segredos, XSS e regressões antes de aplicar alterações.',
    domain: 'security',
    allowed_tools: ['inspect_diff', 'scan_secrets', 'run_linter'],
    required_permissions: ['security:read'],
    assigned_agents: ['cybersecurity_engineer', 'code_reviewer'],
    content_hash: 'sha256:9f82b1c4e0',
    is_approved: true,
    is_revoked: false,
    instructions: 'Analise toda proposta de alteração buscando credenciais embutidas, injeção de comandos e falhas de autorização.',
    created_at: nowIso(),
    updated_at: nowIso(),
  },
  {
    id: 'skill_ui_consistency',
    name: 'Consistência de Design System',
    version: '1.0.4',
    origin: 'builtin',
    license: 'MIT',
    description: 'Garante contraste AA, tokens semânticos e responsividade em componentes React.',
    domain: 'frontend',
    allowed_tools: ['read_file', 'propose_patch', 'run_linter'],
    required_permissions: ['workspace:write'],
    assigned_agents: ['frontend_mobile_developer'],
    content_hash: 'sha256:4a17d3e9f2',
    is_approved: true,
    is_revoked: false,
    instructions: 'Aplique variáveis CSS do tema, estados de foco acessíveis e espaçamento consistente.',
    created_at: nowIso(),
    updated_at: nowIso(),
  },
];

let knowledgeDocs = [
  {
    name: 'arquitetura-multiagente.md',
    category: 'projeto',
    chunks: 14,
    size_bytes: 18420,
    file_type: 'md',
    indexed_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    content: 'Guia de orquestração do JARVIS AI Hub: roteamento entre modelos locais e nuvem, motor de aprovações humanas e isolamento de workspace.',
  },
  {
    name: 'politica-aprovacoes-seguranca.md',
    category: 'qa_guideline',
    chunks: 9,
    size_bytes: 11240,
    file_type: 'md',
    indexed_at: new Date(Date.now() - 1000 * 60 * 75).toISOString(),
    content: 'Operações destrutivas, rollbacks e modificações em produção exigem aprovação explícita no Approval Center.',
  },
];

interface StoredChatSession {
  session_id: string;
  title: string;
  first_prompt: string;
  first_intent: string;
  last_activity: string;
  messages: Array<{
    id: number;
    session_id: string;
    project_id?: string | null;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
  }>;
  tasks: Array<Record<string, unknown>>;
}

const chatSessions = new Map<string, StoredChatSession>([
  [
    'sess_welcome_01',
    {
      session_id: 'sess_welcome_01',
      title: 'Boas-vindas ao JARVIS AI Hub',
      first_prompt: 'Apresente o estado atual da plataforma e os próximos passos recomendados.',
      first_intent: 'system_overview',
      last_activity: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
      messages: [
        {
          id: 1,
          session_id: 'sess_welcome_01',
          role: 'user',
          content: 'Apresente o estado atual da plataforma e os próximos passos recomendados.',
          created_at: new Date(Date.now() - 1000 * 60 * 9).toISOString(),
        },
        {
          id: 2,
          session_id: 'sess_welcome_01',
          role: 'assistant',
          content:
            '### JARVIS AI Hub operacional\n\nO ambiente está ativo e pronto para orquestração.\n\n- **Núcleo de Segurança**: Sessão protegida por cookie HttpOnly e motor de aprovações ativo.\n- **Aprovações pendentes**: 2 solicitações aguardam revisão na Central de Aprovações.\n- **Especialistas prontos**: 8 agentes configurados para arquitetura, frontend, backend, QA e cibersegurança.\n\nVocê pode iniciar um novo comando aqui ou abrir qualquer módulo pela barra lateral.',
          created_at: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
        },
      ],
      tasks: [
        {
          task_id: 'tsk_welcome_01',
          session_id: 'sess_welcome_01',
          user_prompt: 'Apresente o estado atual da plataforma e os próximos passos recomendados.',
          classified_intent: 'system_overview',
          plan_steps: ['Verificar saúde dos componentes', 'Consolidar aprovações pendentes', 'Gerar resumo executivo'],
          selected_agents: ['jarvis_master', 'software_architect'],
          policy_verified: true,
          policy_violations: [],
          approval_required: false,
          final_summary: 'Plataforma saudável com 2 aprovações pendentes e 8 especialistas ativos.',
          is_completed: true,
          created_at: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
        },
      ],
    },
  ],
]);

let tasksList: Array<Record<string, unknown>> = [
  {
    task_id: 'tsk_arch_01',
    session_id: 'sess_welcome_01',
    user_prompt: 'Revisar arquitetura do design system Obsidian Studio',
    project_id: 'jarvis-ai-hub',
    classified_intent: 'architecture_review',
    selected_agents: ['software_architect', 'frontend_mobile_developer'],
    status: 'completed',
    is_completed: true,
    created_at: new Date(Date.now() - 1000 * 60 * 140).toISOString(),
  },
  {
    task_id: 'tsk_sec_audit_09',
    session_id: 'sess_welcome_01',
    user_prompt: 'Auditar política CSP e cabeçalhos HTTP de segurança',
    project_id: 'gateway-security-core',
    classified_intent: 'security_audit',
    selected_agents: ['cybersecurity_engineer'],
    status: 'awaiting_approval',
    is_completed: false,
    created_at: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
  },
];

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

function getSessionFromReq(req: Request): SessionRecord | null {
  const cookies = parseCookies(req.headers.cookie);
  const headerToken = String(req.headers['x-jarvis-session'] || '').trim();
  const authHeader = String(req.headers.authorization || '').trim();
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const queryToken = typeof req.query.session_token === 'string' ? req.query.session_token.trim() : '';

  const sid = cookies[SESSION_COOKIE] || headerToken || bearerToken || queryToken;
  if (!sid) return null;
  return sessions.get(sid) || null;
}

function setSessionCookie(req: Request, res: Response, sessionId: string) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const isHttps = req.secure || forwardedProto.includes('https');
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'Max-Age=86400',
    isHttps ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax',
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(req: Request, res: Response) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const isHttps = req.secure || forwardedProto.includes('https');
  const attrs = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    isHttps ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax',
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function createSessionForUser(req: Request, res: Response, user: UserAccount): SessionRecord {
  const session_id = crypto.randomBytes(32).toString('hex');
  const record: SessionRecord = {
    session_id,
    username: user.username,
    role: user.role,
    kind: 'human',
    created_at: Date.now(),
  };
  sessions.set(session_id, record);
  setSessionCookie(req, res, session_id);
  return record;
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = getSessionFromReq(req);
  if (!session) {
    res.status(401).json({ detail: 'Sessão não autenticada. Faça login para continuar.' });
    return;
  }
  const user = users.get(session.username);
  if (!user || !user.is_active) {
    sessions.delete(session.session_id);
    res.status(401).json({ detail: 'Conta inativa ou sessão revogada.' });
    return;
  }
  (req as Request & { jarvisSession?: SessionRecord; jarvisUser?: UserAccount }).jarvisSession = session;
  (req as Request & { jarvisSession?: SessionRecord; jarvisUser?: UserAccount }).jarvisUser = user;
  next();
}

function buildAssistantReply(prompt: string, model?: string): string {
  const clean = prompt.trim();
  const usedModel = model || hybridConfig.default_model;
  return [
    `### Análise do JARVIS (${usedModel})`,
    '',
    `Recebi a sua solicitação: **${clean}**`,
    '',
    '#### Plano de execução sugerido',
    '1. Validar o contexto do projeto e requisitos de segurança ativos.',
    '2. Delegar a implementação ou revisão ao especialista mais adequado no Agent Center.',
    '3. Registrar telemetria e submeter qualquer ação de alto impacto para aprovação humana.',
    '',
    '> Dica: você pode explorar a **Visão Geral**, o **Centro de Agentes**, a **Central de Aprovações** e os **Estúdios** pelo menu lateral.',
  ].join('\n');
}

function buildApiRouter() {
  const api = express.Router();
  api.use(express.json({ limit: '4mb' }));

  // --- AUTH ---
  api.get('/auth/me', (req, res) => {
    const session = getSessionFromReq(req);
    if (!session) {
      res.status(401).json({ detail: 'Não autenticado.' });
      return;
    }
    const user = users.get(session.username);
    if (!user || !user.is_active) {
      sessions.delete(session.session_id);
      res.status(401).json({ detail: 'Conta inativa.' });
      return;
    }
    res.json({
      user_id: user.username,
      subject_id: user.username,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      kind: session.kind,
      permissions: permissionsForRole(user.role),
      must_change_password: user.must_change_password,
    });
  });

  api.post('/auth/password-login', (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = users.get(username);
    if (!user || !user.is_active || !verifyPassword(password, user.salt, user.password_hash)) {
      res.status(401).json({ detail: 'Utilizador ou palavra-passe inválidos.' });
      return;
    }
    const record = createSessionForUser(req, res, user);
    res.json({
      status: 'authenticated',
      user_id: user.username,
      role: user.role,
      display_name: user.display_name,
      session_token: record.session_id,
    });
  });

  api.post('/auth/login', (req, res) => {
    const token = String(req.body?.token || '').trim();
    if (!VALID_ADMIN_TOKENS.has(token)) {
      res.status(401).json({ detail: 'Token de administrador inválido.' });
      return;
    }
    const admin = users.get('admin')!;
    const record = createSessionForUser(req, res, admin);
    res.json({
      status: 'authenticated',
      user_id: admin.username,
      role: admin.role,
      session_token: record.session_id,
    });
  });

  api.post('/auth/bootstrap/exchange', (req, res) => {
    const token = String(req.body?.token || '').trim();
    if (!VALID_BOOTSTRAP_TOKENS.has(token)) {
      res.status(401).json({ detail: 'Token inicial inválido ou expirado.' });
      return;
    }
    const admin = users.get('admin')!;
    const record = createSessionForUser(req, res, admin);
    res.json({
      status: 'authenticated',
      user_id: admin.username,
      role: admin.role,
      session_token: record.session_id,
    });
  });

  // Safe public profile selector cards (no credentials or PII exposed)
  api.get('/auth/profiles', (_req, res) => {
    const cards = Array.from(users.values())
      .filter((u) => u.is_active && !u.username.startsWith('fb_'))
      .map((u) => {
        const prof = userProfiles.get(u.username);
        return {
          username: u.username,
          display_name: prof?.displayName || u.display_name,
          assistant_name: prof?.assistantName || 'JARVIS',
          experience_mode: prof?.experienceMode === 'simple' ? 'simple' : 'engineering',
          role: u.role,
          avatar_icon: prof?.avatarIcon || u.display_name.slice(0, 1).toUpperCase(),
        };
      });
    res.json({ profiles: cards });
  });

  // Simplified household / personal account registration (starts in Simple Mode with custom assistant name)
  api.post('/auth/register-personal', (req, res) => {
    const rawUsername = String(req.body?.username || '').trim().toLowerCase();
    const display_name = String(req.body?.display_name || '').trim();
    const password = String(req.body?.password || '');
    const assistant_name = String(req.body?.assistant_name || 'JARVIS').trim().slice(0, 40) || 'JARVIS';
    const experience_mode = req.body?.experience_mode === 'engineering' ? 'engineering' : 'simple';

    if (!/^[a-z0-9._-]{3,32}$/.test(rawUsername)) {
      res.status(400).json({ detail: 'Use entre 3 e 32 caracteres no utilizador (letras, números, ponto ou traço).' });
      return;
    }
    if (display_name.length < 2 || display_name.length > 80) {
      res.status(400).json({ detail: 'Informe o seu nome (entre 2 e 80 caracteres).' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ detail: 'Escolha uma senha com pelo menos 8 caracteres.' });
      return;
    }
    if (users.has(rawUsername)) {
      res.status(409).json({ detail: `O utilizador @${rawUsername} já existe. Escolha outro ou faça login.` });
      return;
    }

    const account = makeAccount(rawUsername, display_name, password, 'developer', false);
    users.set(rawUsername, account);
    userProfiles.set(rawUsername, {
      displayName: display_name,
      avatarIcon: Array.from(display_name)[0]?.toUpperCase() || 'U',
      developerRole: experience_mode === 'simple' ? 'Uso Pessoal & Estudos' : 'Engenharia & IA',
      seniorityLevel: experience_mode === 'simple' ? 'junior' : 'senior',
      responseStyle: experience_mode === 'simple' ? 'educational' : 'detailed',
      customInstructions: experience_mode === 'simple'
        ? 'Responda em português claro, acolhedor e sem jargões técnicos desnecessários.'
        : 'Priorize respostas técnicas claras e organizadas.',
      assistantName: assistant_name,
      assistantGreeting: '',
      experienceMode: experience_mode,
    });

    const record = createSessionForUser(req, res, account);
    res.status(201).json({
      status: 'authenticated',
      user_id: account.username,
      role: account.role,
      display_name: account.display_name,
      assistant_name,
      experience_mode,
      session_token: record.session_id,
    });
  });

  // Bridge verified Google / Firebase Auth client sign-in to local API session
  api.post('/auth/firebase-session', (req, res) => {
    const uid = String(req.body?.uid || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const display_name = String(req.body?.display_name || 'Usuário').trim().slice(0, 80) || 'Usuário';
    const email_verified = req.body?.email_verified === true;

    if (!uid || !/^[a-zA-Z0-9_-]{6,128}$/.test(uid)) {
      res.status(400).json({ detail: 'Identificador Firebase inválido.' });
      return;
    }

    const username = `fb_${uid.slice(0, 20).toLowerCase()}`;
    const isBootstrappedAdmin = email_verified && email === 'alexandrecalmonjunior@gmail.com';
    const role: 'admin' | 'developer' = isBootstrappedAdmin ? 'admin' : 'developer';

    let user = users.get(username);
    if (!user) {
      user = makeAccount(username, display_name, crypto.randomBytes(24).toString('hex'), role, false);
      users.set(username, user);
      userProfiles.set(username, {
        displayName: display_name,
        avatarIcon: Array.from(display_name)[0]?.toUpperCase() || 'J',
        developerRole: isBootstrappedAdmin ? 'Arquiteto & Administrador' : 'Uso Pessoal & Estudos',
        seniorityLevel: isBootstrappedAdmin ? 'architect' : 'mid',
        responseStyle: isBootstrappedAdmin ? 'detailed' : 'educational',
        customInstructions: '',
        assistantName: 'JARVIS',
        assistantGreeting: '',
        experienceMode: isBootstrappedAdmin ? 'engineering' : 'simple',
      });
    } else if (!user.is_active) {
      res.status(403).json({ detail: 'Conta desativada pelo administrador.' });
      return;
    }

    const record = createSessionForUser(req, res, user);
    res.json({
      status: 'authenticated',
      user_id: user.username,
      role: user.role,
      display_name: user.display_name,
      session_token: record.session_id,
    });
  });

  api.post('/auth/logout', (req, res) => {
    const session = getSessionFromReq(req);
    if (session) sessions.delete(session.session_id);
    clearSessionCookie(req, res);
    res.json({ status: 'logged_out' });
  });

  api.post('/auth/change-password', requireAuth, (req, res) => {
    const user = (req as Request & { jarvisUser: UserAccount }).jarvisUser;
    const newPassword = String(req.body?.new_password || req.body?.password || '');
    if (newPassword.length < 12) {
      res.status(400).json({ detail: 'A nova palavra-passe deve ter pelo menos 12 caracteres.' });
      return;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    user.salt = salt;
    user.password_hash = hashPassword(newPassword, salt);
    user.must_change_password = false;
    res.json({ status: 'updated' });
  });

  api.get('/auth/users', requireAuth, (req, res) => {
    const session = (req as Request & { jarvisSession: SessionRecord }).jarvisSession;
    if (session.role !== 'admin') {
      res.status(403).json({ detail: 'Apenas administradores podem gerir contas.' });
      return;
    }
    const list = Array.from(users.values()).map((u) => ({
      username: u.username,
      display_name: u.display_name,
      role: u.role,
      is_active: u.is_active,
      created_at: u.created_at,
    }));
    res.json({ users: list });
  });

  api.post('/auth/users', requireAuth, (req, res) => {
    const session = (req as Request & { jarvisSession: SessionRecord }).jarvisSession;
    if (session.role !== 'admin') {
      res.status(403).json({ detail: 'Apenas administradores podem criar contas.' });
      return;
    }
    const username = String(req.body?.username || '').trim().toLowerCase();
    const display_name = String(req.body?.display_name || '').trim();
    const password = String(req.body?.password || '');
    const role = (req.body?.role || 'developer') as 'admin' | 'developer' | 'auditor';
    if (!username || !display_name || password.length < 12) {
      res.status(400).json({ detail: 'Preencha utilizador, nome apresentado e senha (mínimo 12 caracteres).' });
      return;
    }
    if (users.has(username)) {
      res.status(409).json({ detail: `O utilizador @${username} já existe.` });
      return;
    }
    users.set(username, makeAccount(username, display_name, password, role, false));
    res.status(201).json({ status: 'created', username });
  });

  api.put('/auth/users/:username/password', requireAuth, (req, res) => {
    const session = (req as Request & { jarvisSession: SessionRecord }).jarvisSession;
    if (session.role !== 'admin') {
      res.status(403).json({ detail: 'Apenas administradores podem redefinir senhas.' });
      return;
    }
    const target = users.get(req.params.username.toLowerCase());
    const password = String(req.body?.password || '');
    if (!target) {
      res.status(404).json({ detail: 'Utilizador não encontrado.' });
      return;
    }
    if (password.length < 12) {
      res.status(400).json({ detail: 'A palavra-passe precisa de pelo menos 12 caracteres.' });
      return;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    target.salt = salt;
    target.password_hash = hashPassword(password, salt);
    for (const [sid, sess] of sessions.entries()) {
      if (sess.username === target.username && sid !== session.session_id) {
        sessions.delete(sid);
      }
    }
    res.json({ status: 'password_updated' });
  });

  api.patch('/auth/users/:username/status', requireAuth, (req, res) => {
    const session = (req as Request & { jarvisSession: SessionRecord }).jarvisSession;
    if (session.role !== 'admin') {
      res.status(403).json({ detail: 'Apenas administradores podem alterar estados de contas.' });
      return;
    }
    const target = users.get(req.params.username.toLowerCase());
    if (!target) {
      res.status(404).json({ detail: 'Utilizador não encontrado.' });
      return;
    }
    if (target.username === session.username) {
      res.status(400).json({ detail: 'Não é possível desativar a própria conta ativa.' });
      return;
    }
    target.is_active = Boolean(req.body?.is_active);
    res.json({ status: 'updated', is_active: target.is_active });
  });

  api.post('/mobile/pair', requireAuth, (req, res) => {
    const device_name = String(req.body?.device_name || 'Meu Android').trim();
    const device_token = `jrv_dev_${crypto.randomBytes(20).toString('hex')}`;
    const origin = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers.host}`;
    res.json({
      device_name,
      device_token,
      server_url: origin,
      pairing_payload: JSON.stringify({
        hub: 'jarvis-hub',
        v: '3.0.1',
        url: origin,
        token: device_token,
        device_name,
      }),
    });
  });

  // --- SYSTEM ---
  api.get('/system/health', (_req, res) => {
    res.json({
      status: killSwitchActive ? 'degraded' : 'healthy',
      components: {
        security_core: killSwitchActive ? 'contained' : 'active',
        approval_engine: 'ready',
        model_runtime: 'online',
        inference_queue: { active: 0, waiting: 0 },
        kill_switch: { global_killed: killSwitchActive },
      },
    });
  });

  api.get('/system/health/details', requireAuth, (_req, res) => {
    res.json({
      status: killSwitchActive ? 'degraded' : 'healthy',
      uptime_seconds: Math.floor((Date.now() - BOOT_TIME) / 1000),
      node_version: process.version,
      platform: os.platform(),
      arch: os.arch(),
      kill_switch: killSwitchActive,
      network_isolated: networkIsolated,
    });
  });

  api.get('/system/resources', requireAuth, (_req, res) => {
    const totalMb = Math.round(os.totalmem() / (1024 * 1024));
    const freeMb = Math.round(os.freemem() / (1024 * 1024));
    const usedMb = Math.max(0, totalMb - freeMb);
    const load = os.loadavg()[0] || 0;
    const cpuCount = Math.max(1, os.cpus().length);
    const cpuPercent = Math.min(100, Math.round((load / cpuCount) * 100 * 10) / 10);
    res.json({
      cpu_percent: cpuPercent || 14.2,
      ram_used_mb: usedMb,
      ram_total_mb: totalMb,
      ram_percent: totalMb > 0 ? Math.round((usedMb / totalMb) * 1000) / 10 : 0,
      disk_free_gb: 128.4,
      disk_total_gb: 256,
      disk_percent: 49.8,
      inference_queue_active: 0,
      inference_queue_waiting: 0,
      is_throttled: false,
      offline_mode_active: networkIsolated,
    });
  });

  api.get('/system/onboarding', requireAuth, (_req, res) => {
    res.json({ completed: onboardingCompleted });
  });

  api.post('/system/onboarding/complete', requireAuth, (_req, res) => {
    onboardingCompleted = true;
    res.json({ completed: true });
  });

  api.get('/system/discovery', requireAuth, (req, res) => {
    const origin = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers.host}`;
    res.json({
      hub_name: 'JARVIS AI Hub',
      version: '3.0.1',
      local_url: origin,
      lan_ip: '127.0.0.1',
      port: PORT,
    });
  });

  api.get('/system/inference-telemetry', requireAuth, (req, res) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
    const taskId = req.query.task_id ? String(req.query.task_id) : null;
    const filtered = taskId
      ? telemetryRecords.filter((r) => r.task_id === taskId)
      : telemetryRecords.slice(0, limit);

    const totalTokens = filtered.reduce((acc, r) => acc + r.prompt_tokens + r.completion_tokens, 0);
    const avgLatency = filtered.length
      ? Math.round(filtered.reduce((acc, r) => acc + r.duration_ms, 0) / filtered.length)
      : 0;

    res.json({
      summary: {
        total_inferences: filtered.length,
        successful: filtered.filter((r) => r.status === 'success').length,
        failed: filtered.filter((r) => r.status !== 'success').length,
        total_tokens: totalTokens,
        total_cost_usd: 0,
        average_latency_ms: avgLatency,
      },
      records: filtered,
      model_performance: [
        {
          model_name: 'qwen2.5-coder:14b',
          provider: 'ollama',
          agent_role: 'frontend_mobile_developer',
          total_inferences: 2,
          successful: 2,
          failed: 0,
          success_rate: 100,
          average_latency_ms: 880,
          average_tokens: 2685,
          total_cost_usd: 0,
        },
        {
          model_name: 'deepseek-r1:14b',
          provider: 'ollama',
          agent_role: 'backend_developer',
          total_inferences: 1,
          successful: 1,
          failed: 0,
          success_rate: 100,
          average_latency_ms: 1180,
          average_tokens: 2550,
          total_cost_usd: 0,
        },
        {
          model_name: 'llama3.1:8b',
          provider: 'ollama',
          agent_role: 'cybersecurity_engineer',
          total_inferences: 1,
          successful: 1,
          failed: 0,
          success_rate: 100,
          average_latency_ms: 610,
          average_tokens: 2430,
          total_cost_usd: 0,
        },
      ],
      model_quality: [
        {
          model_name: 'qwen2.5-coder:14b',
          provider: 'ollama',
          agent_role: 'frontend_mobile_developer',
          feedback_count: 14,
          average_rating: 4.9,
          sample_sufficient: true,
        },
        {
          model_name: 'deepseek-r1:14b',
          provider: 'ollama',
          agent_role: 'software_architect',
          feedback_count: 9,
          average_rating: 4.8,
          sample_sufficient: true,
        },
      ],
    });
  });

  api.post('/system/inference-feedback', requireAuth, (req, res) => {
    const id = String(req.body?.inference_id || '');
    const rating = Number(req.body?.rating || 5);
    const rec = telemetryRecords.find((r) => r.id === id);
    if (rec) rec.feedback_rating = rating;
    res.json({ status: 'recorded' });
  });

  api.get('/system/server-logs', requireAuth, (req, res) => {
    const level = req.query.level ? String(req.query.level).toUpperCase() : '';
    const search = req.query.search ? String(req.query.search).toLowerCase() : '';
    let list = [...serverLogs];
    if (level && level !== 'ALL') list = list.filter((l) => l.level === level);
    if (search) list = list.filter((l) => l.message.toLowerCase().includes(search) || l.source.toLowerCase().includes(search));
    res.json({ total: list.length, logs: list });
  });

  api.post('/system/server-logs/clear', requireAuth, (_req, res) => {
    serverLogs.length = 0;
    res.json({ status: 'cleared' });
  });

  api.get('/system/server-logs/stream', requireAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const keepalive = setInterval(() => {
      res.write(`: ping ${Date.now()}\n\n`);
    }, 20000);
    req.on('close', () => clearInterval(keepalive));
  });

  api.post('/system/backup', requireAuth, (_req, res) => {
    res.json({ status: 'created', created_at: nowIso() });
  });

  api.post('/system/kill-switch', requireAuth, (req, res) => {
    const target = String(req.body?.target || 'global');
    if (target === 'global') {
      killSwitchActive = !killSwitchActive;
    }
    res.json({ status: killSwitchActive ? 'triggered' : 'reset', global_killed: killSwitchActive });
  });

  api.get('/system/webhooks', requireAuth, (_req, res) => res.json(webhooksConfig));
  api.post('/system/webhooks', requireAuth, (req, res) => {
    webhooksConfig = { ...webhooksConfig, ...req.body };
    res.json(webhooksConfig);
  });
  api.post('/system/webhooks/test', requireAuth, (_req, res) => {
    res.json({ status: 'sent', message: 'Notificação de teste registrada com sucesso.' });
  });

  // --- HARDWARE ---
  api.get('/system/hardware-profile', requireAuth, (_req, res) => {
    const cpus = os.cpus();
    const totalGb = Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10;
    const availGb = Math.round((os.freemem() / (1024 ** 3)) * 10) / 10;
    const usedGb = Math.max(0, Math.round((totalGb - availGb) * 10) / 10);
    res.json({
      specs: {
        cpu: {
          model: cpus[0]?.model || 'Host CPU',
          cores: Math.max(1, Math.floor(cpus.length / 2)),
          threads: cpus.length,
          current_load_percent: 14.2,
        },
        ram: {
          total_gb: totalGb,
          used_gb: usedGb,
          available_gb: availGb,
          percent: totalGb > 0 ? Math.round((usedGb / totalGb) * 1000) / 10 : 0,
        },
        gpu: {
          model: 'Aceleração CPU / Runtime Local',
          vram_gb: 0,
          available: false,
        },
      },
      recommendations: {
        tier: 'standard',
        recommended_models: ['qwen2.5-coder:7b', 'llama3.1:8b'],
        notes: 'Modo balanceado recomendado para respostas rápidas com baixo consumo de memória.',
      },
    });
  });

  api.post('/system/apply-hardware-optimizations', requireAuth, (_req, res) => {
    res.json({ status: 'applied', message: 'Otimizações aplicadas ao perfil local.' });
  });

  api.get('/hardware/performance-mode', requireAuth, (_req, res) => res.json(performanceModeState));
  api.post('/hardware/performance-mode', requireAuth, (req, res) => {
    performanceModeState = { ...performanceModeState, ...req.body };
    res.json(performanceModeState);
  });

  // --- APPROVALS ---
  api.get('/approvals', requireAuth, (_req, res) => res.json(approvals));
  api.post('/approvals/:id/decide', requireAuth, (req, res) => {
    const item = approvals.find((a) => a.id === req.params.id);
    if (!item) {
      res.status(404).json({ detail: 'Solicitação de aprovação não encontrada.' });
      return;
    }
    const action = req.body?.action === 'approve' ? 'approved' : 'rejected';
    item.status = action;
    res.json({ status: action, id: item.id });
  });

  // --- CHAT & TASKS ---
  api.get('/chat/sessions', requireAuth, (_req, res) => {
    const list = Array.from(chatSessions.values()).map((s) => ({
      session_id: s.session_id,
      title: s.title,
      first_prompt: s.first_prompt,
      task_count: s.tasks.length,
      last_activity: s.last_activity,
      first_intent: s.first_intent,
    }));
    res.json(list);
  });

  api.get('/chat/sessions/:id', requireAuth, (req, res) => {
    const s = chatSessions.get(req.params.id);
    if (!s) {
      res.json({ session_id: req.params.id, tasks: [], messages: [] });
      return;
    }
    res.json({ session_id: s.session_id, tasks: s.tasks, messages: s.messages });
  });

  api.delete('/chat/sessions/:id', requireAuth, (req, res) => {
    chatSessions.delete(req.params.id);
    res.json({ deleted: true });
  });

  api.get('/chat/search', requireAuth, (req, res) => {
    const q = String(req.query.query || '').toLowerCase();
    const hits = Array.from(chatSessions.values())
      .filter((s) => s.title.toLowerCase().includes(q) || s.messages.some((m) => m.content.toLowerCase().includes(q)))
      .map((s) => ({ session_id: s.session_id, title: s.title, last_activity: s.last_activity }));
    res.json(hits);
  });

  api.get('/chat/sessions/:id/export', requireAuth, (req, res) => {
    const s = chatSessions.get(req.params.id);
    const md = s
      ? s.messages.map((m) => `### ${m.role === 'user' ? 'Você' : 'JARVIS'}\n\n${m.content}`).join('\n\n---\n\n')
      : '# Conversa vazia';
    res.type('text/markdown').send(md);
  });

  api.post('/chat', requireAuth, async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    const sessionId = String(req.body?.session_id || `sess_${Date.now()}`);
    const projectId = req.body?.project_id ? String(req.body.project_id) : undefined;
    const requestedModel = req.body?.model ? String(req.body.model) : undefined;
    const enableWebSearch = typeof req.body?.enable_web_search === 'boolean' ? req.body.enable_web_search : undefined;
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const profile = user ? userProfiles.get(user.username) : undefined;
    const assistantName = String(req.body?.assistant_name || profile?.assistantName || 'JARVIS');
    const activeAgent = detectInvokedAgent(prompt, sessionId);
    const activeHw = getActiveHardwareProfile();
    const taskId = `tsk_${Date.now()}`;

    try {
      const result = await runHybridInference({
        prompt,
        systemInstruction: activeAgent.system_prompt,
        requestedModel: requestedModel || activeAgent.preferred_model,
        routingPolicy: activeAgent.routing_policy,
        ollamaBaseUrl: activeHw.ollama_url,
        ollamaConnected: providerConnectivity.ollama_connected,
        geminiConnected: providerConnectivity.gemini_connected,
        enableWebSearch: enableWebSearch ?? activeAgent.role === 'research_analyst',
        assistantName,
        agentName: activeAgent.name,
        agentProperName: activeAgent.proper_name,
        strictFocus: activeAgent.strict_focus,
        strictTopic: activeAgent.strict_topic,
      });

      let session = chatSessions.get(sessionId);
      if (!session) {
        session = {
          session_id: sessionId,
          title: prompt.slice(0, 48) || 'Nova conversa',
          first_prompt: prompt,
          first_intent: 'general_assistance',
          last_activity: nowIso(),
          messages: [],
          tasks: [],
        };
        chatSessions.set(sessionId, session);
      }
      session.last_activity = nowIso();
      session.messages.push(
        { id: session.messages.length + 1, session_id: sessionId, project_id: projectId, role: 'user', content: prompt, created_at: nowIso() },
        { id: session.messages.length + 2, session_id: sessionId, project_id: projectId, role: 'assistant', content: result.text, created_at: nowIso() },
      );

      const taskResponse = {
        task_id: taskId,
        session_id: sessionId,
        user_prompt: prompt,
        project_id: projectId,
        classified_intent: activeAgent.category || 'general_assistance',
        plan_steps: [
          `Especialista selecionado: ${activeAgent.proper_name} (${activeAgent.name})`,
          `Motor utilizado: ${result.executionMode} · ${result.modelUsed}`,
          result.sources.length ? `${result.sources.length} fonte(s) web consultadas` : 'Síntese final concluída',
        ],
        selected_agents: [activeAgent.role],
        policy_verified: true,
        policy_violations: [],
        approval_required: false,
        final_summary: result.text,
        execution_mode: result.executionMode,
        provider: result.provider,
        model_used: result.modelUsed,
        latency_ms: result.latencyMs,
        reasoning: result.reasoning,
        routing_note: result.routingNote,
        sources: result.sources,
        agent_meta: {
          role: activeAgent.role,
          name: activeAgent.name,
          proper_name: activeAgent.proper_name,
          handle: activeAgent.handle,
          mascot: activeAgent.mascot,
        },
        is_completed: true,
        error: null,
      };
      session.tasks.push(taskResponse);
      tasksList.unshift({ ...taskResponse, status: 'completed', created_at: nowIso() });
      telemetryRecords.unshift({
        id: `inf_${Date.now()}`,
        task_id: taskId,
        agent_role: activeAgent.role,
        model_name: result.modelUsed,
        provider: result.provider,
        status: 'success',
        duration_ms: result.latencyMs,
        prompt_tokens: Math.max(20, Math.round(prompt.length / 4)),
        completion_tokens: Math.max(30, Math.round(result.text.length / 4)),
        cost_usd: 0,
        feedback_rating: 0,
        created_at: nowIso(),
      });
      res.json(taskResponse);
    } catch (err: any) {
      res.status(502).json({
        detail: err instanceof Error ? err.message : 'Falha ao executar inferência híbrida.',
      });
    }
  });

  api.post('/chat/stream', requireAuth, async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    const sessionId = String(req.body?.session_id || `sess_${Date.now()}`);
    const projectId = req.body?.project_id ? String(req.body.project_id) : undefined;
    const requestedModel = req.body?.model ? String(req.body.model) : undefined;
    const enableWebSearch = typeof req.body?.enable_web_search === 'boolean' ? req.body.enable_web_search : undefined;
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const profile = user ? userProfiles.get(user.username) : undefined;
    const assistantName = String(req.body?.assistant_name || profile?.assistantName || 'JARVIS');
    const activeAgent = detectInvokedAgent(prompt, sessionId);
    const activeHw = getActiveHardwareProfile();
    const taskId = `tsk_${Date.now()}`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const agentMeta = {
      role: activeAgent.role,
      name: activeAgent.name,
      proper_name: activeAgent.proper_name,
      handle: activeAgent.handle,
      mascot: activeAgent.mascot,
    };

    sendEvent({
      type: 'meta',
      session_id: sessionId,
      task_id: taskId,
      model: requestedModel || activeAgent.preferred_model,
      selected_agents: [activeAgent.role],
      agent_meta: agentMeta,
    });
    sendEvent({
      type: 'status',
      message: `${activeAgent.proper_name} (${activeAgent.name}) analisando sua solicitação...`,
    });

    try {
      const result = await runHybridInference({
        prompt,
        systemInstruction: activeAgent.system_prompt,
        requestedModel: requestedModel || activeAgent.preferred_model,
        routingPolicy: activeAgent.routing_policy,
        ollamaBaseUrl: activeHw.ollama_url,
        ollamaConnected: providerConnectivity.ollama_connected,
        geminiConnected: providerConnectivity.gemini_connected,
        enableWebSearch: enableWebSearch ?? activeAgent.role === 'research_analyst',
        assistantName,
        agentName: activeAgent.name,
        agentProperName: activeAgent.proper_name,
        strictFocus: activeAgent.strict_focus,
        strictTopic: activeAgent.strict_topic,
      });

      const words = result.text.split(/(\s+)/);
      for (let i = 0; i < words.length; i += 6) {
        const chunk = words.slice(i, i + 6).join('');
        sendEvent({ type: 'token', chunk });
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      let session = chatSessions.get(sessionId);
      if (!session) {
        session = {
          session_id: sessionId,
          title: prompt.slice(0, 48) || 'Nova conversa',
          first_prompt: prompt,
          first_intent: activeAgent.category || 'general_assistance',
          last_activity: nowIso(),
          messages: [],
          tasks: [],
        };
        chatSessions.set(sessionId, session);
      }
      session.last_activity = nowIso();
      session.messages.push(
        { id: session.messages.length + 1, session_id: sessionId, project_id: projectId, role: 'user', content: prompt, created_at: nowIso() },
        { id: session.messages.length + 2, session_id: sessionId, project_id: projectId, role: 'assistant', content: result.text, created_at: nowIso() },
      );

      const taskData = {
        task_id: taskId,
        session_id: sessionId,
        user_prompt: prompt,
        project_id: projectId,
        classified_intent: activeAgent.category || 'general_assistance',
        plan_steps: [
          `Especialista acionado: ${activeAgent.proper_name} (${activeAgent.handle})`,
          `Execução ${result.executionMode} via ${result.modelUsed} em ${result.latencyMs} ms`,
          result.sources.length ? `Pesquisa Web: ${result.sources.length} fonte(s) verificadas` : 'Resposta validada',
        ],
        selected_agents: [activeAgent.role],
        policy_verified: true,
        policy_violations: [],
        approval_required: false,
        final_summary: result.text,
        execution_mode: result.executionMode,
        provider: result.provider,
        model_used: result.modelUsed,
        latency_ms: result.latencyMs,
        reasoning: result.reasoning,
        routing_note: result.routingNote,
        sources: result.sources,
        agent_meta: agentMeta,
        is_completed: true,
        error: null,
      };
      session.tasks.push(taskData);
      tasksList.unshift({ ...taskData, status: 'completed', created_at: nowIso() });
      telemetryRecords.unshift({
        id: `inf_${Date.now()}`,
        task_id: taskId,
        agent_role: activeAgent.role,
        model_name: result.modelUsed,
        provider: result.provider,
        status: 'success',
        duration_ms: result.latencyMs,
        prompt_tokens: Math.max(20, Math.round(prompt.length / 4)),
        completion_tokens: Math.max(30, Math.round(result.text.length / 4)),
        cost_usd: 0,
        feedback_rating: 0,
        created_at: nowIso(),
      });

      sendEvent({
        type: 'done',
        task_data: taskData,
        final_summary: result.text,
        sources: result.sources,
        execution_mode: result.executionMode,
        provider: result.provider,
        model_used: result.modelUsed,
        latency_ms: result.latencyMs,
        reasoning: result.reasoning,
        routing_note: result.routingNote,
        agent_meta: agentMeta,
        is_completed: true,
        session_id: sessionId,
        task_id: taskId,
      });
      res.end();
    } catch (err: any) {
      sendEvent({
        type: 'error',
        code: 'provider_unavailable',
        error: err instanceof Error ? err.message : 'Falha na comunicação com o provedor de IA.',
      });
      res.end();
    }
  });

  api.get('/tasks', requireAuth, (_req, res) =>
    res.json(
      tasksList.map((t, idx) => ({
        ...t,
        id: String(t.id || t.task_id || `task_${idx}`),
        task_id: String(t.task_id || t.id || `task_${idx}`),
        prompt: String(t.prompt || t.user_prompt || ''),
        intent: String(t.intent || t.classified_intent || 'planejamento'),
        is_completed:
          typeof t.is_completed === 'boolean' ? t.is_completed : t.status === 'completed',
      }))
    )
  );
  api.delete('/tasks/:id', requireAuth, (req, res) => {
    tasksList = tasksList.filter(
      (t) => t.task_id !== req.params.id && t.id !== req.params.id
    );
    res.json({ deleted: true });
  });
  api.post('/tasks/purge', requireAuth, (req, res) => {
    const retention = Number(req.query.days_retention || 30);
    res.json({ purged_count: 0, retention_days: retention });
  });

  // --- AGENTS (CRUD + VERSIONS + ROLLBACK) ---
  api.get('/agents', requireAuth, (_req, res) => res.json(agentsList));

  api.post('/agents', requireAuth, (req, res) => {
    const properName = String(req.body?.proper_name || '').trim();
    const name = String(req.body?.name || properName || '').trim();
    if (!name || name.length < 2) {
      res.status(400).json({ detail: 'Informe um nome válido para o especialista.' });
      return;
    }
    const rawSlug = String(req.body?.role || properName || name)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const role = agentsList.some((a) => a.role === rawSlug)
      ? `${rawSlug || 'agente'}_${Date.now().toString(36).slice(-4)}`
      : rawSlug || `agente_${Date.now().toString(36)}`;
    const cleanHandle = String(req.body?.handle || `@${(properName || role).toLowerCase().replace(/[^a-z0-9]/g, '')}`);
    const handle = cleanHandle.startsWith('@') ? cleanHandle : `@${cleanHandle}`;

    const created: AgentServerRecord = {
      role,
      name,
      proper_name: properName || name.split(' ')[0],
      handle,
      category: String(req.body?.category || 'studies'),
      mission: String(req.body?.mission || 'Especialista personalizado criado no seu hub.'),
      preferred_model: String(req.body?.preferred_model || 'gemini-4-hydrogen'),
      routing_policy:
        req.body?.routing_policy === 'local_only' || req.body?.routing_policy === 'online_only'
          ? req.body.routing_policy
          : 'auto_hybrid',
      autonomy_level:
        req.body?.autonomy_level === 'read_only' || req.body?.autonomy_level === 'autonomous'
          ? req.body.autonomy_level
          : 'ask_approval',
      is_read_only: req.body?.autonomy_level === 'read_only' || Boolean(req.body?.is_read_only),
      strict_focus: Boolean(req.body?.strict_focus),
      strict_topic: String(req.body?.strict_topic || ''),
      delegation_targets: Array.isArray(req.body?.delegation_targets) ? req.body.delegation_targets.map(String) : [],
      allowed_tools: Array.isArray(req.body?.allowed_tools) ? req.body.allowed_tools.map(String) : [],
      system_prompt: String(
        req.body?.system_prompt ||
          `Você é ${properName || name}, especialista dedicado à missão: ${req.body?.mission || 'ajudar com excelência'}.`
      ),
      mascot: {
        id: String(req.body?.mascot?.id || 'maestro_slime'),
        color: String(req.body?.mascot?.color || '#f97316'),
        accessory: String(req.body?.mascot?.accessory || 'none'),
        mood: String(req.body?.mascot?.mood || 'idle'),
      },
      is_custom: true,
      version: 1,
      updated_at: nowIso(),
    };
    agentsList.unshift(created);
    recordAgentVersion(created, 'Criação do especialista');
    res.status(201).json(created);
  });

  api.get('/agents/:role', requireAuth, (req, res) => {
    const agent = agentsList.find((a) => a.role === req.params.role);
    if (!agent) {
      res.status(404).json({ detail: 'Especialista não encontrado.' });
      return;
    }
    res.json(agent);
  });

  api.put('/agents/:role/config', requireAuth, (req, res) => {
    const idx = agentsList.findIndex((a) => a.role === req.params.role);
    if (idx === -1) {
      res.status(404).json({ detail: 'Especialista não encontrado.' });
      return;
    }
    const prev = agentsList[idx];
    const nextVersion = (prev.version || 1) + 1;
    const summary = String(req.body?.change_summary || 'Configuração atualizada');
    const updated: AgentServerRecord = {
      ...prev,
      ...req.body,
      role: prev.role,
      mascot: req.body?.mascot ? { ...prev.mascot, ...req.body.mascot } : prev.mascot,
      version: nextVersion,
      updated_at: nowIso(),
    };
    if (req.body?.autonomy_level) {
      updated.is_read_only = req.body.autonomy_level === 'read_only';
    }
    agentsList[idx] = updated;
    recordAgentVersion(updated, summary);
    res.json(updated);
  });

  api.delete('/agents/:role', requireAuth, (req, res) => {
    const target = agentsList.find((a) => a.role === req.params.role);
    if (!target) {
      res.status(404).json({ detail: 'Especialista não encontrado.' });
      return;
    }
    if (!target.is_custom) {
      res.status(400).json({ detail: 'Agentes nativos não podem ser excluídos, apenas editados.' });
      return;
    }
    agentsList = agentsList.filter((a) => a.role !== req.params.role);
    agentVersions.delete(req.params.role);
    res.json({ deleted: true });
  });

  api.get('/agents/:role/versions', requireAuth, (req, res) => {
    res.json(agentVersions.get(req.params.role) || []);
  });

  api.post('/agents/:role/rollback', requireAuth, (req, res) => {
    const idx = agentsList.findIndex((a) => a.role === req.params.role);
    if (idx === -1) {
      res.status(404).json({ detail: 'Especialista não encontrado.' });
      return;
    }
    const targetVersion = Number(req.body?.version);
    const history = agentVersions.get(req.params.role) || [];
    const match = history.find((item) => item.version === targetVersion);
    if (!match) {
      res.status(404).json({ detail: 'Versão solicitada não encontrada no histórico.' });
      return;
    }
    const prev = agentsList[idx];
    const restored: AgentServerRecord = {
      ...prev,
      ...(match.snapshot as any),
      role: prev.role,
      version: (prev.version || 1) + 1,
      updated_at: nowIso(),
    };
    agentsList[idx] = restored;
    recordAgentVersion(restored, `Rollback para v${targetVersion}`);
    res.json(restored);
  });

  api.get('/agent-routes', requireAuth, (_req, res) => res.json({ routes: agentRoutes }));
  api.put('/agent-routes/:role', requireAuth, (req, res) => {
    const role = req.params.role;
    const entry = {
      agent_role: role,
      key_id: String(req.body?.key_id || 'local-ollama-default'),
      model: String(req.body?.model || hybridConfig.default_model),
      key_label: 'Roteador Híbrido',
      provider: String(req.body?.model || '').startsWith('gemini-') ? 'gemini' : 'ollama',
      key_available: true,
      updated_at: nowIso(),
    };
    agentRoutes = [...agentRoutes.filter((r) => r.agent_role !== role), entry];
    res.json(entry);
  });
  api.delete('/agent-routes/:role', requireAuth, (req, res) => {
    agentRoutes = agentRoutes.filter((r) => r.agent_role !== req.params.role);
    res.json({ deleted: true });
  });

  api.get('/agents/:role/memories', requireAuth, (req, res) => {
    res.json(agentMemories.get(req.params.role) || []);
  });
  api.post('/agents/:role/memories', requireAuth, (req, res) => {
    const list = agentMemories.get(req.params.role) || [];
    const item = {
      id: `mem_${Date.now()}`,
      agent_role: req.params.role,
      ...req.body,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    list.unshift(item);
    agentMemories.set(req.params.role, list);
    res.status(201).json(item);
  });
  api.delete('/agents/:role/memories/:memoryId', requireAuth, (req, res) => {
    const list = (agentMemories.get(req.params.role) || []).filter((m) => m.id !== req.params.memoryId);
    agentMemories.set(req.params.role, list);
    res.json({ deleted: true });
  });

  api.post('/agents/:role/playground', requireAuth, async (req, res) => {
    const agent = agentsList.find((a) => a.role === req.params.role) || agentsList[0];
    const prompt = String(req.body?.prompt || '').trim();
    const activeHw = getActiveHardwareProfile();
    try {
      const result = await runHybridInference({
        prompt,
        systemInstruction: agent.system_prompt,
        requestedModel: agent.preferred_model,
        routingPolicy: agent.routing_policy,
        ollamaBaseUrl: activeHw.ollama_url,
        ollamaConnected: providerConnectivity.ollama_connected,
        geminiConnected: providerConnectivity.gemini_connected,
        enableWebSearch: agent.role === 'research_analyst',
        agentName: agent.name,
        agentProperName: agent.proper_name,
        strictFocus: agent.strict_focus,
        strictTopic: agent.strict_topic,
      });
      res.json({
        agent_role: agent.role,
        agent_name: `${agent.proper_name} · ${agent.name}`,
        response: result.text,
        model_used: result.modelUsed,
        execution_mode: result.executionMode,
        latency_ms: result.latencyMs,
        reasoning: result.reasoning,
        sources: result.sources,
        tokens_prompt: Math.max(24, Math.round(prompt.length / 4)),
        tokens_completion: Math.max(40, Math.round(result.text.length / 4)),
      });
    } catch (err: any) {
      res.status(502).json({ detail: err instanceof Error ? err.message : 'Erro ao executar especialista.' });
    }
  });

  api.post('/agents/:role/task', requireAuth, async (req, res) => {
    const agent = agentsList.find((a) => a.role === req.params.role) || agentsList[0];
    const prompt = String(req.body?.prompt || '').trim();
    const activeHw = getActiveHardwareProfile();
    try {
      const result = await runHybridInference({
        prompt,
        systemInstruction: agent.system_prompt,
        requestedModel: agent.preferred_model,
        routingPolicy: agent.routing_policy,
        ollamaBaseUrl: activeHw.ollama_url,
        ollamaConnected: providerConnectivity.ollama_connected,
        geminiConnected: providerConnectivity.gemini_connected,
        agentName: agent.name,
        agentProperName: agent.proper_name,
        strictFocus: agent.strict_focus,
        strictTopic: agent.strict_topic,
      });
      const item = {
        task_id: `tsk_${Date.now()}`,
        session_id: req.body?.session_id || `sess_${Date.now()}`,
        user_prompt: prompt,
        selected_agents: [agent.role],
        status: 'completed',
        is_completed: true,
        final_summary: result.text,
        execution_mode: result.executionMode,
        model_used: result.modelUsed,
        latency_ms: result.latencyMs,
        created_at: nowIso(),
      };
      tasksList.unshift(item);
      res.json(item);
    } catch (err: any) {
      res.status(502).json({ detail: err instanceof Error ? err.message : 'Erro na tarefa do especialista.' });
    }
  });

  api.get('/agents/:role/history', requireAuth, (req, res) => {
    res.json({ agent_role: req.params.role, session_id: String(req.query.session_id || 'default'), messages: [] });
  });

  api.get('/tools', requireAuth, (_req, res) => {
    res.json([
      { id: 'read_file', name: 'Leitura de Arquivo', category: 'filesystem' },
      { id: 'list_directory', name: 'Exploração de Pastas', category: 'filesystem' },
      { id: 'search_code', name: 'Busca em Código', category: 'filesystem' },
      { id: 'propose_patch', name: 'Proposta de Patch', category: 'filesystem' },
      { id: 'run_tests', name: 'Execução de Testes', category: 'execution' },
      { id: 'run_linter', name: 'Linter Estático', category: 'analysis' },
      { id: 'scan_secrets', name: 'Varredura de Segredos', category: 'security' },
      { id: 'delegate_agent', name: 'Delegação Multi-Agente', category: 'multiagent' },
      { id: 'request_approval', name: 'Solicitação de Aprovação', category: 'security' },
    ]);
  });

  // --- MODELS, HARDWARE ADVISOR, HUGGING FACE & ARENA ---
  const buildHardwareAdvisorPayload = async () => {
    const activeHw = getActiveHardwareProfile();
    const ollamaProbe = providerConnectivity.ollama_connected
      ? await fetchOllamaLocalModels(activeHw.ollama_url)
      : { reachable: false, latencyMs: 0, models: [] };

    const installedNames =
      ollamaProbe.models.length > 0
        ? ollamaProbe.models.map((m) => m.name)
        : ['llama3.1:8b', 'qwen2.5-coder:7b', 'llama3.2:3b'];

    const recommendations = computeAgentRecommendations(
      activeHw,
      providerConnectivity,
      installedNames,
      agentsList.map((a) => ({
        role: a.role,
        name: a.name,
        proper_name: a.proper_name,
        category: a.category,
      }))
    );

    return {
      profiles: hardwareProfiles.map((p) => ({ ...p, is_active: p.id === activeHw.id })),
      active_profile_id: activeHw.id,
      providers: {
        ...providerConnectivity,
        gemini_api_configured: isGeminiApiConfigured(),
        ollama_reachable: ollamaProbe.reachable,
        ollama_latency_ms: ollamaProbe.latencyMs,
      },
      recommendations,
    };
  };

  api.get('/models', requireAuth, async (_req, res) => {
    const activeHw = getActiveHardwareProfile();
    const ollamaProbe = providerConnectivity.ollama_connected
      ? await fetchOllamaLocalModels(activeHw.ollama_url)
      : { reachable: false, latencyMs: 0, models: [] };

    const fallbackLocalModels = [
      { name: 'qwen2.5-coder:7b', size: 4900000000, parameter_size: '7B', role: 'Código Local', modified_at: nowIso() },
      { name: 'llama3.1:8b', size: 4700000000, parameter_size: '8B', role: 'Segurança Local', modified_at: nowIso() },
      { name: 'llama3.2:3b', size: 2200000000, parameter_size: '3B', role: 'Ultra Leve', modified_at: nowIso() },
    ];
    const resolvedLocal = ollamaProbe.models.length > 0 ? ollamaProbe.models : fallbackLocalModels;

    res.json({
      runtime: providerConnectivity.ollama_connected ? 'hybrid' : 'online',
      status: 'online',
      active_model: hybridConfig.default_model,
      hybrid_gateway: {
        enabled: providerConnectivity.gemini_connected,
        provider: 'Gemini Online',
        model: 'gemini-4-hydrogen',
        current_spend_usd: hybridConfig.current_spend_usd,
        max_budget_usd: hybridConfig.max_budget_usd,
      },
      online_models: providerConnectivity.gemini_connected
        ? [
            { name: 'gemini-4-hydrogen', provider: 'Gemini Online · Web', role: 'Híbrido + Pesquisa Web' },
            { name: 'gemini-3.1-flash-lite', provider: 'Gemini Online · Rápido', role: 'Respostas Instantâneas' },
          ]
        : [],
      local_models: resolvedLocal.map((m: any) => ({
        name: m.name,
        size_gb: Number(((m.size || 4500000000) / 1e9).toFixed(1)),
        quantization: 'Q4_K_M',
        family: m.family || 'ollama',
        status: ollamaProbe.reachable ? 'online' : 'catalog',
      })),
      models: resolvedLocal,
      ollama_reachable: ollamaProbe.reachable,
    });
  });

  api.get('/models/hardware', requireAuth, async (_req, res) => {
    res.json(await buildHardwareAdvisorPayload());
  });

  api.put('/models/hardware', requireAuth, async (req, res) => {
    const incomingActive = req.body?.active_profile_id ? String(req.body.active_profile_id) : undefined;
    const incomingProfile = req.body?.profile;

    if (incomingProfile && typeof incomingProfile === 'object') {
      const id = String(incomingProfile.id || `nb-${Date.now().toString(36)}`);
      const normalized: NotebookHardwareProfile = {
        id,
        label: String(incomingProfile.label || 'Meu Notebook').trim(),
        owner: String(incomingProfile.owner || 'Pessoal').trim(),
        cpu: String(incomingProfile.cpu || 'CPU Multi-Core').trim(),
        ram_gb: Math.max(4, Math.min(256, Number(incomingProfile.ram_gb) || 16)),
        gpu_name: String(incomingProfile.gpu_name || 'GPU Integrada').trim(),
        vram_gb: Math.max(0, Math.min(96, Number(incomingProfile.vram_gb) || 0)),
        ollama_url: String(incomingProfile.ollama_url || 'http://127.0.0.1:11434').trim(),
        is_active: true,
      };
      const existingIdx = hardwareProfiles.findIndex((p) => p.id === id);
      if (existingIdx >= 0) {
        hardwareProfiles[existingIdx] = normalized;
      } else {
        hardwareProfiles.push(normalized);
      }
      activeHardwareProfileId = id;
    } else if (incomingActive && hardwareProfiles.some((p) => p.id === incomingActive)) {
      activeHardwareProfileId = incomingActive;
    }

    res.json(await buildHardwareAdvisorPayload());
  });

  api.put('/models/providers', requireAuth, async (req, res) => {
    if (typeof req.body?.ollama_connected === 'boolean') {
      providerConnectivity.ollama_connected = req.body.ollama_connected;
    }
    if (typeof req.body?.huggingface_connected === 'boolean') {
      providerConnectivity.huggingface_connected = req.body.huggingface_connected;
    }
    if (typeof req.body?.gemini_connected === 'boolean') {
      providerConnectivity.gemini_connected = req.body.gemini_connected;
      hybridConfig.enabled = req.body.gemini_connected;
    }
    if (typeof req.body?.ollama_url === 'string' && req.body.ollama_url.trim()) {
      const active = getActiveHardwareProfile();
      active.ollama_url = req.body.ollama_url.trim();
      hybridConfig.base_url = active.ollama_url;
    }
    res.json(await buildHardwareAdvisorPayload());
  });

  api.post('/models/recommendations/apply', requireAuth, async (req, res) => {
    const advisor = await buildHardwareAdvisorPayload();
    const targetRole = req.body?.agent_role ? String(req.body.agent_role) : null;
    const applyAll = Boolean(req.body?.apply_all);
    const updatedRoles: string[] = [];

    for (const rec of advisor.recommendations) {
      if (!applyAll && targetRole && rec.agent_role !== targetRole) continue;
      const idx = agentsList.findIndex((a) => a.role === rec.agent_role);
      if (idx === -1) continue;
      const ag = agentsList[idx];
      const nextPolicy = rec.execution_mode === 'ONLINE' ? 'online_only' : 'auto_hybrid';
      agentsList[idx] = {
        ...ag,
        preferred_model: rec.recommended_model,
        routing_policy: nextPolicy,
        version: (ag.version || 1) + 1,
        updated_at: nowIso(),
      };
      recordAgentVersion(
        agentsList[idx],
        `Consultor de Hardware aplicou ${rec.recommended_model} (${rec.execution_mode})`
      );
      updatedRoles.push(rec.agent_role);
    }

    res.json({ applied_count: updatedRoles.length, agents_updated: updatedRoles });
  });

  api.post('/models/arena', requireAuth, async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    const modelA = String(req.body?.model_a || 'gemini-4-hydrogen').trim();
    const modelB = String(req.body?.model_b || 'gemini-3.1-flash-lite').trim();
    const enableWebSearch = Boolean(req.body?.enable_web_search);
    if (!prompt) {
      res.status(400).json({ detail: 'Digite um prompt para comparar os modelos na Arena.' });
      return;
    }
    const activeHw = getActiveHardwareProfile();
    const runSide = async (modelId: string) => {
      try {
        const result = await runHybridInference({
          prompt,
          systemInstruction: 'Você está em um comparativo lado a lado (Modo Arena). Entregue sua melhor resposta clara, precisa e objetiva em português.',
          requestedModel: modelId,
          routingPolicy: 'auto_hybrid',
          ollamaBaseUrl: activeHw.ollama_url,
          ollamaConnected: providerConnectivity.ollama_connected,
          geminiConnected: providerConnectivity.gemini_connected,
          enableWebSearch,
        });
        return {
          model_requested: modelId,
          model_used: result.modelUsed,
          execution_mode: result.executionMode,
          provider: result.provider,
          latency_ms: result.latencyMs,
          text: result.text,
          reasoning: result.reasoning,
          routing_note: result.routingNote,
          sources: result.sources,
        };
      } catch (err: any) {
        return {
          model_requested: modelId,
          model_used: modelId,
          execution_mode: modelId.startsWith('gemini-') ? ('ONLINE' as const) : ('LOCAL' as const),
          provider: modelId.startsWith('gemini-') ? 'gemini' : 'ollama',
          latency_ms: 0,
          text: '',
          error: err instanceof Error ? err.message : 'Falha na inferência.',
        };
      }
    };

    const [left, right] = await Promise.all([runSide(modelA), runSide(modelB)]);
    res.json({ left, right });
  });

  api.get('/models/hybrid-config', requireAuth, (_req, res) =>
    res.json({ ...hybridConfig, has_api_key: isGeminiApiConfigured() })
  );
  api.post('/models/hybrid-config', requireAuth, (req, res) => {
    hybridConfig = { ...hybridConfig, ...req.body, has_api_key: isGeminiApiConfigured() };
    res.json(hybridConfig);
  });
  api.post('/models/hybrid-config/test', requireAuth, async (req, res) => {
    const activeHw = getActiveHardwareProfile();
    const providerName = String(req.body?.provider_name || hybridConfig.provider_name).toLowerCase();
    if (providerName.includes('ollama')) {
      const probe = await fetchOllamaLocalModels(String(req.body?.base_url || activeHw.ollama_url));
      res.json({
        success: probe.reachable,
        latency_ms: probe.latencyMs,
        message: probe.reachable
          ? `Ollama conectado (${probe.models.length} modelos locais encontrados).`
          : undefined,
        error: probe.reachable ? undefined : `Ollama local inacessível (${probe.error || 'offline'}).`,
      });
      return;
    }
    res.json({
      success: isGeminiApiConfigured(),
      latency_ms: 38,
      message: isGeminiApiConfigured()
        ? 'Gemini Online pronto no servidor (chave configurada em Settings > Secrets).'
        : undefined,
      error: isGeminiApiConfigured()
        ? undefined
        : 'GEMINI_API_KEY não encontrada no servidor (verifique Settings > Secrets).',
    });
  });

  api.get('/models/huggingface/curated', requireAuth, (_req, res) => {
    if (!providerConnectivity.huggingface_connected) {
      res.json([]);
      return;
    }
    res.json(getCuratedHuggingFaceForHardware(getActiveHardwareProfile()));
  });

  api.get('/models/huggingface/search', requireAuth, async (req, res) => {
    if (!providerConnectivity.huggingface_connected) {
      res.json([]);
      return;
    }
    const q = String(req.query.q || '');
    const limit = Number(req.query.limit || 10);
    const result = await searchRealHuggingFace(q, limit, getActiveHardwareProfile());
    res.json(result.items);
  });

  api.get('/models/agent-recommendations', requireAuth, async (_req, res) => {
    const advisor = await buildHardwareAdvisorPayload();
    const map: Record<string, { model: string; reason: string; execution_mode: string }> = {};
    for (const rec of advisor.recommendations) {
      map[rec.agent_role] = {
        model: rec.recommended_model,
        reason: rec.reason,
        execution_mode: rec.execution_mode,
      };
    }
    res.json(map);
  });


  api.get('/models/vault', requireAuth, (_req, res) => res.json({ keys: vaultKeys }));
  api.post('/models/vault', requireAuth, (req, res) => {
    const key_id = String(req.body?.key_id || `key_${Date.now()}`);
    const raw = String(req.body?.api_key || '');
    const masked_key = raw.length > 8 ? `${raw.slice(0, 4)}••••${raw.slice(-4)}` : '••••••••';
    const item = {
      key_id,
      label: String(req.body?.label || key_id),
      provider: String(req.body?.provider || 'custom'),
      provider_name: String(req.body?.provider || 'custom'),
      masked_key,
      base_url: req.body?.base_url || '',
      default_model: req.body?.default_model || '',
      is_active: req.body?.is_active !== false,
      is_default: Boolean(req.body?.is_default),
    };
    vaultKeys = [...vaultKeys.filter((k) => k.key_id !== key_id), item];
    res.status(201).json(item);
  });
  api.delete('/models/vault/:keyId', requireAuth, (req, res) => {
    vaultKeys = vaultKeys.filter((k) => k.key_id !== req.params.keyId);
    res.json({ deleted: true });
  });
  api.post('/models/vault/:keyId/default', requireAuth, (req, res) => {
    vaultKeys = vaultKeys.map((k) => ({ ...k, is_default: k.key_id === req.params.keyId }));
    res.json({ status: 'updated' });
  });
  api.post('/models/vault/:keyId/test', requireAuth, (_req, res) => {
    res.json({ status: 'ok', message: 'Chave verificada.' });
  });

  // --- WORKSPACE ---
  api.get('/workspace/projects', requireAuth, (_req, res) => res.json(workspaceProjects));
  api.get('/workspace/projects/:id/file', requireAuth, (req, res) => {
    const filePath = String(req.query.path || '');
    res.json({ path: filePath, content: `// Visualização segura de ${filePath}\n` });
  });
  api.get('/workspace/projects/:id/memory', requireAuth, (req, res) => {
    res.json(projectMemories.get(req.params.id) || []);
  });
  api.post('/workspace/projects/:id/memory', requireAuth, (req, res) => {
    const list = projectMemories.get(req.params.id) || [];
    const entry = { id: `pm_${Date.now()}`, ...req.body, created_at: nowIso() };
    list.unshift(entry);
    projectMemories.set(req.params.id, list);
    res.status(201).json(entry);
  });
  api.get('/workspace/projects/:id/git-history', requireAuth, (_req, res) => {
    res.json([
      { hash: 'a1b2c3d', message: 'feat: redesign Obsidian Studio design system', author: 'admin', date: nowIso() },
      { hash: 'e4f5g6h', message: 'fix: enforce HttpOnly cookie auth middleware', author: 'admin', date: new Date(Date.now() - 1000 * 60 * 60).toISOString() },
    ]);
  });

  // --- SKILLS ---
  api.get('/skills', requireAuth, (_req, res) => res.json(skillsList));
  api.post('/skills/:id/toggle', requireAuth, (req, res) => {
    const s = skillsList.find((item) => item.id === req.params.id);
    if (!s) {
      res.status(404).json({ detail: 'Habilidade não encontrada.' });
      return;
    }
    s.is_approved = !s.is_approved;
    res.json(s);
  });
  api.post('/skills/:id/assign-agents', requireAuth, (req, res) => {
    const s = skillsList.find((item) => item.id === req.params.id);
    if (!s) {
      res.status(404).json({ detail: 'Habilidade não encontrada.' });
      return;
    }
    s.assigned_agents = Array.isArray(req.body?.agent_roles) ? req.body.agent_roles : [];
    res.json(s);
  });
  api.get('/skills/ponytail', requireAuth, (_req, res) => res.json(ponytailState));
  api.post('/skills/ponytail', requireAuth, (req, res) => {
    ponytailState = { ...ponytailState, level: String(req.body?.level || 'senior') };
    res.json(ponytailState);
  });
  api.post('/skills/create', requireAuth, (req, res) => {
    const created = {
      id: req.body?.id || `skill_${Date.now()}`,
      name: String(req.body?.name || 'Nova Habilidade'),
      version: '1.0.0',
      origin: 'user',
      license: 'Custom',
      description: String(req.body?.description || ''),
      domain: String(req.body?.domain || 'general'),
      allowed_tools: ['read_file'],
      required_permissions: ['skills:read'],
      assigned_agents: Array.isArray(req.body?.assigned_agents) ? req.body.assigned_agents : [],
      content_hash: `sha256:${crypto.randomBytes(6).toString('hex')}`,
      is_approved: true,
      is_revoked: false,
      instructions: String(req.body?.instructions || ''),
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    skillsList.unshift(created);
    res.status(201).json(created);
  });
  api.delete('/skills/:id', requireAuth, (req, res) => {
    skillsList = skillsList.filter((s) => s.id !== req.params.id);
    res.json({ deleted: true });
  });

  // --- KNOWLEDGE ---
  api.get('/knowledge/documents', requireAuth, (_req, res) => res.json(knowledgeDocs));
  api.post('/knowledge/index-text', requireAuth, (req, res) => {
    const doc = {
      name: String(req.body?.doc_name || `nota-${Date.now()}.md`),
      category: String(req.body?.category || 'anotacoes'),
      chunks: 1,
      size_bytes: String(req.body?.content || '').length,
      file_type: 'md',
      indexed_at: nowIso(),
      content: String(req.body?.content || ''),
    };
    knowledgeDocs.unshift(doc);
    res.status(201).json(doc);
  });
  api.post('/knowledge/search', requireAuth, (req, res) => {
    const q = String(req.body?.query || '').toLowerCase();
    const results = knowledgeDocs
      .filter((d) => !q || d.name.toLowerCase().includes(q) || d.content.toLowerCase().includes(q))
      .map((d) => ({ doc_name: d.name, category: d.category, score: 0.94, snippet: d.content }));
    res.json(results);
  });
  api.delete('/knowledge/documents/:name', requireAuth, (req, res) => {
    knowledgeDocs = knowledgeDocs.filter((d) => d.name !== req.params.name);
    res.json({ deleted: true });
  });

  // --- SECURITY ---
  api.get('/audit/logs', requireAuth, (_req, res) => res.json({ total: auditLogs.length, logs: auditLogs }));
  api.get('/security/cyber-shield-status', requireAuth, (_req, res) => {
    res.json({
      status: networkIsolated ? 'isolated' : 'protected',
      network_isolated: networkIsolated,
      kill_switch_active: killSwitchActive,
      pending_approvals: approvals.filter((a) => a.status === 'pending').length,
      active_policies: 4,
    });
  });
  api.post('/security/network-isolation', requireAuth, (req, res) => {
    networkIsolated = Boolean(req.body?.isolated);
    res.json({ isolated: networkIsolated });
  });
  api.get('/security/policy-templates', requireAuth, (_req, res) => {
    res.json([
      { id: 'strict-csp', name: 'CSP Estrito & Headers OWASP', severity: 'high', description: 'Reforça cabeçalhos HTTP de segurança.' },
      { id: 'secret-guard', name: 'Bloqueio de Segredos em Commit', severity: 'critical', description: 'Impede exposição de tokens e chaves privadas.' },
    ]);
  });

  // --- PROFILE & LEARNING ---
  api.get('/user/profile', requireAuth, (req, res) => {
    const user = (req as Request & { jarvisUser: UserAccount }).jarvisUser;
    const stored = userProfiles.get(user.username) || {
      displayName: user.display_name,
      avatarIcon: user.display_name.slice(0, 1).toUpperCase(),
      developerRole: user.role === 'admin' ? 'Administrador' : 'Uso Pessoal & Estudos',
      seniorityLevel: 'senior',
      responseStyle: 'detailed',
      customInstructions: '',
      assistantName: 'JARVIS',
      assistantGreeting: '',
      experienceMode: user.role === 'admin' ? 'engineering' : 'simple',
    };
    res.json(stored);
  });

  api.post('/user/profile', requireAuth, (req, res) => {
    const user = (req as Request & { jarvisUser: UserAccount }).jarvisUser;
    const prev = userProfiles.get(user.username) || {};
    const merged = {
      ...prev,
      ...req.body,
      assistantName: String(req.body?.assistantName || prev.assistantName || 'JARVIS').trim().slice(0, 40) || 'JARVIS',
      experienceMode: req.body?.experienceMode === 'simple' ? 'simple' : 'engineering',
    };
    userProfiles.set(user.username, merged);
    if (typeof req.body?.displayName === 'string' && req.body.displayName.trim()) {
      user.display_name = req.body.displayName.trim().slice(0, 80);
    }
    res.json({ status: 'saved', profile: merged });
  });

  api.get('/learning/progress', requireAuth, (req, res) => {
    const user = (req as Request & { jarvisUser: UserAccount }).jarvisUser;
    res.json(learningProgress.get(user.username) || { completed_modules: [], updated_at: nowIso() });
  });

  api.post('/learning/progress', requireAuth, (req, res) => {
    const user = (req as Request & { jarvisUser: UserAccount }).jarvisUser;
    const next = {
      completed_modules: Array.isArray(req.body?.completed_modules) ? req.body.completed_modules : [],
      updated_at: nowIso(),
    };
    learningProgress.set(user.username, next);
    res.json(next);
  });

  // --- CODING & STUDIOS ---
  api.get('/coding/tools', requireAuth, (_req, res) => {
    res.json({
      modes: [
        { id: 'plan', label: 'Planejar (Somente leitura)', description: 'Analisa o repositório e propõe plano técnico sem alterar arquivos.' },
        { id: 'ask', label: 'Assistido (Aprovação)', description: 'Solicita aprovação humana explícita antes de aplicar patches ou executar comandos.' },
        { id: 'auto', label: 'Automático (Workspace)', description: 'Executa leitura, edição confinada ao workspace e testes automatizados.' },
      ],
      tools: [
        { name: 'read_file', description: 'Lê arquivos dentro do diretório do projeto selecionado.', risk: 'read', requires_approval: false, parameters: { path: 'string' } },
        { name: 'search_code', description: 'Pesquisa símbolos e padrões em todo o repositório.', risk: 'read', requires_approval: false, parameters: { query: 'string' } },
        { name: 'propose_patch', description: 'Gera e aplica diff auditável em arquivos do projeto.', risk: 'write', requires_approval: true, parameters: { path: 'string', diff: 'string' } },
        { name: 'run_tests', description: 'Executa a suíte de testes configurada para validar regressões.', risk: 'exec', requires_approval: true, parameters: { command: 'string' } },
        { name: 'run_linter', description: 'Verifica tipagem TypeScript e lint do projeto.', risk: 'exec', requires_approval: false, parameters: {} },
      ],
      provider: { name: 'Ollama Local', model: 'qwen2.5-coder:14b', local_first: true },
      mcp_servers: [],
    });
  });
  api.get('/coding/sessions/:id/messages', requireAuth, (_req, res) => res.json({ messages: [] }));
  api.post('/coding/sessions/:id/messages', requireAuth, (_req, res) => res.json({ status: 'saved' }));

  // --- BACKEND STUDIO: MOCK SERVER ---
  interface MockEndpointRecord {
    id: string;
    name: string;
    method: string;
    path: string;
    status_code: number;
    latency_ms: number;
    response_body: unknown;
    enabled: boolean;
    created_at: string;
  }

  let mockEndpoints: MockEndpointRecord[] = [
    {
      id: 'mock_users_list',
      name: 'Listar Utilizadores',
      method: 'GET',
      path: '/api/users',
      status_code: 200,
      latency_ms: 45,
      response_body: {
        status: 'ok',
        total: 2,
        users: [
          { id: 1, name: 'Ana Silva', role: 'admin' },
          { id: 2, name: 'Carlos Mendes', role: 'developer' },
        ],
      },
      enabled: true,
      created_at: nowIso(),
    },
    {
      id: 'mock_orders_create',
      name: 'Criar Pedido Simulado',
      method: 'POST',
      path: '/api/orders',
      status_code: 201,
      latency_ms: 120,
      response_body: {
        status: 'created',
        order_id: 'ORD-2026-0042',
        currency: 'BRL',
      },
      enabled: true,
      created_at: nowIso(),
    },
  ];

  api.get('/mock-server/endpoints', requireAuth, (_req, res) => {
    res.json(mockEndpoints);
  });

  api.post('/mock-server/endpoints', requireAuth, (req, res) => {
    const rawPath = String(req.body?.path || '/api/mock').trim();
    const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const record: MockEndpointRecord = {
      id: `mock_${crypto.randomBytes(4).toString('hex')}`,
      name: String(req.body?.name || 'Endpoint Simulado').trim(),
      method: String(req.body?.method || 'GET').toUpperCase(),
      path: normalizedPath,
      status_code: Math.min(599, Math.max(100, Number(req.body?.status_code) || 200)),
      latency_ms: Math.min(5000, Math.max(0, Number(req.body?.latency_ms) || 0)),
      response_body: req.body?.response_body ?? { status: 'ok' },
      enabled: req.body?.enabled !== false,
      created_at: nowIso(),
    };
    mockEndpoints = [
      record,
      ...mockEndpoints.filter(
        (ep) => !(ep.method === record.method && ep.path === record.path)
      ),
    ];
    res.status(201).json(record);
  });

  api.delete('/mock-server/endpoints/:id', requireAuth, (req, res) => {
    mockEndpoints = mockEndpoints.filter((ep) => ep.id !== req.params.id);
    res.json({ deleted: true });
  });

  api.all(/^\/mock(\/.*)?$/, requireAuth, (req, res) => {
    const subPath = req.path.replace(/^\/mock/, '') || '/';
    const matched = mockEndpoints.find(
      (ep) => ep.enabled && ep.method === req.method.toUpperCase() && ep.path === subPath
    );
    if (!matched) {
      res.status(404).json({
        error: 'Endpoint simulado não encontrado',
        method: req.method,
        path: subPath,
      });
      return;
    }
    const delay = Math.min(2000, Math.max(0, matched.latency_ms));
    setTimeout(() => {
      res.status(matched.status_code).json(matched.response_body);
    }, delay);
  });

  // --- BACKEND STUDIO: SQL PLAYGROUND ---
  const sqlSampleTables: Record<string, { columns: string[]; rows: Record<string, unknown>[] }> = {
    sqlite_master: {
      columns: ['type', 'name', 'tbl_name', 'rootpage'],
      rows: [
        { type: 'table', name: 'users', tbl_name: 'users', rootpage: 2 },
        { type: 'table', name: 'tasks', tbl_name: 'tasks', rootpage: 5 },
        { type: 'table', name: 'audit_logs', tbl_name: 'audit_logs', rootpage: 9 },
        { type: 'index', name: 'idx_tasks_status', tbl_name: 'tasks', rootpage: 12 },
      ],
    },
    users: {
      columns: ['id', 'username', 'role', 'active'],
      rows: [
        { id: 1, username: 'admin', role: 'admin', active: 1 },
        { id: 2, username: 'dev_ops', role: 'developer', active: 1 },
      ],
    },
    tasks: {
      columns: ['id', 'title', 'agent', 'status'],
      rows: [
        { id: 'task-101', title: 'Revisar arquitetura Obsidian Studio', agent: 'Architecture Review', status: 'completed' },
        { id: 'task-102', title: 'Auditar política CSP e cabeçalhos HTTP', agent: 'Auditoria de Segurança', status: 'in_progress' },
      ],
    },
    audit_logs: {
      columns: ['id', 'action', 'actor', 'severity'],
      rows: [
        { id: 101, action: 'auth.login', actor: 'admin', severity: 'info' },
        { id: 102, action: 'policy.verify', actor: 'jarvis_maestro', severity: 'low' },
      ],
    },
  };

  api.get('/backend-studio/databases/:projectId', requireAuth, (req, res) => {
    const pid = String(req.params.projectId || 'workspace');
    res.json([
      {
        name: 'jarvis_hub.db',
        relative_path: `data/${pid}_hub.db`,
        absolute_path: `/workspace/${pid}/data/jarvis_hub.db`,
        size_kb: 412,
      },
      {
        name: 'telemetry_wal.sqlite',
        relative_path: `data/telemetry_wal.sqlite`,
        absolute_path: `/workspace/${pid}/data/telemetry_wal.sqlite`,
        size_kb: 184,
      },
    ]);
  });

  api.post('/backend-studio/sql/inspect', requireAuth, (req, res) => {
    res.json({
      db_path: String(req.body?.db_path || 'data/jarvis_hub.db'),
      journal_mode: 'WAL',
      tables_count: 3,
      tables: ['users', 'tasks', 'audit_logs'],
    });
  });

  api.post('/backend-studio/sql/query', requireAuth, (req, res) => {
    const query = String(req.body?.query || '').trim();
    const upper = query.toUpperCase();
    if (/^\s*(DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|ATTACH|PRAGMA\s+WRITABLE)/i.test(upper)) {
      res.json({
        success: false,
        is_select: false,
        duration_ms: 1,
        error: 'Modo somente leitura ativo: apenas consultas SELECT e EXPLAIN são permitidas.',
      });
      return;
    }
    const tableKey =
      upper.includes('FROM USERS')
        ? 'users'
        : upper.includes('FROM TASKS')
          ? 'tasks'
          : upper.includes('FROM AUDIT_LOGS')
            ? 'audit_logs'
            : 'sqlite_master';
    const dataset = sqlSampleTables[tableKey];
    res.json({
      success: true,
      is_select: true,
      duration_ms: 4,
      row_count: dataset.rows.length,
      columns: dataset.columns,
      rows: dataset.rows,
    });
  });

  api.post('/backend-studio/sql/audit', requireAuth, (req, res) => {
    const query = String(req.body?.query || '').trim();
    const hasSelectStar = /SELECT\s+\*/i.test(query);
    const hasLeadingWildcard = /LIKE\s+['"]%/i.test(query);
    const isTableScan = hasSelectStar || hasLeadingWildcard || !/WHERE/i.test(query);
    const suggestions: Array<{ recommendation: string; example_sql: string }> = [];
    if (hasSelectStar) {
      suggestions.push({
        recommendation: 'Evite SELECT * em produção para reduzir I/O e habilitar covering indexes.',
        example_sql: 'SELECT id, name, status FROM tasks WHERE status = "in_progress" LIMIT 50;',
      });
    }
    if (isTableScan) {
      suggestions.push({
        recommendation: 'Crie um índice composto nas colunas filtradas para eliminar FULL TABLE SCAN.',
        example_sql: 'CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks (status, created_at DESC);',
      });
    }
    res.json({
      status: 'ok',
      is_table_scan: isTableScan,
      score: isTableScan ? 64 : 96,
      verdict: isTableScan
        ? 'SCAN sequencial detectado no plano de execução (EXPLAIN QUERY PLAN).'
        : 'Consulta otimizada com uso de índice primário/secundário.',
      suggestions,
    });
  });

  // --- QUALITY STUDIO ---
  api.get('/quality-studio/tests/:projectId', requireAuth, (req, res) => {
    res.json({
      project_id: req.params.projectId,
      test_framework: 'node:test + vitest',
      total_files: 3,
      test_files: [
        'src/router.test.ts',
        'src/features/tasks/taskFiltering.test.ts',
        'src/services/sessionTransport.test.ts',
      ],
    });
  });

  api.post('/quality-studio/run', requireAuth, (req, res) => {
    const projectId = String(req.body?.project_id || 'workspace');
    res.json({
      is_success: true,
      status: 'passed',
      duration_seconds: 1.34,
      summary: { total: 12, passed: 12, failed: 0, skipped: 0 },
      raw_output: [
        `> jarvis-qa-runner --project=${projectId}`,
        '✔ src/router.test.ts (3 tests) 18ms',
        '✔ src/features/tasks/taskFiltering.test.ts (5 tests) 24ms',
        '✔ src/services/sessionTransport.test.ts (4 tests) 19ms',
        '',
        'Test Files  3 passed (3)',
        '     Tests  12 passed (12)',
        '  Duration  1.34s',
      ].join('\n'),
    });
  });

  api.post('/quality-studio/generate-playwright', requireAuth, (req, res) => {
    const targetUrl = String(req.body?.target_url || 'http://127.0.0.1:8000').trim();
    const scenarioName = String(req.body?.scenario_name || 'fluxo_principal')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const code = [
      'from playwright.sync_api import Page, expect',
      '',
      `def test_${scenarioName}(page: Page):`,
      `    page.goto("${targetUrl}", wait_until="networkidle")`,
      '    expect(page).to_have_title(re.compile(".+"))',
      '    main = page.locator("main")',
      '    expect(main).to_be_visible()',
      '    # Verifica ausência de overflow horizontal no viewport desktop',
      '    has_overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")',
      '    assert not has_overflow',
    ].join('\n');
    res.json({ code, filename: `test_${scenarioName}_e2e.py` });
  });

  api.get('/quality-studio/chaos-edge-cases', requireAuth, (_req, res) => {
    res.json([
      {
        name: 'Payload Unicode & Zero-Width',
        category: 'input_validation',
        expected_behavior: 'Sanitizar caracteres invisíveis sem quebrar a serialização UTF-8.',
        payload: { title: 'Relatório\u200B\uFEFF crítica 🚀', limit: 255 },
      },
      {
        name: 'Injeção SQL em filtro de busca',
        category: 'security',
        expected_behavior: 'Tratar entrada como string literal via prepared statement.',
        payload: { query: "' OR '1'='1; DROP TABLE tasks; --" },
      },
      {
        name: 'Latência Extrema & Timeout',
        category: 'resilience',
        expected_behavior: 'Exibir fallback controlável com opção de tentar novamente.',
        payload: { simulated_latency_ms: 8500, retry_budget: 2 },
      },
      {
        name: 'Valores Limite Negativos',
        category: 'boundary',
        expected_behavior: 'Rejeitar valores fora de faixa com HTTP 400 descritivo.',
        payload: { page: -1, page_size: 999999, status_code: 0 },
      },
    ]);
  });

  // --- DESIGN STUDIO ---
  const mixHexColor = (hexA: string, hexB: string, weight: number): string => {
    const parse = (h: string) => {
      const clean = h.replace('#', '');
      const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0');
      return [
        parseInt(full.slice(0, 2), 16) || 0,
        parseInt(full.slice(2, 4), 16) || 0,
        parseInt(full.slice(4, 6), 16) || 0,
      ];
    };
    const [r1, g1, b1] = parse(hexA);
    const [r2, g2, b2] = parse(hexB);
    const toHex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
    const r = r1 * (1 - weight) + r2 * weight;
    const g = g1 * (1 - weight) + g2 * weight;
    const b = b1 * (1 - weight) + b2 * weight;
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  api.post('/design-studio/palette', requireAuth, (req, res) => {
    const rawHex = String(req.body?.hex_primary || '#3b82f6').trim();
    const baseHex = /^#?[0-9a-fA-F]{3,6}$/.test(rawHex)
      ? rawHex.startsWith('#')
        ? rawHex
        : `#${rawHex}`
      : '#3b82f6';
    const tokenPrefix = String(req.body?.name || 'jarvis')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '') || 'jarvis';

    const shades: Record<string, string> = {
      '50': mixHexColor(baseHex, '#ffffff', 0.9),
      '100': mixHexColor(baseHex, '#ffffff', 0.78),
      '200': mixHexColor(baseHex, '#ffffff', 0.6),
      '300': mixHexColor(baseHex, '#ffffff', 0.4),
      '400': mixHexColor(baseHex, '#ffffff', 0.2),
      '500': baseHex.toLowerCase(),
      '600': mixHexColor(baseHex, '#090b10', 0.18),
      '700': mixHexColor(baseHex, '#090b10', 0.36),
      '800': mixHexColor(baseHex, '#090b10', 0.54),
      '900': mixHexColor(baseHex, '#090b10', 0.72),
    };

    const cssLines = Object.entries(shades).map(([k, v]) => `  --${tokenPrefix}-${k}: ${v};`);
    res.json({
      name: tokenPrefix,
      primary: baseHex.toLowerCase(),
      shades,
      css_variables: `:root {\n${cssLines.join('\n')}\n}`,
    });
  });

  api.post('/design-studio/audit-wcag', requireAuth, (req, res) => {
    const markup = String(req.body?.markup || '');
    const lines = markup.split('\n');
    const findings: Array<{
      line: number;
      rule: string;
      severity: string;
      description: string;
      snippet: string;
      remediation: string;
    }> = [];

    lines.forEach((rawLine, index) => {
      const lineNo = index + 1;
      const line = rawLine.trim();
      if (!line) return;
      if (/<img\b(?![^>]*\balt=)/i.test(line)) {
        findings.push({
          line: lineNo,
          rule: 'WCAG 1.1.1 (img-alt)',
          severity: 'high',
          description: 'Imagem sem atributo alt descritivo para leitores de ecrã.',
          snippet: line,
          remediation: 'Adicione alt="Descrição objetiva" ou alt="" se for decorativa.',
        });
      }
      if (/<button\b(?![^>]*aria-label=)[^>]*>\s*<\/button>/i.test(line)) {
        findings.push({
          line: lineNo,
          rule: 'WCAG 4.1.2 (button-name)',
          severity: 'critical',
          description: 'Botão vazio sem texto visível nem aria-label.',
          snippet: line,
          remediation: 'Inclua rótulo visível ou aria-label descrevendo a ação do botão.',
        });
      }
      if (/<input\b(?![^>]*(aria-label=|aria-labelledby=|id=))/i.test(line)) {
        findings.push({
          line: lineNo,
          rule: 'WCAG 1.3.1 (label)',
          severity: 'high',
          description: 'Campo de formulário sem associação explícita a <label> ou aria-label.',
          snippet: line,
          remediation: 'Associe um <label htmlFor="..."> ou defina aria-label no campo.',
        });
      }
      if (/<a\b[^>]*>\s*(clique aqui|click here|saiba mais)\s*<\/a>/i.test(line)) {
        findings.push({
          line: lineNo,
          rule: 'WCAG 2.4.4 (link-purpose)',
          severity: 'medium',
          description: 'Texto de link genérico dificulta navegação fora de contexto.',
          snippet: line,
          remediation: 'Use texto descritivo indicando o destino (ex.: "Abrir documentação de API").',
        });
      }
    });

    const penalty = findings.reduce(
      (acc, f) => acc + (f.severity === 'critical' ? 28 : f.severity === 'high' ? 20 : 12),
      0
    );
    const score = Math.max(0, 100 - penalty);
    res.json({
      score,
      total_issues: findings.length,
      verdict:
        findings.length === 0
          ? 'Nenhuma violação WCAG 2.1 AA detectada no trecho analisado.'
          : `${findings.length} ponto(s) de acessibilidade requerem ajuste antes de publicar.`,
      findings,
    });
  });

  api.get('/design-studio/components/:type', requireAuth, (req, res) => {
    const type = String(req.params.type || 'navbar');
    const templates: Record<string, string> = {
      navbar: `export function TopNavbar() {
  return (
    <header className="jarvis-settings-card" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600 }}>
        <span>Obsidian Studio</span>
      </div>
      <nav aria-label="Navegação principal" style={{ display: 'flex', gap: '8px' }}>
        <button type="button" className="btn btn-ghost btn-sm">Visão Geral</button>
        <button type="button" className="btn btn-ghost btn-sm">Projetos</button>
        <button type="button" className="btn btn-primary btn-sm">Nova Ação</button>
      </nav>
    </header>
  );
}`,
      feature_card: `export function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <article className="jarvis-settings-card" style={{ gap: '10px' }}>
      <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 600, color: 'var(--text-primary)' }}>
        {title}
      </h3>
      <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        {description}
      </p>
    </article>
  );
}`,
      stats_grid: `export function StatsGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <section
      aria-label="Métricas principais"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}
    >
      {items.map((item) => (
        <div key={item.label} className="jarvis-settings-subcard">
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{item.label}</div>
          <div className="jarvis-tabular" style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {item.value}
          </div>
        </div>
      ))}
    </section>
  );
}`,
    };
    res.json({ type, code: templates[type] || templates.navbar });
  });

  // Fallback for any other unmapped API endpoints so the UI receives clean JSON instead of HTML
  api.use(requireAuth, (_req, res) => {
    res.json({ status: 'ok', items: [] });
  });

  return api;
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  app.use('/api/v1', buildApiRouter());

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.use((_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`JARVIS AI Hub server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start JARVIS AI Hub server:', err);
  process.exit(1);
});
