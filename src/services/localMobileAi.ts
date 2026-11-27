/**
 * Gerenciador de Conexão Dinâmica (Desktop Host), Ponte Nativa Android (Capacitor)
 * e IA Local On-Device (Mobile).
 */

const MOBILE_HOST_STORAGE_KEY = 'calmon_mobile_host_url_v1';
const LOCAL_MOBILE_MODEL_KEY = 'calmon_local_mobile_model_v1';

export interface LocalMobileModelSpec {
  id: string;
  name: string;
  sizeLabel: string;
  minRamGb: number;
  quantization: string;
  recommended: boolean;
  downloadUrl: string;
}

export interface DiscoveredLanHost {
  ip: string;
  hostname: string;
  port: number;
  platform: string;
  url: string;
}

export const RECOMMENDED_MOBILE_MODELS: LocalMobileModelSpec[] = [
  {
    id: 'qwen2.5-1.5b-instruct-q4_k_m',
    name: 'Qwen 2.5 1.5B Instruct (PT-BR)',
    sizeLabel: '980 MB',
    minRamGb: 4,
    quantization: 'Q4_K_M',
    recommended: true,
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
  },
  {
    id: 'llama-3.2-1b-instruct-q4_k_m',
    name: 'Llama 3.2 1B Instruct',
    sizeLabel: '740 MB',
    minRamGb: 3,
    quantization: 'Q4_K_M',
    recommended: false,
    downloadUrl:
      'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
  },
  {
    id: 'gemma-2-2b-it-q4_k_m',
    name: 'Gemma 2 2B Instruct',
    sizeLabel: '1.55 GB',
    minRamGb: 6,
    quantization: 'Q4_K_M',
    recommended: false,
    downloadUrl:
      'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf',
  },
];

interface CalmonNativeBridge {
  discoverLanHosts?: () => Promise<{ hosts: DiscoveredLanHost[] }>;
  startForegroundBridge?: (opts: { host: string }) => Promise<{ running: boolean }>;
  stopForegroundBridge?: () => Promise<{ running: boolean }>;
  authenticateBiometric?: (opts: { reason: string }) => Promise<{ authenticated: boolean; method: string }>;
  listLocalModels?: () => Promise<{ models: Array<{ id: string; filename: string; sizeBytes: number }> }>;
  downloadLocalModel?: (opts: { modelId: string; url: string }) => Promise<{ ok: boolean; path: string; sizeBytes: number }>;
  checkAppUpdate?: (opts?: { repo?: string }) => Promise<{
    currentVersion: string;
    latestVersion: string;
    hasUpdate: boolean;
    apkUrl: string;
  }>;
  downloadAndInstallApk?: (opts: { apkUrl: string }) => Promise<{ started: boolean }>;
}

function getCalmonNative(): CalmonNativeBridge | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as { Capacitor?: { Plugins?: { CalmonNative?: CalmonNativeBridge } } }).Capacitor;
  return cap?.Plugins?.CalmonNative || null;
}

export function isNativeMobileRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

export function getPairedHostUrl(): string {
  try {
    return localStorage.getItem(MOBILE_HOST_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setPairedHostUrl(url: string): string {
  const clean = (url || '').trim().replace(/\/+$/, '');
  try {
    if (clean) {
      localStorage.setItem(MOBILE_HOST_STORAGE_KEY, clean);
    } else {
      localStorage.removeItem(MOBILE_HOST_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
  return clean;
}

export function getSelectedLocalMobileModel(): string {
  try {
    return localStorage.getItem(LOCAL_MOBILE_MODEL_KEY) || RECOMMENDED_MOBILE_MODELS[0].id;
  } catch {
    return RECOMMENDED_MOBILE_MODELS[0].id;
  }
}

export function setSelectedLocalMobileModel(modelId: string): void {
  try {
    localStorage.setItem(LOCAL_MOBILE_MODEL_KEY, modelId);
  } catch {
    // ignore
  }
}

export async function discoverLanHostsNative(): Promise<DiscoveredLanHost[]> {
  const native = getCalmonNative();
  if (!native?.discoverLanHosts) return [];
  const res = await native.discoverLanHosts();
  return Array.isArray(res?.hosts) ? res.hosts : [];
}

export async function authenticateBiometricNative(reason: string): Promise<boolean> {
  const native = getCalmonNative();
  if (!native?.authenticateBiometric) return true;
  const res = await native.authenticateBiometric({ reason });
  return Boolean(res?.authenticated);
}

export async function setForegroundBridgeNative(enabled: boolean, host: string): Promise<boolean> {
  const native = getCalmonNative();
  if (!native) return false;
  if (enabled && native.startForegroundBridge) {
    const res = await native.startForegroundBridge({ host });
    return Boolean(res?.running);
  }
  if (!enabled && native.stopForegroundBridge) {
    await native.stopForegroundBridge();
    return false;
  }
  return false;
}

export async function listDownloadedLocalModelsNative(): Promise<string[]> {
  const native = getCalmonNative();
  if (!native?.listLocalModels) return [];
  const res = await native.listLocalModels();
  return Array.isArray(res?.models) ? res.models.map((m) => m.id) : [];
}

export async function downloadLocalModelNative(modelId: string): Promise<{ ok: boolean; sizeBytes?: number }> {
  const native = getCalmonNative();
  const spec = RECOMMENDED_MOBILE_MODELS.find((m) => m.id === modelId);
  if (!native?.downloadLocalModel || !spec) {
    return { ok: false };
  }
  return native.downloadLocalModel({ modelId: spec.id, url: spec.downloadUrl });
}

export async function checkAppUpdateNative() {
  const native = getCalmonNative();
  if (!native?.checkAppUpdate) return null;
  return native.checkAppUpdate({ repo: 'AlexandreCalmonJr/Frontend_JarvisHub' });
}

export async function downloadAndInstallApkNative(apkUrl: string): Promise<boolean> {
  const native = getCalmonNative();
  if (!native?.downloadAndInstallApk) return false;
  const res = await native.downloadAndInstallApk({ apkUrl });
  return Boolean(res?.started);
}

const SYNC_MIRROR_KEY = 'calmon_mobile_sync_mirror_v1';

export interface MobileSyncMirror {
  sync_cursor: string;
  desktop_ai?: { ollama_connected: boolean; gemini_connected: boolean; default_model: string };
  counts?: { agents: number; sessions: number; skills: number; media: number };
}

export async function syncDeltaWithDesktop(apiBase: string): Promise<MobileSyncMirror | null> {
  let since = '';
  try {
    const prev = JSON.parse(localStorage.getItem(SYNC_MIRROR_KEY) || 'null') as MobileSyncMirror | null;
    since = prev?.sync_cursor || '';
  } catch {
    since = '';
  }
  const url = since ? `${apiBase}/sync/delta?since=${encodeURIComponent(since)}` : `${apiBase}/sync/delta`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return null;
  const data = (await res.json()) as MobileSyncMirror;
  try {
    localStorage.setItem(SYNC_MIRROR_KEY, JSON.stringify(data));
  } catch {
    // ignore quota
  }
  return data;
}
