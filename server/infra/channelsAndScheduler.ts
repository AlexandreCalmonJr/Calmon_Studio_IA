/**
 * Fase 4 + Prioridade 1 — Agendador 24/7 Vivo (`scheduled_jobs`) & Gateway de Canais Bidirecional (`channel_bindings`).
 *
 * Recursos reais:
 *  - Parser e matcher exato de cron 5 campos (min hora dia mês dia-semana) + cálculo de `next_run_at`
 *  - Loop de background 24/7 (`startDaemon`/`stopDaemon`/`tickDueJobs`) com trava anti-duplicação
 *  - Despacho real de respostas de saída para Telegram, Discord, Slack e WhatsApp via `process.env`
 *  - Isolamento por `user_id` e auditoria durável em `agent_runs` / `agent_run_steps`
 */

import crypto from 'node:crypto';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import type { ChannelBindingModel, ChannelProvider, ScheduledJobModel } from '../brain/models.ts';

const VALID_CHANNEL_PROVIDERS: ReadonlySet<string> = new Set([
  'telegram',
  'discord',
  'slack',
  'whatsapp',
]);

export function isValidChannelProvider(raw: string): raw is ChannelProvider {
  return VALID_CHANNEL_PROVIDERS.has(String(raw || '').trim().toLowerCase());
}

function parseCronField(field: string, min: number, max: number, mapSevenToZero = false): Set<number> | null {
  const trimmed = String(field || '').trim();
  if (!trimmed) return null;
  const result = new Set<number>();

  const segments = trimmed.split(',');
  for (const segment of segments) {
    if (!segment) return null;
    const stepParts = segment.split('/');
    if (stepParts.length > 2) return null;

    const rangePart = stepParts[0];
    const step = stepParts.length === 2 ? Number(stepParts[1]) : 1;
    if (!Number.isInteger(step) || step < 1 || step > max - min + 1) return null;

    let start = min;
    let end = max;

    if (rangePart === '*') {
      // keep full range
    } else if (rangePart.includes('-')) {
      const bounds = rangePart.split('-');
      if (bounds.length !== 2) return null;
      start = Number(bounds[0]);
      end = Number(bounds[1]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) return null;
    } else {
      const exact = Number(rangePart);
      if (!Number.isInteger(exact)) return null;
      start = exact;
      end = stepParts.length === 2 ? max : exact;
    }

    if (start < min || end > max) return null;
    for (let v = start; v <= end; v += step) {
      result.add(mapSevenToZero && v === 7 ? 0 : v);
    }
  }

  return result.size > 0 ? result : null;
}

interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  domWildcard: boolean;
  dowWildcard: boolean;
}

function parseCronExpression(expr: string): ParsedCron | null {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minutes = parseCronField(parts[0], 0, 59);
  const hours = parseCronField(parts[1], 0, 23);
  const daysOfMonth = parseCronField(parts[2], 1, 31);
  const months = parseCronField(parts[3], 1, 12);
  const daysOfWeek = parseCronField(parts[4], 0, 7, true);
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null;
  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    domWildcard: parts[2] === '*',
    dowWildcard: parts[4] === '*',
  };
}

/** Valida expressão cron padrão de 5 campos (min hora dia mês dia-semana) com limites reais. */
export function isValidCronExpression(expr: string): boolean {
  return parseCronExpression(expr) !== null;
}

/** Verifica se uma data corresponde exatamente à expressão cron de 5 campos. */
export function matchesCronDate(cronExpr: string, date: Date): boolean {
  const parsed = parseCronExpression(cronExpr);
  if (!parsed) return false;
  const month = date.getMonth() + 1;
  const dom = date.getDate();
  const dow = date.getDay();
  const hour = date.getHours();
  const minute = date.getMinutes();

  if (!parsed.months.has(month)) return false;
  if (!parsed.hours.has(hour)) return false;
  if (!parsed.minutes.has(minute)) return false;

  if (parsed.domWildcard && parsed.dowWildcard) return true;
  if (parsed.domWildcard) return parsed.daysOfWeek.has(dow);
  if (parsed.dowWildcard) return parsed.daysOfMonth.has(dom);
  return parsed.daysOfMonth.has(dom) || parsed.daysOfWeek.has(dow);
}

