import { API_BASE } from './client';
import { apiFetch } from '../sessionTransport';

export async function fetchModels(): Promise<any> {
  const res = await apiFetch(`${API_BASE}/models`);
  if (!res.ok) throw new Error('Falha ao carregar modelos');
  return res.json();
}

export async function fetchHybridConfig(): Promise<any> {
  const res = await apiFetch(`${API_BASE}/models/hybrid-config`);
  if (!res.ok) throw new Error('Falha ao carregar configuração do gateway híbrido');
  return res.json();
}

export async function saveHybridConfig(config: {
  provider_name: string;
  enabled: boolean;
  api_key?: string;
  base_url?: string;
  default_model?: string;
  max_budget_usd: number;
}): Promise<any> {
  const res = await apiFetch(`${API_BASE}/models/hybrid-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Erro ao salvar configuração' }));
    throw new Error(err.detail || 'Erro ao salvar configuração híbrida');
  }
  return res.json();
}

export async function testHybridConnection(payload: {
  provider_name: string;
  api_key?: string;
  base_url?: string;
  default_model?: string;
}): Promise<any> {
  const res = await apiFetch(`${API_BASE}/models/hybrid-config/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Falha no teste de conexão' }));
    throw new Error(err.detail || 'Falha no teste de conexão');
  }
  return res.json();
}

export async function fetchCuratedHuggingFaceModels(): Promise<any[]> {
  const res = await apiFetch(`${API_BASE}/models/huggingface/curated`);
  if (!res.ok) throw new Error('Falha ao carregar modelos curados do Hugging Face.');
  return res.json();
}

export async function searchHuggingFaceModels(q: string = '', limit: number = 10): Promise<any[]> {
  const res = await apiFetch(`${API_BASE}/models/huggingface/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  if (!res.ok) throw new Error('Falha ao pesquisar modelos no Hugging Face.');
  return res.json();
}

export async function fetchAgentModelRecommendations(): Promise<Record<string, { model: string; reason: string }>> {
  const res = await apiFetch(`${API_BASE}/models/agent-recommendations`);
  if (!res.ok) throw new Error('Falha ao carregar recomendações de modelos dos agentes.');
  return res.json();
}

export interface HardwareAdvisorPayload {
  profiles: Array<{
    id: string;
    label: string;
    owner: string;
    cpu: string;
    ram_gb: number;
    gpu_name: string;
    vram_gb: number;
    ollama_url: string;
    is_active: boolean;
  }>;
  active_profile_id: string;
  providers: {
    ollama_connected: boolean;
    huggingface_connected: boolean;
    gemini_connected: boolean;
    gemini_api_configured: boolean;
    ollama_reachable: boolean;
    ollama_latency_ms?: number;
  };
  recommendations: Array<{
    agent_role: string;
    agent_name: string;
    proper_name: string;
    recommended_model: string;
    execution_mode: 'LOCAL' | 'ONLINE';
    provider: 'ollama' | 'gemini';
    fit_tier: 'gpu_smooth' | 'cpu_ok' | 'recommend_online';
    fit_label: string;
    reason: string;
    required_vram_gb: number;
  }>;
}

export async function fetchHardwareAdvisor(): Promise<HardwareAdvisorPayload> {
  const res = await apiFetch(`${API_BASE}/models/hardware`);
  if (!res.ok) throw new Error('Falha ao consultar o Consultor de Hardware.');
  return res.json();
}

export async function saveHardwareProfile(payload: {
  active_profile_id?: string;
  profile?: {
    id: string;
    label: string;
    owner: string;
    cpu: string;
    ram_gb: number;
    gpu_name: string;
    vram_gb: number;
    ollama_url: string;
    is_active?: boolean;
  };
}): Promise<HardwareAdvisorPayload> {
  const res = await apiFetch(`${API_BASE}/models/hardware`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Falha ao atualizar perfil de hardware.');
  return res.json();
}

export async function updateProviderConnectivity(payload: {
  ollama_connected?: boolean;
  huggingface_connected?: boolean;
  gemini_connected?: boolean;
  ollama_url?: string;
}): Promise<HardwareAdvisorPayload> {
  const res = await apiFetch(`${API_BASE}/models/providers`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Falha ao atualizar provedores de IA.');
  return res.json();
}

export async function applyHardwareRecommendations(payload: {
  agent_role?: string;
  apply_all?: boolean;
}): Promise<{ applied_count: number; agents_updated: string[] }> {
  const res = await apiFetch(`${API_BASE}/models/recommendations/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Falha ao aplicar recomendações aos agentes.');
  return res.json();
}

export interface ArenaSideResult {
  model_requested: string;
  model_used: string;
  execution_mode: 'LOCAL' | 'ONLINE';
  provider: string;
  latency_ms: number;
  text: string;
  reasoning?: string;
  routing_note?: string;
  sources?: Array<{ title: string; url: string }>;
  error?: string;
}

export async function runModelArenaComparison(payload: {
  prompt: string;
  model_a: string;
  model_b: string;
  enable_web_search?: boolean;
}): Promise<{ left: ArenaSideResult; right: ArenaSideResult }> {
  const res = await apiFetch(`${API_BASE}/models/arena`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Falha ao executar comparação na Arena.' }));
    throw new Error(err.detail || 'Falha ao executar comparação na Arena.');
  }
  return res.json();
}

export interface KeyVaultItem {
  key_id: string;
  label?: string;
  provider_name?: string;
  provider?: string;
  masked_key: string;
  base_url?: string;
  preferred_model?: string;
  default_model?: string;
  assigned_agents?: string[];
  is_active: boolean;
  owner_user_id?: string | null;
  is_default?: boolean;
}

export async function fetchKeyVault(): Promise<KeyVaultItem[]> {
  const res = await apiFetch(`${API_BASE}/models/vault`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Falha ao carregar o KeyVault.' }));
    throw new Error(err.detail || 'Falha ao carregar o KeyVault.');
  }
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.keys)) return data.keys;
  throw new Error('Resposta inválida recebida do KeyVault.');
}

