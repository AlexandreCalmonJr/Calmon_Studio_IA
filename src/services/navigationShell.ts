import { getAccountStorageKey } from './accountScope';
import { isTabUnlockedByPacks, type ModulePackDefinition } from './modulePackEngine';

export type NavGroupId =
  | 'principal'
  | 'intelligence'
  | 'engineering'
  | 'governance'
  | 'system';

export type NavIconKey =
  | 'overview'
  | 'chat'
  | 'creative_studio'
  | 'office'
  | 'tasks'
  | 'workflows'
  | 'agents'
  | 'models'
  | 'knowledge'
  | 'workspace'
  | 'coding'
  | 'architecture'
  | 'app_builder'
  | 'github_import'
  | 'android_app'
  | 'brain_server'
  | 'companion'
  | 'security'
  | 'approvals'
  | 'usage'
  | 'backend_studio'
  | 'quality'
  | 'design'
  | 'executive_report'
  | 'server_logs'
  | 'advisor'
  | 'skills'
  | 'store'
  | 'pack_studio'
  | 'learning'
  | 'settings';

export interface NavigationModuleItem {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  groupId: NavGroupId;
  groupTitle: string;
  iconKey: NavIconKey;
  color: string;
  isSimpleCore: boolean;
  isUtility?: boolean;
  collapsibleGroup?: boolean;
  requiresPackManage?: boolean;
  adminOnly?: boolean;
  launchpadOnly?: boolean;
}

export interface NavGroupMeta {
  id: NavGroupId;
  title: string;
  collapsible: boolean;
}

export const NAV_GROUPS_META: readonly NavGroupMeta[] = [
  { id: 'principal', title: 'Principal', collapsible: false },
  { id: 'intelligence', title: 'Inteligência & Recursos', collapsible: false },
  { id: 'engineering', title: 'Engenharia & Ecossistema', collapsible: true },
  { id: 'governance', title: 'Estúdios & Governança', collapsible: true },
  { id: 'system', title: 'Sistema & Loja', collapsible: false },
] as const;

