import express, { Request, Response, Router } from 'express';
import {
  serverState,
  requireAuth,
  getOwnerUserId,
  syncVaultHttpOnlyCookie,
  resolveExternalCredentialForRequest,
  buildSessionProviderKeysPayload,
  buildHardwareAdvisorPayload,
  getActiveHardwareProfile,
  recordAgentVersion,
  nowIso,
} from '../serverState.ts';
import { requireRole } from '../serverHardening.ts';
import {
  fetchOllamaLocalModels,
  getCuratedHuggingFaceForHardware,
  isGeminiApiConfigured,
  runHybridInference,
  searchRealHuggingFace,
} from '../hybridAiEngine.ts';
import {
  EXTERNAL_PROVIDERS,
  ExternalProviderId,
  decryptProviderSecret,
  encryptProviderSecret,
  inferExternalProviderFromModel,
  maskApiKey,
  normalizeProviderId,
  testExternalProviderConnection,
  testGeminiServerConnection,
  validateProviderBaseUrl,
} from '../providerEngine.ts';
import { NotebookHardwareProfile } from '../../src/services/hardwareAdvisor.ts';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';

export interface ModelsRouterDeps {
  store: LocalSqliteBrainStore;
}

export function createModelsRouter(deps: ModelsRouterDeps): Router {
  const router = express.Router();
  const { store } = deps;

  router.get('/models', requireAuth, async (req: Request, res: Response) => {
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
      if (p.configured && p.default_model) {
        onlineModels.push({
          name: p.default_model,
          provider: `${p.name}${p.is_default ? ' · Padrão' : ''}`,
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

    res.json({
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
    });
  });

  router.get('/models/hardware', requireAuth, async (_req: Request, res: Response) => {
    res.json(await buildHardwareAdvisorPayload());
  });

  router.put('/models/hardware', requireAuth, async (req: Request, res: Response) => {
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
      const existingIdx = serverState.hardwareProfiles.findIndex((p) => p.id === id);
      if (existingIdx >= 0) {
        serverState.hardwareProfiles[existingIdx] = normalized;
      } else {
        serverState.hardwareProfiles.push(normalized);
      }
      serverState.activeHardwareProfileId = id;
    } else if (incomingActive && serverState.hardwareProfiles.some((p) => p.id === incomingActive)) {
      serverState.activeHardwareProfileId = incomingActive;
    }

    res.json(await buildHardwareAdvisorPayload());
  });

  router.put('/models/providers', requireAuth, async (req: Request, res: Response) => {
    if (typeof req.body?.ollama_connected === 'boolean') {
      serverState.providerConnectivity.ollama_connected = req.body.ollama_connected;
    }
    if (typeof req.body?.huggingface_connected === 'boolean') {
      serverState.providerConnectivity.huggingface_connected = req.body.huggingface_connected;
    }
    if (typeof req.body?.gemini_connected === 'boolean') {
      serverState.providerConnectivity.gemini_connected = req.body.gemini_connected;
      serverState.hybridConfig.enabled = req.body.gemini_connected;
    }
    if (typeof req.body?.ollama_url === 'string' && req.body.ollama_url.trim()) {
      const active = getActiveHardwareProfile();
      active.ollama_url = req.body.ollama_url.trim();
      serverState.hybridConfig.base_url = active.ollama_url;
    }
    res.json(await buildHardwareAdvisorPayload());
  });

  router.post('/models/recommendations/apply', requireAuth, async (req: Request, res: Response) => {
    const advisor = await buildHardwareAdvisorPayload();
    const targetRole = req.body?.agent_role ? String(req.body.agent_role) : null;
    const applyAll = Boolean(req.body?.apply_all);
    const updatedRoles: string[] = [];

    for (const rec of advisor.recommendations) {
      if (!applyAll && targetRole && rec.agent_role !== targetRole) continue;
      const idx = serverState.agentsList.findIndex((a) => a.role === rec.agent_role);
      if (idx === -1) continue;
      const ag = serverState.agentsList[idx];
      const nextPolicy = rec.execution_mode === 'ONLINE' ? 'online_only' : 'auto_hybrid';
      serverState.agentsList[idx] = {
        ...ag,
        preferred_model: rec.recommended_model,
        routing_policy: nextPolicy,
        version: (ag.version || 1) + 1,
        updated_at: nowIso(),
      };
      recordAgentVersion(
        serverState.agentsList[idx],
        `Consultor de Hardware aplicou ${rec.recommended_model} (${rec.execution_mode})`
      );
      updatedRoles.push(rec.agent_role);
    }

    res.json({ applied_count: updatedRoles.length, agents_updated: updatedRoles });
  });

  router.post('/models/arena', requireAuth, async (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
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
        const externalCred = resolveExternalCredentialForRequest(req, store, ownerUserId, modelId);
        const result = await runHybridInference({
          prompt,
          systemInstruction: 'Você está em um comparativo lado a lado (Modo Arena). Entregue sua melhor resposta clara, precisa e objetiva em português.',
          requestedModel: modelId,
          routingPolicy: 'auto_hybrid',
          ollamaBaseUrl: activeHw.ollama_url,
          ollamaConnected: serverState.providerConnectivity.ollama_connected,
          geminiConnected: serverState.providerConnectivity.gemini_connected,
          enableWebSearch,
          externalProvider: externalCred,
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
        const inferred = inferExternalProviderFromModel(modelId);
        return {
          model_requested: modelId,
          model_used: modelId,
          execution_mode: modelId.startsWith('gemini-') || inferred ? ('ONLINE' as const) : ('LOCAL' as const),
          provider: inferred || (modelId.startsWith('gemini-') ? 'gemini' : 'ollama'),
          latency_ms: 0,
          text: '',
          error: err instanceof Error ? err.message : 'Falha na inferência.',
        };
      }
    };

    const [left, right] = await Promise.all([runSide(modelA), runSide(modelB)]);
    res.json({ left, right });
  });

  router.get('/models/hybrid-config', requireAuth, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const defaultExternal = resolveExternalCredentialForRequest(req, store, ownerUserId);
    res.json({
      ...serverState.hybridConfig,
      provider_name: defaultExternal ? defaultExternal.provider : serverState.hybridConfig.provider_name,
      default_model: defaultExternal ? defaultExternal.model : serverState.hybridConfig.default_model,
      base_url: defaultExternal ? defaultExternal.baseUrl : serverState.hybridConfig.base_url,
      has_api_key: Boolean(defaultExternal) || isGeminiApiConfigured(),
    });
  });

  router.post('/models/hybrid-config', requireAuth, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const providerId = normalizeProviderId(String(req.body?.provider_name || ''));
    const rawKey = String(req.body?.api_key || '').trim();
    const baseUrl = String(req.body?.base_url || '').trim();
    const defaultModel = String(req.body?.default_model || '').trim();

    if (providerId && rawKey) {
      const check = validateProviderBaseUrl(providerId, baseUrl);
      if (!check.valid) {
        res.status(400).json({ detail: check.error || 'Endpoint inválido.' });
        return;
      }
      const meta = EXTERNAL_PROVIDERS[providerId];
      store.upsertProviderVaultKey({
        key_id: `session_${providerId}`,
        owner_user_id: ownerUserId,
        provider: providerId,
        label: meta.name,
        encrypted_api_key: encryptProviderSecret(rawKey),
        masked_key: maskApiKey(rawKey),
        base_url: check.normalizedUrl,
        default_model: defaultModel || meta.defaultModel,
        is_active: req.body?.enabled !== false,
        is_default: req.body?.enabled !== false,
      });
      syncVaultHttpOnlyCookie(req, res, ownerUserId, store);
    }

    serverState.hybridConfig = {
      ...serverState.hybridConfig,
      provider_name: String(req.body?.provider_name || serverState.hybridConfig.provider_name),
      enabled: req.body?.enabled !== false,
      base_url: baseUrl || serverState.hybridConfig.base_url,
      default_model: defaultModel || serverState.hybridConfig.default_model,
      max_budget_usd: Number(req.body?.max_budget_usd ?? serverState.hybridConfig.max_budget_usd),
      has_api_key: Boolean(resolveExternalCredentialForRequest(req, store, ownerUserId)) || isGeminiApiConfigured(),
    };
    res.json(serverState.hybridConfig);
  });

  router.post('/models/hybrid-config/test', requireAuth, async (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const activeHw = getActiveHardwareProfile();
    const providerName = String(req.body?.provider_name || serverState.hybridConfig.provider_name).toLowerCase();

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

    const externalId = normalizeProviderId(providerName);
    if (externalId) {
      const rawKey = String(req.body?.api_key || '').trim();
      const existing = resolveExternalCredentialForRequest(req, store, ownerUserId, undefined, externalId);
      const effectiveKey = rawKey || existing?.apiKey || '';
      const effectiveUrl = String(req.body?.base_url || '').trim() || existing?.baseUrl;
      const probe = await testExternalProviderConnection({
        provider: externalId,
        apiKey: effectiveKey,
        baseUrl: effectiveUrl,
      });
      res.json({
        success: probe.ok,
        latency_ms: probe.latency_ms,
        models_detected: probe.models_detected,
        message: probe.ok ? probe.message : undefined,
        error: probe.ok ? undefined : probe.message,
      });
      return;
    }

    res.json({
      success: isGeminiApiConfigured(),
      latency_ms: 32,
      message: isGeminiApiConfigured()
        ? 'Gemini Online pronto no servidor (credencial protegida no ambiente).'
        : undefined,
      error: isGeminiApiConfigured()
        ? undefined
        : 'GEMINI_API_KEY não encontrada no ambiente do servidor.',
    });
  });

  router.get('/models/huggingface/curated', requireAuth, (_req: Request, res: Response) => {
    if (!serverState.providerConnectivity.huggingface_connected) {
      res.json([]);
      return;
    }
    res.json(getCuratedHuggingFaceForHardware(getActiveHardwareProfile()));
  });

  router.get('/models/huggingface/search', requireAuth, async (req: Request, res: Response) => {
    if (!serverState.providerConnectivity.huggingface_connected) {
      res.json([]);
      return;
    }
    const q = String(req.query.q || '');
    const limit = Number(req.query.limit || 10);
    const result = await searchRealHuggingFace(q, limit, getActiveHardwareProfile());
    res.json(result.items);
  });

  router.post('/models/huggingface/install', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
    const modelTag = String(req.body?.model_tag || '').trim();
    const displayName = String(req.body?.display_name || modelTag).trim();
    if (!modelTag || /[\s\r\n]/.test(modelTag) || modelTag.length > 160) {
      res.status(400).json({ detail: 'Tag de modelo inválida para instalação.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const activeHw = getActiveHardwareProfile();
    const ollamaUrl = (activeHw.ollama_url || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    const probe = serverState.providerConnectivity.ollama_connected
      ? await fetchOllamaLocalModels(ollamaUrl)
      : { reachable: false, latencyMs: 0, models: [] };

    if (!probe.reachable) {
      sendEvent({
        status: 'error',
        message: `Ollama não está acessível em ${ollamaUrl}. Inicie o serviço Ollama na máquina local para baixar ${displayName}.`,
      });
      res.end();
      return;
    }

    sendEvent({ status: 'downloading', percent: 5, message: `Conectando ao Ollama em ${ollamaUrl}...` });

    try {
      const pullRes = await fetch(`${ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelTag, stream: true }),
      });

      if (!pullRes.ok || !pullRes.body) {
        sendEvent({
          status: 'error',
          message: `Ollama recusou o download de ${displayName} (HTTP ${pullRes.status}).`,
        });
        res.end();
        return;
      }

      const reader = pullRes.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const raw of lines) {
          if (!raw.trim()) continue;
          try {
            const parsed = JSON.parse(raw);
            if (parsed.error) {
              sendEvent({ status: 'error', message: String(parsed.error) });
              res.end();
              return;
            }
            if (parsed.total && parsed.completed) {
              sendEvent({
                status: 'downloading',
                total: Number(parsed.total),
                completed: Number(parsed.completed),
              });
            } else if (parsed.status === 'success') {
              sendEvent({ status: 'success', model: modelTag });
              res.end();
              return;
            }
          } catch {
            // ignora linhas parciais
          }
        }
      }

      sendEvent({ status: 'success', model: modelTag });
      res.end();
    } catch (err: any) {
      sendEvent({
        status: 'error',
        message: err?.message || `Falha de comunicação com o Ollama ao baixar ${displayName}.`,
      });
      res.end();
    }
  });

  router.get('/models/agent-recommendations', requireAuth, async (_req: Request, res: Response) => {
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

  // --- SETTINGS: COFRE PROTEGIDO DE CHAVES DE TERCEIROS (HTTP-ONLY COOKIE + SQLITE AES-256-GCM) ---
  router.get('/settings/provider-keys', requireAuth, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    res.json(buildSessionProviderKeysPayload(req, store, ownerUserId));
  });

  router.put('/settings/provider-keys/:provider', requireAuth, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const providerId = normalizeProviderId(req.params.provider);
    if (!providerId) {
      res.status(400).json({ detail: 'Provedor externo não suportado. Use anthropic, openai, deepseek, groq, openrouter, xai ou custom.' });
      return;
    }

    const meta = EXTERNAL_PROVIDERS[providerId];
    const rawKey = String(req.body?.api_key || '').trim();
    const baseUrl = String(req.body?.base_url || '').trim() || meta.defaultBaseUrl;
    const defaultModel = String(req.body?.default_model || '').trim() || meta.defaultModel;
    const isDefault = Boolean(req.body?.is_default);
    const label = String(req.body?.label || meta.name).trim().slice(0, 64) || meta.name;

    const urlCheck = validateProviderBaseUrl(providerId, baseUrl);
    if (!urlCheck.valid) {
      res.status(400).json({ detail: urlCheck.error || 'Endpoint HTTPS inválido.' });
      return;
    }

    const keyId = `session_${providerId}`;
    const existing = store.getEncryptedProviderVaultRecord(ownerUserId, keyId);
    if (!rawKey && !existing) {
      res.status(400).json({ detail: `Informe a chave de API do provedor ${meta.shortLabel}.` });
      return;
    }

    try {
      store.upsertProviderVaultKey({
        key_id: keyId,
        owner_user_id: ownerUserId,
        provider: providerId,
        label,
        encrypted_api_key: rawKey ? encryptProviderSecret(rawKey) : undefined,
        masked_key: rawKey ? maskApiKey(rawKey) : undefined,
        base_url: urlCheck.normalizedUrl,
        default_model: defaultModel,
        is_active: true,
        is_default: isDefault || Boolean(existing?.is_default),
      });
      syncVaultHttpOnlyCookie(req, res, ownerUserId, store);
      res.json(buildSessionProviderKeysPayload(req, store, ownerUserId));
    } catch (err: any) {
      res.status(400).json({ detail: err?.message || 'Não foi possível salvar a chave de API.' });
    }
  });

  router.post('/settings/provider-keys/:provider/test', requireAuth, async (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const providerId = normalizeProviderId(req.params.provider);
    if (!providerId) {
      res.status(400).json({ detail: 'Provedor externo não suportado.' });
      return;
    }

    const rawKey = String(req.body?.api_key || '').trim();
    const existing = resolveExternalCredentialForRequest(req, store, ownerUserId, undefined, providerId);
    const effectiveKey = rawKey || existing?.apiKey || '';
    const effectiveUrl = String(req.body?.base_url || '').trim() || existing?.baseUrl;

    const result = await testExternalProviderConnection({
      provider: providerId,
      apiKey: effectiveKey,
      baseUrl: effectiveUrl,
    });

    const dbRec = store.getEncryptedProviderVaultRecord(ownerUserId, `session_${providerId}`);
    if (dbRec) {
      store.recordProviderVaultTestResult(
        ownerUserId,
        dbRec.key_id,
        result.ok ? 'ok' : 'error',
        result.message,
        result.latency_ms,
        result.status_code
      );
    }

    res.status(result.ok ? 200 : 400).json({
      ...result,
      state: buildSessionProviderKeysPayload(req, store, ownerUserId),
    });
  });

  router.post('/settings/provider-keys/health', requireAuth, async (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const checkedAt = new Date().toISOString();
    const initialPayload = buildSessionProviderKeysPayload(req, store, ownerUserId);
    const configuredExternal = initialPayload.providers.filter((p) => p.configured);

    const externalPromises = configuredExternal.map(async (item) => {
      const cred = resolveExternalCredentialForRequest(req, store, ownerUserId, undefined, item.provider);
      const result = await testExternalProviderConnection({
        provider: item.provider,
        apiKey: cred?.apiKey || '',
        baseUrl: cred?.baseUrl || item.base_url,
        timeoutMs: 6500,
      });

      const dbRec = store.getEncryptedProviderVaultRecord(ownerUserId, `session_${item.provider}`);
      if (dbRec) {
        store.recordProviderVaultTestResult(
          ownerUserId,
          dbRec.key_id,
          result.ok ? 'ok' : 'error',
          result.message,
          result.latency_ms,
          result.status_code
        );
      }

      return {
        provider: item.provider,
        ok: result.ok,
        status_code: result.status_code,
        latency_ms: result.latency_ms,
        endpoint_host: result.endpoint_host,
        models_detected: result.models_detected,
        message: result.message,
        checked_at: new Date().toISOString(),
      };
    });

    const geminiPromise = isGeminiApiConfigured()
      ? testGeminiServerConnection(6500).then((r) => {
          serverState.lastGeminiHealth = r;
          return r;
        })
      : Promise.resolve(null);

    const [geminiHealth, externalSettled] = await Promise.all([
      geminiPromise,
      Promise.allSettled(externalPromises),
    ]);

    const results = externalSettled
      .filter((entry): entry is PromiseFulfilledResult<any> => entry.status === 'fulfilled')
      .map((entry) => entry.value);

    res.json({
      checked_at: checkedAt,
      gemini_health: geminiHealth,
      results,
      state: buildSessionProviderKeysPayload(req, store, ownerUserId),
    });
  });

  router.post('/settings/provider-keys/:provider/default', requireAuth, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const rawProv = String(req.params.provider || '').toLowerCase();
    if (rawProv === 'none' || rawProv === 'gemini') {
      store.clearDefaultProviderVaultKey(ownerUserId);
      syncVaultHttpOnlyCookie(req, res, ownerUserId, store);
      res.json(buildSessionProviderKeysPayload(req, store, ownerUserId));
      return;
    }

    const providerId = normalizeProviderId(rawProv);
    if (!providerId) {
      res.status(400).json({ detail: 'Provedor inválido.' });
      return;
    }

    const updated = store.setDefaultProviderVaultKey(ownerUserId, providerId);
    if (!updated) {
      res.status(404).json({ detail: 'Salve uma chave de API para este provedor antes de ativá-lo como padrão.' });
      return;
    }
    syncVaultHttpOnlyCookie(req, res, ownerUserId, store);
    res.json(buildSessionProviderKeysPayload(req, store, ownerUserId));
  });

  router.delete('/settings/provider-keys/:provider', requireAuth, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const providerId = normalizeProviderId(req.params.provider);
    if (!providerId) {
      res.status(400).json({ detail: 'Provedor inválido.' });
      return;
    }
    store.deleteProviderVaultKey(ownerUserId, providerId);
    syncVaultHttpOnlyCookie(req, res, ownerUserId, store);
    res.json(buildSessionProviderKeysPayload(req, store, ownerUserId));
  });

  // --- KEYVAULT COMPATÍVEL COM CENTRAL DE MODELOS ---
  router.get('/models/vault', requireAuth, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const items = store.listProviderVaultKeys(ownerUserId).map((k) => ({
      key_id: k.key_id,
      label: k.label,
      provider: k.provider,
      provider_name: EXTERNAL_PROVIDERS[k.provider as ExternalProviderId]?.name || k.provider,
      masked_key: k.masked_key,
      base_url: k.base_url,
      default_model: k.default_model,
      preferred_model: k.default_model,
      is_active: k.is_active,
      is_default: k.is_default,
      owner_user_id: k.owner_user_id,
      last_tested_at: k.last_tested_at,
      last_test_status: k.last_test_status,
      last_test_message: k.last_test_message,
    }));
    res.json({ keys: items });
  });

  router.post('/models/vault', requireAuth, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const providerId = normalizeProviderId(String(req.body?.provider || ''));
    if (!providerId) {
      res.status(400).json({
        detail: 'Provedor inválido. Use anthropic, openai, deepseek, groq, openrouter, xai ou custom (Gemini é gerenciado no servidor).',
      });
      return;
    }

    const rawKey = String(req.body?.api_key || '').trim();
    if (!rawKey) {
      res.status(400).json({ detail: 'Informe uma chave de API válida.' });
      return;
    }

    const meta = EXTERNAL_PROVIDERS[providerId];
    const urlCheck = validateProviderBaseUrl(providerId, String(req.body?.base_url || ''));
    if (!urlCheck.valid) {
      res.status(400).json({ detail: urlCheck.error || 'Endpoint HTTPS inválido.' });
      return;
    }

    const keyId = String(req.body?.key_id || `session_${providerId}`)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .slice(0, 48);

    try {
      const saved = store.upsertProviderVaultKey({
        key_id: keyId || `session_${providerId}`,
        owner_user_id: ownerUserId,
        provider: providerId,
        label: String(req.body?.label || meta.name).trim().slice(0, 64),
        encrypted_api_key: encryptProviderSecret(rawKey),
        masked_key: maskApiKey(rawKey),
        base_url: urlCheck.normalizedUrl,
        default_model: String(req.body?.default_model || meta.defaultModel).trim(),
        is_active: req.body?.is_active !== false,
        is_default: Boolean(req.body?.is_default),
      });
      syncVaultHttpOnlyCookie(req, res, ownerUserId, store);
      res.status(201).json({
        ...saved,
        provider_name: meta.name,
        preferred_model: saved.default_model,
      });
    } catch (err: any) {
      res.status(400).json({ detail: err?.message || 'Erro ao salvar credencial no cofre.' });
    }
  });

  router.delete('/models/vault/:keyId', requireAuth, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const deleted = store.deleteProviderVaultKey(ownerUserId, req.params.keyId);
    syncVaultHttpOnlyCookie(req, res, ownerUserId, store);
    res.json({ deleted });
  });

  router.post('/models/vault/:keyId/default', requireAuth, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const updated = store.setDefaultProviderVaultKey(ownerUserId, req.params.keyId);
    if (!updated) {
      res.status(404).json({ detail: 'Credencial não encontrada neste cofre de sessão.' });
      return;
    }
    syncVaultHttpOnlyCookie(req, res, ownerUserId, store);
    res.json({ status: 'updated' });
  });

  router.post('/models/vault/:keyId/test', requireAuth, async (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const record = store.getEncryptedProviderVaultRecord(ownerUserId, req.params.keyId);
    if (!record) {
      res.status(404).json({ status: 'error', detail: 'Credencial não encontrada no cofre da sessão.' });
      return;
    }
    const providerId = normalizeProviderId(record.provider);
    if (!providerId) {
      res.status(400).json({ status: 'error', detail: 'Provedor não suportado para verificação.' });
      return;
    }

    let plainKey = '';
    try {
      plainKey = decryptProviderSecret(record.encrypted_api_key);
    } catch {
      res.status(400).json({
        status: 'error',
        detail: 'A chave criptografada precisará ser reinserida após rotação da chave mestra.',
      });
      return;
    }

    const result = await testExternalProviderConnection({
      provider: providerId,
      apiKey: plainKey,
      baseUrl: record.base_url,
    });
    store.recordProviderVaultTestResult(
      ownerUserId,
      record.key_id,
      result.ok ? 'ok' : 'error',
      result.message
    );

    if (!result.ok) {
      res.status(400).json({ status: 'error', detail: result.message, latency_ms: result.latency_ms });
      return;
    }
    res.json({
      status: 'ok',
      message: result.message,
      latency_ms: result.latency_ms,
      models_detected: result.models_detected,
    });
  });

  // Provisiona o modelo local incorporado Calmon IA no Ollama do usuário
  router.post('/models/calmon-ia/provision', requireAuth, async (req: Request, res: Response) => {
    const activeHw = getActiveHardwareProfile();
    const ollamaUrl = (String(req.body?.ollama_url || activeHw.ollama_url || 'http://127.0.0.1:11434')).replace(/\/+$/, '');
    const baseModel = String(req.body?.base_model || 'llama3.2:3b').trim() || 'llama3.2:3b';

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180_000);
      const response = await fetch(`${ollamaUrl}/api/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'calmon-ia',
          from: baseModel,
          stream: false,
          parameters: {
            temperature: 0.6,
            top_p: 0.9,
            num_ctx: 4096,
            num_predict: 768,
          },
          system:
            'Você é a Calmon IA, a inteligência artificial local oficial do Calmon Studio. Responda em Português do Brasil claro, direto, bem estruturado e técnico quando necessário. Você opera 100% localmente na máquina do usuário com privacidade total.',
        }),
      });
      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        res.status(502).json({
          status: 'error',
          detail: `Ollama retornou HTTP ${response.status} ao criar calmon-ia${errText ? `: ${errText.slice(0, 180)}` : '.'}`,
        });
        return;
      }

      res.json({
        status: 'ok',
        model: 'calmon-ia:latest',
        base_model: baseModel,
        message: 'Modelo local Calmon IA provisionado com sucesso no Ollama.',
      });
    } catch (err) {
      res.status(503).json({
        status: 'error',
        detail: `Não foi possível conectar ao Ollama em ${ollamaUrl} (${err instanceof Error ? err.message : String(err)}).`,
      });
    }
  });

  return router;
}
