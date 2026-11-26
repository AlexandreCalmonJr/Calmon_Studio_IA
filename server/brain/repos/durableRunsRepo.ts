/**
 * Repositório SQLite para execuções duráveis de agentes, etapas, artefatos,
 * sessões de sandbox, agendador persistente e bindings de canais.
 */
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AgentRunModel,
  AgentRunStatus,
  AgentRunStepModel,
  AgentStepKind,
  AgentStepStatus,
  ChannelBindingModel,
  ChannelProvider,
  RunArtifactModel,
  SandboxSessionModel,
  ScheduledJobModel,
} from '../models.ts';
import { nowIso } from './repoUtils.ts';

export class DurableRunsRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public createAgentRun(input: {
    id?: string;
    session_id: string;
    user_id: string;
    agent_role: string;
    agent_name: string;
    prompt: string;
    status?: AgentRunStatus;
    model_used?: string;
    execution_mode?: string;
    total_steps?: number;
    checkpoint?: Record<string, unknown>;
  }): AgentRunModel {
    const now = nowIso();
    const id = (input.id || `run_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`).slice(0, 80);
    const record: AgentRunModel = {
      id,
      session_id: String(input.session_id || 'default').slice(0, 120),
      user_id: String(input.user_id || 'admin').slice(0, 80),
      agent_role: String(input.agent_role || 'jarvis_master').slice(0, 80),
      agent_name: String(input.agent_name || 'Calmon IA').slice(0, 80),
      prompt: String(input.prompt || '').slice(0, 8000),
      status: input.status || 'running',
      model_used: String(input.model_used || '').slice(0, 120),
      execution_mode: String(input.execution_mode || 'hybrid').slice(0, 40),
      current_step_index: 0,
      total_steps: Number.isFinite(input.total_steps) ? Math.max(0, Number(input.total_steps)) : 0,
      final_summary: '',
      checkpoint_json: JSON.stringify(input.checkpoint || {}),
      error_message: null,
      started_at: now,
      updated_at: now,
      finished_at: null,
    };
    this.db.prepare(`
      INSERT INTO agent_runs (
        id, session_id, user_id, agent_role, agent_name, prompt, status,
        model_used, execution_mode, current_step_index, total_steps,
        final_summary, checkpoint_json, error_message, started_at, updated_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.session_id,
      record.user_id,
      record.agent_role,
      record.agent_name,
      record.prompt,
      record.status,
      record.model_used,
      record.execution_mode,
      record.current_step_index,
      record.total_steps,
      record.final_summary,
      record.checkpoint_json,
      record.error_message,
      record.started_at,
      record.updated_at,
      record.finished_at,
    );
    return record;
  }

  public updateAgentRun(
    runId: string,
    patch: {
      status?: AgentRunStatus;
      model_used?: string;
      execution_mode?: string;
      current_step_index?: number;
      total_steps?: number;
      final_summary?: string;
      checkpoint?: Record<string, unknown>;
      error_message?: string | null;
      finished_at?: string | null;
    }
  ): AgentRunModel | null {
    const existing = this.getAgentRun(runId);
    if (!existing) return null;
    const now = nowIso();
    const next: AgentRunModel = {
      ...existing,
      status: patch.status ?? existing.status,
      model_used: patch.model_used !== undefined ? String(patch.model_used).slice(0, 120) : existing.model_used,
      execution_mode: patch.execution_mode !== undefined ? String(patch.execution_mode).slice(0, 40) : existing.execution_mode,
      current_step_index: patch.current_step_index !== undefined ? Math.max(0, Number(patch.current_step_index)) : existing.current_step_index,
      total_steps: patch.total_steps !== undefined ? Math.max(0, Number(patch.total_steps)) : existing.total_steps,
      final_summary: patch.final_summary !== undefined ? String(patch.final_summary).slice(0, 20000) : existing.final_summary,
      checkpoint_json: patch.checkpoint !== undefined ? JSON.stringify(patch.checkpoint) : existing.checkpoint_json,
      error_message: patch.error_message !== undefined ? patch.error_message : existing.error_message,
      updated_at: now,
      finished_at: patch.finished_at !== undefined ? patch.finished_at : existing.finished_at,
    };
    this.db.prepare(`
      UPDATE agent_runs
      SET status = ?, model_used = ?, execution_mode = ?, current_step_index = ?,
          total_steps = ?, final_summary = ?, checkpoint_json = ?, error_message = ?,
          updated_at = ?, finished_at = ?
      WHERE id = ?
    `).run(
      next.status,
      next.model_used,
      next.execution_mode,
      next.current_step_index,
      next.total_steps,
      next.final_summary,
      next.checkpoint_json,
      next.error_message,
      next.updated_at,
      next.finished_at,
      runId,
    );
    return next;
  }

  private mapAgentRunRow(row: Record<string, unknown>): AgentRunModel {
    return {
      id: String(row.id),
      session_id: String(row.session_id),
      user_id: String(row.user_id),
      agent_role: String(row.agent_role),
      agent_name: String(row.agent_name),
      prompt: String(row.prompt),
      status: String(row.status) as AgentRunStatus,
      model_used: String(row.model_used || ''),
      execution_mode: String(row.execution_mode || 'hybrid'),
      current_step_index: Number(row.current_step_index || 0),
      total_steps: Number(row.total_steps || 0),
      final_summary: String(row.final_summary || ''),
      checkpoint_json: String(row.checkpoint_json || '{}'),
      error_message: row.error_message ? String(row.error_message) : null,
      started_at: String(row.started_at),
      updated_at: String(row.updated_at),
      finished_at: row.finished_at ? String(row.finished_at) : null,
    };
  }

  public getAgentRun(runId: string, userId?: string): AgentRunModel | null {
    const row = userId
      ? (this.db.prepare('SELECT * FROM agent_runs WHERE id = ? AND user_id = ?').get(runId, userId) as Record<string, unknown> | undefined)
      : (this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as Record<string, unknown> | undefined);
    return row ? this.mapAgentRunRow(row) : null;
  }

  public listAgentRuns(options: { user_id?: string; session_id?: string; limit?: number } = {}): AgentRunModel[] {
    const limit = Math.max(1, Math.min(200, Number(options.limit || 40)));
    if (options.user_id && options.session_id) {
      const rows = this.db
        .prepare('SELECT * FROM agent_runs WHERE user_id = ? AND session_id = ? ORDER BY started_at DESC LIMIT ?')
        .all(options.user_id, options.session_id, limit) as Array<Record<string, unknown>>;
      return rows.map((r) => this.mapAgentRunRow(r));
    }
    if (options.user_id) {
      const rows = this.db
        .prepare('SELECT * FROM agent_runs WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
        .all(options.user_id, limit) as Array<Record<string, unknown>>;
      return rows.map((r) => this.mapAgentRunRow(r));
    }
    if (options.session_id) {
      const rows = this.db
        .prepare('SELECT * FROM agent_runs WHERE session_id = ? ORDER BY started_at DESC LIMIT ?')
        .all(options.session_id, limit) as Array<Record<string, unknown>>;
      return rows.map((r) => this.mapAgentRunRow(r));
    }
    const rows = this.db
      .prepare('SELECT * FROM agent_runs ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapAgentRunRow(r));
  }

  public recoverInterruptedAgentRuns(): number {
    const now = nowIso();
    const res = this.db
      .prepare(`
        UPDATE agent_runs
        SET status = 'interrupted',
            error_message = COALESCE(error_message, 'Execução interrompida durante reinicialização do servidor. Pronta para retomar do último checkpoint.'),
            updated_at = ?
        WHERE status IN ('queued', 'running')
      `)
      .run(now) as { changes: number };
    return Number(res.changes || 0);
  }

  public countRecoverableAgentRuns(userId?: string): number {
    const row = userId
      ? (this.db.prepare(`SELECT COUNT(*) AS cnt FROM agent_runs WHERE user_id = ? AND status IN ('interrupted', 'paused')`).get(userId) as { cnt: number })
      : (this.db.prepare(`SELECT COUNT(*) AS cnt FROM agent_runs WHERE status IN ('interrupted', 'paused')`).get() as { cnt: number });
    return Number(row?.cnt || 0);
  }

  public appendAgentRunStep(input: {
    id?: string;
    run_id: string;
    step_index: number;
    kind: AgentStepKind;
    title: string;
    status?: AgentStepStatus;
    duration_ms?: number;
    input_summary?: string;
    output_summary?: string;
    checkpoint_payload?: Record<string, unknown>;
    finished_at?: string | null;
  }): AgentRunStepModel {
    const now = nowIso();
    const id = (input.id || `step_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`).slice(0, 80);
    const step: AgentRunStepModel = {
      id,
      run_id: input.run_id,
      step_index: Math.max(0, Number(input.step_index)),
      kind: input.kind,
      title: String(input.title || 'Etapa').slice(0, 180),
      status: input.status || 'completed',
      duration_ms: Math.max(0, Math.round(Number(input.duration_ms || 0))),
      input_summary: String(input.input_summary || '').slice(0, 2000),
      output_summary: String(input.output_summary || '').slice(0, 4000),
      checkpoint_payload_json: JSON.stringify(input.checkpoint_payload || {}),
      started_at: now,
      finished_at: input.finished_at !== undefined ? input.finished_at : (input.status === 'running' ? null : now),
    };
    this.db.prepare(`
      INSERT INTO agent_run_steps (
        id, run_id, step_index, kind, title, status, duration_ms,
        input_summary, output_summary, checkpoint_payload_json, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      step.id,
      step.run_id,
      step.step_index,
      step.kind,
      step.title,
      step.status,
      step.duration_ms,
      step.input_summary,
      step.output_summary,
      step.checkpoint_payload_json,
      step.started_at,
      step.finished_at,
    );
    this.db
      .prepare('UPDATE agent_runs SET current_step_index = MAX(current_step_index, ?), total_steps = MAX(total_steps, ?), updated_at = ? WHERE id = ?')
      .run(step.step_index, step.step_index + 1, now, step.run_id);
    return step;
  }

  public updateAgentRunStep(
    stepId: string,
    patch: { status?: AgentStepStatus; duration_ms?: number; output_summary?: string; checkpoint_payload?: Record<string, unknown>; finished_at?: string | null }
  ): void {
    const existing = this.db.prepare('SELECT * FROM agent_run_steps WHERE id = ?').get(stepId) as Record<string, unknown> | undefined;
    if (!existing) return;
    this.db.prepare(`
      UPDATE agent_run_steps
      SET status = ?, duration_ms = ?, output_summary = ?, checkpoint_payload_json = ?, finished_at = ?
      WHERE id = ?
    `).run(
      patch.status ?? String(existing.status),
      patch.duration_ms !== undefined ? Math.max(0, Math.round(patch.duration_ms)) : Number(existing.duration_ms || 0),
      patch.output_summary !== undefined ? String(patch.output_summary).slice(0, 4000) : String(existing.output_summary || ''),
      patch.checkpoint_payload !== undefined ? JSON.stringify(patch.checkpoint_payload) : String(existing.checkpoint_payload_json || '{}'),
      patch.finished_at !== undefined ? patch.finished_at : (patch.status && patch.status !== 'running' ? nowIso() : (existing.finished_at ? String(existing.finished_at) : null)),
      stepId,
    );
  }

  public listAgentRunSteps(runId: string): AgentRunStepModel[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_run_steps WHERE run_id = ? ORDER BY step_index ASC, started_at ASC')
      .all(runId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      run_id: String(row.run_id),
      step_index: Number(row.step_index || 0),
      kind: String(row.kind) as AgentStepKind,
      title: String(row.title || ''),
      status: String(row.status) as AgentStepStatus,
      duration_ms: Number(row.duration_ms || 0),
      input_summary: String(row.input_summary || ''),
      output_summary: String(row.output_summary || ''),
      checkpoint_payload_json: String(row.checkpoint_payload_json || '{}'),
      started_at: String(row.started_at),
      finished_at: row.finished_at ? String(row.finished_at) : null,
    }));
  }

  public recordRunArtifact(input: {
    id?: string;
    run_id: string;
    session_id: string;
    user_id: string;
    title: string;
    kind: string;
    mime_type: string;
    storage_driver: string;
    storage_key: string;
    size_bytes: number;
    sha256: string;
    preview_text?: string;
  }): RunArtifactModel {
    const now = nowIso();
    const record: RunArtifactModel = {
      id: (input.id || `art_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`).slice(0, 80),
      run_id: input.run_id,
      session_id: input.session_id,
      user_id: input.user_id,
      title: String(input.title || 'Artefato').slice(0, 180),
      kind: String(input.kind || 'markdown').slice(0, 40),
      mime_type: String(input.mime_type || 'text/plain').slice(0, 100),
      storage_driver: String(input.storage_driver || 'local').slice(0, 40),
      storage_key: String(input.storage_key || '').slice(0, 300),
      size_bytes: Math.max(0, Math.round(Number(input.size_bytes || 0))),
      sha256: String(input.sha256 || '').slice(0, 128),
      preview_text: String(input.preview_text || '').slice(0, 12000),
      created_at: now,
    };
    this.db.prepare(`
      INSERT INTO run_artifacts (
        id, run_id, session_id, user_id, title, kind, mime_type,
        storage_driver, storage_key, size_bytes, sha256, preview_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.run_id,
      record.session_id,
      record.user_id,
      record.title,
      record.kind,
      record.mime_type,
      record.storage_driver,
      record.storage_key,
      record.size_bytes,
      record.sha256,
      record.preview_text,
      record.created_at,
    );
    return record;
  }

  public listRunArtifacts(runId: string, userId?: string): RunArtifactModel[] {
    const rows = userId
      ? (this.db.prepare('SELECT * FROM run_artifacts WHERE run_id = ? AND user_id = ? ORDER BY created_at DESC').all(runId, userId) as Array<Record<string, unknown>>)
      : (this.db.prepare('SELECT * FROM run_artifacts WHERE run_id = ? ORDER BY created_at DESC').all(runId) as Array<Record<string, unknown>>);
    return rows.map((r) => ({
      id: String(r.id),
      run_id: String(r.run_id),
      session_id: String(r.session_id),
      user_id: String(r.user_id),
      title: String(r.title),
      kind: String(r.kind),
      mime_type: String(r.mime_type),
      storage_driver: String(r.storage_driver),
      storage_key: String(r.storage_key),
      size_bytes: Number(r.size_bytes || 0),
      sha256: String(r.sha256 || ''),
      preview_text: String(r.preview_text || ''),
      created_at: String(r.created_at),
    }));
  }

  public recordSandboxSession(input: Omit<SandboxSessionModel, 'id' | 'created_at'> & { id?: string }): SandboxSessionModel {
    const record: SandboxSessionModel = {
      id: (input.id || `sbx_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`).slice(0, 80),
      user_id: String(input.user_id || 'admin').slice(0, 80),
      run_id: input.run_id ? String(input.run_id).slice(0, 80) : null,
      driver: String(input.driver || 'local_confined').slice(0, 40),
      command: String(input.command || '').slice(0, 500),
      cwd: String(input.cwd || '').slice(0, 300),
      status: input.status,
      exit_code: input.exit_code ?? null,
      stdout_excerpt: String(input.stdout_excerpt || '').slice(0, 8000),
      stderr_excerpt: String(input.stderr_excerpt || '').slice(0, 4000),
      duration_ms: Math.max(0, Math.round(Number(input.duration_ms || 0))),
      created_at: nowIso(),
    };
    this.db.prepare(`
      INSERT INTO sandbox_sessions (
        id, user_id, run_id, driver, command, cwd, status, exit_code,
        stdout_excerpt, stderr_excerpt, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.user_id,
      record.run_id,
      record.driver,
      record.command,
      record.cwd,
      record.status,
      record.exit_code,
      record.stdout_excerpt,
      record.stderr_excerpt,
      record.duration_ms,
      record.created_at,
    );
    return record;
  }

  public listSandboxSessions(userId?: string, limit = 30): SandboxSessionModel[] {
    const safeLimit = Math.max(1, Math.min(100, Number(limit || 30)));
    const rows = userId
      ? (this.db.prepare('SELECT * FROM sandbox_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, safeLimit) as Array<Record<string, unknown>>)
      : (this.db.prepare('SELECT * FROM sandbox_sessions ORDER BY created_at DESC LIMIT ?').all(safeLimit) as Array<Record<string, unknown>>);
    return rows.map((r) => ({
      id: String(r.id),
      user_id: String(r.user_id),
      run_id: r.run_id ? String(r.run_id) : null,
      driver: String(r.driver),
      command: String(r.command),
      cwd: String(r.cwd),
      status: String(r.status) as SandboxSessionModel['status'],
      exit_code: r.exit_code === null || r.exit_code === undefined ? null : Number(r.exit_code),
      stdout_excerpt: String(r.stdout_excerpt || ''),
      stderr_excerpt: String(r.stderr_excerpt || ''),
      duration_ms: Number(r.duration_ms || 0),
      created_at: String(r.created_at),
    }));
  }

  public upsertScheduledJob(input: {
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
    const now = nowIso();
    const id = (input.id || `job_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`).slice(0, 80);
    const existing = this.db.prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    const record: ScheduledJobModel = {
      id,
      user_id: String(input.user_id || 'admin').slice(0, 80),
      name: String(input.name || 'Rotina agendada').slice(0, 120),
      cron_expr: String(input.cron_expr || '0 9 * * *').slice(0, 60),
      target_type: input.target_type || 'agent_prompt',
      target_ref: String(input.target_ref || '').slice(0, 240),
      payload_json: JSON.stringify(input.payload || {}),
      enabled: input.enabled !== false,
      last_run_at: existing?.last_run_at ? String(existing.last_run_at) : null,
      last_status: existing?.last_status ? String(existing.last_status) : null,
      next_run_at: input.next_run_at ?? now,
      created_at: existing?.created_at ? String(existing.created_at) : now,
      updated_at: now,
    };
    this.db.prepare(`
      INSERT INTO scheduled_jobs (
        id, user_id, name, cron_expr, target_type, target_ref, payload_json,
        enabled, last_run_at, last_status, next_run_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        cron_expr = excluded.cron_expr,
        target_type = excluded.target_type,
        target_ref = excluded.target_ref,
        payload_json = excluded.payload_json,
        enabled = excluded.enabled,
        next_run_at = excluded.next_run_at,
        updated_at = excluded.updated_at
    `).run(
      record.id,
      record.user_id,
      record.name,
      record.cron_expr,
      record.target_type,
      record.target_ref,
      record.payload_json,
      record.enabled ? 1 : 0,
      record.last_run_at,
      record.last_status,
      record.next_run_at,
      record.created_at,
      record.updated_at,
    );
    return record;
  }

  public listScheduledJobs(userId?: string): ScheduledJobModel[] {
    const rows = userId
      ? (this.db.prepare('SELECT * FROM scheduled_jobs WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as Array<Record<string, unknown>>)
      : (this.db.prepare('SELECT * FROM scheduled_jobs ORDER BY updated_at DESC').all() as Array<Record<string, unknown>>);
    return rows.map((r) => ({
      id: String(r.id),
      user_id: String(r.user_id),
      name: String(r.name),
      cron_expr: String(r.cron_expr),
      target_type: String(r.target_type) as ScheduledJobModel['target_type'],
      target_ref: String(r.target_ref),
      payload_json: String(r.payload_json || '{}'),
      enabled: Boolean(r.enabled),
      last_run_at: r.last_run_at ? String(r.last_run_at) : null,
      last_status: r.last_status ? String(r.last_status) : null,
      next_run_at: r.next_run_at ? String(r.next_run_at) : null,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    }));
  }

  public deleteScheduledJob(id: string, userId?: string): boolean {
    const res = userId
      ? (this.db.prepare('DELETE FROM scheduled_jobs WHERE id = ? AND user_id = ?').run(id, userId) as { changes: number })
      : (this.db.prepare('DELETE FROM scheduled_jobs WHERE id = ?').run(id) as { changes: number });
    return Number(res.changes || 0) > 0;
  }

  public markScheduledJobExecuted(id: string, status: string, nextRunAt: string | null): void {
    const now = nowIso();
    this.db
      .prepare('UPDATE scheduled_jobs SET last_run_at = ?, last_status = ?, next_run_at = ?, updated_at = ? WHERE id = ?')
      .run(now, status.slice(0, 120), nextRunAt, now, id);
  }

  private mapChannelBindingRow(r: Record<string, unknown>): ChannelBindingModel {
    return {
      id: String(r.id),
      user_id: String(r.user_id),
      provider: String(r.provider) as ChannelProvider,
      label: String(r.label),
      external_chat_id: String(r.external_chat_id),
      agent_role: String(r.agent_role),
      workspace_slug: String(r.workspace_slug),
      webhook_secret_hint: String(r.webhook_secret_hint || ''),
      enabled: Boolean(r.enabled),
      last_message_at: r.last_message_at ? String(r.last_message_at) : null,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  }

  public upsertChannelBinding(input: {
    id?: string;
    user_id: string;
    provider: ChannelProvider;
    label: string;
    external_chat_id: string;
    agent_role?: string;
    workspace_slug?: string;
    webhook_secret_hint?: string;
    enabled?: boolean;
  }): ChannelBindingModel {
    const now = nowIso();
    const id = (input.id || `chn_${input.provider}_${crypto.randomBytes(4).toString('hex')}`).slice(0, 80);
    const existing = this.db.prepare('SELECT * FROM channel_bindings WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    const record: ChannelBindingModel = {
      id,
      user_id: String(input.user_id || 'admin').slice(0, 80),
      provider: input.provider,
      label: String(input.label || `${input.provider} binding`).slice(0, 120),
      external_chat_id: String(input.external_chat_id || '').slice(0, 160),
      agent_role: String(input.agent_role || 'jarvis_master').slice(0, 80),
      workspace_slug: String(input.workspace_slug || 'default').slice(0, 80),
      webhook_secret_hint: String(input.webhook_secret_hint || '').slice(0, 40),
      enabled: input.enabled !== false,
      last_message_at: existing?.last_message_at ? String(existing.last_message_at) : null,
      created_at: existing?.created_at ? String(existing.created_at) : now,
      updated_at: now,
    };
    this.db.prepare(`
      INSERT INTO channel_bindings (
        id, user_id, provider, label, external_chat_id, agent_role,
        workspace_slug, webhook_secret_hint, enabled, last_message_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        external_chat_id = excluded.external_chat_id,
        agent_role = excluded.agent_role,
        workspace_slug = excluded.workspace_slug,
        webhook_secret_hint = excluded.webhook_secret_hint,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `).run(
      record.id,
      record.user_id,
      record.provider,
      record.label,
      record.external_chat_id,
      record.agent_role,
      record.workspace_slug,
      record.webhook_secret_hint,
      record.enabled ? 1 : 0,
      record.last_message_at,
      record.created_at,
      record.updated_at,
    );
    return record;
  }

  public listChannelBindings(userId?: string): ChannelBindingModel[] {
    const rows = userId
      ? (this.db.prepare('SELECT * FROM channel_bindings WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as Array<Record<string, unknown>>)
      : (this.db.prepare('SELECT * FROM channel_bindings ORDER BY updated_at DESC').all() as Array<Record<string, unknown>>);
    return rows.map((r) => this.mapChannelBindingRow(r));
  }

  public findChannelBinding(provider: ChannelProvider, externalChatId: string): ChannelBindingModel | null {
    const r = this.db
      .prepare('SELECT * FROM channel_bindings WHERE provider = ? AND external_chat_id = ? AND enabled = 1 LIMIT 1')
      .get(provider, externalChatId) as Record<string, unknown> | undefined;
    return r ? this.mapChannelBindingRow(r) : null;
  }

  public deleteChannelBinding(id: string, userId?: string): boolean {
    const res = userId
      ? (this.db.prepare('DELETE FROM channel_bindings WHERE id = ? AND user_id = ?').run(id, userId) as { changes: number })
      : (this.db.prepare('DELETE FROM channel_bindings WHERE id = ?').run(id) as { changes: number });
    return Number(res.changes || 0) > 0;
  }

  public touchChannelBindingActivity(id: string): void {
    const now = nowIso();
    this.db.prepare('UPDATE channel_bindings SET last_message_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  }
}
