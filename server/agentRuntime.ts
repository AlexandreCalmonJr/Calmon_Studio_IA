import fs from 'node:fs';
import path from 'node:path';
import type { AgentServerRecord } from './serverState.ts';
import type { AgentCoreConfig as AgentCoreRecord } from '../src/services/agentCoreEngine.ts';
import type { BrainSearchHit as BrainMemorySearchHit } from '../src/services/secondBrain.ts';
import type { ContextSetRecord } from '../src/services/integrationsCatalog.ts';

export interface ChatHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ActiveSkillRecord {
  id: string;
  name: string;
  domain?: string;
  description?: string;
  instructions?: string;
  allowed_tools?: string[];
  assigned_agents?: string[];
  is_approved?: boolean;
  is_revoked?: boolean;
}

export interface ActiveSkillSummary {
  id: string;
  name: string;
  domain: string;
  allowed_tools: string[];
}

export interface AgentRouteEntry {
  agent_role?: string;
  key_id?: string;
  model?: string;
  provider?: string;
  key_label?: string;
  key_available?: boolean;
}

export interface WorkspaceProjectContext {
  id: string;
  name: string;
  type?: string;
  description?: string;
  files?: string[];
}

export type ModelResolutionSource =
  | 'chat_override'
  | 'agent_route'
  | 'agent_core'
  | 'agent_preferred'
  | 'system_default';

export interface ResolvedAgentModel {
  requestedModel: string;
  source: ModelResolutionSource;
  fallbackModel?: string;
}

export function isAutoModelSelection(value?: string | null): boolean {
  const clean = String(value || '').trim().toLowerCase();
  return !clean || clean === 'auto' || clean === 'auto_hybrid';
}

/**
 * Precedência determinística em 5 níveis:
 * 1. Sobrescrita manual do Chat (quando != 'auto')
 * 2. Rota customizada do agente (agentRoutes)
 * 3. Modelo primário no Núcleo Cognitivo (AgentCore)
 * 4. Modelo preferencial no cadastro do agente (preferred_model)
 * 5. Modelo padrão do Gateway Híbrido / Sistema
 */
export function resolveAgentTargetModel(input: {
  explicitChatOverride?: string | null;
  agentRoute?: AgentRouteEntry | null;
  agentCore?: Partial<AgentCoreRecord> | null;
  agentPreferredModel?: string | null;
  systemDefaultModel?: string | null;
}): ResolvedAgentModel {
  const fallbackCandidate = String(input.agentCore?.fallback_model || '').trim() || undefined;

  if (!isAutoModelSelection(input.explicitChatOverride)) {
    return {
      requestedModel: String(input.explicitChatOverride).trim(),
      source: 'chat_override',
      fallbackModel: fallbackCandidate,
    };
  }

  const routeModel = String(input.agentRoute?.model || '').trim();
  if (routeModel && !isAutoModelSelection(routeModel)) {
    return {
      requestedModel: routeModel,
      source: 'agent_route',
      fallbackModel: fallbackCandidate,
    };
  }

  const coreModel = String(input.agentCore?.primary_model || '').trim();
  if (coreModel && !isAutoModelSelection(coreModel)) {
    return {
      requestedModel: coreModel,
      source: 'agent_core',
      fallbackModel: fallbackCandidate,
    };
  }
  if (input.agentCore?.primary_provider === 'ollama') {
    return {
      requestedModel: 'calmon-ia:latest',
      source: 'agent_core',
      fallbackModel: fallbackCandidate,
    };
  }

  const preferredModel = String(input.agentPreferredModel || '').trim();
  if (preferredModel && !isAutoModelSelection(preferredModel)) {
    return {
      requestedModel: preferredModel,
      source: 'agent_preferred',
      fallbackModel: fallbackCandidate,
    };
  }

  const systemDefault = String(input.systemDefaultModel || 'gemini-4-hydrogen').trim() || 'gemini-4-hydrogen';
  return {
    requestedModel: systemDefault,
    source: 'system_default',
    fallbackModel: fallbackCandidate,
  };
}

/**
 * Filtra apenas habilidades aprovadas, não revogadas e vinculadas ao papel do agente.
 */
export function resolveActiveSkillsForAgent(
  skillsList: ActiveSkillRecord[],
  agentRole: string
): ActiveSkillRecord[] {
  if (!Array.isArray(skillsList) || !agentRole) return [];
  return skillsList.filter((sk) => {
    if (!sk || sk.is_approved === false || sk.is_revoked === true) return false;
    const assigned = Array.isArray(sk.assigned_agents) ? sk.assigned_agents : [];
    return assigned.includes(agentRole);
  });
}

