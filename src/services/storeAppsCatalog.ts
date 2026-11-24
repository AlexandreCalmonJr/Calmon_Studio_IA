import { getAccountStorageKey } from './accountScope';

export type StoreAppCategory = 'productivity' | 'documents' | 'development' | 'ai';

export interface StoreAppItem {
  id: string;
  name: string;
  description: string;
  category: StoreAppCategory;
  color: string;
  iconType: string;
  isCustom?: boolean;
  connectionType?: 'mcp' | 'webhook' | 'custom_tool';
  endpoint?: string;
}

export const APP_CATEGORY_LABELS: Record<StoreAppCategory, string> = {
  productivity: 'Produtividade',
  documents: 'Documentos',
  development: 'Desenvolvimento & Código',
  ai: 'IA & MCP',
};

export const APP_CATEGORY_SHORT_LABELS: Record<StoreAppCategory, string> = {
  productivity: 'PRODUTIVIDADE',
  documents: 'DOCUMENTOS',
  development: 'DESENVOLVIMENTO',
  ai: 'IA & MCP',
};

export const DEFAULT_CONNECTED_APP_IDS: readonly string[] = [
  'telegram',
  'whatsapp',
  'github',
  'canva',
  'vercel',
  'context7',
  'huggingface',
];

export const STORE_APPS: StoreAppItem[] = [
  // Produtividade
  {
    id: 'slack',
    name: 'Slack',
    description: 'Menções e mensagens diretas no Slack',
    category: 'productivity',
    color: '#ffffff',
    iconType: 'slack',
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Menções e mensagens diretas no Discord',
    category: 'productivity',
    color: '#5865f2',
    iconType: 'discord',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Grupos e conversas diretas no Telegram',
    category: 'productivity',
    color: '#0284c7',
    iconType: 'telegram',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Seu próprio chat e as pessoas que você atende',
    category: 'productivity',
    color: '#22c55e',
    iconType: 'whatsapp',
  },
  {
    id: '1password',
    name: '1Password',
    description: 'Entre em sites com os logins que você usa',
    category: 'productivity',
    color: '#0284c7',
    iconType: '1password',
  },
  {
    id: 'bitwarden',
    name: 'Bitwarden',
    description: 'Entre em sites com logins de um cofre',
    category: 'productivity',
    color: '#175ddc',
    iconType: 'bitwarden',
  },

  // Documentos
  {
    id: 'coda',
    name: 'Coda',
    description: 'Docs, pages and tables',
    category: 'documents',
    color: '#ea580c',
    iconType: 'coda',
  },
  {
    id: 'craft',
    name: 'Craft',
    description: 'Notes, docs and tasks',
    category: 'documents',
    color: '#ffffff',
    iconType: 'craft',
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    description: 'Files and folders',
    category: 'documents',
    color: '#0061ff',
    iconType: 'dropbox',
  },
  {
    id: 'evernote',
    name: 'Evernote',
    description: 'Notes and notebooks',
    category: 'documents',
    color: '#00a82d',
    iconType: 'evernote',
  },

  // Desenvolvimento & Código
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repositórios, PRs e commits',
    category: 'development',
    color: '#18181b',
    iconType: 'github',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    description: 'Deployments, logs e ambientes',
    category: 'development',
    color: '#000000',
    iconType: 'vercel',
  },
  {
    id: 'canva',
    name: 'Canva',
    description: 'Criação de designs, mockups e assets visuais',
    category: 'development',
    color: '#00c4cc',
    iconType: 'canva',
  },

  // Inteligência Artificial & Dados
  {
    id: 'context7',
    name: 'Context7',
    description: 'Servidor MCP de documentação técnica',
    category: 'ai',
    color: '#059669',
    iconType: 'context7',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    description: 'Modelos e datasets abertos',
    category: 'ai',
    color: '#eab308',
    iconType: 'huggingface',
  },
];

export const STORE_APPS_UPDATED_EVENT = 'jarvis:store-apps-updated';

export interface StoreAppsUpdatedDetail {
  connectedAppIds?: string[];
  customApps?: StoreAppItem[];
}

const VALID_STORE_CATEGORIES: readonly StoreAppCategory[] = [
  'productivity',
  'documents',
  'development',
  'ai',
];

let customAppSeq = 0;

function hasLocalStorage(): boolean {
  try {
    return (
      typeof localStorage !== 'undefined' &&
      localStorage !== null &&
      typeof localStorage.getItem === 'function' &&
      typeof localStorage.setItem === 'function'
    );
  } catch {
    return false;
  }
}

function broadcastStoreAppsUpdated(detail?: StoreAppsUpdatedDetail): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent<StoreAppsUpdatedDetail>(STORE_APPS_UPDATED_EVENT, { detail }));
  }
}

function normalizeStoreAppCategory(raw: unknown, fallbackConnectionType?: string): StoreAppCategory {
  if (typeof raw === 'string' && (VALID_STORE_CATEGORIES as readonly string[]).includes(raw)) {
    return raw as StoreAppCategory;
  }
  return fallbackConnectionType === 'mcp' ? 'ai' : 'development';
}

