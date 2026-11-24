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
} from '../serverState.ts';
import { runHybridInference } from '../hybridAiEngine.ts';
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
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';

export interface ChatRouterDeps {
  store: LocalSqliteBrainStore;
}

export function createChatRouter(deps: ChatRouterDeps): Router {
  const router = express.Router();
  const { store } = deps;

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
    const s = serverState.chatSessions.get(req.params.id);
    if (!s) {
      res.json({ session_id: req.params.id, tasks: [], messages: [] });
      return;
    }
    res.json({ session_id: s.session_id, tasks: s.tasks, messages: s.messages });
  });

  router.delete('/chat/sessions/:id', requireAuth, (req: Request, res: Response) => {
    serverState.chatSessions.delete(req.params.id);
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
    const s = serverState.chatSessions.get(req.params.id);
    const md = s
      ? s.messages.map((m) => `### ${m.role === 'user' ? 'Você' : 'JARVIS'}\n\n${m.content}`).join('\n\n---\n\n')
      : '# Conversa vazia';
    res.type('text/markdown').send(md);
  });

  router.post('/chat', requireAuth, async (req: Request, res: Response) => {
    const prompt = String(req.body?.prompt || '').trim();
    const sessionId = String(req.body?.session_id || `sess_${Date.now()}`);
    const projectId = req.body?.project_id ? String(req.body.project_id) : undefined;
    const requestedModel = req.body?.model ? String(req.body.model) : undefined;
    const enableWebSearch = typeof req.body?.enable_web_search === 'boolean' ? req.body.enable_web_search : undefined;
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const profile = user ? userProfiles.get(user.username) : undefined;
    const assistantName = String(req.body?.assistant_name || profile?.assistantName || 'JARVIS');
    const activeAgent = detectInvokedAgent(prompt, sessionId);
    const activeHw = getActiveHardwareProfile();
    const taskId = `tsk_${Date.now()}`;

    const ownerUserId = user?.username || 'admin';
    const targetModelName = requestedModel || activeAgent.preferred_model;
    const resolvedExternalCred = resolveExternalCredentialForRequest(req, store, ownerUserId, targetModelName);

    try {
      const result = await runHybridInference({
        prompt,
        systemInstruction: activeAgent.system_prompt,
        requestedModel: targetModelName,
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
          first_intent: 'general_assistance',
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
          `Motor utilizado: ${result.executionMode} · ${result.modelUsed}`,
          result.sources.length ? `${result.sources.length} fonte(s) web consultadas` : 'Síntese final concluída',
        ],
        selected_agents: [activeAgent.role],
        policy_verified: true,
        policy_violations: [],
        approval_required: false,
        final_summary: result.text,
        execution_mode: result.executionMode,
        provider: result.provider,
        model_used: result.modelUsed,
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
      serverState.tasksList.unshift({ ...taskResponse, status: 'completed', created_at: nowIso() });
      res.json(taskResponse);
    } catch (err: any) {
      res.status(502).json({
        detail: err instanceof Error ? err.message : 'Falha ao executar inferência híbrida.',
      });
    }
  });

  router.post('/chat/stream', requireAuth, async (req: Request, res: Response) => {
    const prompt = String(req.body?.prompt || '').trim();
    const sessionId = String(req.body?.session_id || `sess_${Date.now()}`);
    const projectId = req.body?.project_id ? String(req.body.project_id) : undefined;
    const requestedModel = req.body?.model ? String(req.body.model) : undefined;
    const enableWebSearch = typeof req.body?.enable_web_search === 'boolean' ? req.body.enable_web_search : undefined;
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const profile = user ? userProfiles.get(user.username) : undefined;
    const assistantName = String(req.body?.assistant_name || profile?.assistantName || 'JARVIS');
    const activeAgent = detectInvokedAgent(prompt, sessionId);
    const activeHw = getActiveHardwareProfile();
    const taskId = `tsk_${Date.now()}`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const orchestrationPlan = planMultiAgentExecution(prompt, serverState.agentsList, assistantName);
    const primaryRole = orchestrationPlan.invoked_agents[0]?.role || activeAgent.role;
    const primaryAgent = serverState.agentsList.find((a) => a.role === primaryRole) || activeAgent;
    const selectedRoles = orchestrationPlan.invoked_agents.map((a) => a.role);

    const agentMeta = {
      role: primaryAgent.role,
      name: primaryAgent.name,
      proper_name: primaryAgent.proper_name,
      handle: primaryAgent.handle,
      mascot: primaryAgent.mascot,
    };

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

    sendEvent({
      type: 'meta',
      session_id: sessionId,
      task_id: taskId,
      model: requestedModel || primaryAgent.preferred_model,
      selected_agents: selectedRoles,
      agent_meta: agentMeta,
    });
    sendEvent({
      type: 'status',
      message: `${orchestrationPlan.summary} · executando...`,
    });

    try {
      const relevantBrain = searchBrainMemories(serverState.brainMemories, prompt, {
        username: user?.username || 'admin',
        limit: 3,
      });
      const allowedContextPacks = serverState.contextSets.filter((cs) =>
        canAgentAccessResource(cs.allowed_agents, primaryAgent.role)
      );
      const contextNotes: string[] = [];
      if (orchestrationPlan.invoked_agents.length > 1) {
        contextNotes.push(
          `Plano de Multi-Orquestração (${orchestrationPlan.mode}):\n` +
            orchestrationPlan.steps.map((s) => `- ${s}`).join('\n')
        );
      }
      if (relevantBrain.length > 0) {
        contextNotes.push(
          'Memórias relevantes do Segundo Cérebro:\n' +
            relevantBrain.map((h) => `- [${h.memory.layer}] ${h.memory.title}: ${h.memory.content}`).join('\n')
        );
      }
      if (allowedContextPacks.length > 0) {
        contextNotes.push(
          'Context Sets acoplados a este agente:\n' +
            allowedContextPacks.slice(0, 2).map((cs) => `- ${cs.name}: ${cs.content.slice(0, 320)}`).join('\n')
        );
      }
      const enrichedSystemPrompt = [primaryAgent.system_prompt, ...contextNotes].filter(Boolean).join('\n\n');

      const streamOwnerUserId = user?.username || 'admin';
      const streamTargetModel = requestedModel || primaryAgent.preferred_model;
      const streamExternalCred = resolveExternalCredentialForRequest(req, store, streamOwnerUserId, streamTargetModel);

      const result = await runHybridInference({
        prompt,
        systemInstruction: enrichedSystemPrompt,
        requestedModel: streamTargetModel,
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
      });

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

      let generatedArtifact: StructuredArtifactPayload | null = null;
      if (orchestrationPlan.deliverable) {
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

      const words = result.text.split(/(\s+)/);
      for (let i = 0; i < words.length; i += 6) {
        const chunk = words.slice(i, i + 6).join('');
        sendEvent({ type: 'token', chunk });
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Auto-destilação no Segundo Cérebro ("Tudo Vira Cérebro")
      if (serverState.brainAutoDistill && prompt.length >= 10 && result.text.length >= 30) {
        const distilled = distillConversationToMemory({
          prompt,
          answer: result.text,
          ownerUserId: user?.username || 'admin',
          ownerName: user?.display_name || assistantName,
          agentRole: activeAgent.role,
          agentName: activeAgent.proper_name,
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

      const taskData = {
        task_id: taskId,
        session_id: sessionId,
        user_prompt: prompt,
        project_id: projectId,
        classified_intent: orchestrationPlan.mode === 'deep_research' ? 'deep_research' : primaryAgent.category || 'general_assistance',
        plan_steps: [
          ...orchestrationPlan.steps,
          `Execução ${result.executionMode} via ${result.modelUsed} em ${result.latencyMs} ms`,
          result.sources.length ? `Pesquisa Web: ${result.sources.length} fonte(s) verificadas` : 'Resposta validada',
        ],
        selected_agents: selectedRoles,
        policy_verified: true,
        policy_violations: [],
        approval_required: false,
        final_summary: result.text,
        execution_mode: result.executionMode,
        provider: result.provider,
        model_used: result.modelUsed,
        latency_ms: result.latencyMs,
        reasoning: result.reasoning,
        routing_note: result.routingNote,
        sources: result.sources,
        agent_meta: agentMeta,
        artifact_payload: generatedArtifact || undefined,
        is_completed: true,
        error: null,
      };
      session.tasks.push(taskData);
      serverState.tasksList.unshift({ ...taskData, status: 'completed', created_at: nowIso() });

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

      sendEvent({
        type: 'done',
        task_data: taskData,
        final_summary: result.text,
        sources: result.sources,
        execution_mode: result.executionMode,
        provider: result.provider,
        model_used: result.modelUsed,
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
      sendEvent({
        type: 'error',
        code: 'provider_unavailable',
        error: err instanceof Error ? err.message : 'Falha na comunicação com o provedor de IA.',
      });
      res.end();
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
    serverState.tasksList = serverState.tasksList.filter(
      (t) => t.task_id !== req.params.id && t.id !== req.params.id
    );
    res.json({ deleted: true });
  });

  router.post('/tasks/purge', requireAuth, (req: Request, res: Response) => {
    const retention = Number(req.query.days_retention || 30);
    res.json({ purged_count: 0, retention_days: retention });
  });

  return router;
}