/**
 * Mantém a janela recente da conversa dentro de limites seguros de tokens/caracteres.
 */
export function normalizeConversationHistory(
  rawMessages: Array<{ role?: string; content?: string }>,
  maxTurns = 12,
  maxChars = 9000
): ChatHistoryTurn[] {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) return [];
  const valid: ChatHistoryTurn[] = [];
  for (const m of rawMessages) {
    const content = String(m?.content || '').trim();
    if (!content) continue;
    const role = m?.role === 'user' ? 'user' : m?.role === 'assistant' ? 'assistant' : null;
    if (!role) continue;
    valid.push({ role, content: content.slice(0, 2400) });
  }

  const recent = valid.slice(-maxTurns);
  const kept: ChatHistoryTurn[] = [];
  let charBudget = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const turn = recent[i];
    if (charBudget + turn.content.length > maxChars && kept.length > 0) break;
    kept.unshift(turn);
    charBudget += turn.content.length;
  }
  return kept;
}

export interface BuildAgentRuntimeContextInput {
  agent: Pick<
    AgentServerRecord,
    'role' | 'name' | 'proper_name' | 'handle' | 'mission' | 'system_prompt' | 'preferred_model' | 'allowed_tools'
  >;
  agentCore?: Partial<AgentCoreRecord> | null;
  skillsList: ActiveSkillRecord[];
  agentMemories?: Array<Record<string, unknown>>;
  brainMemories?: BrainMemorySearchHit[];
  contextSets?: ContextSetRecord[];
  workspaceProject?: WorkspaceProjectContext | null;
  projectMemories?: Array<Record<string, unknown>>;
  historyMessages?: Array<{ role?: string; content?: string }>;
  agentRoute?: AgentRouteEntry | null;
  explicitChatOverride?: string | null;
  systemDefaultModel?: string | null;
  extraNotes?: string[];
  executionModeHint?: 'plan' | 'ask' | 'auto' | string;
}

export interface BuiltAgentRuntimeContext {
  systemInstruction: string;
  skillsUsed: ActiveSkillSummary[];
  history: ChatHistoryTurn[];
  resolvedModel: ResolvedAgentModel;
}