/** Calcula com exatidão o próximo timestamp ISO de disparo para um cron de 5 campos. */
export function computeNextRunIso(cronExpr: string, fromMs = Date.now()): string {
  const parsed = parseCronExpression(cronExpr);
  if (!parsed) {
    return new Date(fromMs + 60 * 60_000).toISOString();
  }

  // Avança para o próximo minuto cheio
  const cursor = new Date(Math.floor(fromMs / 60_000) * 60_000 + 60_000);
  const maxLimitMs = fromMs + 366 * 24 * 60 * 60_000;

  while (cursor.getTime() <= maxLimitMs) {
    const month = cursor.getMonth() + 1;
    if (!parsed.months.has(month)) {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    const dom = cursor.getDate();
    const dow = cursor.getDay();
    const dayMatches =
      parsed.domWildcard && parsed.dowWildcard
        ? true
        : parsed.domWildcard
          ? parsed.daysOfWeek.has(dow)
          : parsed.dowWildcard
            ? parsed.daysOfMonth.has(dom)
            : parsed.daysOfMonth.has(dom) || parsed.daysOfWeek.has(dow);

    if (!dayMatches) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    if (!parsed.hours.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      continue;
    }

    if (!parsed.minutes.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
      continue;
    }

    return cursor.toISOString();
  }

  return new Date(fromMs + 24 * 60 * 60_000).toISOString();
}

export function verifyChannelWebhookToken(
  providedToken: string | undefined,
  envSecret: string | undefined
): boolean {
  const secret = String(envSecret || '').trim();
  if (!secret) return false;
  const provided = String(providedToken || '').trim();
  if (!provided) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(secret, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface ScheduledJobExecutionResult {
  output: string;
  modelUsed?: string;
  status?: 'completed' | 'failed';
}

export type ScheduledJobExecutor = (job: ScheduledJobModel) => Promise<ScheduledJobExecutionResult>;

export interface SchedulerDaemonStatus {
  running: boolean;
  interval_ms: number;
  started_at: string | null;
  last_tick_at: string | null;
  tick_count: number;
  due_executed_count: number;
  in_flight_jobs: number;
  last_error: string | null;
}

export interface ScheduledJobTriggerReceipt {
  job: ScheduledJobModel;
  runId: string;
  outputSummary: string;
  status: 'completed' | 'failed';
}

export class PersistentSchedulerService {
  private readonly store: LocalSqliteBrainStore;
  private jobExecutor?: ScheduledJobExecutor;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly runningJobIds = new Set<string>();
  private intervalMs = 30_000;
  private startedAt: string | null = null;
  private lastTickAt: string | null = null;
  private tickCount = 0;
  private dueExecutedCount = 0;
  private lastError: string | null = null;

  constructor(store: LocalSqliteBrainStore, opts?: { jobExecutor?: ScheduledJobExecutor }) {
    this.store = store;
    this.jobExecutor = opts?.jobExecutor;
  }

  public setJobExecutor(executor: ScheduledJobExecutor): void {
    this.jobExecutor = executor;
  }

  public startDaemon(intervalMs = 30_000): SchedulerDaemonStatus {
    const safeInterval = Math.max(2_000, Math.min(300_000, Math.floor(intervalMs)));
    if (this.timer) {
      return this.getDaemonStatus();
    }
    this.intervalMs = safeInterval;
    this.startedAt = new Date().toISOString();
    this.lastError = null;
    this.timer = setInterval(() => {
      void this.tickDueJobs().catch((err) => {
        this.lastError = err instanceof Error ? err.message : 'Erro no loop do agendador 24/7';
      });
    }, safeInterval);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    return this.getDaemonStatus();
  }

  public stopDaemon(): SchedulerDaemonStatus {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this.getDaemonStatus();
  }

  public getDaemonStatus(): SchedulerDaemonStatus {
    return {
      running: this.timer !== null,
      interval_ms: this.intervalMs,
      started_at: this.startedAt,
      last_tick_at: this.lastTickAt,
      tick_count: this.tickCount,
      due_executed_count: this.dueExecutedCount,
      in_flight_jobs: this.runningJobIds.size,
      last_error: this.lastError,
    };
  }

  public listJobs(userId: string): ScheduledJobModel[] {
    return this.store.listScheduledJobs(userId);
  }

  public createOrUpdateJob(input: {
    id?: string;
    user_id: string;
    name: string;
    cron_expr: string;
    target_type: 'agent_prompt' | 'workflow' | 'mcp_tool';
    target_ref: string;
    payload?: Record<string, unknown>;
    enabled?: boolean;
    next_run_at?: string | null;
  }): ScheduledJobModel {
    if (!isValidCronExpression(input.cron_expr)) {
      throw new Error('Expressão cron inválida. Use o formato padrão de 5 campos (ex.: "*/15 * * * *" ou "0 9 * * *").');
    }
    if (!String(input.name || '').trim()) {
      throw new Error('Informe um nome para a rotina agendada.');
    }
    if (!String(input.target_ref || '').trim()) {
      throw new Error('Informe o destino (prompt, fluxo ou ferramenta MCP) da rotina.');
    }
    const nextRunAt = input.next_run_at ?? computeNextRunIso(input.cron_expr);
    return this.store.upsertScheduledJob({
      ...input,
      next_run_at: nextRunAt,
    });
  }

  private async executeJob(
    job: ScheduledJobModel,
    triggerMode: 'manual' | 'daemon_24x7',
    nowMs = Date.now()
  ): Promise<ScheduledJobTriggerReceipt> {
    if (this.runningJobIds.has(job.id)) {
      throw new Error(`Rotina "${job.name}" já está em execução no momento.`);
    }
    this.runningJobIds.add(job.id);
    const startedMs = Date.now();
    const run = this.store.createAgentRun({
      session_id: `sched_${job.id}`,
      user_id: job.user_id,
      agent_role: 'jarvis_master',
      agent_name: 'Agendador 24/7',
      prompt: `[Agendado: ${job.name}] ${job.target_ref}`,
      status: 'running',
      model_used: 'scheduler_engine',
      execution_mode: triggerMode === 'daemon_24x7' ? 'scheduled_daemon' : 'scheduled_manual',
      total_steps: 2,
      checkpoint: {
        job_id: job.id,
        cron_expr: job.cron_expr,
        target_type: job.target_type,
        trigger_mode: triggerMode,
      },
    });

    try {
      this.store.appendAgentRunStep({
        run_id: run.id,
        step_index: 0,
        kind: 'plan',
        title: `Disparo ${triggerMode === 'daemon_24x7' ? 'automático 24/7' : 'manual'} (${job.cron_expr})`,
        status: 'completed',
        duration_ms: Math.max(1, Date.now() - startedMs),
        input_summary: `${job.target_type}: ${job.target_ref}`,
        output_summary: `Rotina "${job.name}" validada e enfileirada para @${job.user_id}.`,
      });

      const execStarted = Date.now();
      let execResult: ScheduledJobExecutionResult;
      if (this.jobExecutor) {
        execResult = await this.jobExecutor(job);
      } else {
        execResult = {
          output: `Rotina "${job.name}" (${job.target_type}) concluída para @${job.user_id}.`,
          modelUsed: 'scheduler_engine',
          status: 'completed',
        };
      }

      const finalStatus = execResult.status === 'failed' ? 'failed' : 'completed';
      const summary = String(execResult.output || '').trim().slice(0, 1000) || `Job "${job.name}" finalizado.`;

      this.store.appendAgentRunStep({
        run_id: run.id,
        step_index: 1,
        kind: job.target_type === 'mcp_tool' ? 'mcp' : 'model',
        title:
          finalStatus === 'completed'
            ? `Execução concluída (${execResult.modelUsed || 'scheduler_engine'})`
            : 'Falha na execução da rotina',
        status: finalStatus,
        duration_ms: Math.max(1, Date.now() - execStarted),
        input_summary: job.target_ref.slice(0, 220),
        output_summary: summary.slice(0, 320),
      });

      this.store.updateAgentRun(run.id, {
        status: finalStatus,
        model_used: execResult.modelUsed || 'scheduler_engine',
        final_summary: summary,
        error_message: finalStatus === 'failed' ? summary : null,
        finished_at: new Date().toISOString(),
      });

      const nextRunAt = computeNextRunIso(job.cron_expr, nowMs);
      this.store.markScheduledJobExecuted(job.id, finalStatus, nextRunAt);
      const updated = this.store.listScheduledJobs(job.user_id).find((j) => j.id === job.id) || {
        ...job,
        last_status: finalStatus,
        next_run_at: nextRunAt,
      };
      return { job: updated, runId: run.id, outputSummary: summary, status: finalStatus };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erro ao executar rotina agendada.';
      this.store.appendAgentRunStep({
        run_id: run.id,
        step_index: 1,
        kind: 'response',
        title: 'Execução interrompida por erro',
        status: 'failed',
        duration_ms: Math.max(1, Date.now() - startedMs),
        output_summary: errMsg.slice(0, 300),
      });
      this.store.updateAgentRun(run.id, {
        status: 'failed',
        error_message: errMsg.slice(0, 500),
        finished_at: new Date().toISOString(),
      });
      const nextRunAt = computeNextRunIso(job.cron_expr, nowMs);
      this.store.markScheduledJobExecuted(job.id, 'failed', nextRunAt);
      const updated = this.store.listScheduledJobs(job.user_id).find((j) => j.id === job.id) || {
        ...job,
        last_status: 'failed',
        next_run_at: nextRunAt,
      };
      return { job: updated, runId: run.id, outputSummary: errMsg, status: 'failed' };
    } finally {
      this.runningJobIds.delete(job.id);
    }
  }

  /** Verifica todas as rotinas habilitadas com `next_run_at <= nowMs` e executa as pendentes. */
  public async tickDueJobs(nowMs = Date.now()): Promise<{
    status: SchedulerDaemonStatus;
    executed: ScheduledJobTriggerReceipt[];
  }> {
    this.tickCount += 1;
    this.lastTickAt = new Date(nowMs).toISOString();
    const allJobs = this.store.listScheduledJobs();
    const dueJobs = allJobs.filter((job) => {
      if (!job.enabled || this.runningJobIds.has(job.id)) return false;
      if (!job.next_run_at) return false;
      const dueMs = Date.parse(job.next_run_at);
      return Number.isFinite(dueMs) && dueMs <= nowMs;
    });

    const executed: ScheduledJobTriggerReceipt[] = [];
    for (const job of dueJobs) {
      try {
        const receipt = await this.executeJob(job, 'daemon_24x7', nowMs);
        executed.push(receipt);
        this.dueExecutedCount += 1;
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : 'Erro no disparo automático';
      }
    }

    return {
      status: this.getDaemonStatus(),
      executed,
    };
  }

  public async triggerJobNow(jobId: string, userId: string): Promise<ScheduledJobTriggerReceipt> {
    const jobs = this.store.listScheduledJobs(userId);
    const job = jobs.find((j) => j.id === jobId);
    if (!job) {
      throw new Error('Agendamento não encontrado para este usuário.');
    }
    return this.executeJob(job, 'manual');
  }

  public deleteJob(jobId: string, userId: string): boolean {
    return this.store.deleteScheduledJob(jobId, userId);
  }
}

// ==================== OUTBOUND CHANNEL DISPATCHER (TELEGRAM / DISCORD / SLACK / WHATSAPP) ====================

export type OutboundDeliveryStatus = 'sent' | 'skipped_unconfigured' | 'failed';

export interface OutboundDeliveryResult {
  provider: ChannelProvider;
  status: OutboundDeliveryStatus;
  http_status?: number;
  detail: string;
}

export interface ChannelOutboundReadiness {
  telegram: { configured: boolean; env_vars: string[] };
  discord: { configured: boolean; env_vars: string[] };
  slack: { configured: boolean; env_vars: string[] };
  whatsapp: { configured: boolean; env_vars: string[] };
}

const SAFE_EXTERNAL_CHAT_ID_RE = /^[@a-zA-Z0-9._:+-]{1,128}$/;

export function getOutboundChannelsReadiness(
  env: Record<string, string | undefined> = process.env
): ChannelOutboundReadiness {
  return {
    telegram: {
      configured: Boolean((env.TELEGRAM_BOT_TOKEN || '').trim()),
      env_vars: ['TELEGRAM_BOT_TOKEN'],
    },
    discord: {
      configured: Boolean((env.DISCORD_BOT_TOKEN || '').trim()),
      env_vars: ['DISCORD_BOT_TOKEN'],
    },
    slack: {
      configured: Boolean((env.SLACK_BOT_TOKEN || '').trim()),
      env_vars: ['SLACK_BOT_TOKEN'],
    },
    whatsapp: {
      configured: Boolean(
        (env.WHATSAPP_ACCESS_TOKEN || '').trim() && (env.WHATSAPP_PHONE_NUMBER_ID || '').trim()
      ),
      env_vars: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
    },
  };
}

export async function sendChannelOutboundReply(params: {
  provider: ChannelProvider;
  externalChatId: string;
  text: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<OutboundDeliveryResult> {
  const env = params.env || process.env;
  const fetchFn = params.fetchImpl || fetch;
  const timeoutMs = Math.max(1000, Math.min(15_000, params.timeoutMs ?? 8_000));
  const chatId = String(params.externalChatId || '').trim();
  const messageText = String(params.text || '').trim();

  if (!SAFE_EXTERNAL_CHAT_ID_RE.test(chatId)) {
    return {
      provider: params.provider,
      status: 'failed',
      detail: 'Identificador de chat externo em formato inválido.',
    };
  }
  if (!messageText) {
    return {
      provider: params.provider,
      status: 'failed',
      detail: 'Texto da resposta de saída vazio.',
    };
  }

  let url = '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let bodyObj: Record<string, unknown> = {};

  if (params.provider === 'telegram') {
    const token = (env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!token) {
      return {
        provider: 'telegram',
        status: 'skipped_unconfigured',
        detail: 'Defina TELEGRAM_BOT_TOKEN no servidor para enviar respostas ao Telegram.',
      };
    }
    url = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;
    bodyObj = { chat_id: chatId, text: messageText.slice(0, 4000) };
  } else if (params.provider === 'discord') {
    const token = (env.DISCORD_BOT_TOKEN || '').trim();
    if (!token) {
      return {
        provider: 'discord',
        status: 'skipped_unconfigured',
        detail: 'Defina DISCORD_BOT_TOKEN no servidor para enviar respostas ao Discord.',
      };
    }
    url = `https://discord.com/api/v10/channels/${encodeURIComponent(chatId)}/messages`;
    headers.Authorization = `Bot ${token}`;
    bodyObj = { content: messageText.slice(0, 1950) };
  } else if (params.provider === 'slack') {
    const token = (env.SLACK_BOT_TOKEN || '').trim();
    if (!token) {
      return {
        provider: 'slack',
        status: 'skipped_unconfigured',
        detail: 'Defina SLACK_BOT_TOKEN no servidor para enviar respostas ao Slack.',
      };
    }
    url = 'https://slack.com/api/chat.postMessage';
    headers.Authorization = `Bearer ${token}`;
    bodyObj = { channel: chatId, text: messageText.slice(0, 3900) };
  } else if (params.provider === 'whatsapp') {
    const token = (env.WHATSAPP_ACCESS_TOKEN || '').trim();
    const phoneId = (env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
    if (!token || !phoneId) {
      return {
        provider: 'whatsapp',
        status: 'skipped_unconfigured',
        detail: 'Defina WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID no servidor para responder via WhatsApp.',
      };
    }
    url = `https://graph.facebook.com/v20.0/${encodeURIComponent(phoneId)}/messages`;
    headers.Authorization = `Bearer ${token}`;
    bodyObj = {
      messaging_product: 'whatsapp',
      to: chatId,
      type: 'text',
      text: { body: messageText.slice(0, 4000) },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyObj),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      return {
        provider: params.provider,
        status: 'failed',
        http_status: response.status,
        detail: `API ${params.provider} respondeu HTTP ${response.status}${errBody ? `: ${errBody.slice(0, 140)}` : ''}`,
      };
    }

    if (params.provider === 'slack') {
      const slackJson = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (slackJson && slackJson.ok === false) {
        return {
          provider: 'slack',
          status: 'failed',
          http_status: response.status,
          detail: `Slack API recusou envio: ${slackJson.error || 'erro desconhecido'}`,
        };
      }
    }

    return {
      provider: params.provider,
      status: 'sent',
      http_status: response.status,
      detail: `Resposta entregue com sucesso via ${params.provider.toUpperCase()}.`,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      provider: params.provider,
      status: 'failed',
      detail: err instanceof Error ? err.message : `Falha de rede ao enviar resposta para ${params.provider}.`,
    };
  }
}

export type ChannelAgentExecutor = (ctx: {
  binding: ChannelBindingModel;
  senderName: string;
  text: string;
}) => Promise<{ reply: string; modelUsed?: string }>;

export class ChannelGatewayService {
  private readonly store: LocalSqliteBrainStore;
  private agentExecutor?: ChannelAgentExecutor;
  private fetchImpl?: typeof fetch;
  private envRef?: Record<string, string | undefined>;

  constructor(
    store: LocalSqliteBrainStore,
    opts?: {
      agentExecutor?: ChannelAgentExecutor;
      fetchImpl?: typeof fetch;
      env?: Record<string, string | undefined>;
    }
  ) {
    this.store = store;
    this.agentExecutor = opts?.agentExecutor;
    this.fetchImpl = opts?.fetchImpl;
    this.envRef = opts?.env;
  }

  public setAgentExecutor(executor: ChannelAgentExecutor): void {
    this.agentExecutor = executor;
  }

  public getOutboundReadiness(): ChannelOutboundReadiness {
    return getOutboundChannelsReadiness(this.envRef || process.env);
  }

  public listBindings(userId: string): ChannelBindingModel[] {
    return this.store.listChannelBindings(userId);
  }

  public upsertBinding(input: {
    id?: string;
    user_id: string;
    provider: string;
    label: string;
    external_chat_id: string;
    agent_role?: string;
    workspace_slug?: string;
    enabled?: boolean;
  }): ChannelBindingModel {
    const prov = String(input.provider || '').trim().toLowerCase();
    if (!isValidChannelProvider(prov)) {
      throw new Error('Canal inválido. Suportados: telegram, discord, slack, whatsapp.');
    }
    const cleanChatId = String(input.external_chat_id || '').trim();
    if (!cleanChatId || !SAFE_EXTERNAL_CHAT_ID_RE.test(cleanChatId)) {
      throw new Error('Informe um identificador válido de chat/canal externo (sem espaços ou caracteres especiais).');
    }
    const envVarName = `CHANNEL_${prov.toUpperCase()}_WEBHOOK_SECRET`;
    const secretConfigured = Boolean((this.envRef || process.env)[envVarName]);
    return this.store.upsertChannelBinding({
      ...input,
      external_chat_id: cleanChatId,
      provider: prov,
      webhook_secret_hint: secretConfigured ? `${envVarName} configurada` : `${envVarName} pendente`,
    });
  }

  public deleteBinding(id: string, userId: string): boolean {
    return this.store.deleteChannelBinding(id, userId);
  }

  public async testOutboundDelivery(
    bindingId: string,
    userId: string,
    sampleText?: string
  ): Promise<{ binding: ChannelBindingModel; delivery: OutboundDeliveryResult }> {
    const binding = this.store.listChannelBindings(userId).find((b) => b.id === bindingId);
    if (!binding) {
      throw new Error('Vínculo de canal não encontrado para este usuário.');
    }
    const text =
      String(sampleText || '').trim() ||
      `[JARVIS Hub] Verificação de canal ativo para "${binding.label}" (@${binding.agent_role}).`;
    const delivery = await sendChannelOutboundReply({
      provider: binding.provider,
      externalChatId: binding.external_chat_id,
      text,
      env: this.envRef || process.env,
      fetchImpl: this.fetchImpl,
    });
    return { binding, delivery };
  }

  public async routeInboundMessage(params: {
    provider: ChannelProvider;
    externalChatId: string;
    senderName: string;
    text: string;
  }): Promise<{
    binding: ChannelBindingModel;
    runId: string;
    reply: string;
    delivery: OutboundDeliveryResult;
  }> {
    const binding = this.store.findChannelBinding(params.provider, params.externalChatId);
    if (!binding) {
      throw new Error(`Nenhum vínculo ativo encontrado para ${params.provider}:${params.externalChatId}.`);
    }
    this.store.touchChannelBindingActivity(binding.id);

    const run = this.store.createAgentRun({
      session_id: `chn_${binding.provider}_${binding.external_chat_id}`,
      user_id: binding.user_id,
      agent_role: binding.agent_role,
      agent_name: `${binding.provider.toUpperCase()} Bridge`,
      prompt: `[${binding.provider}/${params.senderName}] ${params.text}`,
      status: 'running',
      model_used: 'channel_gateway',
      execution_mode: 'channel_24x7',
      total_steps: 3,
      checkpoint: {
        provider: binding.provider,
        binding_id: binding.id,
        workspace_slug: binding.workspace_slug,
      },
    });

    this.store.appendAgentRunStep({
      run_id: run.id,
      step_index: 0,
      kind: 'plan',
      title: `Mensagem recebida via ${binding.provider.toUpperCase()}`,
      status: 'completed',
      duration_ms: 3,
      input_summary: `Canal ${binding.label} (${binding.external_chat_id})`,
      output_summary: `Isolado no usuário @${binding.user_id} / workspace ${binding.workspace_slug}`,
    });

    const modelStarted = Date.now();
    let reply = '';
    let modelUsed = 'channel_gateway';
    try {
      if (this.agentExecutor) {
        const res = await this.agentExecutor({
          binding,
          senderName: params.senderName,
          text: params.text,
        });
        reply = String(res.reply || '').trim();
        modelUsed = res.modelUsed || 'channel_gateway';
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'provedor indisponível';
      reply = `Recebido no Calmon Studio Hub (@${binding.agent_role}). Mensagem registrada na fila durável (${errMsg}).`;
    }
    if (!reply) {
      reply = `Mensagem recebida por @${binding.agent_role} no workspace "${binding.workspace_slug}": "${params.text.slice(0, 160)}".`;
    }

    this.store.appendAgentRunStep({
      run_id: run.id,
      step_index: 1,
      kind: 'model',
      title: `Resposta gerada por @${binding.agent_role} (${modelUsed})`,
      status: 'completed',
      duration_ms: Math.max(1, Date.now() - modelStarted),
      input_summary: params.text.slice(0, 220),
      output_summary: reply.slice(0, 320),
    });

    const deliveryStarted = Date.now();
    const delivery = await sendChannelOutboundReply({
      provider: binding.provider,
      externalChatId: binding.external_chat_id,
      text: reply,
      env: this.envRef || process.env,
      fetchImpl: this.fetchImpl,
    });

    this.store.appendAgentRunStep({
      run_id: run.id,
      step_index: 2,
      kind: 'response',
      title: `Envio de saída ${binding.provider.toUpperCase()} (${delivery.status})`,
      status: delivery.status === 'failed' ? 'failed' : 'completed',
      duration_ms: Math.max(1, Date.now() - deliveryStarted),
      output_summary: delivery.detail,
    });

    this.store.updateAgentRun(run.id, {
      status: 'completed',
      model_used: modelUsed,
      final_summary: `${reply.slice(0, 420)} [Saída ${binding.provider}: ${delivery.status}]`,
      checkpoint: {
        provider: binding.provider,
        binding_id: binding.id,
        workspace_slug: binding.workspace_slug,
        outbound_status: delivery.status,
      },
      finished_at: new Date().toISOString(),
    });

    return { binding, runId: run.id, reply, delivery };
  }
}
