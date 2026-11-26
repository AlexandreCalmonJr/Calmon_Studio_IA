/**
 * Fase 3 + Prioridade 2 — Camada Dual de Repositório Assíncrono (SQLite WAL + Motor PostgreSQL / pgvector Real).
 *
 * Recursos reais:
 *  - Padrão zero-setup: `SqliteHubRepositoryAdapter` sobre SQLite WAL local + FTS5 + vetores
 *  - Modo produção (`DATABASE_URL`): `PostgresHubRepositoryAdapter` com driver `pg.Pool` real,
 *    queries estritamente parametrizadas (`$1, $2, ...`), bootstrap de schema + extensão `pgvector` HNSW,
 *    busca vetorial por cosseno (`<=>`) e fallback resiliente ao SQLite local caso o Postgres oscile.
 *  - Credenciais mascaradas em todos os diagnósticos e logs.
 */

import net from 'node:net';
import { Pool, type QueryResult } from 'pg';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import type { AgentRunModel, AgentRunStepModel, RunArtifactModel } from '../brain/models.ts';

export type DatabaseEngineKind = 'sqlite_wal' | 'postgres_pgvector';

export interface DatabaseAdapterDiagnostics {
  active_engine: DatabaseEngineKind;
  engine_label: string;
  postgres_configured: boolean;
  postgres_host_masked: string | null;
  postgres_reachable: boolean | null;
  postgres_version: string | null;
  pgvector_ready: boolean;
  schema_initialized: boolean;
  sqlite_journal_mode: string;
  sqlite_busy_timeout_ms: number;
  composite_indexes_count: number;
  recoverable_runs_count: number;
  last_error: string | null;
}

export interface VectorSearchHit {
  chunk_id: string;
  workspace_slug: string;
  content: string;
  distance: number;
}

export interface PgQueryablePool {
  query(text: string, values?: unknown[]): Promise<QueryResult<Record<string, unknown>>>;
  end(): Promise<void>;
}

export interface HubRepositoryAdapter {
  readonly engine: DatabaseEngineKind;
  getDiagnostics(probeNetwork?: boolean): Promise<DatabaseAdapterDiagnostics>;
  ensureSchema(): Promise<{ ok: boolean; detail: string; pgvector_ready: boolean }>;
  listRuns(userId: string, sessionId?: string, limit?: number): Promise<AgentRunModel[]>;
  getRunDetail(
    runId: string,
    userId: string
  ): Promise<{ run: AgentRunModel; steps: AgentRunStepModel[]; artifacts: RunArtifactModel[] } | null>;
  upsertMemoryEmbedding?(params: {
    chunkId: string;
    workspaceSlug: string;
    content: string;
    embedding: number[];
  }): Promise<boolean>;
  searchMemoryVectors?(params: {
    workspaceSlug: string;
    queryEmbedding: number[];
    limit?: number;
  }): Promise<VectorSearchHit[]>;
  getPgVectorSchemaDdl(): string;
  close?(): Promise<void>;
}

export const POSTGRES_PGVECTOR_DDL = `-- JARVIS AI Hub — Schema PostgreSQL 16 + pgvector (HNSW) para Escala Multi-Réplica
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  model_used TEXT NOT NULL DEFAULT '',
  execution_mode TEXT NOT NULL DEFAULT 'hybrid',
  current_step_index INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 0,
  final_summary TEXT NOT NULL DEFAULT '',
  checkpoint_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agent_run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  input_summary TEXT NOT NULL DEFAULT '',
  output_summary TEXT NOT NULL DEFAULT '',
  checkpoint_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS run_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'markdown',
  mime_type TEXT NOT NULL DEFAULT 'text/plain',
  storage_driver TEXT NOT NULL DEFAULT 's3',
  storage_key TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  preview_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memory_embeddings_pg (
  chunk_id TEXT PRIMARY KEY,
  workspace_slug TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pg_agent_runs_session ON agent_runs(session_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pg_agent_runs_user ON agent_runs(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pg_agent_run_steps_run ON agent_run_steps(run_id, step_index ASC);
CREATE INDEX IF NOT EXISTS idx_pg_memory_embeddings_hnsw ON memory_embeddings_pg USING hnsw (embedding vector_cosine_ops);
`;

export function parseMaskedPostgresUrl(rawUrl?: string): {
  valid: boolean;
  raw: string;
  host: string;
  port: number;
  database: string;
  masked: string;
} | null {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return null;
    const host = u.hostname;
    if (!host) return null;
    const port = u.port ? Number(u.port) : 5432;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    const database = (u.pathname || '/jarvis_brain').replace(/^\//, '') || 'jarvis_brain';
    return {
      valid: true,
      raw: trimmed,
      host,
      port,
      database,
      masked: `postgresql://***@${host}:${port}/${database}`,
    };
  } catch {
    return null;
  }
}