export function buildAgentRuntimeContext(input: BuildAgentRuntimeContextInput): BuiltAgentRuntimeContext {
  const { agent, agentCore } = input;
  const activeSkills = resolveActiveSkillsForAgent(input.skillsList, agent.role);
  const skillsUsed: ActiveSkillSummary[] = activeSkills.map((sk) => ({
    id: sk.id,
    name: sk.name,
    domain: String(sk.domain || 'general'),
    allowed_tools: Array.isArray(sk.allowed_tools) ? sk.allowed_tools : [],
  }));

  const resolvedModel = resolveAgentTargetModel({
    explicitChatOverride: input.explicitChatOverride,
    agentRoute: input.agentRoute,
    agentCore,
    agentPreferredModel: agent.preferred_model,
    systemDefaultModel: input.systemDefaultModel,
  });

  const sections: string[] = [];

  // 1. Persona e missão base
  const basePrompt = String(agent.system_prompt || '').trim();
  if (basePrompt) {
    sections.push(basePrompt);
  }
  if (agent.mission) {
    sections.push(`Missão principal do especialista (${agent.proper_name || agent.name}): ${agent.mission}`);
  }

  // 2. Núcleo Cognitivo (SOUL.md, diretivas e MEMORY.md)
  const soulMd = String(agentCore?.soul_markdown || '').trim();
  if (soulMd) {
    sections.push(`Núcleo de Identidade (SOUL.md):\n${soulMd.slice(0, 1400)}`);
  }
  const directives = String((agentCore as Record<string, unknown>)?.system_directives || '').trim();
  if (directives) {
    sections.push(`Diretivas Operacionais do Núcleo:\n${directives.slice(0, 900)}`);
  }
  const coreMemoryMd = String(agentCore?.memory_markdown || '').trim();
  if (coreMemoryMd) {
    sections.push(`Memória Persistente do Agente (MEMORY.md):\n${coreMemoryMd.slice(0, 1200)}`);
  }

  for (const ruleFile of ['.calmonrules', 'CLAUDE.md']) {
    try {
      const full = path.join(process.cwd(), ruleFile);
      if (fs.existsSync(full)) {
        const content = fs.readFileSync(full, 'utf8').trim();
        if (content) {
          sections.push(`Regras do Projeto (${ruleFile}):\n${content.slice(0, 1400)}`);
          break;
        }
      }
    } catch {
      // ignora erro de leitura opcional
    }
  }

  // 3. Habilidades Ativas Vinculadas
  if (activeSkills.length > 0) {
    const skillLines = activeSkills.map((sk) => {
      const toolsText =
        Array.isArray(sk.allowed_tools) && sk.allowed_tools.length > 0
          ? ` [Ferramentas: ${sk.allowed_tools.join(', ')}]`
          : '';
      const instr = String(sk.instructions || sk.description || '').trim();
      return `- **${sk.name}** (${sk.domain || 'geral'})${toolsText}: ${instr}`;
    });
    sections.push(
      `Habilidades Ativas Vinculadas (aplique estas instruções quando pertinentes ao pedido):\n${skillLines.join('\n')}`
    );
  }

  // 4. Memórias individuais do agente
  if (Array.isArray(input.agentMemories) && input.agentMemories.length > 0) {
    const memLines = input.agentMemories
      .slice(0, 6)
      .map((m) => {
        const key = String(m.key || m.category || 'nota');
        const content = String(m.content || '').trim();
        return content ? `- [${key}] ${content.slice(0, 260)}` : '';
      })
      .filter(Boolean);
    if (memLines.length > 0) {
      sections.push(`Lembranças Salvas deste Especialista:\n${memLines.join('\n')}`);
    }
  }

  // 5. Segundo Cérebro
  if (Array.isArray(input.brainMemories) && input.brainMemories.length > 0) {
    const brainLines = input.brainMemories.map(
      (h) => `- [${h.memory.layer}] ${h.memory.title}: ${h.memory.content.slice(0, 280)}`
    );
    sections.push(`Memórias Relevantes do Segundo Cérebro:\n${brainLines.join('\n')}`);
  }

  // 6. Context Sets permitidos
  if (Array.isArray(input.contextSets) && input.contextSets.length > 0) {
    const packLines = input.contextSets
      .slice(0, 2)
      .map((cs) => `- ${cs.name}: ${cs.content.slice(0, 320)}`);
    sections.push(`Context Sets Acoplados:\n${packLines.join('\n')}`);
  }

  // 7. Projeto do Workspace vinculado
  if (input.workspaceProject) {
    const wp = input.workspaceProject;
    const filesHint =
      Array.isArray(wp.files) && wp.files.length > 0
        ? ` | Arquivos principais: ${wp.files.slice(0, 12).join(', ')}`
        : '';
    const projLines = [
      `Projeto Vinculado: ${wp.name} (${wp.id}${wp.type ? `, ${wp.type}` : ''}) — ${wp.description || 'Workspace ativo'}${filesHint}`,
    ];
    if (Array.isArray(input.projectMemories) && input.projectMemories.length > 0) {
      for (const pm of input.projectMemories.slice(0, 4)) {
        const content = String(pm.content || '').trim();
        if (content) projLines.push(`- Diretriz do projeto [${pm.key || pm.category || 'regra'}]: ${content}`);
      }
    }
    sections.push(projLines.join('\n'));
  }

  // 8. Modo operacional (Playground: plan / ask / auto)
  if (input.executionModeHint === 'plan') {
    sections.push('MODO OPERACIONAL: PLANO (somente análise, arquitetura e plano de ação; não execute alterações destrutivas).');
  } else if (input.executionModeHint === 'ask') {
    sections.push('MODO OPERACIONAL: ASSISTIDO (explique cada passo crítico antes de sugerir alterações sensíveis).');
  } else if (input.executionModeHint === 'auto') {
    sections.push('MODO OPERACIONAL: AUTÔNOMO (entregue solução direta, completa e acionável dentro das ferramentas permitidas).');
  }

  // 9. Notas extras (ex.: plano multi-agente ou contexto adicional)
  if (Array.isArray(input.extraNotes)) {
    for (const note of input.extraNotes) {
      const clean = String(note || '').trim();
      if (clean) sections.push(clean);
    }
  }

  const history = normalizeConversationHistory(input.historyMessages || []);

  return {
    systemInstruction: sections.filter(Boolean).join('\n\n'),
    skillsUsed,
    history,
    resolvedModel,
  };
}