export async function registerVaultKey(payload: {
  key_id: string;
  label: string;
  provider: string;
  api_key: string;
  base_url?: string;
  default_model?: string;
  is_active?: boolean;
  is_default?: boolean;
  scope?: 'account' | 'global';
}): Promise<any> {
  const res = await apiFetch(`${API_BASE}/models/vault`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Falha ao salvar chave' }));
    throw new Error(err.detail || 'Falha ao cadastrar chave no cofre');
  }
  return res.json();
}

export async function deleteVaultKey(key_id: string, scope: 'account' | 'global' = 'account'): Promise<any> {
  const res = await apiFetch(`${API_BASE}/models/vault/${encodeURIComponent(key_id)}?scope=${scope}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Falha ao remover chave' }));
    throw new Error(err.detail || 'Falha ao remover chave do cofre');
  }
  return res.json();
}

export async function setDefaultVaultKey(key_id: string): Promise<any> {
  const res = await apiFetch(`${API_BASE}/models/vault/${encodeURIComponent(key_id)}/default`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Falha ao definir chave predefinida' }));
    throw new Error(err.detail || 'Falha ao definir chave predefinida');
  }
  return res.json();
}

export async function testVaultKey(key_id: string, scope: 'account' | 'global' = 'account'): Promise<any> {
  const res = await apiFetch(`${API_BASE}/models/vault/${encodeURIComponent(key_id)}/test?scope=${scope}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Falha no teste' }));
    throw new Error(err.detail || 'Falha ao testar chave');
  }
  return res.json();
}

export type ExternalProviderSlug =
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'groq'
  | 'openrouter'
  | 'xai'
  | 'custom';

export interface SessionProviderKeyRecord {
  provider: ExternalProviderSlug;
  name: string;
  short_label: string;
  tier: 'primary' | 'secondary';
  docs_hint: string;
  key_prefix_hint: string;
  suggested_models: string[];
  env_var: string;
  configured: boolean;
  source: 'http_only_cookie_and_vault' | 'http_only_cookie' | 'env' | 'none';
  key_id: string;
  masked_key: string;
  base_url: string;
  default_model: string;
  is_active: boolean;
  is_default: boolean;
  last_tested_at: string | null;
  last_test_status: string | null;
  last_test_message: string | null;
  last_latency_ms: number | null;
  last_status_code: number | null;
}

