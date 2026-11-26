import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createLocalSqliteBrainStore } from './brain/sqliteBrainStore.ts';
import { DurableRunEngine } from './durableRunEngine.ts';
import { createHubInfraRegistry } from './infra/infraRegistry.ts';
import {
  computeRunObservabilityStats,
  executeAutonomousToolLoop,
  planAutonomousToolActions,
} from './agentToolLoop.ts';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('planAutonomousToolActions parses /sandbox, /mcp, natural diagnostic intents, caps at 3, and ignores unapproved MCP', () => {
  const approvedServer = {
    id: 'mcp_weather',
    name: 'Weather MCP',
    transport: 'http' as const,
    endpoint: 'https://mcp.example.com/rpc',
    description: 'Clima',
    is_approved: true,
    tools: [{ name: 'weather.lookup', description: 'Clima' }],
    created_at: new Date().toISOString(),
  };
  const unapprovedServer = {
    ...approvedServer,
    id: 'mcp_unapproved',
    name: 'Rogue MCP',
    is_approved: false,
    tools: [{ name: 'secret.dump', description: 'Nope' }],
  };

  const explicit = planAutonomousToolActions(
    '/sandbox node -v\n/mcp weather.lookup {"city":"Recife"}\n/mcp secret.dump {}',
    [approvedServer, unapprovedServer]
  );
  assert.equal(explicit.length, 2);
  assert.equal(explicit[0].kind, 'sandbox');
  assert.deepEqual(explicit[0].kind === 'sandbox' ? [explicit[0].command, ...explicit[0].args] : [], ['node', '-v']);
  assert.equal(explicit[1].kind, 'mcp');
  assert.equal(explicit[1].kind === 'mcp' ? explicit[1].toolName : '', 'weather.lookup');
  assert.deepEqual(explicit[1].kind === 'mcp' ? explicit[1].args : {}, { city: 'Recife' });

  const natural = planAutonomousToolActions(
    'Por favor verifique a versão do node e rode git status no sandbox e liste os arquivos do workspace e cheque python versão',
    [approvedServer]
  );
  assert.equal(natural.length, 3); // Capped at MAX_ACTIONS_PER_TURN = 3
  assert.equal(natural[0].kind, 'sandbox');
});

test('executeAutonomousToolLoop executes real Sandbox + approved HTTP MCP JSON-RPC 2.0, persists steps & .log artifact, and updates observability stats', async () => {
  const tempDir = makeTempDir('jarvis-tool-loop-');
  const httpServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c.toString('utf8');
    });
    req.on('end', () => {
      const rpc = JSON.parse(body || '{}') as { id?: number; method?: string; params?: any };
      res.setHeader('Content-Type', 'application/json');
      if (rpc.method === 'initialize') {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2024-11-05' } }));
        return;
      }
      if (rpc.method === 'tools/list') {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              tools: [{ name: 'weather.lookup', description: 'Clima ao vivo' }],
            },
          })
        );
        return;
      }
      if (rpc.method === 'tools/call') {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Previsão real para ${rpc.params?.arguments?.city || 'SP'}: 26C ensolarado`,
                },
              ],
            },
          })
        );
        return;
      }
      res.statusCode = 400;
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Not found' } }));
    });
  });

  try {
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = httpServer.address();
    assert.ok(addr && typeof addr === 'object');

    const store = createLocalSqliteBrainStore({ dataDir: tempDir });
    const infra = createHubInfraRegistry(store);
    const engine = new DurableRunEngine({ store, storage: infra.storageAdapter });

    // Register, approve, and discover tools on local HTTP MCP server
    const added = store.addMcpServer({
      name: 'Weather Live MCP',
      transport: 'http',
      endpoint: `http://127.0.0.1:${addr.port}/mcp`,
      description: 'Live MCP test server',
    });
    const approved = store.toggleMcpServerApproval(added.id, true);
    const discovered = await infra.mcpSupervisor.discoverTools(approved, { allowLocalHttp: true });
    assert.equal(discovered.status, 'online');
    assert.equal(discovered.tools.length, 1);

    const run = engine.startRun({
      sessionId: 'sess_p3_1',
      userId: 'admin',
      agentRole: 'architect',
      agentName: 'Atlas',
      prompt: '/sandbox node -v\n/sandbox rm -rf /\n/mcp weather.lookup {"city":"Florianopolis"}',
    });

    const streamedSteps: string[] = [];
    const streamedArtifacts: string[] = [];

    const result = await executeAutonomousToolLoop({
      prompt: run.prompt,
      runId: run.id,
      sessionId: run.session_id,
      userId: 'admin',
      startStepIndex: 0,
      store,
      durableRuns: engine,
      sandboxRunner: infra.sandboxRunner,
      mcpSupervisor: infra.mcpSupervisor,
      allowLocalMcpHttp: true,
      onStep: (s) => streamedSteps.push(`${s.kind}:${s.status}`),
      onArtifact: (a) => streamedArtifacts.push(a.title),
    });

    assert.equal(result.executedCount, 3);
    assert.deepEqual(streamedSteps, ['sandbox:completed', 'sandbox:failed', 'mcp:completed']);
    assert.ok(result.artifact);
    assert.equal(streamedArtifacts.length, 1);
    assert.ok(result.evidencePromptBlock.includes('Florianopolis: 26C ensolarado'));
    assert.ok(result.evidencePromptBlock.includes('=== SANDBOX'));

    engine.completeRun({
      runId: run.id,
      modelUsed: 'gemini-4-hydrogen',
      executionMode: 'ONLINE',
      finalSummary: 'Execução autônoma concluída com evidências reais.',
    });

    const statsAdmin = computeRunObservabilityStats(store, 'admin');
    assert.equal(statsAdmin.total_runs, 1);
    assert.equal(statsAdmin.completed_runs, 1);
    assert.equal(statsAdmin.sandbox_steps, 2);
    assert.equal(statsAdmin.mcp_steps, 1);
    assert.equal(statsAdmin.artifacts_count, 1);

    // Isolamento por usuário verificado
    const statsOther = computeRunObservabilityStats(store, 'other_user');
    assert.equal(statsOther.total_runs, 0);
    assert.equal(statsOther.sandbox_steps, 0);

    store.close();
  } finally {
    httpServer.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
