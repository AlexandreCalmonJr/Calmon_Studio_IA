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

function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

export function loadConnectedAppIds(): string[] {
  if (!hasLocalStorage()) return [...DEFAULT_CONNECTED_APP_IDS];
  try {
    const raw = localStorage.getItem(getAccountStorageKey('jarvis_connected_apps'));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    }
  } catch {}
  return [...DEFAULT_CONNECTED_APP_IDS];
}

export function saveConnectedAppIds(ids: string[]): string[] {
  const unique = Array.from(new Set(ids.map(String)));
  if (hasLocalStorage()) {
    try {
      localStorage.setItem(getAccountStorageKey('jarvis_connected_apps'), JSON.stringify(unique));
    } catch {}
  }
  return unique;
}

export function loadCustomStoreApps(): StoreAppItem[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(getAccountStorageKey('jarvis_custom_store_apps'));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is StoreAppItem =>
            Boolean(item && typeof item.id === 'string' && typeof item.name === 'string')
        );
      }
    }
  } catch {}
  return [];
}

export function saveCustomStoreApps(apps: StoreAppItem[]): StoreAppItem[] {
  if (hasLocalStorage()) {
    try {
      localStorage.setItem(getAccountStorageKey('jarvis_custom_store_apps'), JSON.stringify(apps));
    } catch {}
  }
  return apps;
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

  return {
    id: `custom_${slug || 'connector'}_${Date.now().toString(36)}`,
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
    return (
      app.name.toLowerCase().includes(q) ||
      app.description.toLowerCase().includes(q) ||
      APP_CATEGORY_LABELS[app.category].toLowerCase().includes(q)
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
    counts[app.category] = (counts[app.category] || 0) + 1;
  }
  return counts;
}
