import type { AgentInfo } from '../types';
import type { CatalogAgent } from '../data/agentsCatalog';

export interface UnifiedDockAgent {
  id: string;
  role: string;
  name: string;
  properName: string;
  handle: string;
  subtitle: string;
  color: string;
  isCustom: boolean;
}

export interface ReconciledStoreBlueprint {
  blueprint: CatalogAgent;
  installedAgent: AgentInfo | null;
  status: 'installed' | 'available';
  suggestedProperName: string;
  suggestedHandle: string;
}

const CORE_DOCK_PRIORITY = [
  'jarvis_master',
  'sentinel_security',
  'english_tutor',
  'research_analyst',
  'ux_ui_designer',
  'software_architect',
];

const FALLBACK_COLORS = [
  '#f97316',
  '#10b981',
  '#38bdf8',
  '#f59e0b',
  '#fb7185',
  '#a78bfa',
  '#2dd4bf',
];

const BLUEPRINT_PROPER_NAMES: Record<string, string> = {
  project_manager: 'Bruno',
  project_designer_planner: 'Lara',
  automation_engineer: 'Igor',
  data_scientist: 'Iris',
  business_intelligence: 'Rafael',
  data_engineering_intelligence: 'Nadia',
  data_engineer_pipelines: 'Enzo',
  network_infrastructure_engineer: 'Breno',
  threat_modeling_security_architect: 'Valkiria',
  secure_code_auditor: 'Cesar',
  api_security_specialist: 'DanteSec',
  identity_access_management: 'Gaia',
  software_supply_chain_security: 'Tarek',
  soc_incident_response: 'Sora',
  ai_security_red_team: 'Nyx',
  privacy_data_protection: 'Livia',
};

const STORE_TO_BACKEND_CATEGORY: Record<CatalogAgent['category'], string> = {
  orchestration: 'orchestration',
  development: 'dev',
  data: 'business',
  devops: 'dev',
  security: 'security',
};

