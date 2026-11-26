import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {
  buildAgentRuntimeContext,
  isAutoModelSelection,
  normalizeConversationHistory,
  resolveActiveSkillsForAgent,
  resolveAgentTargetModel,
} from './agentRuntime.ts';
import {
  buildGeminiContents,
  resolveGeminiModelChoice,
} from './hybridAiEngine.ts';
import {
  parseMarkdownBlocks,
  splitCodeFenceSegments,
} from '../src/features/chat/markdownParser.ts';
import { createLocalSqliteBrainStore } from './brain/sqliteBrainStore.ts';
import {
  hydrateServerStateFromSqlite,
  serverState,
  sessions,
  users,
} from './serverState.ts';
import { createAgentsRouter } from './routes/agentsRouter.ts';

test('resolveActiveSkillsForAgent filters approved, non-revoked skills assigned to the role', () => {
  const skills = [
    {
      id: 'sk_1',
      name: 'Conversação Guiada',
      domain: 'studies',
      assigned_agents: ['english_tutor'],
      is_approved: true,
      is_revoked: false,
      instructions: 'Corrija gramática suavemente.',
    },
    {
      id: 'sk_2',
      name: 'Revogada',
      domain: 'studies',
      assigned_agents: ['english_tutor'],
      is_approved: true,
      is_revoked: true,
      instructions: 'Não usar.',
    },
    {
      id: 'sk_3',
      name: 'Não Aprovada',
      domain: 'studies',
      assigned_agents: ['english_tutor'],
      is_approved: false,
      is_revoked: false,
      instructions: 'Não usar.',
    },
    {
      id: 'sk_4',
      name: 'Outro Agente',
      domain: 'security',
      assigned_agents: ['sentinel_security'],
      is_approved: true,
      is_revoked: false,
      instructions: 'Auditoria.',
    },
  ];

  const active = resolveActiveSkillsForAgent(skills, 'english_tutor');
  assert.equal(active.length, 1);
  assert.equal(active[0].id, 'sk_1');
});

test('resolveAgentTargetModel enforces 5-level precedence and respects auto selection', () => {
  assert.equal(isAutoModelSelection('auto'), true);
  assert.equal(isAutoModelSelection('auto_hybrid'), true);
  assert.equal(isAutoModelSelection('gemini-4-hydrogen'), false);

  // Level 1: explicit chat override wins over everything
  const l1 = resolveAgentTargetModel({
    explicitChatOverride: 'claude-3-5-sonnet-20241022',
    agentRoute: { model: 'qwen2.5-coder:14b' },
    agentCore: { primary_model: 'gemini-4-neon', fallback_model: 'gemini-3.1-flash-lite' },
    agentPreferredModel: 'gemini-4-hydrogen',
    systemDefaultModel: 'gemini-4-hydrogen',
  });
  assert.equal(l1.requestedModel, 'claude-3-5-sonnet-20241022');
  assert.equal(l1.source, 'chat_override');
  assert.equal(l1.fallbackModel, 'gemini-3.1-flash-lite');

  // Level 2: 'auto' override falls through to agentRoute
  const l2 = resolveAgentTargetModel({
    explicitChatOverride: 'auto',
    agentRoute: { model: 'qwen2.5-coder:14b' },
    agentCore: { primary_model: 'gemini-4-neon' },
    agentPreferredModel: 'gemini-4-hydrogen',
    systemDefaultModel: 'gemini-4-hydrogen',
  });
  assert.equal(l2.requestedModel, 'qwen2.5-coder:14b');
  assert.equal(l2.source, 'agent_route');

  // Level 3: agentCore.primary_model wins when no route
  const l3 = resolveAgentTargetModel({
    explicitChatOverride: 'auto',
    agentRoute: null,
    agentCore: { primary_model: 'gemini-4-neon' },
    agentPreferredModel: 'gemini-4-hydrogen',
    systemDefaultModel: 'gemini-4-hydrogen',
  });
  assert.equal(l3.requestedModel, 'gemini-4-neon');
  assert.equal(l3.source, 'agent_core');

  const l3Ollama = resolveAgentTargetModel({
    explicitChatOverride: 'auto',
    agentRoute: null,
    agentCore: { primary_provider: 'ollama', primary_model: 'auto_hybrid', fallback_model: 'gpt-4.1-mini' },
    agentPreferredModel: 'auto_hybrid',
    systemDefaultModel: 'gemini-4-hydrogen',
  });
  assert.equal(l3Ollama.requestedModel, 'calmon-ia:latest');
  assert.equal(l3Ollama.source, 'agent_core');
  assert.equal(l3Ollama.fallbackModel, 'gpt-4.1-mini');

  // Level 4: agent.preferred_model wins when core is absent
  const l4 = resolveAgentTargetModel({
    explicitChatOverride: undefined,
    agentRoute: null,
    agentCore: null,
    agentPreferredModel: 'gemini-3.1-flash-lite',
    systemDefaultModel: 'gemini-4-hydrogen',
  });
  assert.equal(l4.requestedModel, 'gemini-3.1-flash-lite');
  assert.equal(l4.source, 'agent_preferred');

  // Level 5: system default fallback
  const l5 = resolveAgentTargetModel({
    explicitChatOverride: 'auto',
    agentRoute: null,
    agentCore: null,
    agentPreferredModel: 'auto',
    systemDefaultModel: 'gemini-4-hydrogen',
  });
  assert.equal(l5.requestedModel, 'gemini-4-hydrogen');
  assert.equal(l5.source, 'system_default');
});