export const NAV_MODULES_CATALOG: readonly NavigationModuleItem[] = [
  // Principal
  {
    id: 'overview',
    label: 'Visão Geral',
    shortLabel: 'Início',
    description: 'Resumo operacional, saúde do sistema e início rápido.',
    groupId: 'principal',
    groupTitle: 'Principal',
    iconKey: 'overview',
    color: '#3b82f6',
    isSimpleCore: true,
  },
  {
    id: 'chat',
    label: 'Chat e Conversas',
    shortLabel: 'Chat',
    description: 'Converse com o Maestro e chame especialistas com @ e /.',
    groupId: 'principal',
    groupTitle: 'Principal',
    iconKey: 'chat',
    color: '#6366f1',
    isSimpleCore: true,
  },
  {
    id: 'creative_studio',
    label: 'Estúdio Criativo',
    shortLabel: 'Criativo',
    description: 'Planilhas .xlsx, criação de imagens e vídeos curtos.',
    groupId: 'principal',
    groupTitle: 'Principal',
    iconKey: 'creative_studio',
    color: '#ec4899',
    isSimpleCore: true,
  },
  {
    id: 'office',
    label: 'Escritório Isométrico',
    shortLabel: 'Escritório',
    description: 'Visão 2.5D da equipe de agentes e mesa redonda.',
    groupId: 'principal',
    groupTitle: 'Principal',
    iconKey: 'office',
    color: '#eab308',
    isSimpleCore: true,
  },
  {
    id: 'tasks',
    label: 'Tarefas',
    shortLabel: 'Tarefas',
    description: 'Delegue missões e acompanhe planos multi-etapas.',
    groupId: 'principal',
    groupTitle: 'Principal',
    iconKey: 'tasks',
    color: '#10b981',
    isSimpleCore: true,
  },
  {
    id: 'workflows',
    label: 'Monitor de Fluxos',
    shortLabel: 'Fluxos',
    description: 'Canvas visual, Flow Architect e rotinas agendadas.',
    groupId: 'principal',
    groupTitle: 'Principal',
    iconKey: 'workflows',
    color: '#8b5cf6',
    isSimpleCore: true,
  },

  // Inteligência & Recursos
  {
    id: 'agents',
    label: 'Central de Agentes',
    shortLabel: 'Agentes',
    description: 'Instale especialistas, edite núcleos e vincule habilidades.',
    groupId: 'intelligence',
    groupTitle: 'Inteligência & Recursos',
    iconKey: 'agents',
    color: '#f97316',
    isSimpleCore: true,
  },
  {
    id: 'models',
    label: 'Modelos & Hardware',
    shortLabel: 'Modelos',
    description: 'Ollama local, Arena de modelos e cofre de chaves API.',
    groupId: 'intelligence',
    groupTitle: 'Inteligência & Recursos',
    iconKey: 'models',
    color: '#06b6d4',
    isSimpleCore: true,
  },
  {
    id: 'knowledge',
    label: 'Habilidades & Conhecimentos',
    shortLabel: 'Cadernos',
    description: 'Base de conhecimento RAG, documentos e memória semântica.',
    groupId: 'intelligence',
    groupTitle: 'Inteligência & Recursos',
    iconKey: 'knowledge',
    color: '#14b8a6',
    isSimpleCore: true,
  },
  {
    id: 'skills',
    label: 'Catálogo de Habilidades',
    shortLabel: 'Skills',
    description: 'Gerencie e crie habilidades reutilizáveis para os agentes.',
    groupId: 'intelligence',
    groupTitle: 'Inteligência & Recursos',
    iconKey: 'skills',
    color: '#f59e0b',
    isSimpleCore: false,
    launchpadOnly: true,
  },

  // Engenharia & Ecossistema
  {
    id: 'workspace',
    label: 'Projetos',
    shortLabel: 'Projetos',
    description: 'Pastas e repositórios locais conectados ao contexto do chat.',
    groupId: 'engineering',
    groupTitle: 'Engenharia & Ecossistema',
    iconKey: 'workspace',
    color: '#22c55e',
    isSimpleCore: false,
    collapsibleGroup: true,
  },
  {
    id: 'coding',
    label: 'IDE & Código',
    shortLabel: 'IDE',
    description: 'Editor assistido, diff visual, checkpoints e terminal.',
    groupId: 'engineering',
    groupTitle: 'Engenharia & Ecossistema',
    iconKey: 'coding',
    color: '#0ea5e9',
    isSimpleCore: false,
    collapsibleGroup: true,
  },
  {
    id: 'architecture',
    label: 'Agente de Arquitetura',
    shortLabel: 'Arquitetura',
    description: 'Análise estrutural, C4 Model e decisões técnicas (ADRs).',
    groupId: 'engineering',
    groupTitle: 'Engenharia & Ecossistema',
    iconKey: 'architecture',
    color: '#f59e0b',
    isSimpleCore: false,
    collapsibleGroup: true,
  },
  {
    id: 'app_builder',
    label: 'Construtor de Apps',
    shortLabel: 'Apps',
    description: 'Crie aplicativos com prévia ao vivo e pacote exportável.',
    groupId: 'engineering',
    groupTitle: 'Engenharia & Ecossistema',
    iconKey: 'app_builder',
    color: '#a855f7',
    isSimpleCore: false,
    collapsibleGroup: true,
  },
  {
    id: 'github_import',
    label: 'Importar GitHub',
    shortLabel: 'GitHub',
    description: 'Leia repositórios e incorpore como agente, skill ou RAG.',
    groupId: 'engineering',
    groupTitle: 'Engenharia & Ecossistema',
    iconKey: 'github_import',
    color: '#64748b',
    isSimpleCore: false,
    collapsibleGroup: true,
  },
  {
    id: 'android_app',
    label: 'App Mobile Android',
    shortLabel: 'Android',
    description: 'Pareamento por QR Code e projeto mobile Android.',
    groupId: 'engineering',
    groupTitle: 'Engenharia & Ecossistema',
    iconKey: 'android_app',
    color: '#10b981',
    isSimpleCore: false,
    collapsibleGroup: true,
  },
  {
    id: 'brain_server',
    label: 'Cérebros & Servidor',
    shortLabel: 'Cérebros',
    description: 'Multi-cérebro SQLite, Docker e sincronização de dados.',
    groupId: 'engineering',
    groupTitle: 'Engenharia & Ecossistema',
    iconKey: 'brain_server',
    color: '#6366f1',
    isSimpleCore: false,
    collapsibleGroup: true,
  },
  {
    id: 'companion',
    label: 'Voz & Companion',
    shortLabel: 'Voz/PWA',
    description: 'Assistente de voz contínuo, wake word e app PWA.',
    groupId: 'engineering',
    groupTitle: 'Engenharia & Ecossistema',
    iconKey: 'companion',
    color: '#f43f5e',
    isSimpleCore: false,
    collapsibleGroup: true,
  },
  {
    id: 'advisor',
    label: 'Diagnóstico de Hardware',
    shortLabel: 'Hardware',
    description: 'Análise de CPU, RAM, GPU e recomendações para Ollama.',
    groupId: 'engineering',
    groupTitle: 'Engenharia & Ecossistema',
    iconKey: 'advisor',
    color: '#14b8a6',
    isSimpleCore: false,
    adminOnly: true,
    launchpadOnly: true,
  },

  // Estúdios & Governança
  {
    id: 'security',
    label: 'Sentinela & Segurança',
    shortLabel: 'Sentinela',
    description: 'Auditoria OWASP, contenção e kill switch.',
    groupId: 'governance',
    groupTitle: 'Estúdios & Governança',
    iconKey: 'security',
    color: '#10b981',
    isSimpleCore: false,
    collapsibleGroup: true,
  },
  {
    id: 'approvals',
    label: 'Aprovações',
    shortLabel: 'Aprovações',
    description: 'Central de aprovações humanas para ações sensíveis.',
    groupId: 'governance',
    groupTitle: 'Estúdios & Governança',
    iconKey: 'approvals',
    color: '#f59e0b',
    isSimpleCore: false,
    collapsibleGroup: true,
  },
  {
    id: 'usage',
    label: 'Uso & Custos',
    shortLabel: 'Custos',
    description: 'Consumo de tokens, custos e telemetria por modelo.',
    groupId: 'governance',
    groupTitle: 'Estúdios & Governança',
    iconKey: 'usage',
    color: '#ec4899',
    isSimpleCore: false,
    collapsibleGroup: true,
  },
  {
    id: 'backend_studio',
    label: 'Backend Studio',
    shortLabel: 'Backend',
    description: 'Simulador de APIs HTTP e playground SQL.',
    groupId: 'governance',
    groupTitle: 'Estúdios & Governança',
    iconKey: 'backend_studio',
    color: '#3b82f6',
    isSimpleCore: false,
    collapsibleGroup: true,
  },
  {
    id: 'quality',
    label: 'Qualidade QA',
    shortLabel: 'QA',
    description: 'Suítes de teste e prevenção de regressões.',
    groupId: 'governance',
    groupTitle: 'Estúdios & Governança',
    iconKey: 'quality',
    color: '#22c55e',
    isSimpleCore: false,
    collapsibleGroup: true,
  },
  {
    id: 'design',
    label: 'Design Studio',
    shortLabel: 'Design',
    description: 'Criação e revisão visual de interfaces.',
    groupId: 'governance',
    groupTitle: 'Estúdios & Governança',
    iconKey: 'design',
    color: '#8b5cf6',
    isSimpleCore: false,
    collapsibleGroup: true,
  },
  {
    id: 'executive_report',
    label: 'Relatório ROI',
    shortLabel: 'ROI',
    description: 'Métricas executivas e retorno dos projetos.',
    groupId: 'governance',
    groupTitle: 'Estúdios & Governança',
    iconKey: 'executive_report',
    color: '#f97316',
    isSimpleCore: false,
    collapsibleGroup: true,
  },
  {
    id: 'server_logs',
    label: 'Logs do Servidor',
    shortLabel: 'Logs',
    description: 'Terminal de eventos do servidor FastAPI em tempo real.',
    groupId: 'governance',
    groupTitle: 'Estúdios & Governança',
    iconKey: 'server_logs',
    color: '#64748b',
    isSimpleCore: false,
    collapsibleGroup: true,
    adminOnly: true,
  },

  // Sistema & Loja
  {
    id: 'store',
    label: 'Loja Unificada',
    shortLabel: 'Loja',
    description: 'Pacotes modulares, conectores, núcleos e habilidades.',
    groupId: 'system',
    groupTitle: 'Sistema & Loja',
    iconKey: 'store',
    color: '#0ea5e9',
    isSimpleCore: true,
    isUtility: true,
  },
  {
    id: 'pack_studio',
    label: 'Estúdio de Pacotes',
    shortLabel: 'Pacotes',
    description: 'Crie e publique pacotes personalizados na Loja.',
    groupId: 'system',
    groupTitle: 'Sistema & Loja',
    iconKey: 'pack_studio',
    color: '#f97316',
    isSimpleCore: true,
    isUtility: true,
    requiresPackManage: true,
  },
  {
    id: 'learning',
    label: 'Ajuda & Guias',
    shortLabel: 'Ajuda',
    description: 'Guias passo a passo, FAQs e novidades da plataforma.',
    groupId: 'system',
    groupTitle: 'Sistema & Loja',
    iconKey: 'learning',
    color: '#22c55e',
    isSimpleCore: true,
    isUtility: true,
  },
  {
    id: 'settings',
    label: 'Configurações',
    shortLabel: 'Ajustes',
    description: 'Tema, voz, provedores, dock macOS e preferências.',
    groupId: 'system',
    groupTitle: 'Sistema & Loja',
    iconKey: 'settings',
    color: '#6366f1',
    isSimpleCore: true,
    isUtility: true,
  },
] as const;