export function formatPgVectorLiteral(values: number[]): string {
  const safe = values
    .slice(0, 4096)
    .map((v) => (Number.isFinite(v) ? Number(v).toFixed(6) : '0'));
  return `[${safe.join(',')}]`;
}

export async function probeTcpPort(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* noop */ }
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

export class SqliteHubRepositoryAdapter implements HubRepositoryAdapter {
  public readonly engine: DatabaseEngineKind = 'sqlite_wal';
  private readonly store: LocalSqliteBrainStore;

  constructor(store: LocalSqliteBrainStore) {
    this.store = store;
  }

  public async getDiagnostics(): Promise<DatabaseAdapterDiagnostics> {
    const health = this.store.getDatabaseHealth();
    return {
      active_engine: 'sqlite_wal',
      engine_label: `SQLite ${health.journalMode.toUpperCase()} + FTS5 + Vetores (Local-First)`,
      postgres_configured: false,
      postgres_host_masked: null,
      postgres_reachable: null,
      postgres_version: null,
      pgvector_ready: false,
      schema_initialized: true,
      sqlite_journal_mode: health.journalMode,
      sqlite_busy_timeout_ms: 5000,
      composite_indexes_count: 14,
      recoverable_runs_count: this.store.countRecoverableAgentRuns(),
      last_error: null,
    };
  }

  public async ensureSchema(): Promise<{ ok: boolean; detail: string; pgvector_ready: boolean }> {
    return {
      ok: true,
      detail: 'Schema SQLite WAL já inicializado localmente. Defina DATABASE_URL para ativar PostgreSQL + pgvector.',
      pgvector_ready: false,
    };
  }

  public async listRuns(userId: string, sessionId?: string, limit = 40): Promise<AgentRunModel[]> {
    return this.store.listAgentRuns({ user_id: userId, session_id: sessionId, limit });
  }

  public async getRunDetail(runId: string, userId: string) {
    const run = this.store.getAgentRun(runId, userId);
    if (!run) return null;
    const steps = this.store.listAgentRunSteps(run.id);
    const artifacts = this.store.listRunArtifacts(run.id, userId);
    return { run, steps, artifacts };
  }

  public getPgVectorSchemaDdl(): string {
    return POSTGRES_PGVECTOR_DDL;
  }
}

function mapPgRunRow(r: Record<string, unknown>): AgentRunModel {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    user_id: String(r.user_id),
    agent_role: String(r.agent_role),
    agent_name: String(r.agent_name),
    prompt: String(r.prompt),
    status: String(r.status) as AgentRunModel['status'],
    model_used: String(r.model_used || ''),
    execution_mode: String(r.execution_mode || 'hybrid'),
    current_step_index: Number(r.current_step_index || 0),
    total_steps: Number(r.total_steps || 0),
    final_summary: String(r.final_summary || ''),
    checkpoint_json:
      typeof r.checkpoint_json === 'string'
        ? r.checkpoint_json
        : JSON.stringify(r.checkpoint_json || {}),
    error_message: r.error_message ? String(r.error_message) : null,
    started_at: r.started_at instanceof Date ? r.started_at.toISOString() : String(r.started_at || ''),
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at || ''),
    finished_at: r.finished_at
      ? r.finished_at instanceof Date
        ? r.finished_at.toISOString()
        : String(r.finished_at)
      : null,
  };
}

export class PostgresHubRepositoryAdapter implements HubRepositoryAdapter {
  public readonly engine: DatabaseEngineKind = 'postgres_pgvector';
  private readonly store: LocalSqliteBrainStore;
  private readonly parsed: NonNullable<ReturnType<typeof parseMaskedPostgresUrl>>;
  private pool: PgQueryablePool | null = null;
  private readonly poolFactory: () => PgQueryablePool;
  private lastReachable: boolean | null = null;
  private lastVersion: string | null = null;
  private pgvectorReady = false;
  private schemaInitialized = false;
  private lastError: string | null = null;

  constructor(
    store: LocalSqliteBrainStore,
    parsed: NonNullable<ReturnType<typeof parseMaskedPostgresUrl>>,
    opts?: { poolFactory?: () => PgQueryablePool }
  ) {
    this.store = store;
    this.parsed = parsed;
    this.poolFactory =
      opts?.poolFactory ||
      (() =>
        new Pool({
          connectionString: parsed.raw,
          max: 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 2_500,
        }) as unknown as PgQueryablePool);
  }

