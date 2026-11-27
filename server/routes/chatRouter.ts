import crypto from 'node:crypto';
import express, { Request, Response, Router } from 'express';
import {
  serverState,
  requireAuth,
  getActiveHardwareProfile,
  detectInvokedAgent,
  resolveExternalCredentialForRequest,
  nowIso,
  broadcastRealtimeEvent,
  UserAccount,
  userProfiles,
  persistStateNamespace,
} from '../serverState.ts';
import { runHybridInference } from '../hybridAiEngine.ts';
import {
  buildAgentRuntimeContext,
  type AgentRouteEntry,
} from '../agentRuntime.ts';
import { planMultiAgentExecution } from '../../src/services/multiOrchestrator.ts';
import {
  searchBrainMemories,
  distillConversationToMemory,
  BrainMemoryItem,
} from '../../src/services/secondBrain.ts';
import { canAgentAccessResource } from '../../src/services/integrationsCatalog.ts';
import {
  generateStructuredArtifact,
  StructuredArtifactPayload,
} from '../artifactEngine.ts';
import {
  resolveNaturalChatMedia,
  type ChatMediaAssetPayload,
} from '../services/chatMediaService.ts';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import { serverRateLimit, RATE_LIMITS, getClientIp } from '../rateLimiter.ts';
import { DurableRunEngine } from '../durableRunEngine.ts';
import { createHubInfraRegistry, type HubInfraRegistry } from '../infra/infraRegistry.ts';
import { scheduleHermesDistill } from '../hermesDaemon.ts';
import {
  computeRunObservabilityStats,
  executeAutonomousToolLoop,
} from '../agentToolLoop.ts';

export interface ChatRouterDeps {
  store: LocalSqliteBrainStore;
  infra?: HubInfraRegistry;
}