export const VALID_NAV_MODULE_IDS = new Set(NAV_MODULES_CATALOG.map((m) => m.id));

export const DEFAULT_DOCK_FAVORITES: readonly string[] = [
  'overview',
  'chat',
  'tasks',
  'store',
] as const;

export const MAX_DOCK_FAVORITES = 6;
export const MAX_DOCK_AGENTS = 6;

export const DOCK_FAVORITES_STORAGE_KEY = 'jarvis_dock_favorites_v1';
export const SIDEBAR_HIDDEN_STORAGE_KEY = 'jarvis_sidebar_hidden_v1';
export const DOCK_MINIMIZED_STORAGE_KEY = 'jarvis_dock_minimized_v1';
export const SIDEBAR_PINNED_STORAGE_KEY = 'jarvis_sidebar_pinned_v1';

export const DOCK_FAVORITES_UPDATED_EVENT = 'jarvis:dock-favorites-changed';
export const SIDEBAR_HIDDEN_UPDATED_EVENT = 'jarvis:sidebar-visibility-changed';
export const DOCK_MINIMIZED_UPDATED_EVENT = 'jarvis:dock-minimized-changed';

function getStorageSafe(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // ignore SSR / sandbox
  }
  return null;
}

function dispatchWindowEvent(type: string, detail?: unknown): void {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      const ev =
        typeof CustomEvent === 'function'
          ? new CustomEvent(type, { detail })
          : ({ type, detail } as unknown as Event);
      window.dispatchEvent(ev);
    }
  } catch {
    // ignore SSR
  }
}

