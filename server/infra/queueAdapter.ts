/**
 * Fase 3 + Prioridade 2 — Fila Durável (SQLite/DB por padrão + Cliente Redis RESP2 Distribuído Real).
 *
 * Recursos reais:
 *  - Modo zero-setup (`sqlite_durable`): execução serial por sessão + persistência em `session_lane_jobs`
 *  - Modo distribuído (`REDIS_URL`): protocolo RESP2 nativo sobre TCP/TLS (`AUTH`, `SELECT`, `PING`,
 *    trava distribuída `SET key val NX PX ttl`, log distribuído `LPUSH`/`LTRIM`, liberação segura `DEL`)
 *    com degradação resiliente para SQLite se o Redis oscilar.
 */

import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import type { SessionLaneJobModel } from '../brain/models.ts';

export type QueueDriverKind = 'sqlite_durable' | 'redis_distributed';

export interface QueueDiagnostics {
  driver: QueueDriverKind;
  driver_label: string;
  redis_configured: boolean;
  redis_host_masked: string | null;
  redis_reachable: boolean | null;
  redis_latency_ms: number | null;
  distributed_locks_acquired: number;
  fallback_count: number;
  active_lanes: number;
  pending_jobs: number;
  total_executed: number;
  durable_persistence: boolean;
}

export interface ParsedRedisUrl {
  host: string;
  port: number;
  useTls: boolean;
  username: string | null;
  password: string | null;
  dbIndex: number;
  masked: string;
}

export function parseMaskedRedisUrl(rawUrl?: string): ParsedRedisUrl | null {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') return null;
    if (!u.hostname) return null;
    const port = u.port ? Number(u.port) : 6379;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    const dbSeg = (u.pathname || '').replace(/^\//, '');
    const dbIndex = dbSeg && /^\d+$/.test(dbSeg) ? Number(dbSeg) : 0;
    return {
      host: u.hostname,
      port,
      useTls: u.protocol === 'rediss:',
      username: u.username ? decodeURIComponent(u.username) : null,
      password: u.password ? decodeURIComponent(u.password) : null,
      dbIndex,
      masked: `${u.protocol}//***@${u.hostname}:${port}${dbIndex > 0 ? `/${dbIndex}` : ''}`,
    };
  } catch {
    return null;
  }
}

/** Codifica um comando no formato RESP2 padrão do Redis. */
export function encodeRespCommand(args: string[]): Buffer {
  const chunks: string[] = [`*${args.length}\r\n`];
  for (const arg of args) {
    const str = String(arg);
    const byteLen = Buffer.byteLength(str, 'utf8');
    chunks.push(`$${byteLen}\r\n${str}\r\n`);
  }
  return Buffer.from(chunks.join(''), 'utf8');
}

export type RespValue = string | number | null | RespValue[];

/** Decodifica uma resposta RESP2 completa do buffer; retorna null se incompleto. */
export function parseRespReply(buf: Buffer, offset = 0): { value: RespValue; nextOffset: number } | null {
  if (offset >= buf.length) return null;
  const prefix = String.fromCharCode(buf[offset]);
  const lineEnd = buf.indexOf('\r\n', offset + 1);
  if (lineEnd === -1) return null;

  const line = buf.subarray(offset + 1, lineEnd).toString('utf8');

  if (prefix === '+') {
    return { value: line, nextOffset: lineEnd + 2 };
  }
  if (prefix === '-') {
    throw new Error(`Redis error: ${line}`);
  }
  if (prefix === ':') {
    return { value: Number(line), nextOffset: lineEnd + 2 };
  }
  if (prefix === '$') {
    const len = Number(line);
    if (len === -1) return { value: null, nextOffset: lineEnd + 2 };
    const start = lineEnd + 2;
    const end = start + len;
    if (buf.length < end + 2) return null;
    return { value: buf.subarray(start, end).toString('utf8'), nextOffset: end + 2 };
  }
  if (prefix === '*') {
    const count = Number(line);
    if (count === -1) return { value: null, nextOffset: lineEnd + 2 };
    const items: RespValue[] = [];
    let cursor = lineEnd + 2;
    for (let i = 0; i < count; i++) {
      const parsed = parseRespReply(buf, cursor);
      if (!parsed) return null;
      items.push(parsed.value);
      cursor = parsed.nextOffset;
    }
    return { value: items, nextOffset: cursor };
  }

  throw new Error(`Prefixo RESP desconhecido: ${prefix}`);
}

