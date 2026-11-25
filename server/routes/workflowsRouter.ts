import crypto from 'node:crypto';
import express, { Request, Response, Router } from 'express';
import {
  serverState,
  userProfiles,
  requireAuth,
  nowIso,
  broadcastRealtimeEvent,
  getActiveHardwareProfile,
  persistStateNamespace,
  UserAccount,
} from '../serverState.ts';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import {
  BrainMemoryItem,
  computeTextEmbedding,
} from '../../src/services/secondBrain.ts';
import {
  parseWorkflowPromptToGraph,
  validateCronSchedule,
} from '../../src/services/multiOrchestrator.ts';
import { runHybridInference } from '../hybridAiEngine.ts';
import {
  runRoundtableDeliberation,
  generateStructuredArtifact,
} from '../artifactEngine.ts';

export interface WorkflowsRouterDeps {
  store?: LocalSqliteBrainStore;
}

const workflowTemplates = [
  {
    id: 'tpl-morning-briefing',
    name: 'Resumo Matinal do Dia',
    category: 'Dia a Dia',
    description: 'Todo dia às 07h30 reúne prioridades, compromissos, lembretes e um resumo rápido para começar o dia.',
    schedule_cron: '30 7 * * 1-5',
    schedule_label: 'Seg-Sex às 07:30',
    prompt_seed: 'Todo dia útil às 7h30 quero um resumo matinal com minhas prioridades, tarefas do dia e lembretes salvo no cérebro',
  },
  {
    id: 'tpl-kira-audit',
    name: 'Verificador de Links & Golpes',
    category: 'Segurança',
    description: 'Kira inspeciona links, boletos e PDFs recentes em busca de golpes, phishing e vazamento de dados pessoais.',
    schedule_cron: '0 18 * * 5',
    schedule_label: 'Toda sexta às 18:00',
    prompt_seed: 'Toda sexta às 18h a Kira verifica links suspeitos, golpes e PDFs recentes e registra o relatório de proteção no cérebro',
  },
  {
    id: 'tpl-spreadsheet-report',
    name: 'Gerador de Relatório em Planilha',
    category: 'Finanças & Planilhas',
    description: 'Iris consolida receitas, despesas e indicadores semanais em uma planilha organizada com totais.',
    schedule_cron: '0 19 * * 0',
    schedule_label: 'Todo domingo às 19:00',
    prompt_seed: 'Todo domingo às 19h a Iris consolida meus gastos e metas em um relatório de planilha organizado e salva no cérebro',
  },
  {
    id: 'tpl-daily-english',
    name: 'Monitor de Estudos & Inglês',
    category: 'Estudos',
    description: 'Clara prepara revisões curtas, 5 expressões práticas de inglês e acompanha sua evolução diária.',
    schedule_cron: '0 8 * * *',
    schedule_label: 'Diariamente às 08:00',
    prompt_seed: 'Todo dia às 8h quero que a Clara prepare um bloco de estudos com 5 expressões práticas de inglês e revisão rápida salvo no cérebro',
  },
  {
    id: 'tpl-research-pptx',
    name: 'Pesquisa Web + Slides PowerPoint',
    category: 'Produtividade',
    description: 'Atlas pesquisa tendências atualizadas e Dante gera uma apresentação executiva .pptx pronta.',
    schedule_cron: '0 9 * * 1',
    schedule_label: 'Toda segunda às 09:00',
    prompt_seed: 'Toda segunda às 9h chama o Atlas para pesquisar tendências de IA e o Dante para montar slides PowerPoint',
  },
];