export function sanitizeDockFavorites(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_DOCK_FAVORITES];
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const id = entry.trim();
    if (!id || !VALID_NAV_MODULE_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    cleaned.push(id);
    if (cleaned.length >= MAX_DOCK_FAVORITES) break;
  }
  return cleaned;
}

export function loadDockFavorites(): string[] {
  const storage = getStorageSafe();
  if (!storage) return [...DEFAULT_DOCK_FAVORITES];
  try {
    const raw = storage.getItem(getAccountStorageKey(DOCK_FAVORITES_STORAGE_KEY));
    if (raw === null) return [...DEFAULT_DOCK_FAVORITES];
    return sanitizeDockFavorites(JSON.parse(raw));
  } catch {
    return [...DEFAULT_DOCK_FAVORITES];
  }
}

export function saveDockFavorites(ids: readonly string[]): string[] {
  const sanitized = sanitizeDockFavorites(ids);
  const storage = getStorageSafe();
  if (storage) {
    try {
      storage.setItem(getAccountStorageKey(DOCK_FAVORITES_STORAGE_KEY), JSON.stringify(sanitized));
    } catch {
      // ignore quota errors
    }
  }
  dispatchWindowEvent(DOCK_FAVORITES_UPDATED_EVENT, { favorites: sanitized });
  return sanitized;
}

export interface ToggleFavoriteResult {
  favorites: string[];
  added: boolean;
  removed: boolean;
  limitReached: boolean;
}

export function toggleDockFavorite(
  tabId: string,
  current: readonly string[]
): ToggleFavoriteResult {
  if (!VALID_NAV_MODULE_IDS.has(tabId)) {
    return {
      favorites: sanitizeDockFavorites(current),
      added: false,
      removed: false,
      limitReached: false,
    };
  }
  const normalized = sanitizeDockFavorites(current);
  if (normalized.includes(tabId)) {
    const next = normalized.filter((id) => id !== tabId);
    return {
      favorites: next,
      added: false,
      removed: true,
      limitReached: false,
    };
  }
  if (normalized.length >= MAX_DOCK_FAVORITES) {
    return {
      favorites: normalized,
      added: false,
      removed: false,
      limitReached: true,
    };
  }
  return {
    favorites: [...normalized, tabId],
    added: true,
    removed: false,
    limitReached: false,
  };
}