export function createChatRouter(deps: ChatRouterDeps): Router {
  const router = express.Router();
  const { store } = deps;
  const infra = deps.infra || createHubInfraRegistry(store);
  const storageAdapter = infra.storageAdapter;
  const durableRuns = new DurableRunEngine({
    store,
    storage: storageAdapter,
    emitter: {
      emit: (eventType, payload) => broadcastRealtimeEvent(eventType, payload),
    },
  });

  const findAgentRoute = (role: string): AgentRouteEntry | null =>
    (serverState.agentRoutes.find((r) => String(r.agent_role || '') === role) as AgentRouteEntry | undefined) || null;

  const findWorkspaceProject = (projectId?: string) => {
    if (!projectId) return null;
    return serverState.workspaceProjects.find((p) => p.id === projectId) || null;
  };

  const persistChatTurnRelational = (
    session: {
      session_id: string;
      title: string;
      first_intent?: string;
      last_activity: string;
    },
    userContent: string,
    assistantContent: string,
    agentRole?: string
  ) => {
    store.upsertChatSessionRecord({
      id: session.session_id,
      title: session.title,
      mode: session.first_intent || 'standard',
      updated_at: session.last_activity,
    });
    const ts = Date.now().toString(36);
    store.appendChatMessageRecord({
      id: `${session.session_id}_u_${ts}_${crypto.randomBytes(2).toString('hex')}`,
      session_id: session.session_id,
      role: 'user',
      content: userContent,
      created_at: session.last_activity,
    });
    store.appendChatMessageRecord({
      id: `${session.session_id}_a_${ts}_${crypto.randomBytes(2).toString('hex')}`,
      session_id: session.session_id,
      role: 'assistant',
      content: assistantContent,
      agent_role: agentRole || null,
      created_at: nowIso(),
    });
  };

  // --- CHAT & TASKS ---
  router.get('/chat/sessions', requireAuth, (_req: Request, res: Response) => {
    const list = Array.from(serverState.chatSessions.values()).map((s) => ({
      session_id: s.session_id,
      title: s.title,
      first_prompt: s.first_prompt,
      task_count: s.tasks.length,
      last_activity: s.last_activity,
      first_intent: s.first_intent,
    }));
    res.json(list);
  });

  router.get('/chat/sessions/:id', requireAuth, (req: Request, res: Response) => {
    const sessionId = String(req.params.id || '');
    const s = serverState.chatSessions.get(sessionId);
    if (!s) {
      const dbMessages = store.getChatSessionMessagesRelational(sessionId);
      res.json({ session_id: sessionId, tasks: [], messages: dbMessages });
      return;
    }
    res.json({ session_id: s.session_id, tasks: s.tasks, messages: s.messages });
  });

  router.delete('/chat/sessions/:id', requireAuth, (req: Request, res: Response) => {
    const sessionId = String(req.params.id || '');
    serverState.chatSessions.delete(sessionId);
    store.deleteChatSessionRecord(sessionId);
    res.json({ deleted: true });
  });

  router.get('/chat/search', requireAuth, (req: Request, res: Response) => {
    const q = String(req.query.query || '').toLowerCase();
    const hits = Array.from(serverState.chatSessions.values())
      .filter((s) => s.title.toLowerCase().includes(q) || s.messages.some((m) => m.content.toLowerCase().includes(q)))
      .map((s) => ({ session_id: s.session_id, title: s.title, last_activity: s.last_activity }));
    res.json(hits);
  });

  router.get('/chat/sessions/:id/export', requireAuth, (req: Request, res: Response) => {
    const s = serverState.chatSessions.get(String(req.params.id || ''));
    const md = s
      ? s.messages.map((m) => `### ${m.role === 'user' ? 'Você' : 'JARVIS'}\n\n${m.content}`).join('\n\n---\n\n')
      : '# Conversa vazia';
    res.type('text/markdown').send(md);
  });

  router.post('/chat', requireAuth, async (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const ownerUserId = user?.username || 'admin';

    // Rate limiting: 60 mensagens/minuto por usuário autenticado
    const rlChat = serverRateLimit('chat', ownerUserId, RATE_LIMITS.chat.limit, RATE_LIMITS.chat.windowMs);
    if (!rlChat.allowed) {
      res.status(429).json({ detail: `Limite de mensagens atingido (${RATE_LIMITS.chat.limit}/min). Aguarde ${Math.ceil(rlChat.retryAfterMs / 1000)}s.` });
      return;
    }

    const prompt = String(req.body?.prompt || '').trim();
    const sessionId = String(req.body?.session_id || `sess_${Date.now()}`);
    const projectId = req.body?.project_id ? String(req.body.project_id) : undefined;
    const requestedModel = req.body?.model ? String(req.body.model) : undefined;
    const enableWebSearch = typeof req.body?.enable_web_search === 'boolean' ? req.body.enable_web_search : undefined;
    const profile = user ? userProfiles.get(user.username) : undefined;
    const assistantName = String(req.body?.assistant_name || profile?.assistantName || 'Calmon IA');
    const activeAgent = detectInvokedAgent(prompt, sessionId);
    const activeHw = getActiveHardwareProfile();
    const taskId = `tsk_${Date.now()}`;

    const existingSession = serverState.chatSessions.get(sessionId);
    const agentCore = store.getAgentCore(ownerUserId, activeAgent.role, {
      name: activeAgent.name,
      proper_name: activeAgent.proper_name,
      handle: activeAgent.handle,
      mission: activeAgent.mission,
      preferred_model: activeAgent.preferred_model,
    });
    const relevantBrain = searchBrainMemories(serverState.brainMemories, prompt, {
      username: ownerUserId,
      limit: 3,
    });
    const allowedContextPacks = serverState.contextSets.filter((cs) =>
      canAgentAccessResource(cs.allowed_agents, activeAgent.role)
    );
    const workspaceProject = findWorkspaceProject(projectId);
    const projectMemories = projectId ? serverState.projectMemories.get(projectId) || [] : [];

    const runtimeCtx = buildAgentRuntimeContext({
      agent: activeAgent,
      agentCore,
      skillsList: serverState.skillsList,
      agentMemories: serverState.agentMemories.get(activeAgent.role) || [],
      brainMemories: relevantBrain,
      contextSets: allowedContextPacks,
      workspaceProject,
      projectMemories,
      historyMessages: existingSession?.messages || [],
      agentRoute: findAgentRoute(activeAgent.role),
      explicitChatOverride: requestedModel,
      systemDefaultModel: serverState.hybridConfig.default_model,
    });

    const targetModelName = runtimeCtx.resolvedModel.requestedModel;
    const resolvedExternalCred = resolveExternalCredentialForRequest(req, store, ownerUserId, targetModelName);

    try {
      const result = await runHybridInference({
        prompt,
        systemInstruction: runtimeCtx.systemInstruction,
        history: runtimeCtx.history,
        requestedModel: targetModelName,
        fallbackModel: runtimeCtx.resolvedModel.fallbackModel,
        routingPolicy: activeAgent.routing_policy,
        ollamaBaseUrl: activeHw.ollama_url,
        ollamaConnected: serverState.providerConnectivity.ollama_connected,
        geminiConnected: serverState.providerConnectivity.gemini_connected,
        enableWebSearch: enableWebSearch ?? activeAgent.role === 'research_analyst',
        assistantName,
        agentName: activeAgent.name,
        agentProperName: activeAgent.proper_name,
        strictFocus: activeAgent.strict_focus,
        strictTopic: activeAgent.strict_topic,
        externalProvider: resolvedExternalCred,
      });

      serverState.telemetryRecords.unshift({
        id: `inf_${Date.now().toString(36)}`,
        task_id: taskId,
        agent_role: activeAgent.role,
        model_name: result.modelUsed,
        provider: result.provider,
        status: 'success',
        duration_ms: result.latencyMs,
        prompt_tokens: Math.max(1, Math.ceil(prompt.length / 4)),
        completion_tokens: Math.max(1, Math.ceil(result.text.length / 4)),
        cost_usd: 0,
        created_at: nowIso(),
      });
      if (serverState.telemetryRecords.length > 500) serverState.telemetryRecords.length = 500;

      let session = serverState.chatSessions.get(sessionId);
      if (!session) {
        session = {
          session_id: sessionId,
          title: prompt.slice(0, 48) || 'Nova conversa',
          first_prompt: prompt,
          first_intent: activeAgent.category || 'general_assistance',
          last_activity: nowIso(),
          messages: [],
          tasks: [],
        };
        serverState.chatSessions.set(sessionId, session);
      }
      session.last_activity = nowIso();
      session.messages.push(
        { id: session.messages.length + 1, session_id: sessionId, project_id: projectId, role: 'user', content: prompt, created_at: nowIso() },
        { id: session.messages.length + 2, session_id: sessionId, project_id: projectId, role: 'assistant', content: result.text, created_at: nowIso() },
      );

      const taskResponse = {
        task_id: taskId,
        session_id: sessionId,
        user_prompt: prompt,
        project_id: projectId,
        classified_intent: activeAgent.category || 'general_assistance',
        plan_steps: [
          `Especialista selecionado: ${activeAgent.proper_name} (${activeAgent.name})`,
          runtimeCtx.skillsUsed.length > 0
            ? `Habilidades aplicadas: ${runtimeCtx.skillsUsed.map((s) => s.name).join(', ')}`
            : 'Execução com persona e núcleo do agente',
          `Motor utilizado: ${result.executionMode} · ${result.modelUsed}${result.fallbackOccurred ? ' (fallback)' : ''}`,
          result.sources.length ? `${result.sources.length} fonte(s) web consultadas` : 'Síntese final concluída',
        ],
        selected_agents: [activeAgent.role],
        policy_verified: true,
        policy_violations: [],
        approval_required: false,
        final_summary: result.text,
        execution_mode: result.executionMode,
        provider: result.provider,
        requested_model: result.requestedModel,
        model_used: result.modelUsed,
        model_source: runtimeCtx.resolvedModel.source,
        fallback_occurred: result.fallbackOccurred,
        skills_used: runtimeCtx.skillsUsed,
        latency_ms: result.latencyMs,
        reasoning: result.reasoning,
        routing_note: result.routingNote,
        sources: result.sources,
        agent_meta: {
          role: activeAgent.role,
          name: activeAgent.name,
          proper_name: activeAgent.proper_name,
          handle: activeAgent.handle,
          mascot: activeAgent.mascot,
        },
        is_completed: true,
        error: null,
      };
      session.tasks.push(taskResponse);
      const storedTask = { ...taskResponse, status: 'completed', created_at: nowIso() };
      serverState.tasksList.unshift(storedTask);
      store.upsertTaskRecord(storedTask);
      persistChatTurnRelational(session, prompt, result.text, activeAgent.role);
      persistStateNamespace(store, 'telemetry_records', serverState.telemetryRecords.slice(0, 500));
      res.json(taskResponse);
    } catch (err: any) {
      res.status(502).json({
        detail: err instanceof Error ? err.message : 'Falha ao executar inferência híbrida.',
      });
    }
  });

  router.post('/chat/stream', requireAuth, async (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const ownerUserId = user?.username || 'admin';

    // Rate limiting: mesma janela do /chat (60/min por usuário)
    const rlStream = serverRateLimit('chat', ownerUserId, RATE_LIMITS.chat.limit, RATE_LIMITS.chat.windowMs);
    if (!rlStream.allowed) {
      res.status(429).json({ detail: `Limite de mensagens atingido (${RATE_LIMITS.chat.limit}/min). Aguarde ${Math.ceil(rlStream.retryAfterMs / 1000)}s.` });
      return;
    }

    const prompt = String(req.body?.prompt || '').trim();
    const sessionId = String(req.body?.session_id || `sess_${Date.now()}`);
    const projectId = req.body?.project_id ? String(req.body.project_id) : undefined;
    const requestedModel = req.body?.model ? String(req.body.model) : undefined;
    const enableWebSearch = typeof req.body?.enable_web_search === 'boolean' ? req.body.enable_web_search : undefined;
    const profile = user ? userProfiles.get(user.username) : undefined;
    const assistantName = String(req.body?.assistant_name || profile?.assistantName || 'Calmon IA');
    const activeAgent = detectInvokedAgent(prompt, sessionId);
    const activeHw = getActiveHardwareProfile();
    const taskId = `tsk_${Date.now()}`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (payload: Record<string, unknown>) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    };

    const orchestrationPlan = planMultiAgentExecution(prompt, serverState.agentsList, assistantName);
    // Se a conversa é dedicada a um agente (agent_<role>) e o usuário não mencionou outro especialista explicitamente, mantém o especialista da sessão
    const isDedicatedAgentSession = sessionId.startsWith('agent_') || sessionId.startsWith('agent-');
    const primaryRole =
      isDedicatedAgentSession && orchestrationPlan.mode === 'single'
        ? activeAgent.role
        : orchestrationPlan.invoked_agents[0]?.role || activeAgent.role;
    const primaryAgent = serverState.agentsList.find((a) => a.role === primaryRole) || activeAgent;
    const selectedRoles = Array.from(
      new Set([primaryAgent.role, ...orchestrationPlan.invoked_agents.map((a) => a.role)])
    );

    const agentMeta = {
      role: primaryAgent.role,
      name: primaryAgent.name,
      proper_name: primaryAgent.proper_name,
      handle: primaryAgent.handle,
      mascot: primaryAgent.mascot,
    };

    const existingSession = serverState.chatSessions.get(sessionId);
    const primaryCore = store.getAgentCore(ownerUserId, primaryAgent.role, {
      name: primaryAgent.name,
      proper_name: primaryAgent.proper_name,
      handle: primaryAgent.handle,
      mission: primaryAgent.mission,
      preferred_model: primaryAgent.preferred_model,
    });
    const relevantBrain = searchBrainMemories(serverState.brainMemories, prompt, {
      username: ownerUserId,
      limit: 3,
    });
    const allowedContextPacks = serverState.contextSets.filter((cs) =>
      canAgentAccessResource(cs.allowed_agents, primaryAgent.role)
    );
    const workspaceProject = findWorkspaceProject(projectId);
    const projectMemories = projectId ? serverState.projectMemories.get(projectId) || [] : [];

    const primaryCtxPreview = buildAgentRuntimeContext({
      agent: primaryAgent,
      agentCore: primaryCore,
      skillsList: serverState.skillsList,
      agentMemories: serverState.agentMemories.get(primaryAgent.role) || [],
      brainMemories: relevantBrain,
      contextSets: allowedContextPacks,
      workspaceProject,
      projectMemories,
      historyMessages: existingSession?.messages || [],
      agentRoute: findAgentRoute(primaryAgent.role),
      explicitChatOverride: requestedModel,
      systemDefaultModel: serverState.hybridConfig.default_model,
    });

    // Broadcast live movement to Isometric Office over WebSocket
    orchestrationPlan.invoked_agents.forEach((ag) => {
      broadcastRealtimeEvent('office_agent_event', {
        agent_role: ag.role,
        agent_name: ag.proper_name || ag.name,
        zone: orchestrationPlan.mode === 'roundtable' ? 'roundtable' : orchestrationPlan.mode === 'deep_research' ? 'research' : 'desk',
        activity:
          orchestrationPlan.mode === 'roundtable'
            ? `Debatendo: ${prompt.slice(0, 38)}`
            : orchestrationPlan.mode === 'deep_research'
              ? `Deep Research: ${prompt.slice(0, 36)}`
              : `Atendendo: ${prompt.slice(0, 40)}`,
        mood: orchestrationPlan.mode === 'roundtable' ? 'debating' : orchestrationPlan.mode === 'deep_research' ? 'researching' : 'thinking',
        updated_at: nowIso(),
      });
    });

    const runStartedAt = Date.now();
    const durableRun = durableRuns.startRun({
      sessionId,
      userId: ownerUserId,
      agentRole: primaryAgent.role,
      agentName: primaryAgent.proper_name || primaryAgent.name,
      prompt,
      modelUsed: primaryCtxPreview.resolvedModel.requestedModel,
      executionMode: orchestrationPlan.mode,
      checkpoint: {
        stage: 'plan',
        selected_agents: selectedRoles,
        project_id: projectId || null,
      },
    });
    sendEvent({ type: 'run_started', run: durableRun });

    let stepCursor = 0;
    const planStep = durableRuns.recordStep({
      runId: durableRun.id,
      stepIndex: stepCursor++,
      kind: 'plan',
      title: `Planejamento · ${primaryAgent.proper_name || primaryAgent.name}`,
      status: 'completed',
      durationMs: Math.max(1, Date.now() - runStartedAt),
      inputSummary: prompt.slice(0, 220),
      outputSummary: `${orchestrationPlan.summary} · Agentes: ${selectedRoles.join(', ')}`,
      checkpointPayload: {
        mode: orchestrationPlan.mode,
        steps: orchestrationPlan.steps,
        selected_agents: selectedRoles,
      },
    });
    sendEvent({ type: 'run_step', run_id: durableRun.id, step: planStep });

    const memStep = durableRuns.recordStep({
      runId: durableRun.id,
      stepIndex: stepCursor++,
      kind: 'memory',
      title: 'Contexto, Memória & Habilidades',
      status: 'completed',
      durationMs: 2,
      inputSummary: workspaceProject ? `Projeto: ${workspaceProject.name}` : 'Sessão direta',
      outputSummary: `${relevantBrain.length} memória(s) · ${primaryCtxPreview.skillsUsed.length} skill(s) · modelo alvo ${primaryCtxPreview.resolvedModel.requestedModel}`,
      checkpointPayload: {
        brain_memories_count: relevantBrain.length,
        skills: primaryCtxPreview.skillsUsed.map((s) => s.name),
        model_source: primaryCtxPreview.resolvedModel.source,
      },
    });
    sendEvent({ type: 'run_step', run_id: durableRun.id, step: memStep });

    sendEvent({
      type: 'meta',
      session_id: sessionId,
      task_id: taskId,
      run_id: durableRun.id,
      model: primaryCtxPreview.resolvedModel.requestedModel,
      requested_model: primaryCtxPreview.resolvedModel.requestedModel,
      model_source: primaryCtxPreview.resolvedModel.source,
      skills_used: primaryCtxPreview.skillsUsed,
      selected_agents: selectedRoles,
      orchestration_mode: orchestrationPlan.mode,
      agent_meta: agentMeta,
    });
    sendEvent({
      type: 'status',
      message: `${orchestrationPlan.summary} · executando em ${primaryCtxPreview.resolvedModel.requestedModel}...`,
    });

    try {
      const agentOutputs: Array<{
        agent_role: string;
        agent_name: string;
        objective: string;
        summary: string;
        requested_model: string;
        model_used: string;
        fallback_occurred: boolean;
        skills_used: string[];
      }> = [];

      // Execução multiagente verdadeira para especialistas secundários (até 3 para latência saudável)
      const secondarySpecs = orchestrationPlan.invoked_agents
        .filter((ag) => ag.role !== primaryAgent.role)
        .slice(0, 3);

      const multiAgentNotes: string[] = [];

      // Prioridade 3: Loop autônomo de ferramentas (Sandbox + MCP aprovados) com streaming vivo de passos e log
      const toolLoop = await executeAutonomousToolLoop({
        prompt,
        runId: durableRun.id,
        sessionId,
        userId: ownerUserId,
        startStepIndex: stepCursor,
        store,
        durableRuns,
        sandboxRunner: infra.sandboxRunner,
        mcpSupervisor: infra.mcpSupervisor,
        onStep: (step) => {
          sendEvent({ type: 'run_step', run_id: durableRun.id, step });
          sendEvent({
            type: 'tool_output',
            run_id: durableRun.id,
            tool: step.title,
            status: step.status,
            output: step.output_summary,
          });
        },
        onArtifact: (artifact) => sendEvent({ type: 'run_artifact', run_id: durableRun.id, artifact }),
      });
      if (toolLoop.executedCount > 0) {
        stepCursor += toolLoop.steps.length;
        if (toolLoop.evidencePromptBlock) {
          multiAgentNotes.push(toolLoop.evidencePromptBlock);
        }
        sendEvent({
          type: 'status',
          message: `${toolLoop.executedCount} ferramenta(s) executada(s) em Sandbox/MCP · sintetizando resposta...`,
        });
      }

      if (secondarySpecs.length > 0) {
        multiAgentNotes.push(
          `Plano de Multi-Orquestração (${orchestrationPlan.mode}):\n` +
            orchestrationPlan.steps.map((s) => `- ${s}`).join('\n')
        );

        for (const spec of secondarySpecs) {
          const specialist = serverState.agentsList.find((a) => a.role === spec.role);
          if (!specialist) continue;
          const specTask = String((spec as any).task || specialist.mission || specialist.role);

          sendEvent({
            type: 'status',
            message: `Consultando especialista ${specialist.proper_name || specialist.name} (${specTask})...`,
          });

          const specCore = store.getAgentCore(ownerUserId, specialist.role, {
            name: specialist.name,
            proper_name: specialist.proper_name,
            handle: specialist.handle,
            mission: specialist.mission,
            preferred_model: specialist.preferred_model,
          });
          const specCtx = buildAgentRuntimeContext({
            agent: specialist,
            agentCore: specCore,
            skillsList: serverState.skillsList,
            agentMemories: serverState.agentMemories.get(specialist.role) || [],
            brainMemories: relevantBrain,
            contextSets: serverState.contextSets.filter((cs) =>
              canAgentAccessResource(cs.allowed_agents, specialist.role)
            ),
            workspaceProject,
            projectMemories,
            historyMessages: existingSession?.messages || [],
            agentRoute: findAgentRoute(specialist.role),
            explicitChatOverride: requestedModel,
            systemDefaultModel: serverState.hybridConfig.default_model,
            extraNotes: [
              `Você está contribuindo em colaboração multiagente (${orchestrationPlan.mode}) com seu parecer objetivo sobre: "${specTask}". Entregue um parecer técnico conciso (máx. 6 linhas) sob sua ótica de especialista.`,
            ],
          });

          const specExtCred = resolveExternalCredentialForRequest(
            req,
            store,
            ownerUserId,
            specCtx.resolvedModel.requestedModel
          );

          try {
            const specRes = await runHybridInference({
              prompt,
              systemInstruction: specCtx.systemInstruction,
              history: specCtx.history,
              requestedModel: specCtx.resolvedModel.requestedModel,
              fallbackModel: specCtx.resolvedModel.fallbackModel,
              routingPolicy: specialist.routing_policy,
              ollamaBaseUrl: activeHw.ollama_url,
              ollamaConnected: serverState.providerConnectivity.ollama_connected,
              geminiConnected: serverState.providerConnectivity.gemini_connected,
              enableWebSearch: enableWebSearch ?? specialist.role === 'research_analyst',
              assistantName,
              agentName: specialist.name,
              agentProperName: specialist.proper_name,
              strictFocus: false,
              externalProvider: specExtCred,
            });

            agentOutputs.push({
              agent_role: specialist.role,
              agent_name: specialist.proper_name || specialist.name,
              objective: specTask,
              summary: specRes.text,
              requested_model: specRes.requestedModel,
              model_used: specRes.modelUsed,
              fallback_occurred: specRes.fallbackOccurred,
              skills_used: specCtx.skillsUsed.map((s) => s.name),
            });

            multiAgentNotes.push(
              `Parecer real de ${specialist.proper_name} (${specialist.name} · modelo ${specRes.modelUsed}):\n${specRes.text.slice(0, 750)}`
            );
          } catch (specErr: any) {
            agentOutputs.push({
              agent_role: specialist.role,
              agent_name: specialist.proper_name || specialist.name,
              objective: specTask,
              summary: `Especialista indisponível neste turno: ${specErr instanceof Error ? specErr.message : 'erro de inferência'}`,
              requested_model: specCtx.resolvedModel.requestedModel,
              model_used: 'indisponível',
              fallback_occurred: true,
              skills_used: specCtx.skillsUsed.map((s) => s.name),
            });
          }
        }

        sendEvent({
          type: 'status',
          message: `${primaryAgent.proper_name || primaryAgent.name} sintetizando os pareceres da equipe...`,
        });
      }

      const finalRuntimeCtx = buildAgentRuntimeContext({
        agent: primaryAgent,
        agentCore: primaryCore,
        skillsList: serverState.skillsList,
        agentMemories: serverState.agentMemories.get(primaryAgent.role) || [],
        brainMemories: relevantBrain,
        contextSets: allowedContextPacks,
        workspaceProject,
        projectMemories,
        historyMessages: existingSession?.messages || [],
        agentRoute: findAgentRoute(primaryAgent.role),
        explicitChatOverride: requestedModel,
        systemDefaultModel: serverState.hybridConfig.default_model,
        extraNotes: multiAgentNotes,
      });

      const streamTargetModel = finalRuntimeCtx.resolvedModel.requestedModel;
      const streamExternalCred = resolveExternalCredentialForRequest(req, store, ownerUserId, streamTargetModel);
      let streamedAnyChunk = false;

      const result = await runHybridInference({
        prompt,
        systemInstruction: finalRuntimeCtx.systemInstruction,
        history: finalRuntimeCtx.history,
        requestedModel: streamTargetModel,
        fallbackModel: finalRuntimeCtx.resolvedModel.fallbackModel,
        routingPolicy: primaryAgent.routing_policy,
        ollamaBaseUrl: activeHw.ollama_url,
        ollamaConnected: serverState.providerConnectivity.ollama_connected,
        geminiConnected: serverState.providerConnectivity.gemini_connected,
        enableWebSearch: enableWebSearch ?? orchestrationPlan.enable_web_search,
        assistantName,
        agentName: primaryAgent.name,
        agentProperName: primaryAgent.proper_name,
        strictFocus: primaryAgent.strict_focus,
        strictTopic: primaryAgent.strict_topic,
        externalProvider: streamExternalCred,
        onToken: (chunk: string) => {
          if (!chunk) return;
          streamedAnyChunk = true;
          sendEvent({ type: 'token', chunk });
        },
      });

      if (!streamedAnyChunk && result.text) {
        sendEvent({ type: 'token', chunk: result.text });
      }
      scheduleHermesDistill(sessionId, prompt, result.text || '');

      // Inclui o próprio agente principal em agent_outputs quando houve colaboração multiagente
      if (agentOutputs.length > 0) {
        agentOutputs.unshift({
          agent_role: primaryAgent.role,
          agent_name: primaryAgent.proper_name || primaryAgent.name,
          objective: (orchestrationPlan.invoked_agents[0] as any)?.task || 'Síntese e coordenação principal',
          summary: result.text.slice(0, 360),
          requested_model: result.requestedModel,
          model_used: result.modelUsed,
          fallback_occurred: result.fallbackOccurred,
          skills_used: finalRuntimeCtx.skillsUsed.map((s) => s.name),
        });
      }

      serverState.telemetryRecords.unshift({
        id: `inf_${Date.now().toString(36)}`,
        task_id: taskId,
        agent_role: primaryAgent.role,
        model_name: result.modelUsed,
        provider: result.provider,
        status: 'success',
        duration_ms: result.latencyMs,
        prompt_tokens: Math.max(1, Math.ceil(prompt.length / 4)),
        completion_tokens: Math.max(1, Math.ceil(result.text.length / 4)),
        cost_usd: 0,
        created_at: nowIso(),
      });
      if (serverState.telemetryRecords.length > 500) serverState.telemetryRecords.length = 500;

      const modelStep = durableRuns.recordStep({
        runId: durableRun.id,
        stepIndex: stepCursor++,
        kind: 'model',
        title: `Inferência · ${result.modelUsed}`,
        status: 'completed',
        durationMs: result.latencyMs,
        inputSummary: `Modo ${result.executionMode} (${result.provider})`,
        outputSummary: result.text.slice(0, 320),
        checkpointPayload: {
          model_used: result.modelUsed,
          requested_model: result.requestedModel,
          fallback_occurred: result.fallbackOccurred,
          provider: result.provider,
          sources_count: result.sources.length,
        },
      });
      sendEvent({ type: 'run_step', run_id: durableRun.id, step: modelStep });

      const mediaAssets: ChatMediaAssetPayload[] = await resolveNaturalChatMedia({
        req,
        store,
        ownerUserId,
        prompt,
        requestedModel: result.requestedModel || result.modelUsed,
      });

      const hasRasterImage = mediaAssets.some((m) => m.kind === 'image');
      let generatedArtifact: StructuredArtifactPayload | null = null;
      if (orchestrationPlan.deliverable && !(orchestrationPlan.deliverable === 'png' && hasRasterImage)) {
        try {
          generatedArtifact = await generateStructuredArtifact({
            kind: orchestrationPlan.deliverable,
            topic: prompt.slice(0, 90),
            context: result.text.slice(0, 800),
            assistantName,
          });
        } catch {
          generatedArtifact = null;
        }
      }

      // Persiste artefato produzido no Object Storage plugável (Disco Local Confinado ou S3/GCS/MinIO)
      if (generatedArtifact) {
        try {
          const persistedArt = await durableRuns.saveArtifact({
            runId: durableRun.id,
            sessionId,
            userId: ownerUserId,
            title: generatedArtifact.title || 'Artefato Gerado',
            kind: generatedArtifact.kind || 'document',
            filename: `${generatedArtifact.kind || 'artifact'}.json`,
            content: JSON.stringify(generatedArtifact, null, 2),
            mimeType: 'application/json',
          });
          sendEvent({ type: 'run_artifact', run_id: durableRun.id, artifact: persistedArt });
          const artStep = durableRuns.recordStep({
            runId: durableRun.id,
            stepIndex: stepCursor++,
            kind: 'artifact',
            title: `Artefato salvo · ${persistedArt.title}`,
            status: 'completed',
            durationMs: 4,
            outputSummary: `${persistedArt.storage_driver} · ${persistedArt.size_bytes} bytes · sha256:${persistedArt.sha256.slice(0, 12)}`,
            checkpointPayload: { artifact_id: persistedArt.id, storage_key: persistedArt.storage_key },
          });
          sendEvent({ type: 'run_step', run_id: durableRun.id, step: artStep });
        } catch {
          // Não interrompe entrega da resposta caso a gravação do artefato falhe
        }
      } else {
        // Extrai bloco de código ou resposta longa como artefato Markdown consultável no Painel Lateral
        const codeMatch = result.text.match(/```([a-zA-Z0-9_-]*)\n([\s\S]{40,}?)\n```/);
        if (codeMatch) {
          const lang = codeMatch[1] || 'txt';
          const codeBody = codeMatch[2];
          try {
            const codeArt = await durableRuns.saveArtifact({
              runId: durableRun.id,
              sessionId,
              userId: ownerUserId,
              title: `Código gerado (.${lang})`,
              kind: 'code',
              filename: `snippet.${lang}`,
              content: codeBody,
              mimeType: 'text/plain; charset=utf-8',
            });
            sendEvent({ type: 'run_artifact', run_id: durableRun.id, artifact: codeArt });
          } catch {
            // Não bloqueia
          }
        }
      }

      // Auto-destilação no Segundo Cérebro ("Tudo Vira Cérebro")
      if (serverState.brainAutoDistill && prompt.length >= 10 && result.text.length >= 30) {
        const distilled = distillConversationToMemory({
          prompt,
          answer: result.text,
          ownerUserId,
          ownerName: user?.display_name || assistantName,
          agentRole: primaryAgent.role,
          agentName: primaryAgent.proper_name,
          sources: result.sources,
        });
        const newMem: BrainMemoryItem = {
          ...distilled,
          id: `mem_${crypto.randomBytes(5).toString('hex')}`,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        serverState.brainMemories.unshift(newMem);
        broadcastRealtimeEvent('brain_memory_updated', { action: 'created', memory: newMem });
      }

      let session = serverState.chatSessions.get(sessionId);
      if (!session) {
        session = {
          session_id: sessionId,
          title: prompt.slice(0, 48) || 'Nova conversa',
          first_prompt: prompt,
          first_intent: primaryAgent.category || 'general_assistance',
          last_activity: nowIso(),
          messages: [],
          tasks: [],
        };
        serverState.chatSessions.set(sessionId, session);
      }
      session.last_activity = nowIso();
      session.messages.push(
        { id: session.messages.length + 1, session_id: sessionId, project_id: projectId, role: 'user', content: prompt, created_at: nowIso() },
        { id: session.messages.length + 2, session_id: sessionId, project_id: projectId, role: 'assistant', content: result.text, created_at: nowIso() },
      );

      const allSkillsUsed = finalRuntimeCtx.skillsUsed;
      const taskData = {
        task_id: taskId,
        session_id: sessionId,
        user_prompt: prompt,
        project_id: projectId,
        classified_intent: orchestrationPlan.mode === 'deep_research' ? 'deep_research' : primaryAgent.category || 'general_assistance',
        plan_steps: [
          ...orchestrationPlan.steps,
          ...toolLoop.summaryLines,
          allSkillsUsed.length > 0
            ? `Habilidades ativas injetadas: ${allSkillsUsed.map((s) => s.name).join(', ')}`
            : 'Executado com persona e diretivas do especialista',
          `Execução ${result.executionMode} via ${result.modelUsed}${result.fallbackOccurred ? ` (fallback de ${result.requestedModel})` : ''} em ${result.latencyMs} ms`,
          result.sources.length ? `Pesquisa Web: ${result.sources.length} fonte(s) verificadas` : 'Resposta validada',
        ],
        selected_agents: selectedRoles,
        orchestration_mode: orchestrationPlan.mode,
        agent_outputs: agentOutputs.length > 0 ? agentOutputs : undefined,
        policy_verified: true,
        policy_violations: [],
        approval_required: false,
        final_summary: result.text,
        execution_mode: result.executionMode,
        provider: result.provider,
        requested_model: result.requestedModel,
        model_used: result.modelUsed,
        model_source: finalRuntimeCtx.resolvedModel.source,
        fallback_occurred: result.fallbackOccurred,
        skills_used: allSkillsUsed,
        latency_ms: result.latencyMs,
        reasoning: result.reasoning,
        routing_note: result.routingNote,
        sources: result.sources,
        agent_meta: agentMeta,
        artifact_payload: generatedArtifact || undefined,
        media_assets: mediaAssets.length > 0 ? mediaAssets : undefined,
        is_completed: true,
        error: null,
      };
      session.tasks.push(taskData);
      const storedStreamTask = { ...taskData, status: 'completed', created_at: nowIso() };
      serverState.tasksList.unshift(storedStreamTask);
      store.upsertTaskRecord(storedStreamTask);
      persistChatTurnRelational(session, prompt, result.text, primaryAgent.role);
      persistStateNamespace(store, 'telemetry_records', serverState.telemetryRecords.slice(0, 500));
      persistStateNamespace(store, 'brain_memories', serverState.brainMemories.slice(0, 250));

      orchestrationPlan.invoked_agents.forEach((ag) => {
        broadcastRealtimeEvent('office_agent_event', {
          agent_role: ag.role,
          agent_name: ag.proper_name || ag.name,
          zone: 'desk',
          activity: 'Entrega concluída ✓',
          mood: 'celebrating',
          updated_at: nowIso(),
        });
      });

      const completedRun = durableRuns.completeRun({
        runId: durableRun.id,
        modelUsed: result.modelUsed,
        executionMode: result.executionMode,
        finalSummary: result.text,
        checkpoint: {
          stage: 'completed',
          task_id: taskId,
          model_used: result.modelUsed,
          total_steps: stepCursor,
        },
      });
      if (completedRun) {
        sendEvent({ type: 'run_completed', run: completedRun });
      }

      sendEvent({
        type: 'done',
        run_id: durableRun.id,
        task_data: taskData,
        final_summary: result.text,
        sources: result.sources,
        execution_mode: result.executionMode,
        provider: result.provider,
        requested_model: result.requestedModel,
        model_used: result.modelUsed,
        model_source: finalRuntimeCtx.resolvedModel.source,
        fallback_occurred: result.fallbackOccurred,
        skills_used: allSkillsUsed,
        agent_outputs: agentOutputs.length > 0 ? agentOutputs : undefined,
        orchestration_mode: orchestrationPlan.mode,
        plan_steps: taskData.plan_steps,
        selected_agents: selectedRoles,
        classified_intent: taskData.classified_intent,
        artifact_payload: generatedArtifact || undefined,
        media_assets: mediaAssets.length > 0 ? mediaAssets : undefined,
        latency_ms: result.latencyMs,
        reasoning: result.reasoning,
        routing_note: result.routingNote,
        agent_meta: agentMeta,
        is_completed: true,
        session_id: sessionId,
        task_id: taskId,
      });
      res.end();
    } catch (err: any) {
      const errMessage = err instanceof Error ? err.message : 'Falha na comunicação com o provedor de IA.';
      const errStep = durableRuns.recordStep({
        runId: durableRun.id,
        stepIndex: 3,
        kind: 'model',
        title: 'Inferência interrompida',
        status: 'failed',
        durationMs: Math.max(1, Date.now() - runStartedAt),
        inputSummary: 'Chamada ao provedor de modelo',
        outputSummary: errMessage.slice(0, 220),
      });
      sendEvent({ type: 'run_step', run_id: durableRun.id, step: errStep });
      const failedRun = durableRuns.failRun(durableRun.id, errMessage);
      if (failedRun) {
        sendEvent({ type: 'run_completed', run: failedRun });
      }
      sendEvent({
        type: 'error',
        run_id: durableRun.id,
        code: 'provider_unavailable',
        error: errMessage,
      });
      res.end();
    }
  });

  // --- EXECUÇÕES DURÁVEIS, CHECKPOINTS, REPLAY & ARTEFATOS (FASE 2) ---
  router.get('/chat/runs', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const ownerUserId = user?.username || 'admin';
    const sessionId = typeof req.query.session_id === 'string' && req.query.session_id.trim()
      ? req.query.session_id.trim()
      : undefined;
    const limit = Number(req.query.limit || 25);
    const runs = durableRuns.listRuns(ownerUserId, sessionId, limit);
    res.json({
      runs,
      recoverable_count: store.countRecoverableAgentRuns(ownerUserId),
    });
  });

  router.get('/chat/runs/stats', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const ownerUserId = user?.username || 'admin';
    const stats = computeRunObservabilityStats(store, ownerUserId);
    res.json({
      ...stats,
      sandbox_driver: infra.sandboxRunner.driver,
      storage_driver: infra.storageAdapter.driver,
      queue_driver: infra.durableQueue.driver,
    });
  });

  router.get('/chat/runs/:runId', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const ownerUserId = user?.username || 'admin';
    const detail = durableRuns.getRunDetail(String(req.params.runId || ''), ownerUserId);
    if (!detail) {
      res.status(404).json({ detail: 'Execução não encontrada ou sem permissão de acesso.' });
      return;
    }
    res.json(detail);
  });

  router.post('/chat/runs/:runId/sandbox', requireAuth, async (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const ownerUserId = user?.username || 'admin';
    const existing = durableRuns.getRunDetail(String(req.params.runId || ''), ownerUserId);
    if (!existing) {
      res.status(404).json({ detail: 'Execução não encontrada ou sem permissão de acesso.' });
      return;
    }
    const command = String(req.body?.command || '').trim();
    const args = Array.isArray(req.body?.args) ? req.body.args.map((a: unknown) => String(a)) : [];
    if (!command) {
      res.status(400).json({ detail: 'Informe um comando permitido para executar no Sandbox.' });
      return;
    }
    const execRes = await infra.sandboxRunner.execute({
      userId: ownerUserId,
      runId: existing.run.id,
      command,
      args,
    });
    const displayCmd = [command, ...args].join(' ').trim();
    const outputText = (
      execRes.session.stdout_excerpt ||
      execRes.session.stderr_excerpt ||
      execRes.reason ||
      '(sem saída)'
    ).trim();
    const step = durableRuns.recordStep({
      runId: existing.run.id,
      stepIndex: existing.steps.length,
      kind: 'sandbox',
      title: `Sandbox · ${displayCmd.slice(0, 48)}`,
      status: execRes.allowed && execRes.session.status === 'completed' ? 'completed' : 'failed',
      durationMs: execRes.session.duration_ms,
      inputSummary: `Terminal do Workspace (${execRes.session.driver})`,
      outputSummary: outputText.slice(0, 360),
      checkpointPayload: {
        tool_kind: 'sandbox',
        driver: execRes.session.driver,
        command: displayCmd,
        allowed: execRes.allowed,
        exit_code: execRes.session.exit_code,
        stdout_excerpt: execRes.session.stdout_excerpt.slice(0, 1800),
        stderr_excerpt: execRes.session.stderr_excerpt.slice(0, 900),
        sandbox_session_id: execRes.session.id,
      },
    });
    const detail = durableRuns.getRunDetail(existing.run.id, ownerUserId);
    res.json({
      allowed: execRes.allowed,
      reason: execRes.reason,
      session: execRes.session,
      step,
      detail,
    });
  });

  router.post('/chat/runs/:runId/resume', requireAuth, async (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const ownerUserId = user?.username || 'admin';
    const fromStepIndex =
      typeof req.body?.from_step_index === 'number' ? req.body.from_step_index : undefined;

    const detail = await durableRuns.resumeRunFromCheckpoint(
      String(req.params.runId || ''),
      ownerUserId,
      fromStepIndex,
      {
        executeContinuation: async ({ run, resumeFromStep, priorSteps }) => {
          const priorContext = priorSteps
            .map(
              (s) =>
                `#${s.step_index + 1} [${s.kind}] ${s.title}: ${s.output_summary || s.input_summary || s.status}`
            )
            .join('\n');
          const continuationPrompt = [
            `Retomada de execução durável a partir do checkpoint #${resumeFromStep + 1}.`,
            `Solicitação original: ${run.prompt}`,
            priorContext ? `Passos já concluídos:\n${priorContext}` : '',
            'Continue e conclua a entrega de forma clara e objetiva em português.',
          ]
            .filter(Boolean)
            .join('\n\n');

          const requestedModel = run.model_used || serverState.hybridConfig?.default_model || 'gemini-4-hydrogen';
          const externalProvider = resolveExternalCredentialForRequest(
            req,
            store,
            ownerUserId,
            requestedModel
          );
          const geminiReady = Boolean((process.env.GEMINI_API_KEY || '').trim());

          const ollamaConnected = Boolean(serverState.providerConnectivity?.ollama_connected);
          const ollamaBaseUrl = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

          if (!geminiReady && !externalProvider && !ollamaConnected) {
            return {
              output: `Checkpoint #${resumeFromStep + 1} restaurado para "${run.prompt.slice(0, 100)}". Contexto íntegro (${priorSteps.length} passo(s) preservados); configure GEMINI_API_KEY, Ollama ou um provedor externo para re-executar a inferência IA.`,
              modelUsed: 'checkpoint_local_replay',
              executionMode: 'LOCAL',
            };
          }

          try {
            const inference = await runHybridInference({
              prompt: continuationPrompt,
              systemInstruction: `Você é ${run.agent_name} (@${run.agent_role}) retomando uma execução interrompida a partir de um checkpoint persistido no banco do Calmon Studio.`,
              requestedModel,
              routingPolicy: 'auto_hybrid',
              ollamaBaseUrl,
              ollamaConnected,
              geminiConnected: geminiReady,
              externalProvider,
              agentName: run.agent_name,
            });
            return {
              output: inference.text || 'Retomada concluída.',
              modelUsed: inference.modelUsed,
              executionMode: inference.executionMode,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'provedor indisponível';
            return {
              output: `Checkpoint #${resumeFromStep + 1} restaurado (${priorSteps.length} passo(s) preservados). A chamada ao provedor de IA não pôde ser concluída agora (${msg}).`,
              modelUsed: 'checkpoint_local_fallback',
              executionMode: 'LOCAL',
            };
          }
        },
      }
    );

    if (!detail) {
      res.status(404).json({ detail: 'Execução não encontrada para retomada.' });
      return;
    }
    res.json(detail);
  });

  router.get('/chat/runs/:runId/artifacts/:artifactId/download', requireAuth, async (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const ownerUserId = user?.username || 'admin';
    const detail = durableRuns.getRunDetail(String(req.params.runId || ''), ownerUserId);
    if (!detail) {
      res.status(404).json({ detail: 'Execução não encontrada.' });
      return;
    }
    const artifact = detail.artifacts.find((a) => a.id === req.params.artifactId);
    if (!artifact) {
      res.status(404).json({ detail: 'Artefato não encontrado nesta execução.' });
      return;
    }
    try {
      const content = await storageAdapter.getObject(artifact.storage_key);
      if (!content) {
        res.status(404).json({ detail: 'Objeto não encontrado no storage.' });
        return;
      }
      const safeFilename = artifact.title.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'artifact.txt';
      res.setHeader('Content-Type', artifact.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.send(content);
    } catch {
      res.status(500).json({ detail: 'Falha ao ler artefato do storage.' });
    }
  });

  router.get('/tasks', requireAuth, (_req: Request, res: Response) =>
    res.json(
      serverState.tasksList.map((t, idx) => ({
        ...t,
        id: String(t.id || t.task_id || `task_${idx}`),
        task_id: String(t.task_id || t.id || `task_${idx}`),
        prompt: String(t.prompt || t.user_prompt || ''),
        intent: String(t.intent || t.classified_intent || 'planejamento'),
        is_completed:
          typeof t.is_completed === 'boolean' ? t.is_completed : t.status === 'completed',
      }))
    )
  );

  router.delete('/tasks/:id', requireAuth, (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const before = serverState.tasksList.length;
    serverState.tasksList = serverState.tasksList.filter(
      (t) => t.task_id !== id && t.id !== id
    );
    const dbDeleted = store.deleteTaskRecord(id);
    res.json({ deleted: serverState.tasksList.length < before || dbDeleted });
  });

  router.post('/tasks/purge', requireAuth, (req: Request, res: Response) => {
    const rawDays = Number(req.query.days_retention ?? req.body?.days_retention ?? 30);
    const retention = Number.isFinite(rawDays) ? Math.max(0, Math.min(3650, rawDays)) : 30;
    const cutoffMs = Date.now() - retention * 24 * 60 * 60 * 1000;
    const before = serverState.tasksList.length;
    serverState.tasksList = serverState.tasksList.filter((t) => {
      if (retention === 0) return false;
      const ts = Date.parse(String(t.created_at || ''));
      return Number.isNaN(ts) || ts > cutoffMs;
    });
    const memPurged = before - serverState.tasksList.length;
    const dbPurged = store.purgeOldTaskRecords(retention);
    res.json({ purged_count: Math.max(memPurged, dbPurged), retention_days: retention });
  });

  return router;
}
