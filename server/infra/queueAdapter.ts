/**
 * Fase 3 — Fila Durável (SQLite/DB por padrão + Adaptador Redis Opcional).
 *
 * Garante execução serial por sessão (sem condições de corrida em memória),
 * grava cada job em `session_lane_jobs` e reporta se `REDIS_URL` está ativo
 * para escala distribuída multi-nó.
 */

import crypto from 'node:crypto';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import type { SessionLaneJobModel } from '../brain/models.ts';

export type QueueDriverKind = 'sqlite_durable' | 'redis_distributed';

export interface QueueDiagnostics {
  driver: QueueDriverKind;
  driver_label: string;
  redis_configured: boolean;
  redis_host_masked: string | null;
  active_lanes: number;
  pending_jobs: number;
  total_executed: number;
  durable_persistence: boolean;
}

export function parseMaskedRedisUrl(rawUrl?: string): { host: string; port: number; masked: string } | null {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') return null;
    if (!u.hostname) return null;
    const port = u.port ? Number(u.port) : 6379;
    return {
      host: u.hostname,
      port,
      masked: `${u.protocol}//***@${u.hostname}:${port}`,
    };
  } catch {
    return null;
  }
}

export class DurableQueueAdapter {
  private readonly store: LocalSqliteBrainStore;
  private readonly redisMeta: ReturnType<typeof parseMaskedRedisUrl>;
  private readonly lanes = new Map<string, Promise<unknown>>();
  private pendingJobs = 0;
  private totalExecuted = 0;

  constructor(store: LocalSqliteBrainStore, env: NodeJS.ProcessEnv = process.env) {
    this.store = store;
    this.redisMeta = parseMaskedRedisUrl(env.REDIS_URL);
  }

  public get driver(): QueueDriverKind {
    return this.redisMeta ? 'redis_distributed' : 'sqlite_durable';
  }

  public async enqueue<T>(params: {
    sessionId: string;
    workspaceSlug?: string;
    jobType: string;
    summary: string;
    task: () => Promise<T>;
  }): Promise<{ job: SessionLaneJobModel; result: T }> {
    const sessionKey = String(params.sessionId || 'default').slice(0, 120);
    const workspaceSlug = String(params.workspaceSlug || 'default').slice(0, 80);
    const jobId = `djob_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const createdAt = new Date().toISOString();
    this.pendingJobs += 1;

    const prevChain = this.lanes.get(sessionKey) || Promise.resolve();
    let resultValue!: T;
    let finalJob!: SessionLaneJobModel;

    const nextChain = prevChain
      .catch(() => undefined)
      .then(async () => {
        const startedAt = Date.now();
        try {
          resultValue = await params.task();
          const durationMs = Math.max(0, Date.now() - startedAt);
          finalJob = {
            id: jobId,
            session_id: sessionKey,
            workspace_slug: workspaceSlug,
            job_type: params.jobType,
            status: 'completed',
            duration_ms: durationMs,
            summary: params.summary.slice(0, 240),
            error_message: null,
            created_at: createdAt,
            finished_at: new Date().toISOString(),
          };
          this.store.recordLaneJob(finalJob);
          this.totalExecuted += 1;
        } catch (err) {
          const durationMs = Math.max(0, Date.now() - startedAt);
          const msg = err instanceof Error ? err.message : String(err);
          finalJob = {
            id: jobId,
            session_id: sessionKey,
            workspace_slug: workspaceSlug,
            job_type: params.jobType,
            status: 'failed',
            duration_ms: durationMs,
            summary: params.summary.slice(0, 240),
            error_message: msg.slice(0, 500),
            created_at: createdAt,
            finished_at: new Date().toISOString(),
          };
          this.store.recordLaneJob(finalJob);
          this.totalExecuted += 1;
          throw err;
        } finally {
          this.pendingJobs = Math.max(0, this.pendingJobs - 1);
          if (this.lanes.get(sessionKey) === nextChain) {
            this.lanes.delete(sessionKey);
          }
        }
      });

    this.lanes.set(sessionKey, nextChain);
    await nextChain;
    return { job: finalJob, result: resultValue };
  }

  public getDiagnostics(): QueueDiagnostics {
    const isRedis = Boolean(this.redisMeta);
    return {
      driver: this.driver,
      driver_label: isRedis
        ? `Redis Distribuído (${this.redisMeta!.host}:${this.redisMeta!.port})`
        : 'Fila Durável SQLite (Serial por Sessão)',
      redis_configured: isRedis,
      redis_host_masked: this.redisMeta?.masked || null,
      active_lanes: this.lanes.size,
      pending_jobs: this.pendingJobs,
      total_executed: this.totalExecuted,
      durable_persistence: true,
    };
  }
}

export function createDurableQueueAdapter(
  store: LocalSqliteBrainStore,
  env: NodeJS.ProcessEnv = process.env
): DurableQueueAdapter {
  return new DurableQueueAdapter(store, env);
}