export function loadSidebarHidden(): boolean {
  const storage = getStorageSafe();
  if (!storage) return false;
  try {
    return storage.getItem(getAccountStorageKey(SIDEBAR_HIDDEN_STORAGE_KEY)) === 'true';
  } catch {
    return false;
  }
}

export function saveSidebarHidden(hidden: boolean): boolean {
  const next = Boolean(hidden);
  const storage = getStorageSafe();
  if (storage) {
    try {
      storage.setItem(getAccountStorageKey(SIDEBAR_HIDDEN_STORAGE_KEY), String(next));
    } catch {
      // ignore
    }
  }
  dispatchWindowEvent(SIDEBAR_HIDDEN_UPDATED_EVENT, { hidden: next });
  return next;
}

export function loadDockMinimized(): boolean {
  const storage = getStorageSafe();
  if (!storage) return false;
  try {
    return storage.getItem(getAccountStorageKey(DOCK_MINIMIZED_STORAGE_KEY)) === 'true';
  } catch {
    return false;
  }
}

export function saveDockMinimized(minimized: boolean): boolean {
  const next = Boolean(minimized);
  const storage = getStorageSafe();
  if (storage) {
    try {
      storage.setItem(getAccountStorageKey(DOCK_MINIMIZED_STORAGE_KEY), String(next));
    } catch {
      // ignore
    }
  }
  dispatchWindowEvent(DOCK_MINIMIZED_UPDATED_EVENT, { minimized: next });
  return next;
}

export interface ResolveVisibleModulesOptions {
  isSimpleMode?: boolean;
  installedPackIds?: string[] | null;
  customPacks?: ModulePackDefinition[];
  canManagePacks?: boolean;
  canAccessTab?: (tabId: string) => boolean;
  includeLaunchpadOnly?: boolean;
}

export function resolveVisibleNavModules(
  options: ResolveVisibleModulesOptions = {}
): NavigationModuleItem[] {
  const {
    isSimpleMode = false,
    installedPackIds = null,
    customPacks = [],
    canManagePacks = false,
    canAccessTab,
    includeLaunchpadOnly = false,
  } = options;

  return NAV_MODULES_CATALOG.filter((item) => {
    if (!includeLaunchpadOnly && item.launchpadOnly) return false;
    if (item.requiresPackManage && !canManagePacks) return false;
    if (isSimpleMode && !item.isSimpleCore) return false;
    if (canAccessTab && !canAccessTab(item.id)) return false;
    if (
      installedPackIds &&
      !isTabUnlockedByPacks(item.id, installedPackIds, customPacks)
    ) {
      return false;
    }
    return true;
  });
}

export function resolveDockFavoriteItems(
  favoriteIds: readonly string[],
  options: ResolveVisibleModulesOptions = {}
): NavigationModuleItem[] {
  const accessible = resolveVisibleNavModules({
    ...options,
    includeLaunchpadOnly: true,
  });
  const byId = new Map(accessible.map((item) => [item.id, item]));
  return sanitizeDockFavorites(favoriteIds)
    .map((id) => byId.get(id))
    .filter((item): item is NavigationModuleItem => Boolean(item));
}

export function filterLaunchpadModules(
  modules: readonly NavigationModuleItem[],
  query: string
): NavigationModuleItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...modules];
  return modules.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      item.shortLabel.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.groupTitle.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q)
  );
}

/**
 * Telas administrativas densas (tabelas, formulários extensos, editores e logs)
 * nas quais o Dock flutuante recolhe automaticamente para a pílula discreta
 * para evitar sobreposição sobre o rodapé de cards e tabelas.
 */
export const DENSE_DOCK_AUTO_MINIMIZE_TABS: ReadonlySet<string> = new Set([
  'brain_server',
  'pack_studio',
  'agents',
  'models',
  'knowledge',
  'security',
  'approvals',
  'usage',
  'server_logs',
  'settings',
  'store',
  'workflows',
  'coding',
]);

export function shouldAutoMinimizeDockForTab(tabId: string): boolean {
  return DENSE_DOCK_AUTO_MINIMIZE_TABS.has(tabId);
}

export function computeDockClearancePx(opts: {
  showDock: boolean;
  isMinimized: boolean;
  isMobile?: boolean;
  showEscapePill?: boolean;
}): string {
  if (opts.isMobile) return '0px';
  if (opts.showDock) return opts.isMinimized ? '52px' : '112px';
  return opts.showEscapePill ? '52px' : '0px';
}