/** Executa uma sequência de comandos RESP2 em uma conexão TCP/TLS curta e segura com timeout. */
export async function executeRedisPipeline(
  config: ParsedRedisUrl,
  commands: string[][],
  timeoutMs = 2_500
): Promise<RespValue[]> {
  const fullCommands: string[][] = [];
  if (config.password) {
    if (config.username && config.username !== 'default') {
      fullCommands.push(['AUTH', config.username, config.password]);
    } else {
      fullCommands.push(['AUTH', config.password]);
    }
  }
  if (config.dbIndex > 0) {
    fullCommands.push(['SELECT', String(config.dbIndex)]);
  }
  const preambleCount = fullCommands.length;
  fullCommands.push(...commands);

  return new Promise((resolve, reject) => {
    const socket = config.useTls
      ? tls.connect({ host: config.host, port: config.port, servername: config.host })
      : net.createConnection({ host: config.host, port: config.port });

    let settled = false;
    let recvBuf = Buffer.alloc(0);
    const replies: RespValue[] = [];

    const finish = (err?: Error, out?: RespValue[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* noop */ }
      if (err) reject(err);
      else resolve(out || []);
    };

    const timer = setTimeout(() => {
      finish(new Error(`Timeout (${timeoutMs} ms) conectando ao Redis.`));
    }, timeoutMs);

    socket.once('error', (err) => finish(err));

    const connectEvent = config.useTls ? 'secureConnect' : 'connect';
    socket.once(connectEvent, () => {
      const payload = Buffer.concat(fullCommands.map((cmd) => encodeRespCommand(cmd)));
      socket.write(payload);
    });

    socket.on('data', (chunk: Buffer) => {
      recvBuf = Buffer.concat([recvBuf, chunk]);
      try {
        let offset = 0;
        while (replies.length < fullCommands.length) {
          const parsed = parseRespReply(recvBuf, offset);
          if (!parsed) break;
          replies.push(parsed.value);
          offset = parsed.nextOffset;
        }
        if (offset > 0) {
          recvBuf = recvBuf.subarray(offset);
        }
        if (replies.length >= fullCommands.length) {
          finish(undefined, replies.slice(preambleCount));
        }
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    });

    socket.once('close', () => {
      if (!settled) {
        finish(new Error('Conexão Redis encerrada antes de completar a resposta.'));
      }
    });
  });
}

export class DurableQueueAdapter {
  private readonly store: LocalSqliteBrainStore;
  private readonly redisMeta: ParsedRedisUrl | null;
  private readonly lanes = new Map<string, Promise<unknown>>();
  private pendingJobs = 0;
  private totalExecuted = 0;
  private distributedLocksAcquired = 0;
  private fallbackCount = 0;
  private lastRedisProbe: { reachable: boolean; latencyMs: number | null } | null = null;

  constructor(store: LocalSqliteBrainStore, env: NodeJS.ProcessEnv = process.env) {
    this.store = store;
    this.redisMeta = parseMaskedRedisUrl(env.REDIS_URL);
  }

  public get driver(): QueueDriverKind {
    return this.redisMeta ? 'redis_distributed' : 'sqlite_durable';
  }

  public async probeRedis(): Promise<{ reachable: boolean; latencyMs: number | null }> {
    if (!this.redisMeta) {
      return { reachable: false, latencyMs: null };
    }
    const started = Date.now();
    try {
      const [pong] = await executeRedisPipeline(this.redisMeta, [['PING']], 1_500);
      const reachable = pong === 'PONG';
      const latencyMs = Math.max(1, Date.now() - started);
      this.lastRedisProbe = { reachable, latencyMs };
      return this.lastRedisProbe;
    } catch {
      this.lastRedisProbe = { reachable: false, latencyMs: null };
      return this.lastRedisProbe;
    }
  }

  private async acquireDistributedLock(lockKey: string, token: string, ttlMs = 30_000): Promise<boolean> {
    if (!this.redisMeta) return false;
    try {
      const [res] = await executeRedisPipeline(
        this.redisMeta,
        [['SET', lockKey, token, 'NX', 'PX', String(ttlMs)]],
        1_500
      );
      if (res === 'OK') {
        this.distributedLocksAcquired += 1;
        this.lastRedisProbe = { reachable: true, latencyMs: this.lastRedisProbe?.latencyMs ?? 1 };
        return true;
      }
      return false;
    } catch {
      this.fallbackCount += 1;
      this.lastRedisProbe = { reachable: false, latencyMs: null };
      return false;
    }
  }

  private async releaseDistributedLockAndLog(
    lockKey: string,
    lockAcquired: boolean,
    job: SessionLaneJobModel
  ): Promise<void> {
    if (!this.redisMeta) return;
    const cmds: string[][] = [
      ['LPUSH', 'jarvis:lane:history', JSON.stringify(job)],
      ['LTRIM', 'jarvis:lane:history', '0', '199'],
    ];
    if (lockAcquired) {
      cmds.push(['DEL', lockKey]);
    }
    try {
      await executeRedisPipeline(this.redisMeta, cmds, 1_500);
    } catch {
      this.fallbackCount += 1;
    }
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
        const lockKey = `jarvis:lock:lane:${sessionKey}`;
        const lockAcquired = this.redisMeta
          ? await this.acquireDistributedLock(lockKey, jobId, 30_000)
          : false;

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
          await this.releaseDistributedLockAndLog(lockKey, lockAcquired, finalJob);
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
          await this.releaseDistributedLockAndLog(lockKey, lockAcquired, finalJob);
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
      redis_reachable: this.lastRedisProbe ? this.lastRedisProbe.reachable : null,
      redis_latency_ms: this.lastRedisProbe ? this.lastRedisProbe.latencyMs : null,
      distributed_locks_acquired: this.distributedLocksAcquired,
      fallback_count: this.fallbackCount,
      active_lanes: this.lanes.size,
      pending_jobs: this.pendingJobs,
      total_executed: this.totalExecuted,
      durable_persistence: true,
    };
  }

  public async getDiagnosticsAsync(probeNetwork = false): Promise<QueueDiagnostics> {
    if (probeNetwork && this.redisMeta) {
      await this.probeRedis();
    }
    return this.getDiagnostics();
  }
}

export function createDurableQueueAdapter(
  store: LocalSqliteBrainStore,
  env: NodeJS.ProcessEnv = process.env
): DurableQueueAdapter {
  return new DurableQueueAdapter(store, env);
}
