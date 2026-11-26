/**
 * Repositório SQLite para núcleos individuais de agentes (`agent_cores`) e sincronização de SOUL.md / MEMORY.md.
 */
import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildDefaultAgentCore,
  deriveAgentWorkspaceSlug,
  normalizeAgentRoleSlug,
  sanitizeAgentCorePatch,
  type AgentCoreConfig,
  type AgentCorePatch,
  type AgentCoreSeedMeta,
} from '../../../src/services/agentCoreEngine.ts';
import { resolveConfinedPath, sanitizeWorkspaceSlug } from '../workspaceMemoryStore.ts';
import { nowIso, safeJsonParse } from './repoUtils.ts';
import type { AuditLogAppender } from './vaultRepo.ts';

export class AgentsRepository {
  private readonly db: DatabaseSync;
  private readonly workspacesDir: string;
  private readonly appendAuditLog: AuditLogAppender;

  constructor(db: DatabaseSync, workspacesDir: string, appendAuditLog: AuditLogAppender) {
    this.db = db;
    this.workspacesDir = workspacesDir;
    this.appendAuditLog = appendAuditLog;
  }

  private hydrateAgentCoreRow(row: Record<string, unknown>): AgentCoreConfig {
    return {
      agent_role: String(row.agent_role),
      workspace_slug: String(row.workspace_slug || deriveAgentWorkspaceSlug(String(row.agent_role))),
      orchestration_mode: String(row.orchestration_mode || 'plan_execute_verify') as AgentCoreConfig['orchestration_mode'],
      max_steps: Number(row.max_steps) || 8,
      max_delegation_depth: Number(row.max_delegation_depth) || 2,
      primary_provider: String(row.primary_provider || 'gemini'),
      primary_model: String(row.primary_model || 'gemini-2.5-flash'),
      fallback_provider: String(row.fallback_provider || 'openai'),
      fallback_model: String(row.fallback_model || 'gpt-4.1-mini'),
      autonomy_policy: String(row.autonomy_policy || 'auto_safe') as AgentCoreConfig['autonomy_policy'],
      daily_budget_usd: Number.isFinite(Number(row.daily_budget_usd)) ? Number(row.daily_budget_usd) : 5,
      allowed_mcp_servers: safeJsonParse<string[]>(
        typeof row.allowed_mcp_servers_json === 'string' ? row.allowed_mcp_servers_json : null,
        ['mcp_local_workspace']
      ),
      soul_markdown: String(row.soul_markdown || ''),
      memory_markdown: String(row.memory_markdown || ''),
      cron_schedule: row.cron_schedule ? String(row.cron_schedule) : null,
      pack_id: row.pack_id ? String(row.pack_id) : null,
      status: (row.status === 'paused' ? 'paused' : 'active') as AgentCoreConfig['status'],
      updated_at: String(row.updated_at || nowIso()),
    };
  }

  private syncAgentCoreWorkspaceFiles(core: AgentCoreConfig): void {
    try {
      const safeSlug = sanitizeWorkspaceSlug(core.workspace_slug || deriveAgentWorkspaceSlug(core.agent_role));
      const agentWsRoot = resolveConfinedPath(this.workspacesDir, safeSlug);
      fs.mkdirSync(agentWsRoot, { recursive: true });
      const soulPath = resolveConfinedPath(agentWsRoot, 'SOUL.md');
      const memoryPath = resolveConfinedPath(agentWsRoot, 'MEMORY.md');
      fs.writeFileSync(soulPath, core.soul_markdown || '', 'utf8');
      fs.writeFileSync(memoryPath, core.memory_markdown || '', 'utf8');
    } catch {
      // Non-fatal: SQLite remains source of truth even if filesystem sync is restricted
    }
  }