  private getPool(): PgQueryablePool {
    if (!this.pool) {
      this.pool = this.poolFactory();
    }
    return this.pool;
  }

  public async ensureSchema(): Promise<{ ok: boolean; detail: string; pgvector_ready: boolean }> {
    try {
      const pool = this.getPool();
      await pool.query(POSTGRES_PGVECTOR_DDL);
      const ext = await pool.query(
        "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS has_vector"
      );
      const hasVector = Boolean(ext.rows?.[0]?.has_vector);
      this.lastReachable = true;
      this.pgvectorReady = hasVector;
      this.schemaInitialized = true;
      this.lastError = null;
      return {
        ok: true,
        detail: hasVector
          ? `Schema PostgreSQL + pgvector HNSW aplicado com sucesso em ${this.parsed.host}:${this.parsed.port}.`
          : `Schema PostgreSQL aplicado em ${this.parsed.host}:${this.parsed.port} (extensão pgvector pendente).`,
        pgvector_ready: hasVector,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao aplicar schema PostgreSQL.';
      this.lastError = msg.slice(0, 220);
      this.lastReachable = false;
      return {
        ok: false,
        detail: `Não foi possível aplicar o schema PostgreSQL: ${this.lastError}`,
        pgvector_ready: false,
      };
    }
  }

  public async getDiagnostics(probeNetwork = false): Promise<DatabaseAdapterDiagnostics> {
    const health = this.store.getDatabaseHealth();
    if (probeNetwork) {
      try {
        const pool = this.getPool();
        const res = await pool.query(
          "SELECT version() AS ver, EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS has_vector, to_regclass('public.agent_runs') IS NOT NULL AS has_runs_table"
        );
        const row = res.rows?.[0] || {};
        this.lastReachable = true;
        this.lastVersion = row.ver ? String(row.ver).split(' ').slice(0, 2).join(' ') : 'PostgreSQL';
        this.pgvectorReady = Boolean(row.has_vector);
        this.schemaInitialized = Boolean(row.has_runs_table);
        this.lastError = null;
      } catch (err) {
        const tcpOk = await probeTcpPort(this.parsed.host, this.parsed.port, 800);
        this.lastReachable = tcpOk;
        this.lastError = err instanceof Error ? err.message.slice(0, 200) : 'Erro ao consultar PostgreSQL';
      }
    }

    return {
      active_engine: 'postgres_pgvector',
      engine_label: `PostgreSQL + pgvector HNSW (${this.parsed.host}:${this.parsed.port})`,
      postgres_configured: true,
      postgres_host_masked: this.parsed.masked,
      postgres_reachable: this.lastReachable,
      postgres_version: this.lastVersion,
      pgvector_ready: this.pgvectorReady,
      schema_initialized: this.schemaInitialized,
      sqlite_journal_mode: health.journalMode,
      sqlite_busy_timeout_ms: 5000,
      composite_indexes_count: 14,
      recoverable_runs_count: this.store.countRecoverableAgentRuns(),
      last_error: this.lastError,
    };
  }

  public async listRuns(userId: string, sessionId?: string, limit = 40): Promise<AgentRunModel[]> {
    const safeLimit = Math.max(1, Math.min(200, Number(limit || 40)));
    try {
      const pool = this.getPool();
      const res = sessionId
        ? await pool.query(
            'SELECT * FROM agent_runs WHERE user_id = $1 AND session_id = $2 ORDER BY started_at DESC LIMIT $3',
            [userId, sessionId, safeLimit]
          )
        : await pool.query(
            'SELECT * FROM agent_runs WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2',
            [userId, safeLimit]
          );
      this.lastReachable = true;
      return (res.rows || []).map(mapPgRunRow);
    } catch {
      // Fallback resiliente para espelho SQLite local sem derrubar a UI
      return this.store.listAgentRuns({ user_id: userId, session_id: sessionId, limit: safeLimit });
    }
  }

  public async getRunDetail(runId: string, userId: string) {
    try {
      const pool = this.getPool();
      const runRes = await pool.query('SELECT * FROM agent_runs WHERE id = $1 AND user_id = $2 LIMIT 1', [
        runId,
        userId,
      ]);
      if (!runRes.rows || runRes.rows.length === 0) return null;
      const run = mapPgRunRow(runRes.rows[0]);
      const [stepsRes, artsRes] = await Promise.all([
        pool.query('SELECT * FROM agent_run_steps WHERE run_id = $1 ORDER BY step_index ASC', [run.id]),
        pool.query('SELECT * FROM run_artifacts WHERE run_id = $1 AND user_id = $2 ORDER BY created_at DESC', [
          run.id,
          userId,
        ]),
      ]);
      const steps: AgentRunStepModel[] = (stepsRes.rows || []).map((s) => ({
        id: String(s.id),
        run_id: String(s.run_id),
        step_index: Number(s.step_index || 0),
        kind: String(s.kind) as AgentRunStepModel['kind'],
        title: String(s.title),
        status: String(s.status) as AgentRunStepModel['status'],
        duration_ms: Number(s.duration_ms || 0),
        input_summary: String(s.input_summary || ''),
        output_summary: String(s.output_summary || ''),
        checkpoint_payload_json:
          typeof s.checkpoint_payload_json === 'string'
            ? s.checkpoint_payload_json
            : JSON.stringify(s.checkpoint_payload_json || {}),
        started_at: s.started_at instanceof Date ? s.started_at.toISOString() : String(s.started_at || ''),
        finished_at: s.finished_at
          ? s.finished_at instanceof Date
            ? s.finished_at.toISOString()
            : String(s.finished_at)
          : null,
      }));
      const artifacts: RunArtifactModel[] = (artsRes.rows || []).map((a) => ({
        id: String(a.id),
        run_id: String(a.run_id),
        session_id: String(a.session_id),
        user_id: String(a.user_id),
        title: String(a.title),
        kind: String(a.kind),
        mime_type: String(a.mime_type),
        storage_driver: String(a.storage_driver) as RunArtifactModel['storage_driver'],
        storage_key: String(a.storage_key),
        size_bytes: Number(a.size_bytes || 0),
        sha256: String(a.sha256 || ''),
        preview_text: String(a.preview_text || ''),
        created_at: a.created_at instanceof Date ? a.created_at.toISOString() : String(a.created_at || ''),
      }));
      return { run, steps, artifacts };
    } catch {
      const run = this.store.getAgentRun(runId, userId);
      if (!run) return null;
      const steps = this.store.listAgentRunSteps(run.id);
      const artifacts = this.store.listRunArtifacts(run.id, userId);
      return { run, steps, artifacts };
    }
  }

  public async upsertMemoryEmbedding(params: {
    chunkId: string;
    workspaceSlug: string;
    content: string;
    embedding: number[];
  }): Promise<boolean> {
    const vecLiteral = formatPgVectorLiteral(params.embedding);
    const pool = this.getPool();
    await pool.query(
      `INSERT INTO memory_embeddings_pg (chunk_id, workspace_slug, content, embedding, updated_at)
       VALUES ($1, $2, $3, $4::vector, NOW())
       ON CONFLICT (chunk_id) DO UPDATE SET
         content = EXCLUDED.content,
         embedding = EXCLUDED.embedding,
         updated_at = NOW()`,
      [params.chunkId, params.workspaceSlug, params.content, vecLiteral]
    );
    return true;
  }

  public async searchMemoryVectors(params: {
    workspaceSlug: string;
    queryEmbedding: number[];
    limit?: number;
  }): Promise<VectorSearchHit[]> {
    const vecLiteral = formatPgVectorLiteral(params.queryEmbedding);
    const safeLimit = Math.max(1, Math.min(50, Number(params.limit || 8)));
    const pool = this.getPool();
    const res = await pool.query(
      `SELECT chunk_id, workspace_slug, content, (embedding <=> $1::vector) AS distance
       FROM memory_embeddings_pg
       WHERE workspace_slug = $2
       ORDER BY embedding <=> $1::vector ASC
       LIMIT $3`,
      [vecLiteral, params.workspaceSlug, safeLimit]
    );
    return (res.rows || []).map((r) => ({
      chunk_id: String(r.chunk_id),
      workspace_slug: String(r.workspace_slug),
      content: String(r.content),
      distance: Number(r.distance || 0),
    }));
  }

  public getPgVectorSchemaDdl(): string {
    return POSTGRES_PGVECTOR_DDL;
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end().catch(() => {});
      this.pool = null;
    }
  }
}

export function createHubRepositoryAdapter(
  store: LocalSqliteBrainStore,
  env: NodeJS.ProcessEnv = process.env
): HubRepositoryAdapter {
  const parsedPg = parseMaskedPostgresUrl(env.DATABASE_URL);
  if (parsedPg) {
    return new PostgresHubRepositoryAdapter(store, parsedPg);
  }
  return new SqliteHubRepositoryAdapter(store);
}