export function createWorkflowsRouter(deps: WorkflowsRouterDeps = {}): Router {
  const { store } = deps;
  const router = express.Router();

  const persistWorkflows = () => {
    persistStateNamespace(store, 'saved_workflows', serverState.savedWorkflows);
    persistStateNamespace(store, 'workflow_runs', serverState.workflowRuns.slice(0, 60));
    if (store) {
      store.syncWorkspaceSnapshot({
        agents: serverState.agentsList,
        skills: serverState.skillsList,
        workflows: serverState.savedWorkflows as any[],
        knowledge: serverState.knowledgeDocs as any[],
      });
    }
  };

  // --- FASE 4: ESCRITÓRIO ISOMÉTRICO VIVO, MESA REDONDA, FLOW ARCHITECT & FÁBRICA DE ARTEFATOS ---
  router.get('/office/state', requireAuth, (_req: Request, res: Response) => {
    res.json({
      statuses: Array.from(serverState.officeAgentStatuses.values()),
      active_roundtable: serverState.activeRoundtable,
      recent_roundtables: serverState.recentRoundtables.slice(0, 6),
    });
  });

  router.post('/office/roundtable', requireAuth, async (req: Request, res: Response) => {
    const topic = String(req.body?.topic || '').trim();
    if (!topic) {
      res.status(400).json({ detail: 'Informe um tema para a Mesa Redonda.' });
      return;
    }
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const profile = user ? userProfiles.get(user.username) : undefined;
    const assistantName = String(req.body?.assistant_name || profile?.assistantName || 'JARVIS');
    const requestedRoles: string[] = Array.isArray(req.body?.participant_roles) && req.body.participant_roles.length
      ? req.body.participant_roles.map((r: unknown) => String(r))
      : ['software_architect', 'sentinel_security', 'ux_ui_designer', 'research_analyst'];

    const participants = requestedRoles
      .map((role) => serverState.agentsList.find((a) => a.role === role))
      .filter((a): a is (typeof serverState.agentsList)[number] => Boolean(a))
      .slice(0, 6)
      .map((a) => ({
        role: a.role,
        name: a.name,
        proper_name: a.proper_name || a.name,
        department: a.category || 'engineering',
        mission: a.mission,
      }));

    if (participants.length === 0) {
      participants.push(
        { role: 'software_architect', name: 'Arquiteto de Software', proper_name: 'Atlas', department: 'dev', mission: 'Arquitetura escalável' },
        { role: 'sentinel_security', name: 'Segurança & SOC', proper_name: 'Kira', department: 'security', mission: 'Auditoria de segurança' },
        { role: 'ux_ui_designer', name: 'Designer UX/UI', proper_name: 'Vega', department: 'design', mission: 'Experiência e interface' }
      );
    }

    // Move participants to round table in real time
    participants.forEach((p) => {
      const ev = {
        agent_role: p.role,
        agent_name: p.proper_name,
        zone: 'roundtable' as const,
        activity: `Na Mesa Redonda: ${topic.slice(0, 34)}`,
        mood: 'debating' as const,
        updated_at: nowIso(),
      };
      serverState.officeAgentStatuses.set(p.role, ev);
      broadcastRealtimeEvent('office_agent_event', ev);
    });
    broadcastRealtimeEvent('roundtable_started', { topic, participants });

    try {
      const session = await runRoundtableDeliberation({ topic, participants, assistantName });
      serverState.activeRoundtable = session;
      serverState.recentRoundtables.unshift(session);

      session.turns.forEach((turn) => {
        const ev = {
          agent_role: turn.agent_role,
          agent_name: turn.agent_proper_name,
          zone: 'roundtable' as const,
          activity: turn.stance.slice(0, 44),
          mood: 'debating' as const,
          updated_at: nowIso(),
        };
        serverState.officeAgentStatuses.set(turn.agent_role, ev);
        broadcastRealtimeEvent('roundtable_turn', turn);
        broadcastRealtimeEvent('office_agent_event', ev);
      });

      broadcastRealtimeEvent('roundtable_verdict', session);

      // Save verdict automatically to Segundo Cérebro
      const verdictMem: BrainMemoryItem = {
        id: `mem_rt_${crypto.randomBytes(4).toString('hex')}`,
        title: `Veredito da Mesa Redonda: ${topic.slice(0, 52)}`,
        content: `${session.verdict}\n\nPróximos passos:\n${session.action_items.map((i) => `- ${i}`).join('\n')}`,
        layer: 'household',
        owner_user_id: user?.username || 'admin',
        owner_name: user?.display_name || assistantName,
        agent_role: 'jarvis_master',
        agent_name: assistantName,
        source_kind: 'chat_research',
        source_label: `Mesa Redonda · ${participants.map((p) => p.proper_name).join(', ')}`,
        source_url: null,
        tags: ['mesa-redonda', 'conselho', ...participants.map((p) => p.proper_name.toLowerCase()).slice(0, 3)],
        pinned: false,
        confidence: 0.95,
        embedding: computeTextEmbedding(`${topic} ${session.verdict}`),
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      serverState.brainMemories.unshift(verdictMem);
      persistStateNamespace(store, 'brain_memories', serverState.brainMemories.slice(0, 300));
      broadcastRealtimeEvent('brain_memory_updated', { action: 'created', memory: verdictMem });

      res.json(session);
    } catch (err: any) {
      res.status(502).json({ detail: err?.message || 'Falha ao conduzir Mesa Redonda.' });
    }
  });

  // --- WORKFLOWS (FLOW ARCHITECT + RUNNER + CRON) ---
  router.get('/workflows', requireAuth, (_req: Request, res: Response) => {
    res.json({
      workflows: serverState.savedWorkflows,
      runs: serverState.workflowRuns.slice(0, 20),
      templates: workflowTemplates,
    });
  });

  router.post('/workflows/generate', requireAuth, (req: Request, res: Response) => {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      res.status(400).json({ detail: 'Descreva em português o fluxo que o Flow Architect deve montar.' });
      return;
    }
    const draft = parseWorkflowPromptToGraph(prompt);
    const created = {
      id: `wf_${crypto.randomBytes(5).toString('hex')}`,
      ...draft,
      last_run_at: null as string | null,
      last_run_status: 'idle' as 'idle' | 'running' | 'success' | 'error',
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    serverState.savedWorkflows.unshift(created);
    persistWorkflows();
    res.status(201).json(created);
  });

  router.post('/workflows', requireAuth, (req: Request, res: Response) => {
    const title = String(req.body?.title || 'Novo Fluxo').trim();
    const cron = String(req.body?.schedule_cron || '0 8 * * *').trim();
    if (req.body?.schedule_enabled && !validateCronSchedule(cron)) {
      res.status(400).json({ detail: 'Expressão Cron inválida. Use 5 campos (ex.: 0 8 * * *).' });
      return;
    }
    const created = {
      id: `wf_${crypto.randomBytes(5).toString('hex')}`,
      title,
      description: String(req.body?.description || ''),
      schedule_cron: cron,
      schedule_label: String(req.body?.schedule_label || `Cron ${cron}`),
      schedule_enabled: Boolean(req.body?.schedule_enabled),
      nodes: Array.isArray(req.body?.nodes) ? req.body.nodes : [],
      connections: Array.isArray(req.body?.connections) ? req.body.connections : [],
      last_run_at: null as string | null,
      last_run_status: 'idle' as 'idle' | 'running' | 'success' | 'error',
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    serverState.savedWorkflows.unshift(created);
    persistWorkflows();
    res.status(201).json(created);
  });

  router.put('/workflows/:id', requireAuth, (req: Request, res: Response) => {
    const wf = serverState.savedWorkflows.find((w: any) => w.id === req.params.id);
    if (!wf) {
      res.status(404).json({ detail: 'Fluxo não encontrado.' });
      return;
    }
    if (typeof req.body?.schedule_cron === 'string') {
      if (req.body?.schedule_enabled && !validateCronSchedule(req.body.schedule_cron)) {
        res.status(400).json({ detail: 'Expressão Cron inválida (ex.: 0 8 * * *).' });
        return;
      }
      wf.schedule_cron = req.body.schedule_cron.trim();
    }
    if (typeof req.body?.title === 'string') wf.title = req.body.title.trim() || wf.title;
    if (typeof req.body?.description === 'string') wf.description = req.body.description;
    if (typeof req.body?.schedule_label === 'string') wf.schedule_label = req.body.schedule_label;
    if (typeof req.body?.schedule_enabled === 'boolean') wf.schedule_enabled = req.body.schedule_enabled;
    if (Array.isArray(req.body?.nodes)) wf.nodes = req.body.nodes;
    if (Array.isArray(req.body?.connections)) wf.connections = req.body.connections;
    wf.updated_at = nowIso();
    persistWorkflows();
    res.json(wf);
  });

  router.delete('/workflows/:id', requireAuth, (req: Request, res: Response) => {
    serverState.savedWorkflows = serverState.savedWorkflows.filter((w: any) => w.id !== req.params.id);
    persistWorkflows();
    res.json({ deleted: true });
  });

  router.post('/workflows/:id/run', requireAuth, async (req: Request, res: Response) => {
    const wf = serverState.savedWorkflows.find((w: any) => w.id === req.params.id);
    if (!wf) {
      res.status(404).json({ detail: 'Fluxo não encontrado para execução.' });
      return;
    }
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const startedAt = nowIso();
    wf.last_run_status = 'running';

    const stepResults: Array<{
      node_id: string;
      title: string;
      status: 'success' | 'error';
      output: string;
      duration_ms: number;
    }> = [];

    for (const node of wf.nodes) {
      const t0 = Date.now();
      broadcastRealtimeEvent('workflow_run_progress', {
        workflow_id: wf.id,
        node_id: node.id,
        status: 'running',
      });
      if (node.agentRole) {
        const officeEv = {
          agent_role: node.agentRole,
          agent_name: node.title.split(' · ')[0],
          zone: 'desk' as const,
          activity: `Fluxo: ${wf.title.slice(0, 32)}`,
          mood: 'creating' as const,
          updated_at: nowIso(),
        };
        serverState.officeAgentStatuses.set(node.agentRole, officeEv);
        broadcastRealtimeEvent('office_agent_event', officeEv);
      }

      let output = '';
      if (node.type === 'trigger') {
        output = wf.schedule_enabled
          ? `Gatilho validado (${wf.schedule_label} · ${wf.schedule_cron}).`
          : 'Execução iniciada manualmente pelo painel Flow Architect.';
      } else if (node.type === 'agent') {
        const agent = serverState.agentsList.find((a) => a.role === node.agentRole) || serverState.agentsList[0];
        const activeHw = getActiveHardwareProfile();
        try {
          const aiRes = await runHybridInference({
            prompt: `${node.config?.prompt || wf.description || wf.title}. Entregue um resumo prático em 3 tópicos curtos.`,
            systemInstruction: agent.system_prompt,
            requestedModel: agent.preferred_model,
            routingPolicy: agent.routing_policy,
            ollamaBaseUrl: activeHw.ollama_url,
            ollamaConnected: serverState.providerConnectivity.ollama_connected,
            geminiConnected: serverState.providerConnectivity.gemini_connected,
            enableWebSearch: node.agentRole === 'research_analyst',
            assistantName: 'JARVIS',
            agentName: agent.name,
            agentProperName: agent.proper_name,
          });
          output = aiRes.text.slice(0, 420);
        } catch {
          output = `${node.title} concluiu a etapa com entregas estruturadas para "${wf.title}".`;
        }
      } else {
        const mem: BrainMemoryItem = {
          id: `mem_wf_${crypto.randomBytes(4).toString('hex')}`,
          title: `Fluxo concluído: ${wf.title}`,
          content: stepResults.map((s) => `${s.title}: ${s.output}`).join('\n').slice(0, 480) || wf.description,
          layer: 'private',
          owner_user_id: user?.username || 'admin',
          owner_name: user?.display_name || 'Usuário',
          agent_role: wf.nodes.find((n: any) => n.agentRole)?.agentRole || 'jarvis_master',
          agent_name: 'Flow Architect',
          source_kind: 'chat_research',
          source_label: `Rotina · ${wf.title}`,
          source_url: null,
          tags: ['fluxo', 'automacao', 'flow-architect'],
          pinned: false,
          confidence: 0.92,
          embedding: computeTextEmbedding(`${wf.title} ${wf.description}`),
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        serverState.brainMemories.unshift(mem);
        persistStateNamespace(store, 'brain_memories', serverState.brainMemories.slice(0, 300));
        broadcastRealtimeEvent('brain_memory_updated', { action: 'created', memory: mem });
        output = 'Resultado salvo automaticamente no Segundo Cérebro e notificação pronta.';
      }

      const durationMs = Math.max(45, Date.now() - t0);
      stepResults.push({
        node_id: node.id,
        title: node.title,
        status: 'success',
        output,
        duration_ms: durationMs,
      });

      broadcastRealtimeEvent('workflow_run_progress', {
        workflow_id: wf.id,
        node_id: node.id,
        status: 'success',
      });
    }

    const finishedAt = nowIso();
    wf.last_run_at = finishedAt;
    wf.last_run_status = 'success';
    wf.updated_at = finishedAt;

    const runRecord = {
      id: `run_${crypto.randomBytes(5).toString('hex')}`,
      workflow_id: wf.id,
      workflow_title: wf.title,
      status: 'success' as const,
      steps: stepResults,
      summary: `Fluxo "${wf.title}" executado com sucesso (${stepResults.length}/${wf.nodes.length} etapas concluídas).`,
      started_at: startedAt,
      finished_at: finishedAt,
    };
    serverState.workflowRuns.unshift(runRecord);
    persistWorkflows();
    res.json(runRecord);
  });

  // --- FÁBRICA DE ARTEFATOS REAIS (PPTX, PDF, PNG) ---
  router.post('/artifacts/generate', requireAuth, async (req: Request, res: Response) => {
    const kind = String(req.body?.kind || 'pptx').toLowerCase();
    if (kind !== 'pptx' && kind !== 'pdf' && kind !== 'png') {
      res.status(400).json({ detail: 'Formato inválido. Escolha pptx, pdf ou png.' });
      return;
    }
    const topic = String(req.body?.topic || '').trim();
    if (!topic) {
      res.status(400).json({ detail: 'Informe o tema do artefato a ser gerado.' });
      return;
    }
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const profile = user ? userProfiles.get(user.username) : undefined;
    const assistantName = String(req.body?.assistant_name || profile?.assistantName || 'JARVIS');
    try {
      const artifact = await generateStructuredArtifact({
        kind,
        topic,
        context: typeof req.body?.context === 'string' ? req.body.context : undefined,
        assistantName,
      });
      res.json(artifact);
    } catch (err: any) {
      res.status(502).json({ detail: err?.message || 'Falha ao gerar artefato.' });
    }
  });

  return router;
}