  public listAgentCores(ownerUserId: string): AgentCoreConfig[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_cores
         WHERE owner_user_id = ?
         ORDER BY updated_at DESC`
      )
      .all(ownerUserId) as Array<Record<string, unknown>>;

    return rows.map((row) => this.hydrateAgentCoreRow(row));
  }

  public getAgentCore(
    ownerUserId: string,
    agentRole: string,
    seedMeta?: AgentCoreSeedMeta
  ): AgentCoreConfig {
    const safeRole = normalizeAgentRoleSlug(agentRole);
    const row = this.db
      .prepare('SELECT * FROM agent_cores WHERE owner_user_id = ? AND agent_role = ?')
      .get(ownerUserId, safeRole) as Record<string, unknown> | undefined;

    if (row) {
      return this.hydrateAgentCoreRow(row);
    }

    const seeded = buildDefaultAgentCore(safeRole, seedMeta, nowIso());
    this.saveAgentCoreRecord(ownerUserId, seeded);
    return seeded;
  }

  private saveAgentCoreRecord(ownerUserId: string, core: AgentCoreConfig): void {
    this.db
      .prepare(
        `INSERT INTO agent_cores (
          owner_user_id, agent_role, workspace_slug, orchestration_mode,
          max_steps, max_delegation_depth, primary_provider, primary_model,
          fallback_provider, fallback_model, autonomy_policy, daily_budget_usd,
          allowed_mcp_servers_json, soul_markdown, memory_markdown, cron_schedule,
          pack_id, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_user_id, agent_role) DO UPDATE SET
          workspace_slug = excluded.workspace_slug,
          orchestration_mode = excluded.orchestration_mode,
          max_steps = excluded.max_steps,
          max_delegation_depth = excluded.max_delegation_depth,
          primary_provider = excluded.primary_provider,
          primary_model = excluded.primary_model,
          fallback_provider = excluded.fallback_provider,
          fallback_model = excluded.fallback_model,
          autonomy_policy = excluded.autonomy_policy,
          daily_budget_usd = excluded.daily_budget_usd,
          allowed_mcp_servers_json = excluded.allowed_mcp_servers_json,
          soul_markdown = excluded.soul_markdown,
          memory_markdown = excluded.memory_markdown,
          cron_schedule = excluded.cron_schedule,
          pack_id = excluded.pack_id,
          status = excluded.status,
          updated_at = excluded.updated_at`
      )
      .run(
        ownerUserId,
        core.agent_role,
        core.workspace_slug,
        core.orchestration_mode,
        core.max_steps,
        core.max_delegation_depth,
        core.primary_provider,
        core.primary_model,
        core.fallback_provider,
        core.fallback_model,
        core.autonomy_policy,
        core.daily_budget_usd,
        JSON.stringify(core.allowed_mcp_servers),
        core.soul_markdown,
        core.memory_markdown,
        core.cron_schedule,
        core.pack_id,
        core.status,
        core.updated_at
      );

    this.syncAgentCoreWorkspaceFiles(core);
  }

  public upsertAgentCore(
    ownerUserId: string,
    agentRole: string,
    patch: AgentCorePatch,
    seedMeta?: AgentCoreSeedMeta
  ): AgentCoreConfig {
    const current = this.getAgentCore(ownerUserId, agentRole, seedMeta);
    const merged = sanitizeAgentCorePatch(current, patch, nowIso());
    this.saveAgentCoreRecord(ownerUserId, merged);

    this.appendAuditLog({
      action: 'agent_core.updated',
      actor: ownerUserId,
      resource: merged.agent_role,
      detail: `Núcleo atualizado (${merged.orchestration_mode}, ${merged.primary_provider}/${merged.primary_model}, max_steps=${merged.max_steps}).`,
    });

    return merged;
  }

  public deleteAgentCore(ownerUserId: string, agentRole: string): boolean {
    const safeRole = normalizeAgentRoleSlug(agentRole);
    this.db
      .prepare('DELETE FROM agent_cores WHERE owner_user_id = ? AND agent_role = ?')
      .run(ownerUserId, safeRole);
    return true;
  }
}