function normalizeStoredCustomApp(raw: unknown): StoreAppItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  if (!id || !name) return null;

  const connectionType =
    item.connectionType === 'mcp' || item.connectionType === 'webhook' || item.connectionType === 'custom_tool'
      ? item.connectionType
      : undefined;
  const category = normalizeStoreAppCategory(item.category, connectionType);
  const endpoint = typeof item.endpoint === 'string' ? item.endpoint : undefined;
  const description =
    typeof item.description === 'string'
      ? item.description
      : endpoint
        ? `Conector personalizado · ${endpoint}`
        : 'Conector personalizado';
  const iconType =
    typeof item.iconType === 'string' && item.iconType.trim()
      ? item.iconType.trim()
      : connectionType || 'mcp';
  const color = typeof item.color === 'string' && item.color.trim() ? item.color.trim() : '#f97316';

  return {
    id,
    name,
    description,
    category,
    color,
    iconType,
    isCustom: true,
    connectionType,
    endpoint,
  };
}

export function loadConnectedAppIds(): string[] {
  if (!hasLocalStorage()) return [...DEFAULT_CONNECTED_APP_IDS];
  try {
    const raw = localStorage.getItem(getAccountStorageKey('jarvis_connected_apps'));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return Array.from(
          new Set(
            parsed
              .filter((id): id is string => typeof id === 'string')
              .map((id) => id.trim())
              .filter(Boolean)
          )
        );
      }
    }
  } catch {}
  return [...DEFAULT_CONNECTED_APP_IDS];
}

export function saveConnectedAppIds(ids: string[]): string[] {
  const unique = Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean)
    )
  );
  if (hasLocalStorage()) {
    try {
      localStorage.setItem(getAccountStorageKey('jarvis_connected_apps'), JSON.stringify(unique));
    } catch {}
  }
  broadcastStoreAppsUpdated({ connectedAppIds: unique });
  return unique;
}

export function loadCustomStoreApps(): StoreAppItem[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(getAccountStorageKey('jarvis_custom_store_apps'));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const seen = new Set<string>();
        const normalized: StoreAppItem[] = [];
        for (const item of parsed) {
          const app = normalizeStoredCustomApp(item);
          if (app && !seen.has(app.id)) {
            seen.add(app.id);
            normalized.push(app);
          }
        }
        return normalized;
      }
    }
  } catch {}
  return [];
}

export function saveCustomStoreApps(apps: StoreAppItem[]): StoreAppItem[] {
  const seen = new Set<string>();
  const sanitized: StoreAppItem[] = [];
  for (const item of Array.isArray(apps) ? apps : []) {
    const app = normalizeStoredCustomApp(item);
    if (app && !seen.has(app.id)) {
      seen.add(app.id);
      sanitized.push(app);
    }
  }
  if (hasLocalStorage()) {
    try {
      localStorage.setItem(getAccountStorageKey('jarvis_custom_store_apps'), JSON.stringify(sanitized));
    } catch {}
  }
  broadcastStoreAppsUpdated({ customApps: sanitized });
  return sanitized;
}

export function createCustomStoreApp(input: {
  name: string;
  connectionType: 'mcp' | 'webhook' | 'custom_tool';
  endpoint: string;
}): StoreAppItem {
  const cleanName = input.name.trim();
  const cleanEndpoint = input.endpoint.trim();
  const slug = cleanName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  customAppSeq = (customAppSeq + 1) % 1_000_000;
  const suffix = `${Date.now().toString(36)}_${customAppSeq.toString(36)}`;

  return {
    id: `custom_${slug || 'connector'}_${suffix}`,
    name: cleanName,
    description: `${
      input.connectionType === 'mcp'
        ? 'Servidor MCP'
        : input.connectionType === 'webhook'
          ? 'Webhook / API REST'
          : 'Script Sandboxed'
    } · ${cleanEndpoint}`,
    category: input.connectionType === 'mcp' ? 'ai' : 'development',
    color: '#f97316',
    iconType: input.connectionType,
    isCustom: true,
    connectionType: input.connectionType,
    endpoint: cleanEndpoint,
  };
}

export function filterStoreApps(
  apps: StoreAppItem[],
  opts: {
    query?: string;
    category?: 'all' | StoreAppCategory;
  } = {}
): StoreAppItem[] {
  const q = (opts.query || '').trim().toLowerCase();
  const category = opts.category || 'all';
  return apps.filter((app) => {
    if (category !== 'all' && app.category !== category) return false;
    if (!q) return true;
    const categoryLabel = APP_CATEGORY_LABELS[app.category] || '';
    return (
      (app.name || '').toLowerCase().includes(q) ||
      (app.description || '').toLowerCase().includes(q) ||
      categoryLabel.toLowerCase().includes(q)
    );
  });
}

export function countStoreAppsByCategory(
  apps: StoreAppItem[]
): Record<'all' | StoreAppCategory, number> {
  const counts: Record<'all' | StoreAppCategory, number> = {
    all: apps.length,
    productivity: 0,
    documents: 0,
    development: 0,
    ai: 0,
  };
  for (const app of apps) {
    if (app.category in counts) {
      counts[app.category] += 1;
    }
  }
  return counts;
}
