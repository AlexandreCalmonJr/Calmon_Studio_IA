import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import {
  LocalConfinedStorageAdapter,
  S3CompatibleStorageAdapter,
  resolveSafeStoragePath,
} from './storageAdapter.ts';
import {
  POSTGRES_PGVECTOR_DDL,
  PostgresHubRepositoryAdapter,
  SqliteHubRepositoryAdapter,
  parseMaskedPostgresUrl,
} from './databaseAdapter.ts';
import { PluggableSandboxRunner, validateSandboxCommand } from './sandboxRunner.ts';
import { validateMcpHttpEndpoint } from './mcpSupervisor.ts';
import {
  ChannelGatewayService,
  PersistentSchedulerService,
  isValidCronExpression,
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

test('validateMcpHttpEndpoint blocks cloud metadata SSRF targets and allows safe HTTPS', () => {
  assert.equal(validateMcpHttpEndpoint('http://169.254.169.254/latest/meta-data').ok, false);
  assert.equal(validateMcpHttpEndpoint('http://metadata.google.internal/computeMetadata/v1').ok, false);
  assert.equal(validateMcpHttpEndpoint('file:///etc/passwd').ok, false);
  assert.equal(validateMcpHttpEndpoint('https://mcp.example.com/sse').ok, true);
});

test('PersistentSchedulerService, ChannelGatewayService, and DurableRunEngine enforce user isolation and checkpoints', async () => {
  const tempDir = makeTempDir('jarvis-eco-');
  try {
    const store = createLocalSqliteBrainStore({ dataDir: tempDir });
    const storage = new LocalConfinedStorageAdapter(path.join(tempDir, 'artifacts'));
    const engine = new DurableRunEngine({ store, storage });
    const scheduler = new PersistentSchedulerService(store);
    const channels = new ChannelGatewayService(store);

    assert.equal(isValidCronExpression('*/15 * * * *'), true);
    assert.equal(isValidCronExpression('invalid cron'), false);
    assert.equal(verifyChannelWebhookToken('segredo-prod-123', 'segredo-prod-123'), true);
    assert.equal(verifyChannelWebhookToken('errado', 'segredo-prod-123'), false);
    assert.equal(verifyChannelWebhookToken('anything', undefined), false);

    // Agendamento + disparo imediato gera agent_run durável
    const job = scheduler.createOrUpdateJob({
      user_id: 'admin',
      name: 'Relatório Diário',
      cron_expr: '0 9 * * *',
      target_type: 'agent_prompt',
      target_ref: 'Gerar resumo executivo',
    });
    const triggered = scheduler.triggerJobNow(job.id, 'admin');
    assert.ok(triggered.runId);
    assert.equal(triggered.job.last_status, 'completed');

    // Canal 24/7 + roteamento isolado
    channels.upsertBinding({
      user_id: 'admin',
      provider: 'telegram',
      label: 'Operações',
      external_chat_id: 'chat_777',
      agent_role: 'architect',
    });
    const routed = channels.routeInboundMessage({
      provider: 'telegram',
      externalChatId: 'chat_777',
      senderName: 'Carlos',
      text: 'Status do cluster?',
    });
    assert.equal(routed.binding.user_id, 'admin');
    assert.ok(routed.runId);

    // DurableRunEngine: passos, artefato, checkpoint e retomada com isolamento por user_id
    const run = engine.startRun({
      sessionId: 'sess_live_1',
      userId: 'admin',
      agentRole: 'architect',
      agentName: 'Atlas',
      prompt: 'Montar plano técnico',
    });
    engine.recordStep({
      runId: run.id,
      stepIndex: 1,
      kind: 'plan',
      title: 'Planejamento',
      status: 'completed',
      durationMs: 18,
    });
    const artifact = await engine.saveArtifact({
      runId: run.id,
      sessionId: 'sess_live_1',
      userId: 'admin',
      title: 'plano.md',
      kind: 'markdown',
      mimeType: 'text/markdown',
      content: '# Plano Técnico',
    });
    assert.equal(artifact.title, 'plano.md');
    engine.completeRun({ runId: run.id, finalSummary: 'Concluído com sucesso.' });

    assert.equal(engine.getRunDetail(run.id, 'other_user'), null);
    const detail = engine.getRunDetail(run.id, 'admin');
    assert.ok(detail);
    assert.equal(detail.steps.length, 1);
    assert.equal(detail.artifacts.length, 1);

    const resumed = engine.resumeRunFromCheckpoint(run.id, 'admin', 1);
    assert.ok(resumed);
    assert.equal(resumed.steps.length, 2);
    assert.equal(resumed.run.status, 'completed');

    store.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