test('buildAgentRuntimeContext injects persona, SOUL/MEMORY, active skills, memories, project and trimmed history', () => {
  const ctx = buildAgentRuntimeContext({
    agent: {
      role: 'english_tutor',
      name: 'Professora de Inglês',
      proper_name: 'Clara',
      handle: '@clara',
      mission: 'Ensinar inglês com clareza',
      system_prompt: 'Você é Clara, professora paciente de inglês.',
      preferred_model: 'gemini-3.1-flash-lite',
      allowed_tools: ['read_file'],
    },
    agentCore: {
      soul_markdown: 'Sempre use exemplos práticos do cotidiano.',
      system_directives: 'Mantenha respostas objetivas.',
      memory_markdown: 'Aluno prefere foco em conversação de trabalho.',
      primary_model: 'gemini-3.1-flash-lite',
    },
    skillsList: [
      {
        id: 'sk_en',
        name: 'Conversação Guiada em Inglês',
        domain: 'studies',
        assigned_agents: ['english_tutor'],
        allowed_tools: ['read_file'],
        is_approved: true,
        is_revoked: false,
        instructions: 'Inclua tradução e dica de pronúncia.',
      },
    ],
    agentMemories: [
      { key: 'nivel', content: 'Nível intermediário B1' },
    ],
    workspaceProject: {
      id: 'proj_english',
      name: 'Plano de Estudos',
      type: 'web',
      description: 'Notas de vocabulário',
      files: ['vocab.md'],
    },
    historyMessages: [
      { role: 'user', content: 'Hi Clara, my name is Lucas.' },
      { role: 'assistant', content: 'Nice to meet you, Lucas!' },
      { role: 'system', content: 'ignored system message' },
    ],
    executionModeHint: 'plan',
  });

  assert.equal(ctx.resolvedModel.requestedModel, 'gemini-3.1-flash-lite');
  assert.equal(ctx.skillsUsed.length, 1);
  assert.equal(ctx.skillsUsed[0].name, 'Conversação Guiada em Inglês');
  assert.match(ctx.systemInstruction, /SOUL\.md/);
  assert.match(ctx.systemInstruction, /MEMORY\.md/);
  assert.match(ctx.systemInstruction, /Conversação Guiada em Inglês/);
  assert.match(ctx.systemInstruction, /Nível intermediário B1/);
  assert.match(ctx.systemInstruction, /Plano de Estudos/);
  assert.match(ctx.systemInstruction, /MODO OPERACIONAL: PLANO/);
  assert.equal(ctx.history.length, 2);
  assert.equal(ctx.history[0].role, 'user');
  assert.equal(ctx.history[1].role, 'assistant');
});