export interface GeminiServerHealthRecord {
  configured: boolean;
  ok: boolean;
  status_code: number;
  latency_ms: number;
  endpoint_host: string;
  model: string;
  checked_at: string;
  message: string;
}

export interface SessionProviderKeysResponse {
  storage_security: {
    http_only_cookie: boolean;
    cookie_name: string;
    encryption: string;
    plaintext_in_local_storage: boolean;
    owner_user_id: string;
  };
  gemini_server_managed: boolean;
  gemini_health?: GeminiServerHealthRecord | null;
  providers: SessionProviderKeyRecord[];
}

export interface ConfiguredProvidersHealthResponse {
  checked_at: string;
  gemini_health: GeminiServerHealthRecord | null;
  results: Array<{
    provider: ExternalProviderSlug;
    ok: boolean;
    status_code: number;
    latency_ms: number;
    endpoint_host: string;
    models_detected: string[];
    message: string;
    checked_at: string;
  }>;
  state: SessionProviderKeysResponse;
}

export async function fetchSessionProviderKeys(): Promise<SessionProviderKeysResponse> {
  const res = await apiFetch(`${API_BASE}/settings/provider-keys`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Falha ao carregar chaves de provedores.' }));
    throw new Error(err.detail || 'Falha ao carregar chaves de provedores.');
  }
  return res.json();
}

export async function probeConfiguredProvidersHealth(): Promise<ConfiguredProvidersHealthResponse> {
  const res = await apiFetch(`${API_BASE}/settings/provider-keys/health`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Falha ao medir saúde dos provedores configurados.' }));
    throw new Error(err.detail || 'Falha ao medir saúde dos provedores configurados.');
  }
  return res.json();
}

export async function saveSessionProviderKey(
  provider: ExternalProviderSlug,
  payload: {
    api_key?: string;
    base_url?: string;
    default_model?: string;
    is_default?: boolean;
    label?: string;
  }
): Promise<SessionProviderKeysResponse> {
  const res = await apiFetch(`${API_BASE}/settings/provider-keys/${encodeURIComponent(provider)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Falha ao salvar chave de API.' }));
    throw new Error(err.detail || 'Falha ao salvar chave de API.');
  }
  return res.json();
}

export interface SessionProviderPingResponse {
  ok: boolean;
  status_code: number;
  latency_ms: number;
  endpoint_host: string;
  models_detected: string[];
  message: string;
  state?: SessionProviderKeysResponse;
}

export async function testSessionProviderKey(
  provider: ExternalProviderSlug,
  payload?: { api_key?: string; base_url?: string }
): Promise<SessionProviderPingResponse> {
  const res = await apiFetch(`${API_BASE}/settings/provider-keys/${encodeURIComponent(provider)}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json().catch(() => ({ ok: false, message: 'Falha ao testar conexão.' }));
  if (!res.ok) {
    return {
      ok: false,
      status_code: Number(data?.status_code || res.status || 0),
      latency_ms: Number(data?.latency_ms || 0),
      endpoint_host: String(data?.endpoint_host || ''),
      models_detected: [],
      message: data?.message || data?.detail || 'Falha na validação da chave.',
      state: data?.state,
    };
  }
  return {
    ok: Boolean(data?.ok),
    status_code: Number(data?.status_code || res.status || 200),
    latency_ms: Number(data?.latency_ms || 0),
    endpoint_host: String(data?.endpoint_host || ''),
    models_detected: Array.isArray(data?.models_detected) ? data.models_detected : [],
    message: String(data?.message || 'Conexão validada.'),
    state: data?.state,
  };
}

export async function setDefaultSessionProviderKey(
  provider: ExternalProviderSlug | 'none'
): Promise<SessionProviderKeysResponse> {
  const res = await apiFetch(`${API_BASE}/settings/provider-keys/${encodeURIComponent(provider)}/default`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Falha ao definir provedor padrão.' }));
    throw new Error(err.detail || 'Falha ao definir provedor padrão.');
  }
  return res.json();
}

export async function deleteSessionProviderKey(
  provider: ExternalProviderSlug
): Promise<SessionProviderKeysResponse> {
  const res = await apiFetch(`${API_BASE}/settings/provider-keys/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Falha ao remover chave de API.' }));
    throw new Error(err.detail || 'Falha ao remover chave de API.');
  }
  return res.json();
}

