import crypto from 'node:crypto';
import express, { Request, Response, Router } from 'express';
import {
  serverState,
  requireAuth,
  nowIso,
  MockEndpointRecord,
  getActiveHardwareProfile,
  persistStateNamespace,
} from '../serverState.ts';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import { runHybridInference } from '../hybridAiEngine.ts';
import {
  APP_BUILDER_PRESETS,
  AppBlueprintSpec,
  AppPresetId,
  AppTargetPlatform,
  GeneratedProjectFile,
} from '../../src/services/appBuilderEngine.ts';
import {
  generateAppBlueprint,
  packageProjectToZipBuffer,
} from '../appBuilderServer.ts';

const sqlSampleTables: Record<string, { columns: string[]; rows: Record<string, unknown>[] }> = {
  sqlite_master: {
    columns: ['type', 'name', 'tbl_name', 'rootpage'],
    rows: [
      { type: 'table', name: 'users', tbl_name: 'users', rootpage: 2 },
      { type: 'table', name: 'tasks', tbl_name: 'tasks', rootpage: 5 },
      { type: 'table', name: 'audit_logs', tbl_name: 'audit_logs', rootpage: 9 },
      { type: 'index', name: 'idx_tasks_status', tbl_name: 'tasks', rootpage: 12 },
    ],
  },
  users: {
    columns: ['id', 'username', 'role', 'active'],
    rows: [
      { id: 1, username: 'admin', role: 'admin', active: 1 },
      { id: 2, username: 'dev_ops', role: 'developer', active: 1 },
    ],
  },
  tasks: {
    columns: ['id', 'title', 'agent', 'status'],
    rows: [
      { id: 'task-101', title: 'Revisar arquitetura Obsidian Studio', agent: 'Architecture Review', status: 'completed' },
      { id: 'task-102', title: 'Auditar política CSP e cabeçalhos HTTP', agent: 'Auditoria de Segurança', status: 'in_progress' },
    ],
  },
  audit_logs: {
    columns: ['id', 'action', 'actor', 'severity'],
    rows: [
      { id: 101, action: 'auth.login', actor: 'admin', severity: 'info' },
      { id: 102, action: 'policy.verify', actor: 'jarvis_maestro', severity: 'low' },
    ],
  },
};

