import crypto from 'node:crypto';
import express, { Request, Response, Router } from 'express';
import {
  serverState,
  requireAuth,
  getOwnerUserId,
  recordAgentVersion,
  getActiveHardwareProfile,
  resolveExternalCredentialForRequest,
  persistStateNamespace,
  nowIso,
  AgentServerRecord,
} from '../serverState.ts';
import { isGeminiModelId, runHybridInference } from '../hybridAiEngine.ts';
import { inferExternalProviderFromModel } from '../providerEngine.ts';
import { buildAgentRuntimeContext, type AgentRouteEntry } from '../agentRuntime.ts';
import { searchBrainMemories } from '../../src/services/secondBrain.ts';
import { canAgentAccessResource } from '../../src/services/integrationsCatalog.ts';
import {
  evaluateAgentCoreReadiness,
  isValidAgentRoleSlug,
  normalizeAgentRoleSlug,
} from '../../src/services/agentCoreEngine.ts';
import { getModulePackById } from '../../src/services/modulePackEngine.ts';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';

export interface AgentsRouterDeps {
  store: LocalSqliteBrainStore;
}

export function createAgentsRouter(deps: AgentsRouterDeps): Router {
  const router = express.Router();
  const { store } = deps;

  const persistAgentsAndSkills = () => {
    persistStateNamespace(store, 'agents_list', serverState.agentsList);
    persistStateNamespace(store, 'skills_list', serverState.skillsList);
    persistStateNamespace(store, 'agent_versions', Array.from(serverState.agentVersions.entries()));
  };

  const buildContextForAgentRequest = (
    req: Request,
    agent: AgentServerRecord,
    prompt: string,
    opts?: { sessionId?: string; projectId?: string; mode?: string; explicitModel?: string }
  ) => {
    const ownerUserId = getOwnerUserId(req);
    const agentCore = store.getAgentCore(ownerUserId, agent.role, {
      name: agent.name,
      proper_name: agent.proper_name,
      handle: agent.handle,
      mission: agent.mission,
      preferred_model: agent.preferred_model,
      pack_id: agent.template_id?.startsWith('pack:') ? agent.template_id.slice(5) : null,
    });
    const agentRoute =
      (serverState.agentRoutes.find((r) => String(r.agent_role || '') === agent.role) as AgentRouteEntry | undefined) ||
      null;
    const historyMessages = opts?.sessionId
      ? store.listAgentHistoryMessages(agent.role, opts.sessionId)
      : [];
    const workspaceProject = opts?.projectId
      ? serverState.workspaceProjects.find((p) => p.id === opts.projectId) || null
      : null;
    const projectMemories = opts?.projectId ? serverState.projectMemories.get(opts.projectId) || [] : [];
    const relevantBrain = searchBrainMemories(serverState.brainMemories, prompt, {
      username: ownerUserId,
      limit: 3,
    });
    const allowedContextPacks = serverState.contextSets.filter((cs) =>
      canAgentAccessResource(cs.allowed_agents, agent.role)
    );

    const ctx = buildAgentRuntimeContext({
      agent,
      agentCore,
      skillsList: serverState.skillsList,
      agentMemories: serverState.agentMemories.get(agent.role) || [],
      brainMemories: relevantBrain,
      contextSets: allowedContextPacks,
      workspaceProject,
      projectMemories,
      historyMessages,
      agentRoute,
      explicitChatOverride: opts?.explicitModel,
      systemDefaultModel: serverState.hybridConfig.default_model,
      executionModeHint: opts?.mode,
    });
    const externalProvider = resolveExternalCredentialForRequest(
      req,
      store,
      ownerUserId,
      ctx.resolvedModel.requestedModel
    );
    return { ctx, externalProvider, ownerUserId };
  };

  const hydrateInstalledPackResourcesForUser = (ownerUserId: string) => {
    const installed = store.listInstalledPacks(ownerUserId);
    const customPacks = store.listCustomPacks();
    for (const rec of installed) {
      const def = getModulePackById(rec.pack_id, customPacks);
      if (def) {
        for (const spec of def.agents) {
          const existing = serverState.agentsList.find((a) => a.role === spec.role);
          if (!existing) {
            const created: AgentServerRecord = {
              role: spec.role,
              name: spec.name,
              proper_name: spec.proper_name,
              handle: spec.handle,
              category: spec.category,
              mission: spec.mission,
              preferred_model: spec.preferred_model,
              routing_policy: 'auto_hybrid',
              autonomy_level: spec.autonomy_level,
              is_read_only: spec.autonomy_level === 'read_only',
              strict_focus: true,
              strict_topic: spec.name,
              delegation_targets: [],
              allowed_tools: [...spec.allowed_tools],
              system_prompt: `Você é ${spec.proper_name} (${spec.name}), especialista do pacote ${def.name}. Missão: ${spec.mission}`,
              mascot: {
                id: 'maestro_slime',
                color: spec.mascot_color || '#f97316',
                accessory: 'none',
                mood: 'idle',
              },
              is_custom: true,
              template_id: `pack:${def.id}`,
              installed_skills: [...spec.installed_skills],
              version: 1,
              updated_at: nowIso(),
            };
            serverState.agentsList.unshift(created);
            recordAgentVersion(created, `Instalado via pacote ${def.name}`);
          }
          store.getAgentCore(ownerUserId, spec.role, {
            name: spec.name,
            proper_name: spec.proper_name,
            handle: spec.handle,
            mission: spec.mission,
            preferred_model: spec.preferred_model,
            pack_id: def.id,
          });
        }
      }
    }
  };

  // --- AGENTS (CRUD + INDIVIDUAL CORES + VERSIONS + ROLLBACK) ---
  router.get('/agents', requireAuth, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    hydrateInstalledPackResourcesForUser(ownerUserId);
    res.json(serverState.agentsList);
  });

  router.get('/agents/cores', requireAuth, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    hydrateInstalledPackResourcesForUser(ownerUserId);
    const cores = serverState.agentsList.map((agent) => {
      const core = store.getAgentCore(ownerUserId, agent.role, {
        name: agent.name,
        proper_name: agent.proper_name,
        handle: agent.handle,
        mission: agent.mission,
        preferred_model: agent.preferred_model,
        pack_id: agent.template_id?.startsWith('pack:') ? agent.template_id.slice(5) : null,
      });
      return {
        core,
        readiness: evaluateAgentCoreReadiness(core),
      };
    });
    res.json({ cores });
  });

  router.get('/agents/:role/core', requireAuth, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const normalizedRole = normalizeAgentRoleSlug(String(req.params.role || ''));
    if (!isValidAgentRoleSlug(normalizedRole)) {
      res.status(400).json({ detail: 'Identificador de agente inválido.' });
      return;
    }
    hydrateInstalledPackResourcesForUser(ownerUserId);
    const agent = serverState.agentsList.find((a) => a.role === normalizedRole);
    const core = store.getAgentCore(ownerUserId, normalizedRole, {
      name: agent?.name,
      proper_name: agent?.proper_name,
      handle: agent?.handle,
      mission: agent?.mission,
      preferred_model: agent?.preferred_model,
      pack_id: agent?.template_id?.startsWith('pack:') ? agent.template_id.slice(5) : null,
    });
    res.json({
      core,
      readiness: evaluateAgentCoreReadiness(core),
    });
  });

  router.put('/agents/:role/core', requireAuth, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const normalizedRole = normalizeAgentRoleSlug(String(req.params.role || ''));
    if (!isValidAgentRoleSlug(normalizedRole)) {
      res.status(400).json({ detail: 'Identificador de agente inválido.' });
      return;
    }
    hydrateInstalledPackResourcesForUser(ownerUserId);
    const agent = serverState.agentsList.find((a) => a.role === normalizedRole);
    const updatedCore = store.upsertAgentCore(
      ownerUserId,
      normalizedRole,
      req.body || {},
      {
        name: agent?.name,
        proper_name: agent?.proper_name,
        handle: agent?.handle,
        mission: agent?.mission,
        preferred_model: agent?.preferred_model,
        pack_id: agent?.template_id?.startsWith('pack:') ? agent.template_id.slice(5) : null,
      }
    );

    // Sincroniza modelo principal no cartão do agente quando existir na lista ativa
    // e remove rota legada conflitante para que a alteração no núcleo entre em vigor imediatamente.
    if (req.body?.primary_model || req.body?.primary_provider) {
      serverState.agentRoutes = serverState.agentRoutes.filter((r) => r.agent_role !== normalizedRole);
      persistStateNamespace(store, 'agent_routes', serverState.agentRoutes);
    }
    if (agent && updatedCore.primary_model) {
      agent.preferred_model = updatedCore.primary_model;
      agent.updated_at = nowIso();
      persistAgentsAndSkills();
    }

    res.json({
      core: updatedCore,
      readiness: evaluateAgentCoreReadiness(updatedCore),
    });
  });

  router.post('/agents', requireAuth, (req: Request, res: Response) => {
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
    const role = serverState.agentsList.some((a) => a.role === rawSlug)
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
      template_id: req.body?.template_id ? String(req.body.template_id) : undefined,
      installed_skills: Array.isArray(req.body?.installed_skills)
        ? req.body.installed_skills.map(String)
        : undefined,
      version: 1,
      updated_at: nowIso(),
    };
    serverState.agentsList.unshift(created);

    if (Array.isArray(created.installed_skills) && created.installed_skills.length > 0) {
      created.installed_skills.forEach((skillName, idx) => {
        const cleanName = String(skillName).trim();
        if (!cleanName) return;
        const existing = serverState.skillsList.find((s) => s.name.toLowerCase() === cleanName.toLowerCase());
        if (existing) {
          if (!existing.assigned_agents.includes(created.role)) {
            existing.assigned_agents.push(created.role);
            existing.updated_at = nowIso();
          }
        } else {
          const slug = cleanName
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
          serverState.skillsList.unshift({
            id: `skill_${slug || Date.now()}_${idx}`,
            name: cleanName,
            version: '1.0.0',
            origin: 'agent_template',
            license: 'MIT',
            description: `Habilidade ativa instalada junto com ${created.proper_name || created.name}.`,
            domain: created.category || 'general',
            allowed_tools: created.allowed_tools.length > 0 ? [created.allowed_tools[idx] || created.allowed_tools[0]] : ['read_file'],
            required_permissions: ['skills:read'],
            assigned_agents: [created.role],
            content_hash: `sha256:${crypto.randomBytes(6).toString('hex')}`,
            is_approved: true,
            is_revoked: false,
            instructions: `Habilidade "${cleanName}" vinculada ao especialista ${created.proper_name || created.name}.`,
            created_at: nowIso(),
            updated_at: nowIso(),
          });
        }
      });
    }
    recordAgentVersion(created, String(req.body?.change_summary || 'Criação do especialista'));
    persistAgentsAndSkills();
    res.status(201).json(created);
  });

  router.get('/agents/:role', requireAuth, (req: Request, res: Response) => {
    const agent = serverState.agentsList.find((a) => a.role === req.params.role);
    if (!agent) {
      res.status(404).json({ detail: 'Especialista não encontrado.' });
      return;
    }
    res.json(agent);
  });

  router.put('/agents/:role/config', requireAuth, (req: Request, res: Response) => {
    const idx = serverState.agentsList.findIndex((a) => a.role === req.params.role);
    if (idx === -1) {
      res.status(404).json({ detail: 'Especialista não encontrado.' });
      return;
    }
    const prev = serverState.agentsList[idx];
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
    serverState.agentsList[idx] = updated;
    if (req.body?.preferred_model || req.body?.routing_policy) {
      serverState.agentRoutes = serverState.agentRoutes.filter((r) => r.agent_role !== updated.role);
      persistStateNamespace(store, 'agent_routes', serverState.agentRoutes);
    }
    if (req.body?.preferred_model) {
      const ownerUserId = getOwnerUserId(req);
      store.upsertAgentCore(ownerUserId, updated.role, { primary_model: String(req.body.preferred_model) }, {
        name: updated.name,
        proper_name: updated.proper_name,
        handle: updated.handle,
        mission: updated.mission,
        preferred_model: updated.preferred_model,
      });
    }
    recordAgentVersion(updated, summary);
    persistAgentsAndSkills();
    res.json(updated);
  });

  router.put('/agents/:role/skills', requireAuth, (req: Request, res: Response) => {
    const idx = serverState.agentsList.findIndex((a) => a.role === req.params.role);
    if (idx === -1) {
      res.status(404).json({ detail: 'Especialista não encontrado.' });
      return;
    }
    const agent = serverState.agentsList[idx];
    const selectedIds = new Set(
      Array.isArray(req.body?.skill_ids) ? req.body.skill_ids.map(String) : []
    );

    const attachedNames: string[] = [];
    const attachedTools = new Set<string>(agent.allowed_tools || []);

    for (const sk of serverState.skillsList) {
      const hasRole = sk.assigned_agents.includes(agent.role);
      const shouldHave = selectedIds.has(sk.id);
      if (shouldHave) {
        if (!hasRole) {
          sk.assigned_agents.push(agent.role);
          sk.updated_at = nowIso();
        }
        attachedNames.push(sk.name);
        (sk.allowed_tools || []).forEach((t: string) => attachedTools.add(t));
      } else if (hasRole) {
        sk.assigned_agents = sk.assigned_agents.filter((r: string) => r !== agent.role);
        sk.updated_at = nowIso();
      }
    }

    const updated: AgentServerRecord = {
      ...agent,
      installed_skills: attachedNames,
      allowed_tools: Array.from(attachedTools),
      version: (agent.version || 1) + 1,
      updated_at: nowIso(),
    };
    serverState.agentsList[idx] = updated;
    recordAgentVersion(updated, `Habilidades atualizadas (${attachedNames.length} vinculadas)`);
    persistAgentsAndSkills();
    res.json({ agent: updated, attached_skill_ids: Array.from(selectedIds) });
  });

  router.delete('/agents/:role', requireAuth, (req: Request, res: Response) => {
    const target = serverState.agentsList.find((a) => a.role === req.params.role);
    if (!target) {
      res.status(404).json({ detail: 'Especialista não encontrado.' });
      return;
    }
    if (target.role === 'jarvis_master') {
      res.status(400).json({
        detail: 'O Maestro Orquestrador principal não pode ser desinstalado, pois coordena o hub.',
      });
      return;
    }
    serverState.agentsList = serverState.agentsList.filter((a) => a.role !== req.params.role);
    serverState.agentVersions.delete(req.params.role);
    for (const sk of serverState.skillsList) {
      if (sk.assigned_agents.includes(target.role)) {
        sk.assigned_agents = sk.assigned_agents.filter((r: string) => r !== target.role);
        sk.updated_at = nowIso();
      }
    }
    persistAgentsAndSkills();
    res.json({ deleted: true, role: target.role, name: target.proper_name || target.name });
  });

  router.get('/agents/:role/versions', requireAuth, (req: Request, res: Response) => {
    res.json(serverState.agentVersions.get(req.params.role) || []);
  });

  router.post('/agents/:role/rollback', requireAuth, (req: Request, res: Response) => {
    const idx = serverState.agentsList.findIndex((a) => a.role === req.params.role);
    if (idx === -1) {
      res.status(404).json({ detail: 'Especialista não encontrado.' });
      return;
    }
    const targetVersion = Number(req.body?.version);
    const history = serverState.agentVersions.get(req.params.role) || [];
    const match = history.find((item) => item.version === targetVersion);
    if (!match) {
      res.status(404).json({ detail: 'Versão solicitada não encontrada no histórico.' });
      return;
    }
    const prev = serverState.agentsList[idx];
    const restored: AgentServerRecord = {
      ...prev,
      ...(match.snapshot as any),
      role: prev.role,
      version: (prev.version || 1) + 1,
      updated_at: nowIso(),
    };
    serverState.agentsList[idx] = restored;
    recordAgentVersion(restored, `Rollback para v${targetVersion}`);
    persistAgentsAndSkills();
    res.json(restored);
  });

  router.get('/agent-routes', requireAuth, (_req: Request, res: Response) => res.json({ routes: serverState.agentRoutes }));
  router.put('/agent-routes/:role', requireAuth, (req: Request, res: Response) => {
    const role = req.params.role;
    const targetModel = String(req.body?.model || serverState.hybridConfig.default_model).trim();
    const detectedProvider =
      inferExternalProviderFromModel(targetModel) || (isGeminiModelId(targetModel) ? 'gemini' : 'ollama');
    const entry = {
      agent_role: role,
      key_id: String(req.body?.key_id || (detectedProvider === 'gemini' ? 'gemini-server-default' : 'local-ollama-default')),
      model: targetModel,
      key_label: 'Roteador Híbrido',
      provider: detectedProvider,
      key_available: true,
      updated_at: nowIso(),
    };
    serverState.agentRoutes = [...serverState.agentRoutes.filter((r) => r.agent_role !== role), entry];
    persistStateNamespace(store, 'agent_routes', serverState.agentRoutes);
    res.json(entry);
  });
  router.delete('/agent-routes/:role', requireAuth, (req: Request, res: Response) => {
    serverState.agentRoutes = serverState.agentRoutes.filter((r) => r.agent_role !== req.params.role);
    persistStateNamespace(store, 'agent_routes', serverState.agentRoutes);
    res.json({ deleted: true });
  });

  router.get('/agents/:role/memories', requireAuth, (req: Request, res: Response) => {
    res.json(serverState.agentMemories.get(req.params.role) || []);
  });
  router.post('/agents/:role/memories', requireAuth, (req: Request, res: Response) => {
    const list = serverState.agentMemories.get(req.params.role) || [];
    const item = {
      id: `mem_${Date.now()}`,
      agent_role: req.params.role,
      ...req.body,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    list.unshift(item);
    serverState.agentMemories.set(req.params.role, list);
    persistStateNamespace(store, 'agent_memories', Array.from(serverState.agentMemories.entries()));
    res.status(201).json(item);
  });
  router.delete('/agents/:role/memories/:memoryId', requireAuth, (req: Request, res: Response) => {
    const list = (serverState.agentMemories.get(req.params.role) || []).filter((m) => m.id !== req.params.memoryId);
    serverState.agentMemories.set(req.params.role, list);
    persistStateNamespace(store, 'agent_memories', Array.from(serverState.agentMemories.entries()));
    res.json({ deleted: true });
  });

  router.post('/agents/:role/playground', requireAuth, async (req: Request, res: Response) => {
    const agent = serverState.agentsList.find((a) => a.role === req.params.role) || serverState.agentsList[0];
    const prompt = String(req.body?.prompt || '').trim();
    const projectId = req.body?.project_id ? String(req.body.project_id) : undefined;
    const sessionId = req.body?.session_id ? String(req.body.session_id) : undefined;
    const explicitModel = req.body?.model ? String(req.body.model) : undefined;
    const activeHw = getActiveHardwareProfile();
    const { ctx, externalProvider } = buildContextForAgentRequest(req, agent, prompt, {
      sessionId,
      projectId,
      explicitModel,
    });
    try {
      const result = await runHybridInference({
        prompt,
        systemInstruction: ctx.systemInstruction,
        history: ctx.history,
        requestedModel: ctx.resolvedModel.requestedModel,
        fallbackModel: ctx.resolvedModel.fallbackModel,
        routingPolicy: agent.routing_policy,
        ollamaBaseUrl: activeHw.ollama_url,
        ollamaConnected: serverState.providerConnectivity.ollama_connected,
        geminiConnected: serverState.providerConnectivity.gemini_connected,
        enableWebSearch: agent.role === 'research_analyst',
        agentName: agent.name,
        agentProperName: agent.proper_name,
        strictFocus: agent.strict_focus,
        strictTopic: agent.strict_topic,
        externalProvider,
      });
      res.json({
        agent_role: agent.role,
        agent_name: `${agent.proper_name} · ${agent.name}`,
        response: result.text,
        requested_model: result.requestedModel,
        model_used: result.modelUsed,
        fallback_occurred: result.fallbackOccurred,
        routing_note: result.routingNote,
        skills_used: ctx.skillsUsed,
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

  router.post('/agents/:role/task', requireAuth, async (req: Request, res: Response) => {
    const agent = serverState.agentsList.find((a) => a.role === req.params.role) || serverState.agentsList[0];
    const prompt = String(req.body?.prompt || '').trim();
    const sessionId = String(req.body?.session_id || `sess_${Date.now()}`);
    const projectId = req.body?.project_id ? String(req.body.project_id) : undefined;
    const mode = req.body?.mode ? String(req.body.mode) : undefined;
    const explicitModel = req.body?.model ? String(req.body.model) : undefined;
    const activeHw = getActiveHardwareProfile();
    const { ctx, externalProvider } = buildContextForAgentRequest(req, agent, prompt, {
      sessionId,
      projectId,
      mode,
      explicitModel,
    });
    try {
      const result = await runHybridInference({
        prompt,
        systemInstruction: ctx.systemInstruction,
        history: ctx.history,
        requestedModel: ctx.resolvedModel.requestedModel,
        fallbackModel: ctx.resolvedModel.fallbackModel,
        routingPolicy: agent.routing_policy,
        ollamaBaseUrl: activeHw.ollama_url,
        ollamaConnected: serverState.providerConnectivity.ollama_connected,
        geminiConnected: serverState.providerConnectivity.gemini_connected,
        enableWebSearch: agent.role === 'research_analyst',
        agentName: agent.name,
        agentProperName: agent.proper_name,
        strictFocus: agent.strict_focus,
        strictTopic: agent.strict_topic,
        externalProvider,
      });
      store.appendAgentHistoryMessage(agent.role, sessionId, 'user', prompt);
      store.appendAgentHistoryMessage(agent.role, sessionId, 'assistant', result.text);
      const item = {
        task_id: `tsk_${Date.now()}`,
        session_id: sessionId,
        user_prompt: prompt,
        selected_agents: [agent.role],
        status: 'completed',
        is_completed: true,
        final_summary: result.text,
        execution_mode: result.executionMode,
        requested_model: result.requestedModel,
        model_used: result.modelUsed,
        fallback_occurred: result.fallbackOccurred,
        routing_note: result.routingNote,
        skills_used: ctx.skillsUsed,
        latency_ms: result.latencyMs,
        created_at: nowIso(),
      };
      serverState.tasksList.unshift(item);
      store.upsertTaskRecord(item);
      res.json(item);
    } catch (err: any) {
      res.status(502).json({ detail: err instanceof Error ? err.message : 'Erro na tarefa do especialista.' });
    }
  });

  router.post('/agents/:role/stream', requireAuth, async (req: Request, res: Response) => {
    const agent = serverState.agentsList.find((a) => a.role === req.params.role) || serverState.agentsList[0];
    const prompt = String(req.body?.prompt || '').trim();
    const sessionId = String(req.body?.session_id || 'default').trim();
    const projectId = req.body?.project_id ? String(req.body.project_id) : undefined;
    const mode = req.body?.mode ? String(req.body.mode) : undefined;
    const explicitModel = req.body?.model ? String(req.body.model) : undefined;
    if (!prompt) {
      res.status(400).json({ detail: 'Informe um comando ou pergunta para o especialista.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (payload: Record<string, unknown>) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    };

    const { ctx, externalProvider } = buildContextForAgentRequest(req, agent, prompt, {
      sessionId,
      projectId,
      mode,
      explicitModel,
    });

    sendEvent({
      type: 'start',
      agent_role: agent.role,
      agent_name: agent.proper_name || agent.name,
      session_id: sessionId,
      requested_model: ctx.resolvedModel.requestedModel,
      skills_used: ctx.skillsUsed,
    });
    sendEvent({
      type: 'thinking',
      iteration: 1,
      message: `${agent.proper_name || agent.name} analisando em ${ctx.resolvedModel.requestedModel}${ctx.skillsUsed.length > 0 ? ` com ${ctx.skillsUsed.length} habilidade(s)` : ''}...`,
    });

    const activeHw = getActiveHardwareProfile();
    try {
      let accumulated = '';
      const result = await runHybridInference({
        prompt,
        systemInstruction: ctx.systemInstruction,
        history: ctx.history,
        requestedModel: ctx.resolvedModel.requestedModel,
        fallbackModel: ctx.resolvedModel.fallbackModel,
        routingPolicy: agent.routing_policy,
        ollamaBaseUrl: activeHw.ollama_url,
        ollamaConnected: serverState.providerConnectivity.ollama_connected,
        geminiConnected: serverState.providerConnectivity.gemini_connected,
        enableWebSearch: agent.role === 'research_analyst',
        agentName: agent.name,
        agentProperName: agent.proper_name,
        strictFocus: agent.strict_focus,
        strictTopic: agent.strict_topic,
        externalProvider,
        onToken: (chunk: string) => {
          if (!chunk) return;
          accumulated += chunk;
          sendEvent({
            type: 'assistant',
            content: accumulated,
            chunk,
          });
        },
      });

      store.appendAgentHistoryMessage(agent.role, sessionId, 'user', prompt);
      store.appendAgentHistoryMessage(agent.role, sessionId, 'assistant', result.text);
      const taskItem = {
        task_id: `tsk_${Date.now()}`,
        session_id: sessionId,
        user_prompt: prompt,
        selected_agents: [agent.role],
        status: 'completed',
        is_completed: true,
        final_summary: result.text,
        execution_mode: result.executionMode,
        requested_model: result.requestedModel,
        model_used: result.modelUsed,
        fallback_occurred: result.fallbackOccurred,
        routing_note: result.routingNote,
        skills_used: ctx.skillsUsed,
        latency_ms: result.latencyMs,
        created_at: nowIso(),
      };
      serverState.tasksList.unshift(taskItem);
      store.upsertTaskRecord(taskItem);

      sendEvent({
        type: 'assistant',
        content: result.text,
        requested_model: result.requestedModel,
        model_used: result.modelUsed,
        fallback_occurred: result.fallbackOccurred,
        routing_note: result.routingNote,
        skills_used: ctx.skillsUsed,
        execution_mode: result.executionMode,
        latency_ms: result.latencyMs,
      });
      sendEvent({
        type: 'final',
        summary: result.text,
        model: result.modelUsed,
        model_used: result.modelUsed,
        requested_model: result.requestedModel,
        fallback_occurred: result.fallbackOccurred,
        routing_note: result.routingNote,
        skills_used: ctx.skillsUsed,
        execution_mode: result.executionMode,
        latency_ms: result.latencyMs,
        task: taskItem,
        agent_role: agent.role,
        session_id: sessionId,
      });
      res.end();
    } catch (err: any) {
      sendEvent({
        type: 'error',
        error: err instanceof Error ? err.message : 'Erro ao transmitir execução do especialista.',
      });
      res.end();
    }
  });

  router.get('/agents/:role/history', requireAuth, (req: Request, res: Response) => {
    const sessionId = String(req.query.session_id || 'default');
    const messages = store.listAgentHistoryMessages(req.params.role, sessionId);
    res.json({ agent_role: req.params.role, session_id: sessionId, messages });
  });

  router.get('/tools', requireAuth, (_req: Request, res: Response) => {
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

  return router;
}