test('normalizeConversationHistory respects turn and character limits', () => {
  const manyTurns = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Mensagem número ${i} `.repeat(30),
  }));
  const trimmed = normalizeConversationHistory(manyTurns, 6, 1500);
  assert.ok(trimmed.length <= 6);
  assert.ok(trimmed.length >= 1);
  assert.ok(trimmed[trimmed.length - 1].content.includes('Mensagem número 19'));
});

test('resolveGeminiModelChoice preserves active Gemini models and flags deprecated remaps explicitly', () => {
  const active = resolveGeminiModelChoice('gemini-3.1-flash-lite');
  assert.equal(active.model, 'gemini-3.1-flash-lite');
  assert.equal(active.remapped, false);

  const neon = resolveGeminiModelChoice('gemini-4-neon');
  assert.equal(neon.model, 'gemini-4-neon');
  assert.equal(neon.remapped, false);

  const legacy = resolveGeminiModelChoice('gemini-1.5-pro');
  assert.equal(legacy.model, 'gemini-4-hydrogen');
  assert.equal(legacy.remapped, true);
  assert.ok(legacy.reason && legacy.reason.includes('gemini-1.5-pro'));

  const contents = buildGeminiContents(
    [
      { role: 'user', content: 'Meu código secreto é 42.' },
      { role: 'assistant', content: 'Anotado: 42.' },
    ],
    'Qual foi o código?'
  );
  assert.equal(contents.length, 3);
  assert.equal(contents[0].role, 'user');
  assert.equal(contents[1].role, 'model');
  assert.equal(contents[2].parts[0].text, 'Qual foi o código?');
});

test('markdownParser handles GFM tables, blockquotes, closed fences, and open streaming code blocks', () => {
  const streamingMd = [
    '# Título',
    '',
    '> Citação importante',
    '> Segunda linha da citação',
    '',
    '| Agente | Modelo |',
    '| --- | --- |',
    '| Clara | gemini-3.1-flash-lite |',
    '| Kira | gemini-4-hydrogen |',
    '',
    '```ts',
    'const ok = true;',
    '```',
    '',
    '```python',
    'def streaming_now():',
    '    return 42',
  ].join('\n');

  const segments = splitCodeFenceSegments(streamingMd);
  assert.equal(segments.length, 4);
  assert.equal(segments[0].type, 'text');
  assert.equal(segments[1].type, 'code');
  assert.equal(segments[1].language, 'ts');
  assert.equal(segments[1].isStreaming, false);
  assert.equal(segments[3].type, 'code');
  assert.equal(segments[3].language, 'python');
  assert.equal(segments[3].isStreaming, true);

  const blocks = parseMarkdownBlocks(segments[0].content);
  const heading = blocks.find((b) => b.type === 'heading');
  const quote = blocks.find((b) => b.type === 'blockquote');
  const table = blocks.find((b) => b.type === 'table');

  assert.ok(heading && heading.type === 'heading' && heading.text === 'Título');
  assert.ok(quote && quote.type === 'blockquote' && quote.lines.length === 2);
  assert.ok(table && table.type === 'table');
  assert.deepEqual(table.headers, ['Agente', 'Modelo']);
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows[0], ['Clara', 'gemini-3.1-flash-lite']);
});

test('agentsRouter persists agent config, skills, and routes to SQLite and rehydrates cleanly', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agent-runtime-'));
  const dbPath = path.join(tempDir, 'test.db');
  const store = createLocalSqliteBrainStore(dbPath);

  const origAgents = structuredClone(serverState.agentsList);
  const origSkills = structuredClone(serverState.skillsList);
  const origRoutes = structuredClone(serverState.agentRoutes);

  const token = `tok_agent_runtime_${Date.now()}`;
  const username = 'agent_runtime_tester';
  users.set(username, {
    id: 'u_agent_runtime_tester',
    username,
    display_name: 'Agent Runtime Tester',
    role: 'admin',
    permissions: ['*'],
    is_active: true,
    created_at: new Date().toISOString(),
  });
  sessions.set(token, {
    token,
    username,
    role: 'admin',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  });

  const app = express();
  app.use(express.json());
  app.use('/api/v1', createAgentsRouter({ store }));

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    // 1. Update agent preferred_model via PUT /agents/english_tutor/config
    const cfgRes = await fetch(`${baseUrl}/agents/english_tutor/config`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ preferred_model: 'gemini-3.1-flash-lite', change_summary: 'Teste de persistência' }),
    });
    assert.equal(cfgRes.status, 200);
    const updatedAgent = (await cfgRes.json()) as any;
    assert.equal(updatedAgent.preferred_model, 'gemini-3.1-flash-lite');

    // 2. Save custom route via PUT /agent-routes/english_tutor
    const routeRes = await fetch(`${baseUrl}/agent-routes/english_tutor`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ model: 'gemini-4-neon', key_id: 'gemini-server-default' }),
    });
    assert.equal(routeRes.status, 200);
    const routeBody = (await routeRes.json()) as any;
    assert.equal(routeBody.provider, 'gemini');
    assert.equal(routeBody.model, 'gemini-4-neon');

    // 3. Validate 400 on empty prompt in /agents/:role/stream
    const badStream = await fetch(`${baseUrl}/agents/english_tutor/stream`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ prompt: '   ' }),
    });
    assert.equal(badStream.status, 400);

    // 4. Simulate server restart by mutating in-memory arrays and rehydrating from SQLite
    serverState.agentsList = [];
    serverState.agentRoutes = [];
    hydrateServerStateFromSqlite(store);

    const rehydratedAgent = serverState.agentsList.find((a) => a.role === 'english_tutor');
    assert.ok(rehydratedAgent);
    assert.equal(rehydratedAgent.preferred_model, 'gemini-3.1-flash-lite');

    const rehydratedRoute = serverState.agentRoutes.find((r) => r.agent_role === 'english_tutor');
    assert.ok(rehydratedRoute);
    assert.equal(rehydratedRoute.model, 'gemini-4-neon');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    sessions.delete(token);
    users.delete(username);
    serverState.agentsList = origAgents;
    serverState.skillsList = origSkills;
    serverState.agentRoutes = origRoutes;
  }
});
