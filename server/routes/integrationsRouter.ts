import crypto from 'node:crypto';
import express, { Request, Response, Router } from 'express';
import {
  serverState,
  requireAuth,
  nowIso,
  recordAgentVersion,
  persistStateNamespace,
  AgentServerRecord,
} from '../serverState.ts';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import { validateSafeExternalUrl } from '../serverHardening.ts';
import {
  ContextSetRecord,
  IntegrationConnectorRecord,
  IntegrationProviderId,
  maskSecret,
} from '../../src/services/integrationsCatalog.ts';
import {
  buildImportedSkillFromGitHub,
  inspectGitHubRepository,
  syncFigmaDesignTokens,
} from '../integrationsEngine.ts';
import {
  CURATED_GITHUB_EXAMPLES,
  GitHubIncorporationMode,
  GitHubRepoInspection,
  buildGitHubKnowledgeMarkdown,
} from '../../src/services/githubImporterEngine.ts';
import { inspectGitHubRepository as inspectGitHubRepoDetailed } from '../githubImporterServer.ts';

export interface IntegrationsRouterDeps {
  store?: LocalSqliteBrainStore;
}

export function createIntegrationsRouter(deps: IntegrationsRouterDeps = {}): Router {
  const { store } = deps;
  const router = express.Router();

  const persistIntegrations = () => {
    persistStateNamespace(store, 'integration_connectors', serverState.integrationConnectors);
    persistStateNamespace(store, 'context_sets', serverState.contextSets);
  };

  const persistWorkspaceAssets = () => {
    persistStateNamespace(store, 'skills_list', serverState.skillsList);
    persistStateNamespace(store, 'knowledge_docs', serverState.knowledgeDocs);
    if (store) {
      store.syncWorkspaceSnapshot({
        agents: serverState.agentsList,
        skills: serverState.skillsList,
        workflows: serverState.savedWorkflows as any[],
        knowledge: serverState.knowledgeDocs as any[],
      });
    }
  };

  // --- FASE 3: INTEGRAÇÕES REAIS (GITHUB, FIGMA, HUGGING FACE) & CONTEXT SETS ---
  router.get('/integrations', requireAuth, (_req: Request, res: Response) => {
    const synced = serverState.integrationConnectors.map((c) =>
      c.id === 'huggingface'
        ? { ...c, connected: serverState.providerConnectivity.huggingface_connected }
        : c
    );
    res.json({ connectors: synced, context_sets: serverState.contextSets });
  });

  router.put('/integrations/:id', requireAuth, (req: Request, res: Response) => {
    const id = req.params.id as IntegrationProviderId;
    const conn = serverState.integrationConnectors.find((c) => c.id === id);
    if (!conn) {
      res.status(404).json({ detail: 'Integração não encontrada.' });
      return;
    }
    if (typeof req.body?.connected === 'boolean') {
      conn.connected = req.body.connected;
      if (id === 'huggingface') {
        serverState.providerConnectivity = { ...serverState.providerConnectivity, huggingface_connected: req.body.connected };
      }
    }
    if (typeof req.body?.token === 'string' && req.body.token.trim()) {
      serverState.integrationSecrets.set(id, req.body.token.trim());
      conn.masked_token = maskSecret(req.body.token.trim());
    }
    if (typeof req.body?.target_ref === 'string') {
      conn.target_ref = req.body.target_ref.trim();
    }
    if (Array.isArray(req.body?.allowed_agents)) {
      conn.allowed_agents = req.body.allowed_agents.map((r: unknown) => String(r));
    }
    conn.last_synced_at = nowIso();
    persistIntegrations();
    res.json(conn);
  });

  router.post('/integrations/github/inspect', requireAuth, async (req: Request, res: Response) => {
    const repo = String(req.body?.repo || '').trim();
    const token =
      typeof req.body?.token === 'string' && req.body.token.trim()
        ? req.body.token.trim()
        : serverState.integrationSecrets.get('github');
    try {
      const inspection = await inspectGitHubRepository(repo, token);
      const gh = serverState.integrationConnectors.find((c) => c.id === 'github');
      if (gh) {
        gh.connected = true;
        gh.target_ref = inspection.full_name;
        gh.last_synced_at = nowIso();
        gh.last_sync_summary = `${inspection.full_name} · ${inspection.language} · ★ ${inspection.stars}`;
        persistIntegrations();
      }
      res.json(inspection);
    } catch (err: any) {
      res.status(400).json({ detail: err?.message || 'Falha ao consultar GitHub.' });
    }
  });

  router.post('/integrations/github/import-skill', requireAuth, async (req: Request, res: Response) => {
    const repo = String(req.body?.repo || '').trim();
    const allowedAgents = Array.isArray(req.body?.allowed_agents) && req.body.allowed_agents.length
      ? req.body.allowed_agents.map((r: unknown) => String(r))
      : ['software_architect', 'frontend_mobile_developer', 'backend_developer'];
    const token = serverState.integrationSecrets.get('github');
    try {
      const inspection = await inspectGitHubRepository(repo, token);
      const parsedSkill = buildImportedSkillFromGitHub(inspection);
      const newSkill = {
        id: `gh_${inspection.owner}_${inspection.repo}_${Date.now()}`.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        name: parsedSkill.name,
        version: '1.0.0',
        origin: `github:${inspection.full_name}`,
        license: 'Repository',
        description: parsedSkill.description,
        domain: parsedSkill.domain,
        allowed_tools: ['read_file', 'search_code'],
        required_permissions: ['skills:read'],
        assigned_agents: allowedAgents,
        content_hash: `sha256:${crypto.randomBytes(6).toString('hex')}`,
        is_approved: true,
        is_revoked: false,
        instructions: parsedSkill.instructions,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      serverState.skillsList.unshift(newSkill);

      const ctx: ContextSetRecord = {
        id: `ctx_gh_${crypto.randomBytes(4).toString('hex')}`,
        name: `GitHub · ${inspection.full_name}`,
        description: inspection.description,
        source_type: 'github',
        source_ref: `https://github.com/${inspection.full_name}`,
        content: parsedSkill.instructions.slice(0, 2400),
        token_estimate: Math.max(80, Math.round(parsedSkill.instructions.length / 4)),
        allowed_agents: allowedAgents,
        tags: ['github', inspection.language.toLowerCase(), inspection.repo.toLowerCase()],
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      serverState.contextSets.unshift(ctx);
      persistIntegrations();
      persistWorkspaceAssets();

      res.status(201).json({ skill: newSkill, context_set: ctx, inspection });
    } catch (err: any) {
      res.status(400).json({ detail: err?.message || 'Falha ao importar pacote do GitHub.' });
    }
  });

  router.post('/integrations/figma/sync', requireAuth, async (req: Request, res: Response) => {
    const fileUrl = String(req.body?.file_url || '').trim();
    if (fileUrl && /^https?:\/\//i.test(fileUrl)) {
      const urlCheck = validateSafeExternalUrl(fileUrl);
      if (!urlCheck.valid) {
        res.status(400).json({ detail: `URL do Figma bloqueada: ${urlCheck.reason}` });
        return;
      }
    }
    const incomingToken = typeof req.body?.token === 'string' && req.body.token.trim() ? req.body.token.trim() : undefined;
    if (incomingToken) {
      serverState.integrationSecrets.set('figma', incomingToken);
    }
    const token = incomingToken || serverState.integrationSecrets.get('figma');
    const allowedAgents = Array.isArray(req.body?.allowed_agents) && req.body.allowed_agents.length
      ? req.body.allowed_agents.map((r: unknown) => String(r))
      : ['ux_ui_designer', 'frontend_mobile_developer'];

    const pack = await syncFigmaDesignTokens(fileUrl, token);
    const figmaConn = serverState.integrationConnectors.find((c) => c.id === 'figma')!;
    figmaConn.connected = true;
    if (incomingToken) figmaConn.masked_token = maskSecret(incomingToken);
    if (fileUrl) figmaConn.target_ref = fileUrl;
    figmaConn.allowed_agents = allowedAgents;
    figmaConn.last_synced_at = nowIso();
    figmaConn.last_sync_summary = `${pack.file_name} · ${pack.colors.length} cores · ${pack.components_count} componentes`;
    figmaConn.metadata = { pack };

    const tokenSummary = [
      `Figma File: ${pack.file_name} (${pack.file_key})`,
      'Cores: ' + pack.colors.map((c) => `${c.name} (${c.hex})`).join(', '),
      'Tipografia: ' + pack.typography.map((t) => `${t.name}: ${t.fontFamily} ${t.sizePx}px`).join(' | '),
    ].join('\n');

    const ctx: ContextSetRecord = {
      id: `ctx_figma_${crypto.randomBytes(4).toString('hex')}`,
      name: `Figma Tokens · ${pack.file_name}`,
      description: `Tokens de cor e tipografia sincronizados para Vega (Design) e Neo (Frontend).`,
      source_type: 'figma',
      source_ref: fileUrl || `figma://${pack.file_key}`,
      content: tokenSummary,
      token_estimate: Math.max(90, Math.round(tokenSummary.length / 4)),
      allowed_agents: allowedAgents,
      tags: ['figma', 'tokens', 'design'],
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    serverState.contextSets.unshift(ctx);
    persistIntegrations();

    res.status(201).json({ pack, context_set: ctx, connector: figmaConn });
  });

  router.post('/integrations/context-sets', requireAuth, (req: Request, res: Response) => {
    const name = String(req.body?.name || '').trim();
    const content = String(req.body?.content || '').trim();
    if (!name || !content) {
      res.status(400).json({ detail: 'Nome e conteúdo são obrigatórios para o Context Set.' });
      return;
    }
    const created: ContextSetRecord = {
      id: `ctx_${crypto.randomBytes(5).toString('hex')}`,
      name,
      description: String(req.body?.description || 'Pacote de contexto acoplável aos especialistas.'),
      source_type: (req.body?.source_type || 'markdown') as ContextSetRecord['source_type'],
      source_ref: String(req.body?.source_ref || 'manual.md'),
      content,
      token_estimate: Math.max(40, Math.round(content.length / 4)),
      allowed_agents: Array.isArray(req.body?.allowed_agents) && req.body.allowed_agents.length
        ? req.body.allowed_agents.map((r: unknown) => String(r))
        : ['jarvis_master'],
      tags: Array.isArray(req.body?.tags) ? req.body.tags.map((t: unknown) => String(t)) : ['contexto'],
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    serverState.contextSets.unshift(created);
    persistIntegrations();
    res.status(201).json(created);
  });

  router.put('/integrations/context-sets/:id/agents', requireAuth, (req: Request, res: Response) => {
    const ctx = serverState.contextSets.find((c) => c.id === req.params.id);
    if (!ctx) {
      res.status(404).json({ detail: 'Context Set não encontrado.' });
      return;
    }
    ctx.allowed_agents = Array.isArray(req.body?.allowed_agents)
      ? req.body.allowed_agents.map((r: unknown) => String(r))
      : [];
    ctx.updated_at = nowIso();
    persistIntegrations();
    res.json(ctx);
  });

  router.delete('/integrations/context-sets/:id', requireAuth, (req: Request, res: Response) => {
    serverState.contextSets = serverState.contextSets.filter((c) => c.id !== req.params.id);
    persistIntegrations();
    res.json({ deleted: true });
  });

  // ==================== FASE 6: IMPORTADOR DE REPOSITÓRIOS DO GITHUB ====================
  router.get('/github/history', requireAuth, (_req: Request, res: Response) => {
    const items = Array.from(serverState.githubInspectionStore.values()).sort((a, b) =>
      a.inspectedAt < b.inspectedAt ? 1 : -1
    );
    res.json({ examples: CURATED_GITHUB_EXAMPLES, items });
  });

  router.post('/github/inspect', requireAuth, async (req: Request, res: Response) => {
    try {
      const url = String(req.body?.url || '').trim();
      const useAi = Boolean(req.body?.useAi);
      const inspection = await inspectGitHubRepoDetailed({ url, useAi });
      serverState.githubInspectionStore.set(inspection.id, inspection);

      if (serverState.githubInspectionStore.size > 25) {
        const oldestKey = serverState.githubInspectionStore.keys().next().value;
        if (oldestKey) serverState.githubInspectionStore.delete(oldestKey);
      }

      res.json(inspection);
    } catch (err: any) {
      res.status(400).json({
        error: err?.message || 'Não foi possível analisar este repositório do GitHub.',
      });
    }
  });

  router.post('/github/incorporate', requireAuth, (req: Request, res: Response) => {
    const inspectionId = String(req.body?.inspectionId || '').trim();
    const mode = String(req.body?.mode || '') as GitHubIncorporationMode;
    const approvedByUser = req.body?.approvedByUser === true;
    const customName = String(req.body?.customName || '').trim();
    const requestedAgents: string[] = Array.isArray(req.body?.assignedAgents)
      ? Array.from(new Set(req.body.assignedAgents.map(String)))
      : [];

    if (!approvedByUser) {
      res.status(400).json({
        error: 'É necessária a confirmação explícita do usuário antes de incorporar o repositório.',
      });
      return;
    }

    const inspection = serverState.githubInspectionStore.get(inspectionId);
    if (!inspection) {
      res.status(404).json({
        error: 'Análise do repositório não encontrada. Faça a leitura do link do GitHub novamente.',
      });
      return;
    }

    if (mode !== 'skill' && mode !== 'agent' && mode !== 'knowledge') {
      res.status(400).json({ error: 'Modo de incorporação inválido. Use skill, agent ou knowledge.' });
      return;
    }

    if (mode === 'skill') {
      const skillName = customName || inspection.suggestedSkillName;
      const validAgentRoles = requestedAgents.filter((role) => serverState.agentsList.some((a) => a.role === role));
      const slug = skillName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      const instructions = [
        `Origem GitHub (somente leitura): ${inspection.canonicalUrl}`,
        `Resumo: ${inspection.summaryPtBr}`,
        `Como aplicar no Calmon Studio: ${inspection.howItBoostsJarvis}`,
        inspection.detectedCapabilities.length
          ? `Capacidades detectadas:\n${inspection.detectedCapabilities.map((c) => `- ${c.title}: ${c.description}`).join('\n')}`
          : '',
        inspection.detectedScripts.length
          ? `Comandos/Scripts de referência: ${inspection.detectedScripts.join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const createdSkill = {
        id: `skill_gh_${slug || Date.now()}_${Date.now().toString(36).slice(-4)}`,
        name: skillName,
        version: '1.0.0',
        origin: 'github',
        license: inspection.license || 'Open Source',
        description: inspection.summaryPtBr,
        domain: inspection.suggestedCategory,
        allowed_tools: ['read_file', 'web_search'],
        required_permissions: ['skills:read'],
        assigned_agents: validAgentRoles,
        content_hash: `sha256:${crypto.randomBytes(6).toString('hex')}`,
        is_approved: true,
        is_revoked: false,
        instructions,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      serverState.skillsList.unshift(createdSkill);

      // Sincronização bidirecional com os agentes selecionados
      for (const ag of serverState.agentsList) {
        if (validAgentRoles.includes(ag.role)) {
          const current = Array.isArray(ag.installed_skills) ? ag.installed_skills : [];
          if (!current.includes(createdSkill.name)) {
            ag.installed_skills = [...current, createdSkill.name];
          }
        }
      }

      if (!inspection.incorporatedModes.includes('skill')) {
        inspection.incorporatedModes.push('skill');
      }
      persistWorkspaceAssets();
      res.status(201).json({
        mode: 'skill',
        inspection,
        created: createdSkill,
        message:
          validAgentRoles.length > 0
            ? `Habilidade "${createdSkill.name}" criada e vinculada a ${validAgentRoles.length} agente(s).`
            : `Habilidade "${createdSkill.name}" criada na página de Habilidades.`,
      });
      return;
    }

    if (mode === 'agent') {
      const displayName = customName || inspection.suggestedAgentName;
      const rawSlug = `gh_${inspection.repo}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const role = serverState.agentsList.some((a) => a.role === rawSlug)
        ? `${rawSlug}_${Date.now().toString(36).slice(-4)}`
        : rawSlug || `gh_agent_${Date.now().toString(36)}`;

      const colorByCat: Record<string, string> = {
        dev: '#38bdf8',
        business: '#f97316',
        creative: '#a855f7',
        security: '#10b981',
        studies: '#eab308',
      };
      const linkedSkillName = inspection.suggestedSkillName;

      const createdAgent: AgentServerRecord = {
        role,
        name: displayName,
        proper_name: displayName,
        handle: inspection.suggestedAgentHandle,
        category: inspection.suggestedCategory,
        mission: inspection.suggestedMission,
        preferred_model: 'gemini-4-hydrogen',
        routing_policy: 'auto_hybrid',
        autonomy_level: 'ask_approval',
        is_read_only: false,
        strict_focus: false,
        strict_topic: inspection.fullName,
        delegation_targets: [],
        allowed_tools: ['read_file', 'web_search'],
        system_prompt: [
          `Você é ${displayName}, especialista incorporado a partir do repositório GitHub ${inspection.fullName} (${inspection.canonicalUrl}).`,
          `Resumo do projeto: ${inspection.summaryPtBr}`,
          `Capacidades principais: ${inspection.detectedCapabilities.map((c) => c.title).join('; ')}.`,
          `Sempre responda em português do Brasil claro e prático, aplicando as convenções e soluções desse projeto para ajudar o usuário.`,
        ].join('\n'),
        mascot: {
          id: 'maestro_slime',
          color: colorByCat[inspection.suggestedCategory] || '#f97316',
          accessory: 'glasses',
          mood: 'idle',
        },
        is_custom: true,
        installed_skills: [linkedSkillName],
        version: 1,
        updated_at: nowIso(),
      };
      serverState.agentsList.unshift(createdAgent);
      recordAgentVersion(createdAgent, `Incorporado do GitHub (${inspection.fullName})`);

      // Garante a habilidade vinculada ao novo especialista
      const existingSkill = serverState.skillsList.find(
        (s) => s.name.toLowerCase() === linkedSkillName.toLowerCase()
      );
      if (existingSkill) {
        if (!existingSkill.assigned_agents.includes(createdAgent.role)) {
          existingSkill.assigned_agents.push(createdAgent.role);
          existingSkill.updated_at = nowIso();
        }
      } else {
        serverState.skillsList.unshift({
          id: `skill_gh_agent_${Date.now().toString(36)}`,
          name: linkedSkillName,
          version: '1.0.0',
          origin: 'github',
          license: inspection.license || 'Open Source',
          description: inspection.summaryPtBr,
          domain: inspection.suggestedCategory,
          allowed_tools: ['read_file', 'web_search'],
          required_permissions: ['skills:read'],
          assigned_agents: [createdAgent.role],
          content_hash: `sha256:${crypto.randomBytes(6).toString('hex')}`,
          is_approved: true,
          is_revoked: false,
          instructions: `Conhecimento e capacidades incorporados de ${inspection.canonicalUrl}.`,
          created_at: nowIso(),
          updated_at: nowIso(),
        });
      }

      if (!inspection.incorporatedModes.includes('agent')) {
        inspection.incorporatedModes.push('agent');
      }
      persistWorkspaceAssets();
      res.status(201).json({
        mode: 'agent',
        inspection,
        created: createdAgent,
        message: `Especialista "${createdAgent.name}" (${createdAgent.handle}) incorporado ao Dock e ao Chat.`,
      });
      return;
    }

    // mode === 'knowledge'
    const markdown = buildGitHubKnowledgeMarkdown(inspection);
    const docName = customName
      ? `${customName.replace(/\.md$/i, '')}.md`
      : `github-${inspection.owner}-${inspection.repo}.md`;

    const createdDoc = {
      name: docName,
      category: 'github',
      chunks: Math.max(1, Math.ceil(markdown.length / 650)),
      size_bytes: Buffer.byteLength(markdown, 'utf8'),
      file_type: 'md',
      indexed_at: nowIso(),
      content: markdown,
    };
    serverState.knowledgeDocs = [createdDoc, ...serverState.knowledgeDocs.filter((d) => d.name !== createdDoc.name)];

    if (!inspection.incorporatedModes.includes('knowledge')) {
      inspection.incorporatedModes.push('knowledge');
    }
    persistWorkspaceAssets();
    res.status(201).json({
      mode: 'knowledge',
      inspection,
      created: createdDoc,
      message: `Documentação "${createdDoc.name}" indexada na Base de Conhecimento.`,
    });
  });

  return router;
}
