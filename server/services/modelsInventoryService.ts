import type { Request } from 'express';
import {
  buildSessionProviderKeysPayload,
  getActiveHardwareProfile,
  getOwnerUserId,
  serverState,
} from '../serverState.ts';
import { fetchOllamaLocalModels, isGeminiApiConfigured } from '../hybridAiEngine.ts';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';

/**
 * Monta o inventário consolidado de modelos locais (Ollama) e online
 * para o endpoint GET /models.
 */
export async function buildModelsInventoryPayload(req: Request, store: LocalSqliteBrainStore) {
  const ownerUserId = getOwnerUserId(req);
  const activeHw = getActiveHardwareProfile();
  const ollamaProbe = serverState.providerConnectivity.ollama_connected
    ? await fetchOllamaLocalModels(activeHw.ollama_url)
    : { reachable: false, latencyMs: 0, models: [] };

  const realLocalModels = ollamaProbe.reachable ? ollamaProbe.models : [];
  const providerState = buildSessionProviderKeysPayload(req, store, ownerUserId);

  const onlineModels: Array<{ name: string; provider: string; role: string }> = [];
  if (serverState.providerConnectivity.gemini_connected && isGeminiApiConfigured()) {
    onlineModels.push(
      { name: 'gemini-4-hydrogen', provider: 'Gemini Online · Web', role: 'Híbrido + Pesquisa Web' },
      { name: 'gemini-3.1-flash-lite', provider: 'Gemini Online · Rápido', role: 'Respostas Instantâneas' }
    );
  }
  for (const p of providerState.providers) {
    if (!p.configured) continue;
    const selectedModels =
      Array.isArray(p.enabled_models) && p.enabled_models.length > 0
        ? p.enabled_models
        : p.default_model
          ? [p.default_model]
          : [];
    const seen = new Set<string>();
    for (const modelName of selectedModels) {
      const clean = String(modelName || '').trim();
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      onlineModels.push({
        name: clean,
        provider: `${p.name}${p.is_default && clean === p.default_model ? ' · Padrão' : ''}`,
        role: p.source === 'env' ? 'Variável de Ambiente' : 'Cofre Protegido da Sessão',
      });
    }
  }

  const defaultExternal = providerState.providers.find((p) => p.configured && p.is_default);
  const resolvedActiveModel = defaultExternal
    ? defaultExternal.default_model
    : isGeminiApiConfigured()
      ? 'gemini-4-hydrogen'
      : realLocalModels[0]?.name || serverState.hybridConfig.default_model;

  return {
    runtime: serverState.providerConnectivity.ollama_connected && ollamaProbe.reachable ? 'hybrid' : 'online',
    status: 'online',
    active_model: resolvedActiveModel,
    hybrid_gateway: {
      enabled: serverState.providerConnectivity.gemini_connected || Boolean(defaultExternal),
      provider: defaultExternal ? defaultExternal.name : 'Gemini Online',
      model: resolvedActiveModel,
      current_spend_usd: serverState.hybridConfig.current_spend_usd,
      max_budget_usd: serverState.hybridConfig.max_budget_usd,
    },
    online_models: onlineModels,
    local_models: realLocalModels.map((m: any) => ({
      name: m.name,
      size_gb: Number(((m.size || 0) / 1e9).toFixed(1)),
      quantization: 'Local',
      family: m.family || 'ollama',
      status: 'online',
    })),
    models: realLocalModels,
    ollama_reachable: ollamaProbe.reachable,
  };
}