export function getAgentDisplayColor(agent: AgentInfo, idx = 0): string {
  return agent.mascot?.color || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

export function getAgentProperName(agent: AgentInfo): string {
  const clean = (agent.proper_name || '').trim();
  if (clean) return clean;
  return agent.name || agent.role;
}

export function sortAgentsCustomFirst(agents: AgentInfo[]): AgentInfo[] {
  return [...agents].sort((a, b) => {
    const aCustom = a.is_custom ? 1 : 0;
    const bCustom = b.is_custom ? 1 : 0;
    if (aCustom !== bCustom) return bCustom - aCustom;
    return 0;
  });
}

/**
 * Resolve the right-hand AgentDock strictly from the user's real active agents
 * (GET /api/v1/agents). Never injects legacy hardcoded fake specialists.
 */
export function resolveDockAgents(
  realAgents: AgentInfo[],
  pinnedRoles: string[] | null,
  maxDefault = 6
): UnifiedDockAgent[] {
  if (!realAgents || realAgents.length === 0) return [];

  const byRole = new Map<string, AgentInfo>();
  realAgents.forEach((ag) => byRole.set(ag.role, ag));

  // Keep only pinned roles that actually exist in the user's active team
  const validPinned = (pinnedRoles || [])
    .map((id) => byRole.get(id))
    .filter((ag): ag is AgentInfo => Boolean(ag));

  let chosen: AgentInfo[];
  if (validPinned.length > 0) {
    // Also surface any newly created custom agent that is not yet in validPinned (if space allows)
    const pinnedSet = new Set(validPinned.map((a) => a.role));
    const unpinnedCustom = realAgents.filter((a) => a.is_custom && !pinnedSet.has(a.role));
    chosen = [...unpinnedCustom, ...validPinned].slice(0, 8);
  } else {
    const customAgents = realAgents.filter((a) => a.is_custom);
    const customSet = new Set(customAgents.map((a) => a.role));
    const coreAgents = CORE_DOCK_PRIORITY
      .map((role) => byRole.get(role))
      .filter((ag): ag is AgentInfo => Boolean(ag && !customSet.has(ag.role)));
    const fallbackOthers = realAgents.filter(
      (ag) => !customSet.has(ag.role) && !CORE_DOCK_PRIORITY.includes(ag.role)
    );
    chosen = [...customAgents, ...coreAgents, ...fallbackOthers].slice(0, maxDefault);
  }

  return chosen.map((ag, idx) => ({
    id: ag.role,
    role: ag.role,
    name: getAgentProperName(ag),
    properName: getAgentProperName(ag),
    handle: ag.handle || `@${ag.role.split('_')[0]}`,
    subtitle: ag.name || ag.mission,
    color: getAgentDisplayColor(ag, idx),
    isCustom: Boolean(ag.is_custom),
  }));
}

/**
 * Resolve the Chat sidebar ("Meus Agentes") strictly from real active agents,
 * prioritizing user-created custom agents at the top.
 */
export function resolveQuickChatAgents(
  realAgents: AgentInfo[],
  searchTerm = ''
): UnifiedDockAgent[] {
  const ordered = sortAgentsCustomFirst(realAgents);
  const mapped: UnifiedDockAgent[] = ordered.map((ag, idx) => ({
    id: `agent_${ag.role}`,
    role: ag.role,
    name: getAgentProperName(ag),
    properName: getAgentProperName(ag),
    handle: ag.handle || `@${ag.role.split('_')[0]}`,
    subtitle: ag.name || ag.mission,
    color: getAgentDisplayColor(ag, idx),
    isCustom: Boolean(ag.is_custom),
  }));

  const q = searchTerm.trim().toLowerCase();
  if (!q) return mapped;
  return mapped.filter(
    (ag) =>
      ag.name.toLowerCase().includes(q) ||
      ag.handle.toLowerCase().includes(q) ||
      ag.subtitle.toLowerCase().includes(q) ||
      ag.role.toLowerCase().includes(q)
  );
}

/**
 * Reconciles the static Store blueprints against the user's real active agents
 * so there is zero duplication or contradiction between Store and Agents Center.
 */
export function reconcileStoreBlueprints(
  catalogBlueprints: CatalogAgent[],
  realAgents: AgentInfo[]
): {
  items: ReconciledStoreBlueprint[];
  availableCount: number;
  installedCount: number;
} {
  const byRole = new Map<string, AgentInfo>();
  realAgents.forEach((ag) => byRole.set(ag.role, ag));

  const items: ReconciledStoreBlueprint[] = catalogBlueprints.map((bp) => {
    const installedAgent = byRole.get(bp.role) || null;
    const suggestedProperName =
      installedAgent?.proper_name ||
      BLUEPRINT_PROPER_NAMES[bp.role] ||
      bp.name.split(' ')[0];
    const suggestedHandle =
      installedAgent?.handle ||
      `@${suggestedProperName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')}`;

    return {
      blueprint: bp,
      installedAgent,
      status: installedAgent ? 'installed' : 'available',
      suggestedProperName,
      suggestedHandle,
    };
  });

  const installedCount = items.filter((i) => i.status === 'installed').length;
  const availableCount = items.length - installedCount;
  return { items, availableCount, installedCount };
}

/**
 * Builds a valid POST /api/v1/agents payload when installing a Store blueprint
 * into the user's real team.
 */
export function mapBlueprintToCreatePayload(item: ReconciledStoreBlueprint) {
  const { blueprint, suggestedProperName, suggestedHandle } = item;
  const mascotId =
    blueprint.category === 'security'
      ? 'sentinel_owl'
      : blueprint.category === 'orchestration'
        ? 'maestro_slime'
        : blueprint.category === 'data'
          ? 'scholar_fox'
          : 'coder_slime';
  const accessory =
    blueprint.category === 'security'
      ? 'shield'
      : blueprint.category === 'data'
        ? 'glasses'
        : 'visor';

  return {
    role: blueprint.role,
    name: blueprint.name,
    proper_name: suggestedProperName,
    handle: suggestedHandle,
    category: STORE_TO_BACKEND_CATEGORY[blueprint.category] || 'dev',
    mission: blueprint.mission,
    preferred_model: blueprint.category === 'security' ? 'llama3.1:8b' : 'gemini-4-hydrogen',
    routing_policy: 'auto_hybrid' as const,
    autonomy_level: blueprint.category === 'security' ? ('read_only' as const) : ('ask_approval' as const),
    strict_focus: blueprint.category === 'security',
    strict_topic: blueprint.categoryLabel,
    system_prompt: `Você é ${suggestedProperName}, ${blueprint.name}. Missão principal: ${blueprint.mission}`,
    mascot: {
      id: mascotId,
      color: blueprint.color,
      accessory,
      mood: 'idle',
    },
  };
}