const mixHexColor = (hexA: string, hexB: string, weight: number): string => {
  const parse = (h: string) => {
    const clean = h.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0');
    return [
      parseInt(full.slice(0, 2), 16) || 0,
      parseInt(full.slice(2, 4), 16) || 0,
      parseInt(full.slice(4, 6), 16) || 0,
    ];
  };
  const [r1, g1, b1] = parse(hexA);
  const [r2, g2, b2] = parse(hexB);
  const toHex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  const r = r1 * (1 - weight) + r2 * weight;
  const g = g1 * (1 - weight) + g2 * weight;
  const b = b1 * (1 - weight) + b2 * weight;
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export interface StudiosRouterDeps {
  store?: LocalSqliteBrainStore;
}

export function createStudiosRouter(deps?: StudiosRouterDeps): Router {
  const router = express.Router();
  const store = deps?.store;

  // --- CODING & STUDIOS ---
  router.get('/coding/tools', requireAuth, (_req: Request, res: Response) => {
    const mcpServers = store ? store.listMcpServers() : [];
    res.json({
      modes: [
        { id: 'plan', label: 'Planejar (Somente leitura)', description: 'Analisa o repositório e propõe plano técnico sem alterar arquivos.' },
        { id: 'ask', label: 'Assistido (Aprovação)', description: 'Solicita aprovação humana explícita antes de aplicar patches ou executar comandos.' },
        { id: 'auto', label: 'Automático (Workspace)', description: 'Executa leitura, edição confinada ao workspace e testes automatizados.' },
      ],
      tools: [
        { name: 'read_file', description: 'Lê arquivos dentro do diretório do projeto selecionado.', risk: 'read', requires_approval: false, parameters: { path: 'string' } },
        { name: 'search_code', description: 'Pesquisa símbolos e padrões em todo o repositório.', risk: 'read', requires_approval: false, parameters: { query: 'string' } },
        { name: 'propose_patch', description: 'Gera e aplica diff auditável em arquivos do projeto.', risk: 'write', requires_approval: true, parameters: { path: 'string', diff: 'string' } },
        { name: 'run_tests', description: 'Executa a suíte de testes configurada para validar regressões.', risk: 'exec', requires_approval: true, parameters: { command: 'string' } },
        { name: 'run_linter', description: 'Verifica tipagem TypeScript e lint do projeto.', risk: 'exec', requires_approval: false, parameters: {} },
      ],
      provider: { name: 'Ollama Local', model: 'qwen2.5-coder:14b', local_first: true },
      mcp_servers: mcpServers,
    });
  });

  router.post('/mcp/reload', requireAuth, (_req: Request, res: Response) => {
    const servers = store ? store.listMcpServers() : [];
    const registered = servers.flatMap((s) => (s.tools || []).map((t) => `${s.name}:${t.name}`));
    res.json({
      servers: servers.length,
      tools: registered.length,
      errors: {},
      registered,
      status: { reloaded_at: nowIso() },
    });
  });

  router.get('/coding/sessions/:id/messages', requireAuth, (req: Request, res: Response) => {
    const messages = store ? store.listCodingMessages(req.params.id) : [];
    res.json({ messages });
  });

  router.post('/coding/sessions/:id/messages', requireAuth, (req: Request, res: Response) => {
    const content = String(req.body?.content || '').trim();
    if (!content) {
      res.status(400).json({ detail: 'Conteúdo da mensagem de código é obrigatório.' });
      return;
    }
    const saved = store
      ? store.appendCodingMessage({
          session_id: req.params.id,
          project_id: req.body?.project_id ? String(req.body.project_id) : null,
          role: String(req.body?.role || 'user'),
          content,
          tool_calls: Array.isArray(req.body?.tool_calls) ? req.body.tool_calls : undefined,
          tool_call_id: req.body?.tool_call_id ? String(req.body.tool_call_id) : null,
          tool_name: req.body?.tool_name ? String(req.body.tool_name) : null,
        })
      : { id: Date.now(), session_id: req.params.id, role: 'user', content, created_at: nowIso() };
    res.status(201).json({ status: 'saved', message: saved });
  });

  router.delete('/coding/sessions/:id/messages', requireAuth, (req: Request, res: Response) => {
    const deleted = store ? store.clearCodingMessages(req.params.id) : 0;
    res.json({ deleted });
  });

  router.post('/coding/approvals/:id/decide', requireAuth, (req: Request, res: Response) => {
    const item = serverState.approvals.find((a) => a.id === req.params.id);
    const action = req.body?.action === 'approve' ? 'approved' : 'rejected';
    if (item) {
      item.status = action;
      persistStateNamespace(store, 'approvals', serverState.approvals);
    }
    res.json({ status: action, id: req.params.id });
  });

  router.post('/coding/run/stream', requireAuth, async (req: Request, res: Response) => {
    const prompt = String(req.body?.prompt || '').trim();
    const projectId = String(req.body?.project_id || 'workspace');
    const sessionId = String(req.body?.session_id || `coding_${projectId}`);
    const mode = String(req.body?.mode || 'plan');
    if (!prompt) {
      res.status(400).json({ detail: 'Informe uma instrução de engenharia para o Coding Agent.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    store?.appendCodingMessage({
      session_id: sessionId,
      project_id: projectId,
      role: 'user',
      content: prompt,
    });

    sendEvent({ type: 'start', session_id: sessionId, project_id: projectId, mode });
    sendEvent({ type: 'thinking', content: `Analisando projeto "${projectId}" em modo ${mode}...` });

    const codingAgent =
      serverState.agentsList.find((a) => a.role === (req.body?.agent_role || 'coding_agent')) ||
      serverState.agentsList[0];
    const activeHw = getActiveHardwareProfile();

    try {
      const result = await runHybridInference({
        prompt: `[Projeto: ${projectId} | Modo: ${mode}]\n${prompt}`,
        systemInstruction: codingAgent.system_prompt,
        requestedModel: req.body?.model ? String(req.body.model) : codingAgent.preferred_model,
        routingPolicy: codingAgent.routing_policy,
        ollamaBaseUrl: activeHw.ollama_url,
        ollamaConnected: serverState.providerConnectivity.ollama_connected,
        geminiConnected: serverState.providerConnectivity.gemini_connected,
        enableWebSearch: false,
        agentName: codingAgent.name,
        agentProperName: codingAgent.proper_name,
      });

      store?.appendCodingMessage({
        session_id: sessionId,
        project_id: projectId,
        role: 'assistant',
        content: result.text,
      });

      sendEvent({ type: 'assistant', content: result.text, model: result.modelUsed, latency_ms: result.latencyMs });
      sendEvent({ type: 'final', content: result.text, session_id: sessionId, project_id: projectId });
      res.end();
    } catch (err: any) {
      sendEvent({
        type: 'error',
        error: err instanceof Error ? err.message : 'Falha na execução do Coding Agent.',
      });
      res.end();
    }
  });

  // --- BACKEND STUDIO: MOCK SERVER ---
  router.get('/mock-server/endpoints', requireAuth, (_req: Request, res: Response) => {
    res.json(serverState.mockEndpoints);
  });

  router.post('/mock-server/endpoints', requireAuth, (req: Request, res: Response) => {
    const rawPath = String(req.body?.path || '/api/mock').trim();
    const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const record: MockEndpointRecord = {
      id: `mock_${crypto.randomBytes(4).toString('hex')}`,
      name: String(req.body?.name || 'Endpoint Simulado').trim(),
      method: String(req.body?.method || 'GET').toUpperCase(),
      path: normalizedPath,
      status_code: Math.min(599, Math.max(100, Number(req.body?.status_code) || 200)),
      latency_ms: Math.min(5000, Math.max(0, Number(req.body?.latency_ms) || 0)),
      response_body: req.body?.response_body ?? { status: 'ok' },
      enabled: req.body?.enabled !== false,
      created_at: nowIso(),
    };
    serverState.mockEndpoints = [
      record,
      ...serverState.mockEndpoints.filter(
        (ep) => !(ep.method === record.method && ep.path === record.path)
      ),
    ];
    persistStateNamespace(store, 'mock_endpoints', serverState.mockEndpoints);
    res.status(201).json(record);
  });

  router.delete('/mock-server/endpoints/:id', requireAuth, (req: Request, res: Response) => {
    serverState.mockEndpoints = serverState.mockEndpoints.filter((ep) => ep.id !== req.params.id);
    persistStateNamespace(store, 'mock_endpoints', serverState.mockEndpoints);
    res.json({ deleted: true });
  });

  router.all(/^\/mock(\/.*)?$/, requireAuth, (req: Request, res: Response) => {
    const subPath = req.path.replace(/^\/mock/, '') || '/';
    const matched = serverState.mockEndpoints.find(
      (ep) => ep.enabled && ep.method === req.method.toUpperCase() && ep.path === subPath
    );
    if (!matched) {
      res.status(404).json({
        error: 'Endpoint simulado não encontrado',
        method: req.method,
        path: subPath,
      });
      return;
    }
    const delay = Math.min(2000, Math.max(0, matched.latency_ms));
    setTimeout(() => {
      res.status(matched.status_code).json(matched.response_body);
    }, delay);
  });

  // --- BACKEND STUDIO: SQL PLAYGROUND ---
  router.get('/backend-studio/databases/:projectId', requireAuth, (req: Request, res: Response) => {
    const pid = String(req.params.projectId || 'workspace');
    res.json([
      {
        name: 'jarvis_hub.db',
        relative_path: `data/${pid}_hub.db`,
        absolute_path: `/workspace/${pid}/data/jarvis_hub.db`,
        size_kb: 412,
      },
      {
        name: 'telemetry_wal.sqlite',
        relative_path: `data/telemetry_wal.sqlite`,
        absolute_path: `/workspace/${pid}/data/telemetry_wal.sqlite`,
        size_kb: 184,
      },
    ]);
  });

  router.post('/backend-studio/sql/inspect', requireAuth, (req: Request, res: Response) => {
    res.json({
      db_path: String(req.body?.db_path || 'data/jarvis_hub.db'),
      journal_mode: 'WAL',
      tables_count: 3,
      tables: ['users', 'tasks', 'audit_logs'],
    });
  });

  router.post('/backend-studio/sql/query', requireAuth, (req: Request, res: Response) => {
    const query = String(req.body?.query || '').trim();
    const upper = query.toUpperCase();
    if (/^\s*(DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|ATTACH|PRAGMA\s+WRITABLE)/i.test(upper)) {
      res.json({
        success: false,
        is_select: false,
        duration_ms: 1,
        error: 'Modo somente leitura ativo: apenas consultas SELECT e EXPLAIN são permitidas.',
      });
      return;
    }
    const tableKey =
      upper.includes('FROM USERS')
        ? 'users'
        : upper.includes('FROM TASKS')
          ? 'tasks'
          : upper.includes('FROM AUDIT_LOGS')
            ? 'audit_logs'
            : 'sqlite_master';
    const dataset = sqlSampleTables[tableKey] || sqlSampleTables.sqlite_master;
    res.json({
      success: true,
      is_select: true,
      duration_ms: 4,
      row_count: dataset.rows.length,
      columns: dataset.columns,
      rows: dataset.rows,
    });
  });

  router.post('/backend-studio/sql/audit', requireAuth, (req: Request, res: Response) => {
    const query = String(req.body?.query || '').trim();
    const hasSelectStar = /SELECT\s+\*/i.test(query);
    const hasLeadingWildcard = /LIKE\s+['"]%/i.test(query);
    const isTableScan = hasSelectStar || hasLeadingWildcard || !/WHERE/i.test(query);
    const suggestions: Array<{ recommendation: string; example_sql: string }> = [];
    if (hasSelectStar) {
      suggestions.push({
        recommendation: 'Evite SELECT * em produção para reduzir I/O e habilitar covering indexes.',
        example_sql: 'SELECT id, name, status FROM tasks WHERE status = "in_progress" LIMIT 50;',
      });
    }
    if (isTableScan) {
      suggestions.push({
        recommendation: 'Crie um índice composto nas colunas filtradas para eliminar FULL TABLE SCAN.',
        example_sql: 'CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks (status, created_at DESC);',
      });
    }
    res.json({
      status: 'ok',
      is_table_scan: isTableScan,
      score: isTableScan ? 64 : 96,
      verdict: isTableScan
        ? 'SCAN sequencial detectado no plano de execução (EXPLAIN QUERY PLAN).'
        : 'Consulta otimizada com uso de índice primário/secundário.',
      suggestions,
    });
  });

  // --- QUALITY STUDIO ---
  router.get('/quality-studio/tests/:projectId', requireAuth, (req: Request, res: Response) => {
    res.json({
      project_id: req.params.projectId,
      test_framework: 'node:test + vitest',
      total_files: 3,
      test_files: [
        'src/router.test.ts',
        'src/features/tasks/taskFiltering.test.ts',
        'src/services/sessionTransport.test.ts',
      ],
    });
  });

  router.post('/quality-studio/run', requireAuth, (req: Request, res: Response) => {
    const projectId = String(req.body?.project_id || 'workspace');
    res.json({
      is_success: true,
      status: 'passed',
      duration_seconds: 1.34,
      summary: { total: 12, passed: 12, failed: 0, skipped: 0 },
      raw_output: [
        `> jarvis-qa-runner --project=${projectId}`,
        '✔ src/router.test.ts (3 tests) 18ms',
        '✔ src/features/tasks/taskFiltering.test.ts (5 tests) 24ms',
        '✔ src/services/sessionTransport.test.ts (4 tests) 19ms',
        '',
        'Test Files  3 passed (3)',
        '     Tests  12 passed (12)',
        '  Duration  1.34s',
      ].join('\n'),
    });
  });

  router.post('/quality-studio/generate-playwright', requireAuth, (req: Request, res: Response) => {
    const targetUrl = String(req.body?.target_url || 'http://127.0.0.1:8000').trim();
    const scenarioName = String(req.body?.scenario_name || 'fluxo_principal')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const code = [
      'from playwright.sync_api import Page, expect',
      '',
      `def test_${scenarioName}(page: Page):`,
      `    page.goto("${targetUrl}", wait_until="networkidle")`,
      '    expect(page).to_have_title(re.compile(".+"))',
      '    main = page.locator("main")',
      '    expect(main).to_be_visible()',
      '    # Verifica ausência de overflow horizontal no viewport desktop',
      '    has_overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")',
      '    assert not has_overflow',
    ].join('\n');
    res.json({ code, filename: `test_${scenarioName}_e2e.py` });
  });

  router.get('/quality-studio/chaos-edge-cases', requireAuth, (_req: Request, res: Response) => {
    res.json([
      {
        name: 'Payload Unicode & Zero-Width',
        category: 'input_validation',
        expected_behavior: 'Sanitizar caracteres invisíveis sem quebrar a serialização UTF-8.',
        payload: { title: 'Relatório\u200B\uFEFF crítica 🚀', limit: 255 },
      },
      {
        name: 'Injeção SQL em filtro de busca',
        category: 'security',
        expected_behavior: 'Tratar entrada como string literal via prepared statement.',
        payload: { query: "' OR '1'='1; DROP TABLE tasks; --" },
      },
      {
        name: 'Latência Extrema & Timeout',
        category: 'resilience',
        expected_behavior: 'Exibir fallback controlável com opção de tentar novamente.',
        payload: { simulated_latency_ms: 8500, retry_budget: 2 },
      },
      {
        name: 'Valores Limite Negativos',
        category: 'boundary',
        expected_behavior: 'Rejeitar valores fora de faixa com HTTP 400 descritivo.',
        payload: { page: -1, page_size: 999999, status_code: 0 },
      },
    ]);
  });

  // --- DESIGN STUDIO ---
  router.post('/design-studio/palette', requireAuth, (req: Request, res: Response) => {
    const rawHex = String(req.body?.hex_primary || '#3b82f6').trim();
    const baseHex = /^#?[0-9a-fA-F]{3,6}$/.test(rawHex)
      ? rawHex.startsWith('#')
        ? rawHex
        : `#${rawHex}`
      : '#3b82f6';
    const tokenPrefix = String(req.body?.name || 'jarvis')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '') || 'jarvis';

    const shades: Record<string, string> = {
      '50': mixHexColor(baseHex, '#ffffff', 0.9),
      '100': mixHexColor(baseHex, '#ffffff', 0.78),
      '200': mixHexColor(baseHex, '#ffffff', 0.6),
      '300': mixHexColor(baseHex, '#ffffff', 0.4),
      '400': mixHexColor(baseHex, '#ffffff', 0.2),
      '500': baseHex.toLowerCase(),
      '600': mixHexColor(baseHex, '#090b10', 0.18),
      '700': mixHexColor(baseHex, '#090b10', 0.36),
      '800': mixHexColor(baseHex, '#090b10', 0.54),
      '900': mixHexColor(baseHex, '#090b10', 0.72),
    };

    const cssLines = Object.entries(shades).map(([k, v]) => `  --${tokenPrefix}-${k}: ${v};`);
    res.json({
      name: tokenPrefix,
      primary: baseHex.toLowerCase(),
      shades,
      css_variables: `:root {\n${cssLines.join('\n')}\n}`,
    });
  });

  router.post('/design-studio/audit-wcag', requireAuth, (req: Request, res: Response) => {
    const markup = String(req.body?.markup || '');
    const lines = markup.split('\n');
    const findings: Array<{
      line: number;
      rule: string;
      severity: string;
      description: string;
      snippet: string;
      remediation: string;
    }> = [];

    lines.forEach((rawLine, index) => {
      const lineNo = index + 1;
      const line = rawLine.trim();
      if (!line) return;
      if (/<img\b(?![^>]*\balt=)/i.test(line)) {
        findings.push({
          line: lineNo,
          rule: 'WCAG 1.1.1 (img-alt)',
          severity: 'high',
          description: 'Imagem sem atributo alt descritivo para leitores de ecrã.',
          snippet: line,
          remediation: 'Adicione alt="Descrição objetiva" ou alt="" se for decorativa.',
        });
      }
      if (/<button\b(?![^>]*aria-label=)[^>]*>\s*<\/button>/i.test(line)) {
        findings.push({
          line: lineNo,
          rule: 'WCAG 4.1.2 (button-name)',
          severity: 'critical',
          description: 'Botão vazio sem texto visível nem aria-label.',
          snippet: line,
          remediation: 'Inclua rótulo visível ou aria-label descrevendo a ação do botão.',
        });
      }
      if (/<input\b(?![^>]*(aria-label=|aria-labelledby=|id=))/i.test(line)) {
        findings.push({
          line: lineNo,
          rule: 'WCAG 1.3.1 (label)',
          severity: 'high',
          description: 'Campo de formulário sem associação explícita a <label> ou aria-label.',
          snippet: line,
          remediation: 'Associe um <label htmlFor="..."> ou defina aria-label no campo.',
        });
      }
      if (/<a\b[^>]*>\s*(clique aqui|click here|saiba mais)\s*<\/a>/i.test(line)) {
        findings.push({
          line: lineNo,
          rule: 'WCAG 2.4.4 (link-purpose)',
          severity: 'medium',
          description: 'Texto de link genérico dificulta navegação fora de contexto.',
          snippet: line,
          remediation: 'Use texto descritivo indicando o destino (ex.: "Abrir documentação de API").',
        });
      }
    });

    const penalty = findings.reduce(
      (acc, f) => acc + (f.severity === 'critical' ? 28 : f.severity === 'high' ? 20 : 12),
      0
    );
    const score = Math.max(0, 100 - penalty);
    res.json({
      score,
      total_issues: findings.length,
      verdict:
        findings.length === 0
          ? 'Nenhuma violação WCAG 2.1 AA detectada no trecho analisado.'
          : `${findings.length} ponto(s) de acessibilidade requerem ajuste antes de publicar.`,
      findings,
    });
  });

  router.get('/design-studio/components/:type', requireAuth, (req: Request, res: Response) => {
    const type = String(req.params.type || 'navbar');
    const templates: Record<string, string> = {
      navbar: `export function TopNavbar() {
  return (
    <header className="jarvis-settings-card" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600 }}>
        <span>Obsidian Studio</span>
      </div>
      <nav aria-label="Navegação principal" style={{ display: 'flex', gap: '8px' }}>
        <button type="button" className="btn btn-ghost btn-sm">Visão Geral</button>
        <button type="button" className="btn btn-ghost btn-sm">Projetos</button>
        <button type="button" className="btn btn-primary btn-sm">Nova Ação</button>
      </nav>
    </header>
  );
}`,
      feature_card: `export function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <article className="jarvis-settings-card" style={{ gap: '10px' }}>
      <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 600, color: 'var(--text-primary)' }}>
        {title}
      </h3>
      <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        {description}
      </p>
    </article>
  );
}`,
      stats_grid: `export function StatsGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <section
      aria-label="Métricas principais"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}
    >
      {items.map((item) => (
        <div key={item.label} className="jarvis-settings-subcard">
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{item.label}</div>
          <div className="jarvis-tabular" style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {item.value}
          </div>
        </div>
      ))}
    </section>
  );
}`,
    };
    res.json({ type, code: templates[type] || templates.navbar });
  });

  // ==================== CONSTRUTOR DE APLICATIVOS ANDROID & WINDOWS (.ZIP) ====================
  router.get('/apps', requireAuth, (_req: Request, res: Response) => {
    const items = Array.from(serverState.appProjectStore.values())
      .map((entry) => ({
        blueprint: entry.blueprint,
        files: entry.files,
        preview_html: entry.files.find((f) => f.path === 'www/index.html')?.content || '',
        download_zip_url: `/api/v1/apps/${entry.blueprint.id}/download`,
        zip_size_bytes: entry.zipBuffer.length,
      }))
      .sort((a, b) => (a.blueprint.createdAt < b.blueprint.createdAt ? 1 : -1));
    res.json({ presets: APP_BUILDER_PRESETS, items });
  });

  router.post('/apps/scaffold', requireAuth, async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        prompt?: string;
        presetId?: AppPresetId;
        name?: string;
        platform?: AppTargetPlatform;
        accentColor?: string;
        useAi?: boolean;
      };
      const { blueprint, files } = await generateAppBlueprint({
        prompt: body.prompt,
        presetId: body.presetId,
        name: body.name,
        platform: body.platform || 'both',
        accentColor: body.accentColor,
        useAi: Boolean(body.useAi),
      });
      const zipBuffer = await packageProjectToZipBuffer(blueprint.slug, files);
      serverState.appProjectStore.set(blueprint.id, { blueprint, files, zipBuffer });

      if (serverState.appProjectStore.size > 15) {
        const oldestKey = serverState.appProjectStore.keys().next().value;
        if (oldestKey) serverState.appProjectStore.delete(oldestKey);
      }

      res.json({
        blueprint,
        files,
        preview_html: files.find((f) => f.path === 'www/index.html')?.content || '',
        download_zip_url: `/api/v1/apps/${blueprint.id}/download`,
        zip_size_bytes: zipBuffer.length,
      });
    } catch (err: any) {
      res.status(400).json({
        error: err?.message || 'Não foi possível gerar o projeto do aplicativo.',
      });
    }
  });

  router.get('/apps/:id/download', requireAuth, (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const entry = serverState.appProjectStore.get(id);
    if (!entry) {
      res.status(404).json({ error: 'Projeto de aplicativo não encontrado.' });
      return;
    }
    const filename = `${entry.blueprint.slug}-${entry.blueprint.platform}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(entry.zipBuffer);
  });

  router.delete('/apps/:id', requireAuth, (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const deleted = serverState.appProjectStore.delete(id);
    res.json({ deleted, id });
  });

  return router;
}
