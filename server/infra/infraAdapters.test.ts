import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { createLocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import {
  LocalConfinedStorageAdapter,
  S3CompatibleStorageAdapter,
  resolveSafeStoragePath,
  signAwsV4Request,
  validateStorageEndpoint,
} from './storageAdapter.ts';
import {
  POSTGRES_PGVECTOR_DDL,
  PostgresHubRepositoryAdapter,
  SqliteHubRepositoryAdapter,
  formatPgVectorLiteral,
  parseMaskedPostgresUrl,
  type PgQueryablePool,
} from './databaseAdapter.ts';
import {
  DurableQueueAdapter,
  encodeRespCommand,
  parseMaskedRedisUrl,
  parseRespReply,
} from './queueAdapter.ts';
import {
  HARDENED_DOCKER_ISOLATION_FLAGS,
  PluggableSandboxRunner,
  buildDockerRunArgs,
  resolveSafeDockerImage,
  validateSandboxCommand,
} from './sandboxRunner.ts';
import {
  McpRuntimeSupervisor,
  validateMcpHttpEndpoint,
  validateMcpStdioCommand,
} from './mcpSupervisor.ts';
import {
  ChannelGatewayService,
  PersistentSchedulerService,
  computeNextRunIso,
  isValidCronExpression,
  matchesCronDate,
  sendChannelOutboundReply,
  verifyChannelWebhookToken,
} from './channelsAndScheduler.ts';
import { DurableRunEngine } from '../durableRunEngine.ts';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('LocalConfinedStorageAdapter stores/retrieves with SHA-256 and blocks path traversal', async () => {
  const tempDir = makeTempDir('jarvis-storage-');
  try {
    const adapter = new LocalConfinedStorageAdapter(path.join(tempDir, 'artifacts'));
    const receipt = await adapter.putObject({
      userId: 'admin',
      runId: 'run_01',
      filename: 'relatorio.md',
      content: '# Relatório Seguro\nConteúdo validado.',
      mimeType: 'text/markdown',
    });

    assert.equal(receipt.driver, 'local_confined');
    assert.equal(receipt.sha256.length, 64);
    const readBack = await adapter.getObject(receipt.storageKey);
    assert.ok(readBack);
    assert.equal(readBack.toString('utf8'), '# Relatório Seguro\nConteúdo validado.');

    assert.throws(() => resolveSafeStoragePath(adapter.baseDir, '../../etc/passwd'));
    assert.throws(() => resolveSafeStoragePath(adapter.baseDir, '../outside.txt'));

    const deleted = await adapter.deleteObject(receipt.storageKey);
    assert.equal(deleted, true);
    assert.equal(await adapter.getObject(receipt.storageKey), null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Database adapters report SQLite WAL diagnostics and mask Postgres credentials', async () => {
  const tempDir = makeTempDir('jarvis-db-adapter-');
  try {
    const store = createLocalSqliteBrainStore({ dataDir: tempDir });
    const sqliteAdapter = new SqliteHubRepositoryAdapter(store);
    const diag = await sqliteAdapter.getDiagnostics(false);
    assert.equal(diag.active_engine, 'sqlite_wal');
    assert.equal(diag.sqlite_journal_mode, 'wal');
    assert.ok(sqliteAdapter.getPgVectorSchemaDdl().includes('USING hnsw'));
    assert.ok(POSTGRES_PGVECTOR_DDL.includes('CREATE EXTENSION IF NOT EXISTS vector'));

    const masked = parseMaskedPostgresUrl('postgres://secretuser:superpass@db.internal.local:5432/jarvis_prod');
    assert.ok(masked);
    assert.equal(masked.masked, 'postgresql://***@db.internal.local:5432/jarvis_prod');
    assert.ok(!masked.masked.includes('superpass'));

    const parsedLocalPg = parseMaskedPostgresUrl('postgres://secretuser:superpass@127.0.0.1:5432/jarvis_prod');
    assert.ok(parsedLocalPg);
    const pgAdapter = new PostgresHubRepositoryAdapter(store, parsedLocalPg);
    const pgDiag = await pgAdapter.getDiagnostics(false);
    assert.equal(pgDiag.active_engine, 'postgres_pgvector');
    assert.equal(pgDiag.postgres_configured, true);
    assert.equal(pgDiag.postgres_host_masked, 'postgresql://***@127.0.0.1:5432/jarvis_prod');

    const s3DiagStandby = new S3CompatibleStorageAdapter({
      provider: 's3',
      bucket: 'jarvis-artifacts-prod',
      endpoint: 'https://s3.us-east-1.amazonaws.com',
      localCacheDir: path.join(tempDir, 's3_fallback'),
    }).getDiagnostics();
    assert.equal(s3DiagStandby.multi_replica_ready, false);
    assert.equal(s3DiagStandby.bucket, 'jarvis-artifacts-prod');

    const s3DiagReady = new S3CompatibleStorageAdapter({
      provider: 's3',
      bucket: 'jarvis-artifacts-prod',
      endpoint: 'https://s3.us-east-1.amazonaws.com',
      localCacheDir: path.join(tempDir, 's3_fallback'),
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
    }).getDiagnostics();
    assert.equal(s3DiagReady.multi_replica_ready, true);

    store.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('PluggableSandboxRunner executes allowlisted binaries and blocks dangerous commands with audit log', async () => {
  const tempDir = makeTempDir('jarvis-sandbox-');
  try {
    const store = createLocalSqliteBrainStore({ dataDir: tempDir });
    const runner = new PluggableSandboxRunner(store, path.join(tempDir, 'sandbox_workspaces'));

    assert.equal(validateSandboxCommand('rm', ['-rf', '/']).ok, false);
    assert.equal(validateSandboxCommand('node', ['-e', 'process.exit(1)']).ok, false);
    assert.equal(validateSandboxCommand('cat', ['../../etc/passwd']).ok, false);
    assert.equal(validateSandboxCommand('git', ['push', 'origin', 'main']).ok, false);
    assert.equal(validateSandboxCommand('node', ['-v']).ok, true);

    const blocked = await runner.execute({ userId: 'admin', command: 'rm', args: ['-rf', '.'] });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.session.status, 'blocked');

    const allowed = await runner.execute({ userId: 'admin', command: 'node', args: ['-v'] });
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.session.status, 'completed');
    assert.ok(allowed.session.stdout_excerpt.trim().startsWith('v'));

    const auditLogs = store.listSandboxSessions('admin', 10);
    assert.equal(auditLogs.length, 2);
    assert.equal(store.listSandboxSessions('other_user', 10).length, 0);
    store.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('validateMcpHttpEndpoint & validateMcpStdioCommand block SSRF, private IPs, and shell injection', () => {
  assert.equal(validateMcpHttpEndpoint('http://169.254.169.254/latest/meta-data').ok, false);
  assert.equal(validateMcpHttpEndpoint('http://metadata.google.internal/computeMetadata/v1').ok, false);
  assert.equal(validateMcpHttpEndpoint('http://127.0.0.1:8080/mcp').ok, false);
  assert.equal(validateMcpHttpEndpoint('http://10.0.0.15:9000/mcp').ok, false);
  assert.equal(validateMcpHttpEndpoint('http://192.168.1.50/mcp').ok, false);
  assert.equal(validateMcpHttpEndpoint('http://172.16.5.2/mcp').ok, false);
  assert.equal(validateMcpHttpEndpoint('file:///etc/passwd').ok, false);
  assert.equal(validateMcpHttpEndpoint('https://mcp.example.com/sse').ok, true);
  assert.equal(validateMcpHttpEndpoint('http://127.0.0.1:4123/mcp', { allowLocal: true }).ok, true);

  assert.equal(validateMcpStdioCommand('bash -c "id"').ok, false);
  assert.equal(validateMcpStdioCommand('node server.js; rm -rf /').ok, false);
  assert.equal(validateMcpStdioCommand('node ../../outside.js').ok, false);
  assert.equal(validateMcpStdioCommand('node mcp-server.mjs').ok, true);
  assert.equal(validateMcpStdioCommand('npx -y @modelcontextprotocol/server-memory').ok, true);
});

test('McpRuntimeSupervisor performs real JSON-RPC 2.0 discoverTools and invokeTool over HTTP and stdio', async () => {
  const tempDir = makeTempDir('jarvis-mcp-rpc-');
  const httpServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString('utf8');
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
              tools: [
                {
                  name: 'weather.lookup',
                  description: 'Consulta clima remoto via HTTP MCP',
                  inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
                },
              ],
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
              content: [{ type: 'text', text: `Clima em ${rpc.params?.arguments?.city || 'SP'}: 24C` }],
            },
          })
        );
        return;
      }
      res.statusCode = 400;
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } }));
    });
  });

  try {
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = httpServer.address();
    assert.ok(addr && typeof addr === 'object');
    const httpEndpoint = `http://127.0.0.1:${addr.port}/mcp`;

    const store = createLocalSqliteBrainStore({ dataDir: tempDir });
    const supervisor = new McpRuntimeSupervisor(store);

    // 1. Real HTTP JSON-RPC 2.0
    const httpMcp = store.addMcpServer({
      name: 'Remote Weather MCP',
      transport: 'http',
      endpoint: httpEndpoint,
      description: 'HTTP MCP de teste',
    });
    const approvedHttp = store.toggleMcpServerApproval(httpMcp.id, true);
    const httpDisc = await supervisor.discoverTools(approvedHttp, { allowLocalHttp: true });
    assert.equal(httpDisc.status, 'online');
    assert.equal(httpDisc.tools.length, 1);
    assert.equal(httpDisc.tools[0].name, 'weather.lookup');

    const httpInvoke = await supervisor.invokeTool(
      approvedHttp,
      'weather.lookup',
      { city: 'Curitiba' },
      { allowLocalHttp: true }
    );
    assert.ok(httpInvoke.summary.includes('Curitiba: 24C'));

    // 2. Real stdio JSON-RPC 2.0 child process
    const stdioScriptPath = path.join(store.workspacesDir, 'mock_mcp_stdio.mjs');
    fs.writeFileSync(
      stdioScriptPath,
      [
        "import readline from 'node:readline';",
        'const rl = readline.createInterface({ input: process.stdin });',
        'rl.on("line", (line) => {',
        '  if (!line.trim()) return;',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === "initialize") {',
        '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05" } }) + "\\n");',
        '  } else if (msg.method === "tools/list") {',
        '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "math.double", description: "Dobra numero" }] } }) + "\\n");',
        '  } else if (msg.method === "tools/call") {',
        '    const n = Number(msg.params?.arguments?.n || 0);',
        '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: String(n * 2) }] } }) + "\\n");',
        '  }',
        '});',
      ].join('\n'),
      'utf8'
    );

    const stdioMcp = store.addMcpServer({
      name: 'Local Stdio MCP',
      transport: 'stdio',
      endpoint: 'node mock_mcp_stdio.mjs',
      description: 'Stdio MCP de teste',
    });
    const approvedStdio = store.toggleMcpServerApproval(stdioMcp.id, true);
    const stdioDisc = await supervisor.discoverTools(approvedStdio);
    assert.equal(stdioDisc.status, 'online');
    assert.equal(stdioDisc.tools.length, 1);
    assert.equal(stdioDisc.tools[0].name, 'math.double');

    const stdioInvoke = await supervisor.invokeTool(approvedStdio, 'math.double', { n: 21 });
    assert.ok(stdioInvoke.summary.includes('42'));

    store.close();
  } finally {
    httpServer.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('PersistentSchedulerService 24/7 daemon, ChannelGatewayService outbound replies, and DurableRunEngine real checkpoint continuation', async () => {
  const tempDir = makeTempDir('jarvis-eco-');
  try {
    const store = createLocalSqliteBrainStore({ dataDir: tempDir });
    const storage = new LocalConfinedStorageAdapter(path.join(tempDir, 'artifacts'));
    const engine = new DurableRunEngine({ store, storage });

    // 1. Exact 5-field cron matching & next run calculation
    assert.equal(isValidCronExpression('*/15 * * * *'), true);
    assert.equal(isValidCronExpression('65 9 * * *'), false);
    assert.equal(isValidCronExpression('invalid cron'), false);
    const sampleDate = new Date(2026, 4, 15, 9, 30, 0); // 15 Mai 2026 09:30
    assert.equal(matchesCronDate('30 9 * * *', sampleDate), true);
    assert.equal(matchesCronDate('15 9 * * *', sampleDate), false);
    const nextIso = computeNextRunIso('*/15 * * * *', new Date(2026, 4, 15, 9, 10, 0).getTime());
    assert.equal(new Date(nextIso).getMinutes(), 15);

    // 2. PersistentSchedulerService: background tickDueJobs executes due job & advances next_run_at
    const executedJobs: string[] = [];
    const scheduler = new PersistentSchedulerService(store, {
      jobExecutor: async (job) => {
        executedJobs.push(job.name);
        return { output: `Resumo real gerado para ${job.name}`, modelUsed: 'gemini-4-hydrogen', status: 'completed' };
      },
    });
    const pastIso = new Date(Date.now() - 120_000).toISOString();
    const job = scheduler.createOrUpdateJob({
      user_id: 'admin',
      name: 'Relatório Diário',
      cron_expr: '0 9 * * *',
      target_type: 'agent_prompt',
      target_ref: 'Gerar resumo executivo',
      next_run_at: pastIso,
    });

    const tick1 = await scheduler.tickDueJobs(Date.now());
    assert.equal(tick1.executed.length, 1);
    assert.equal(tick1.executed[0].job.id, job.id);
    assert.equal(tick1.executed[0].status, 'completed');
    assert.ok(tick1.executed[0].outputSummary.includes('Resumo real gerado'));
    assert.equal(executedJobs.length, 1);

    // Segundo tick imediato não re-executa pois next_run_at avançou para o futuro
    const tick2 = await scheduler.tickDueJobs(Date.now());
    assert.equal(tick2.executed.length, 0);

    // Disparo manual assíncrono também funciona
    const triggered = await scheduler.triggerJobNow(job.id, 'admin');
    assert.ok(triggered.runId);
    assert.equal(triggered.job.last_status, 'completed');

    // 3. Outbound channel replies (mocked fetchImpl + unconfigured skip)
    assert.equal(verifyChannelWebhookToken('segredo-prod-123', 'segredo-prod-123'), true);
    assert.equal(verifyChannelWebhookToken('errado', 'segredo-prod-123'), false);
    assert.equal(verifyChannelWebhookToken('anything', undefined), false);

    const skipped = await sendChannelOutboundReply({
      provider: 'telegram',
      externalChatId: 'chat_777',
      text: 'Oi',
      env: {},
    });
    assert.equal(skipped.status, 'skipped_unconfigured');

    const capturedRequests: Array<{ url: string; body: string }> = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedRequests.push({ url: String(url), body: String(init?.body || '') });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const channels = new ChannelGatewayService(store, {
      env: { TELEGRAM_BOT_TOKEN: 'bot-token-test' },
      fetchImpl: fakeFetch,
      agentExecutor: async ({ senderName, text }) => ({
        reply: `Olá ${senderName}, cluster saudável para "${text}".`,
        modelUsed: 'gemini-4-hydrogen',
      }),
    });

    channels.upsertBinding({
      user_id: 'admin',
      provider: 'telegram',
      label: 'Operações',
      external_chat_id: 'chat_777',
      agent_role: 'architect',
    });

    const routed = await channels.routeInboundMessage({
      provider: 'telegram',
      externalChatId: 'chat_777',
      senderName: 'Carlos',
      text: 'Status do cluster?',
    });
    assert.equal(routed.binding.user_id, 'admin');
    assert.equal(routed.delivery.status, 'sent');
    assert.ok(routed.reply.includes('cluster saudável'));
    assert.equal(capturedRequests.length, 1);
    assert.ok(capturedRequests[0].url.startsWith('https://api.telegram.org/bot'));

    // 4. DurableRunEngine: real async continuation from checkpoint with artifact
    const run = engine.startRun({
      sessionId: 'sess_live_1',
      userId: 'admin',
      agentRole: 'architect',
      agentName: 'Atlas',
      prompt: 'Montar plano técnico',
    });
    engine.recordStep({
      runId: run.id,
      stepIndex: 0,
      kind: 'plan',
      title: 'Planejamento',
      status: 'completed',
      durationMs: 18,
    });
    engine.failRun(run.id, 'Conexão interrompida antes da síntese');

    assert.equal(engine.getRunDetail(run.id, 'other_user'), null);

    let continuationInvoked = false;
    const resumed = await engine.resumeRunFromCheckpoint(run.id, 'admin', 0, {
      executeContinuation: async ({ priorSteps }) => {
        continuationInvoked = true;
        assert.equal(priorSteps.length, 1);
        return {
          output: 'Plano técnico retomado e concluído com sucesso.',
          modelUsed: 'gemini-4-hydrogen',
          executionMode: 'ONLINE',
          artifact: {
            title: 'plano_retomado.md',
            filename: 'plano_retomado.md',
            kind: 'markdown',
            mimeType: 'text/markdown',
            content: '# Plano Retomado\nConcluído após checkpoint.',
          },
        };
      },
    });

    assert.equal(continuationInvoked, true);
    assert.ok(resumed);
    assert.equal(resumed.run.status, 'completed');
    assert.equal(resumed.run.model_used, 'gemini-4-hydrogen');
    assert.ok(resumed.run.final_summary?.includes('retomado e concluído'));
    assert.equal(resumed.steps.length, 4); // original plan + resume plan + model + response
    assert.equal(resumed.artifacts.length, 1);
    assert.equal(resumed.artifacts[0].title, 'plano_retomado.md');

    store.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Priority 2 — Docker Ephemeral Sandbox builds hardened args, validates image, probes daemon, and executes isolated container', async () => {
  const tempDir = makeTempDir('jarvis-docker-sandbox-');
  try {
    assert.equal(resolveSafeDockerImage('python:3.12-slim'), 'python:3.12-slim');
    assert.equal(resolveSafeDockerImage('ghcr.io/org/sandbox-box:2.1.0'), 'ghcr.io/org/sandbox-box:2.1.0');
    assert.equal(resolveSafeDockerImage('node:22; rm -rf /'), 'node:22-alpine');
    assert.equal(resolveSafeDockerImage('../evil:latest'), 'node:22-alpine');

    const args = buildDockerRunArgs({
      image: 'python:3.12-slim',
      hostWorkspaceDir: '/tmp/ws_admin',
      binary: 'python3',
      args: ['--version'],
    });
    assert.equal(args[0], 'run');
    for (const flag of HARDENED_DOCKER_ISOLATION_FLAGS) {
      assert.ok(args.includes(flag), `Expected hardened flag ${flag}`);
    }
    assert.ok(args.includes('/tmp/ws_admin:/workspace:ro'));
    assert.ok(args.includes('/tmp:rw,noexec,nosuid,size=64m'));
    assert.equal(args[args.length - 3], 'python:3.12-slim');
    assert.equal(args[args.length - 2], 'python3');
    assert.equal(args[args.length - 1], '--version');

    const spawnedCalls: Array<{ cmd: string; args: readonly string[]; shell: false }> = [];
    const mockSpawn = (cmd: string, spawnArgs: readonly string[], options: { shell: false }) => {
      spawnedCalls.push({ cmd, args: spawnArgs, shell: options.shell });
      const proc = new EventEmitter() as ChildProcess;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      proc.stdout = stdout;
      proc.stderr = stderr;
      proc.kill = () => true;
      setImmediate(() => {
        if (spawnArgs[0] === 'version') {
          stdout.end('27.3.1\n');
        } else {
          stdout.end('Python 3.12.7\n');
        }
        stderr.end();
        proc.emit('close', 0);
      });
      return proc;
    };

    const store = createLocalSqliteBrainStore({ dataDir: tempDir });
    const runner = new PluggableSandboxRunner(
      store,
      tempDir,
      { SANDBOX_DRIVER: 'docker_ephemeral', SANDBOX_DOCKER_IMAGE: 'python:3.12-slim' },
      { spawnImpl: mockSpawn }
    );

    const diag = await runner.getDiagnosticsAsync(true);
    assert.equal(diag.driver, 'docker_ephemeral');
    assert.equal(diag.container_mode_enabled, true);
    assert.equal(diag.docker_available, true);
    assert.equal(diag.docker_version, '27.3.1');

    const res = await runner.execute({ userId: 'admin', command: 'python3', args: ['--version'] });
    assert.equal(res.allowed, true);
    assert.equal(res.session.driver, 'docker_ephemeral');
    assert.equal(res.session.status, 'completed');
    assert.ok(res.session.stdout_excerpt.includes('Python 3.12.7'));

    const runCall = spawnedCalls.find((c) => c.args[0] === 'run');
    assert.ok(runCall);
    assert.equal(runCall.cmd, 'docker');
    assert.equal(runCall.shell, false);
    assert.ok(runCall.args.includes('--network=none'));
    assert.ok(runCall.args.includes('--read-only'));

    store.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Priority 2 — Redis RESP2 wire protocol executes PING, AUTH, SELECT, distributed NX lock, LPUSH/LTRIM, and DEL against real TCP server', async () => {
  const tempDir = makeTempDir('jarvis-redis-resp2-');
  const receivedCommands: string[][] = [];

  // Mock RESP2 TCP server
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length > 0) {
        const parsed = parseRespReply(buffer, 0);
        if (!parsed) break;
        buffer = buffer.subarray(parsed.nextOffset);
        const cmd = Array.isArray(parsed.value) ? parsed.value.map(String) : [];
        receivedCommands.push(cmd);
        const op = (cmd[0] || '').toUpperCase();
        if (op === 'PING') {
          socket.write('+PONG\r\n');
        } else if (op === 'AUTH' || op === 'SELECT' || op === 'SET' || op === 'LTRIM') {
          socket.write('+OK\r\n');
        } else if (op === 'LPUSH' || op === 'DEL') {
          socket.write(':1\r\n');
        } else {
          socket.write('+OK\r\n');
        }
      }
    });
  });

  try {
    // RESP2 encoder/decoder sanity
    const encoded = encodeRespCommand(['SET', 'k1', 'v1']);
    const decoded = parseRespReply(encoded, 0);
    assert.deepEqual(decoded?.value, ['SET', 'k1', 'v1']);
    assert.equal(parseRespReply(Buffer.from('$-1\r\n'))?.value, null);
    assert.equal(parseRespReply(Buffer.from(':42\r\n'))?.value, 42);

    const parsedTls = parseMaskedRedisUrl('rediss://default:mysecret@redis.prod.local:6380/3');
    assert.ok(parsedTls);
    assert.equal(parsedTls.useTls, true);
    assert.equal(parsedTls.dbIndex, 3);
    assert.ok(!parsedTls.masked.includes('mysecret'));

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');

    const store = createLocalSqliteBrainStore({ dataDir: tempDir });
    const queue = new DurableQueueAdapter(store, {
      REDIS_URL: `redis://:testpass123@127.0.0.1:${addr.port}/2`,
    });

    const probe = await queue.probeRedis();
    assert.equal(probe.reachable, true);
    assert.ok(probe.latencyMs !== null && probe.latencyMs >= 1);

    const { job, result } = await queue.enqueue({
      sessionId: 'sess_redis_01',
      jobType: 'agent_run',
      summary: 'Execução distribuída validada',
      task: async () => 'done-redis',
    });
    assert.equal(result, 'done-redis');
    assert.equal(job.status, 'completed');

    const diag = await queue.getDiagnosticsAsync(true);
    assert.equal(diag.driver, 'redis_distributed');
    assert.equal(diag.redis_reachable, true);
    assert.equal(diag.distributed_locks_acquired, 1);
    assert.ok(diag.redis_host_masked && !diag.redis_host_masked.includes('testpass123'));

    assert.ok(receivedCommands.some((c) => c[0] === 'AUTH' && c[1] === 'testpass123'));
    assert.ok(receivedCommands.some((c) => c[0] === 'SELECT' && c[1] === '2'));
    assert.ok(receivedCommands.some((c) => c[0] === 'SET' && c[1] === 'jarvis:lock:lane:sess_redis_01' && c[3] === 'NX'));
    assert.ok(receivedCommands.some((c) => c[0] === 'LPUSH' && c[1] === 'jarvis:lane:history'));
    assert.ok(receivedCommands.some((c) => c[0] === 'DEL' && c[1] === 'jarvis:lock:lane:sess_redis_01'));

    store.close();
  } finally {
    server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Priority 2 — S3/MinIO AWS Signature V4 performs real signed HEAD/PUT/GET/DELETE and blocks cloud metadata endpoints', async () => {
  const tempDir = makeTempDir('jarvis-s3-sigv4-');
  const objects = new Map<string, Buffer>();
  const signedAuthHeaders: string[] = [];

  const mockS3 = http.createServer((req, res) => {
    const auth = String(req.headers.authorization || '');
    const amzDate = String(req.headers['x-amz-date'] || '');
    const amzHash = String(req.headers['x-amz-content-sha256'] || '');
    if (!auth.startsWith('AWS4-HMAC-SHA256 ') || !amzDate || amzHash.length !== 64) {
      res.statusCode = 403;
      res.end('Missing or invalid AWS SigV4 headers');
      return;
    }
    signedAuthHeaders.push(`${req.method}:${auth}`);
    const key = req.url || '/';

    if (req.method === 'HEAD') {
      res.statusCode = 200;
      res.end();
      return;
    }
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        objects.set(key, Buffer.concat(chunks));
        res.statusCode = 200;
        res.end();
      });
      return;
    }
    if (req.method === 'GET') {
      const found = objects.get(key);
      if (!found) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
      res.statusCode = 200;
      res.end(found);
      return;
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      res.statusCode = 204;
      res.end();
      return;
    }
    res.statusCode = 405;
    res.end();
  });

  try {
    // Metadata SSRF protection
    assert.equal(validateStorageEndpoint('http://169.254.169.254/latest/meta-data').ok, false);
    assert.equal(validateStorageEndpoint('http://metadata.google.internal').ok, false);
    assert.equal(validateStorageEndpoint('https://s3.us-east-1.amazonaws.com').ok, true);

    // Deterministic AWS SigV4 header shape
    const sigHeaders = signAwsV4Request({
      method: 'PUT',
      url: new URL('https://minio.local:9000/jarvis-bucket/u1/r1/report.md'),
      region: 'sa-east-1',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'SECRETEXAMPLE',
      payload: Buffer.from('hello sigv4'),
      contentType: 'text/markdown',
      now: new Date('2026-05-15T12:00:00.000Z'),
    });
    assert.ok(sigHeaders.Authorization.includes('Credential=AKIAEXAMPLE/20260515/sa-east-1/s3/aws4_request'));
    assert.equal(sigHeaders['x-amz-date'], '20260515T120000Z');
    assert.equal(sigHeaders['x-amz-content-sha256'].length, 64);

    await new Promise<void>((resolve) => mockS3.listen(0, '127.0.0.1', () => resolve()));
    const addr = mockS3.address();
    assert.ok(addr && typeof addr === 'object');

    const localCacheDir = path.join(tempDir, 's3_cache');
    const adapter = new S3CompatibleStorageAdapter({
      provider: 'minio',
      bucket: 'jarvis-prod',
      endpoint: `http://127.0.0.1:${addr.port}`,
      region: 'us-east-1',
      localCacheDir,
      accessKeyId: 'minioadmin',
      secretAccessKey: 'miniosecret',
    });

    const probeDiag = await adapter.getDiagnosticsAsync(true);
    assert.equal(probeDiag.remote_reachable, true);
    assert.equal(probeDiag.sigv4_enabled, true);

    const receipt = await adapter.putObject({
      userId: 'admin',
      runId: 'run_s3_01',
      filename: 'resumo.md',
      content: '# Artefato Multi-Réplica\nSincronizado via AWS SigV4.',
      mimeType: 'text/markdown',
    });
    assert.equal(receipt.remoteSynced, true);
    assert.equal(adapter.getDiagnostics().remote_synced_count, 1);

    // Remove local cache file to verify multi-replica remote GET fetch via SigV4
    const cachedFile = resolveSafeStoragePath(localCacheDir, receipt.storageKey);
    fs.rmSync(cachedFile, { force: true });
    assert.equal(fs.existsSync(cachedFile), false);

    const remoteData = await adapter.getObject(receipt.storageKey);
    assert.ok(remoteData);
    assert.equal(remoteData.toString('utf8'), '# Artefato Multi-Réplica\nSincronizado via AWS SigV4.');

    const deleted = await adapter.deleteObject(receipt.storageKey);
    assert.equal(deleted, true);
    assert.equal(await adapter.getObject(receipt.storageKey), null);
    assert.ok(signedAuthHeaders.some((h) => h.startsWith('HEAD:')));
    assert.ok(signedAuthHeaders.some((h) => h.startsWith('PUT:')));
    assert.ok(signedAuthHeaders.some((h) => h.startsWith('GET:')));
    assert.ok(signedAuthHeaders.some((h) => h.startsWith('DELETE:')));
  } finally {
    mockS3.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Priority 2 — PostgresHubRepositoryAdapter executes parameterized SQL, schema DDL, and pgvector cosine search', async () => {
  const tempDir = makeTempDir('jarvis-pg-adapter-');
  try {
    assert.equal(formatPgVectorLiteral([0.1, Number.NaN, -0.5, Number.POSITIVE_INFINITY]), '[0.100000,0,-0.500000,0]');

    const recordedQueries: Array<{ text: string; values?: unknown[] }> = [];
    const mockPool: PgQueryablePool = {
      async query(text: string, values?: unknown[]) {
        recordedQueries.push({ text, values });
        if (text.includes('SELECT version() AS ver')) {
          return {
            rows: [{ ver: 'PostgreSQL 16.4 on x86_64', has_vector: true, has_runs_table: true }],
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
          };
        }
        if (text.includes('pg_extension')) {
          return { rows: [{ has_vector: true }], command: 'SELECT', rowCount: 1, oid: 0, fields: [] };
        }
        if (text.includes('FROM agent_runs WHERE user_id = $1 AND session_id = $2')) {
          return {
            rows: [
              {
                id: 'run_pg_1',
                session_id: 'sess_pg',
                user_id: 'admin',
                agent_role: 'architect',
                agent_name: 'Atlas',
                prompt: 'Escalar arquitetura',
                status: 'completed',
                model_used: 'gemini-4-hydrogen',
                execution_mode: 'ONLINE',
                current_step_index: 2,
                total_steps: 2,
                final_summary: 'Concluído no Postgres',
                checkpoint_json: { step: 2 },
                error_message: null,
                started_at: new Date('2026-05-15T10:00:00Z'),
                updated_at: new Date('2026-05-15T10:01:00Z'),
                finished_at: new Date('2026-05-15T10:01:00Z'),
              },
            ],
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
          };
        }
        if (text.includes('FROM agent_runs WHERE id = $1 AND user_id = $2')) {
          return {
            rows: [
              {
                id: 'run_pg_1',
                session_id: 'sess_pg',
                user_id: 'admin',
                agent_role: 'architect',
                agent_name: 'Atlas',
                prompt: 'Escalar arquitetura',
                status: 'completed',
                model_used: 'gemini-4-hydrogen',
                execution_mode: 'ONLINE',
                current_step_index: 1,
                total_steps: 1,
                final_summary: 'Concluído',
                checkpoint_json: '{}',
                error_message: null,
                started_at: '2026-05-15T10:00:00.000Z',
                updated_at: '2026-05-15T10:01:00.000Z',
                finished_at: '2026-05-15T10:01:00.000Z',
              },
            ],
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
          };
        }
        if (text.includes('FROM agent_run_steps')) {
          return {
            rows: [
              {
                id: 'step_1',
                run_id: 'run_pg_1',
                step_index: 0,
                kind: 'plan',
                title: 'Plano inicial',
                status: 'completed',
                duration_ms: 12,
                input_summary: '',
                output_summary: 'OK',
                checkpoint_payload_json: {},
                started_at: '2026-05-15T10:00:00.000Z',
                finished_at: '2026-05-15T10:00:01.000Z',
              },
            ],
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
          };
        }
        if (text.includes('FROM run_artifacts')) {
          return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
        }
        if (text.includes('embedding <=> $1::vector')) {
          return {
            rows: [
              {
                chunk_id: 'chk_1',
                workspace_slug: 'default',
                content: 'Arquitetura PostgreSQL com HNSW ativo',
                distance: 0.042,
              },
            ],
            command: 'SELECT',
            rowCount: 1,
            oid: 0,
            fields: [],
          };
        }
        return { rows: [], command: 'OK', rowCount: 0, oid: 0, fields: [] };
      },
      async end() {},
    };

    const store = createLocalSqliteBrainStore({ dataDir: tempDir });
    const parsed = parseMaskedPostgresUrl('postgresql://jarvis:supersecret@pg.internal:5432/jarvis_hub');
    assert.ok(parsed);

    const adapter = new PostgresHubRepositoryAdapter(store, parsed, { poolFactory: () => mockPool });
    const migrated = await adapter.ensureSchema();
    assert.equal(migrated.ok, true);
    assert.equal(migrated.pgvector_ready, true);

    const diag = await adapter.getDiagnostics(true);
    assert.equal(diag.postgres_reachable, true);
    assert.equal(diag.postgres_version, 'PostgreSQL 16.4');
    assert.equal(diag.pgvector_ready, true);
    assert.equal(diag.schema_initialized, true);

    const runs = await adapter.listRuns('admin', 'sess_pg', 10);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].id, 'run_pg_1');

    const detail = await adapter.getRunDetail('run_pg_1', 'admin');
    assert.ok(detail);
    assert.equal(detail.steps.length, 1);

    const upserted = await adapter.upsertMemoryEmbedding({
      chunkId: 'chk_1',
      workspaceSlug: 'default',
      content: 'Arquitetura PostgreSQL com HNSW ativo',
      embedding: [0.12, 0.34, 0.56],
    });
    assert.equal(upserted, true);

    const hits = await adapter.searchMemoryVectors({
      workspaceSlug: 'default',
      queryEmbedding: [0.12, 0.34, 0.56],
      limit: 5,
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].chunk_id, 'chk_1');
    assert.equal(hits[0].distance, 0.042);

    // Ensure parameterized SQL was used for every data query
    const listQuery = recordedQueries.find((q) => q.text.includes('FROM agent_runs WHERE user_id = $1'));
    assert.deepEqual(listQuery?.values, ['admin', 'sess_pg', 10]);
    const vecQuery = recordedQueries.find((q) => q.text.includes('embedding <=> $1::vector'));
    assert.deepEqual(vecQuery?.values, ['[0.120000,0.340000,0.560000]', 'default', 5]);

    await adapter.close();
    store.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

