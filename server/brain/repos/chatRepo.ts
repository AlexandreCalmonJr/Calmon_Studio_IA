/**
 * Repositório SQLite para sessões de chat, mensagens, tarefas, coding e histórico de agentes.
 */
import type { DatabaseSync } from 'node:sqlite';
import { normalizeAgentRoleSlug } from '../../../src/services/agentCoreEngine.ts';
import { nowIso, safeJsonParse } from './repoUtils.ts';

export class ChatRepository {
  private readonly db: DatabaseSync;
  private readonly isClosed: () => boolean;

  constructor(db: DatabaseSync, isClosed: () => boolean) {
    this.db = db;
    this.isClosed = isClosed;
  }

  public upsertTaskRecord(task: Record<string, unknown>): void {
    if (this.isClosed()) return;
    const taskId = String(task.task_id || task.id || `tsk_${Date.now()}`).slice(0, 128);
    const sessionId = task.session_id ? String(task.session_id).slice(0, 128) : null;
    const userPrompt = String(task.user_prompt || task.prompt || '').slice(0, 4000);
    const status = String(task.status || (task.is_completed ? 'completed' : 'running')).slice(0, 32);
    const createdAt = String(task.created_at || nowIso());
    this.db
      .prepare(
        `INSERT INTO app_tasks (task_id, session_id, user_prompt, status, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           session_id = excluded.session_id,
           user_prompt = excluded.user_prompt,
           status = excluded.status,
           payload_json = excluded.payload_json`
      )
      .run(taskId, sessionId, userPrompt, status, JSON.stringify(task), createdAt);
  }

  public listTaskRecords(limit = 200): Record<string, unknown>[] {
    if (this.isClosed()) return [];
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = this.db
      .prepare('SELECT payload_json FROM app_tasks ORDER BY created_at DESC LIMIT ?')
      .all(safeLimit) as Array<{ payload_json: string }>;
    return rows
      .map((r) => safeJsonParse<Record<string, unknown> | null>(r.payload_json, null))
      .filter((item): item is Record<string, unknown> => Boolean(item));
  }

  public deleteTaskRecord(taskId: string): boolean {
    if (this.isClosed()) return false;
    const res = this.db.prepare('DELETE FROM app_tasks WHERE task_id = ?').run(String(taskId));
    return Number(res.changes || 0) > 0;
  }

  public purgeOldTaskRecords(daysRetention: number): number {
    if (this.isClosed()) return 0;
    const safeDays = Math.max(0, Math.min(3650, Number.isFinite(daysRetention) ? daysRetention : 30));
    const cutoffIso = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
    const res = this.db
      .prepare('DELETE FROM app_tasks WHERE created_at <= ?')
      .run(cutoffIso);
    return Number(res.changes || 0);
  }

  public upsertChatSessionRecord(session: {
    id: string;
    user_id?: string;
    title: string;
    mode?: string;
    created_at?: string;
    updated_at?: string;
  }): void {
    if (this.isClosed()) return;
    const id = String(session.id || '').slice(0, 128);
    if (!id) return;
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO chat_sessions (id, user_id, title, mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           mode = excluded.mode,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        String(session.user_id || 'admin').slice(0, 64),
        String(session.title || 'Conversa').slice(0, 200),
        String(session.mode || 'standard').slice(0, 32),
        String(session.created_at || now),
        String(session.updated_at || now)
      );
  }

  public appendChatMessageRecord(msg: {
    id: string;
    session_id: string;
    role: string;
    content: string;
    agent_role?: string | null;
    created_at?: string;
  }): void {
    if (this.isClosed()) return;
    const sid = String(msg.session_id || '').slice(0, 128);
    if (!sid) return;
    const now = nowIso();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO chat_sessions (id, user_id, title, mode, created_at, updated_at)
         VALUES (?, 'admin', 'Conversa', 'standard', ?, ?)`
      )
      .run(sid, now, now);
    this.db
      .prepare(
        `INSERT INTO chat_messages (id, session_id, role, content, agent_role, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`
      )
      .run(
        String(msg.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`).slice(0, 128),
        sid,
        String(msg.role || 'user').slice(0, 32),
        String(msg.content || ''),
        msg.agent_role ? String(msg.agent_role).slice(0, 64) : null,
        String(msg.created_at || now)
      );
  }

  public listChatSessionsRelational(limit = 100): Array<{
    id: string;
    user_id: string;
    title: string;
    mode: string;
    created_at: string;
    updated_at: string;
  }> {
    if (this.isClosed()) return [];
    const safeLimit = Math.max(1, Math.min(300, Math.floor(limit)));
    return this.db
      .prepare('SELECT id, user_id, title, mode, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT ?')
      .all(safeLimit) as Array<{
      id: string;
      user_id: string;
      title: string;
      mode: string;
      created_at: string;
      updated_at: string;
    }>;
  }

  public getChatSessionMessagesRelational(
    sessionId: string,
    limit = 250
  ): Array<{
    id: string;
    session_id: string;
    role: string;
    content: string;
    agent_role: string | null;
    created_at: string;
  }> {
    if (this.isClosed()) return [];
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    return this.db
      .prepare(
        'SELECT id, session_id, role, content, agent_role, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?'
      )
      .all(String(sessionId), safeLimit) as Array<{
      id: string;
      session_id: string;
      role: string;
      content: string;
      agent_role: string | null;
      created_at: string;
    }>;
  }

  public deleteChatSessionRecord(sessionId: string): boolean {
    if (this.isClosed()) return false;
    const res = this.db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(String(sessionId));
    return Number(res.changes || 0) > 0;
  }

  public migrateLegacyChatSessionsSnapshotIfNeeded(
    loadNamespace: <T>(namespace: string) => T | null
  ): number {
    if (this.isClosed()) return 0;
    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM chat_sessions').get() as { cnt: number };
    if (Number(countRow?.cnt || 0) > 0) return 0;

    const legacy = loadNamespace<Array<[string, any]>>('chat_sessions');
    if (!Array.isArray(legacy) || legacy.length === 0) return 0;

    let migrated = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [, sess] of legacy) {
        if (!sess?.session_id) continue;
        this.upsertChatSessionRecord({
          id: String(sess.session_id),
          title: String(sess.title || 'Conversa'),
          mode: String(sess.first_intent || 'standard'),
          created_at: String(sess.last_activity || nowIso()),
          updated_at: String(sess.last_activity || nowIso()),
        });
        if (Array.isArray(sess.messages)) {
          for (let i = 0; i < sess.messages.length; i += 1) {
            const m = sess.messages[i];
            this.appendChatMessageRecord({
              id: `${sess.session_id}_m_${m.id ?? i}`,
              session_id: String(sess.session_id),
              role: String(m.role || 'user'),
              content: String(m.content || ''),
              created_at: String(m.created_at || nowIso()),
            });
          }
        }
        migrated += 1;
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return migrated;
  }

  public appendCodingMessage(input: {
    session_id: string;
    project_id?: string | null;
    role: string;
    content: string;
    tool_calls?: unknown[];
    tool_call_id?: string | null;
    tool_name?: string | null;
  }) {
    const createdAt = nowIso();
    const info = this.db
      .prepare(
        `INSERT INTO coding_session_messages
          (session_id, project_id, role, content, tool_calls_json, tool_call_id, tool_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.session_id.slice(0, 128),
        input.project_id ? String(input.project_id).slice(0, 128) : null,
        String(input.role || 'user').slice(0, 32),
        String(input.content || '').slice(0, 32000),
        input.tool_calls ? JSON.stringify(input.tool_calls) : null,
        input.tool_call_id ? String(input.tool_call_id).slice(0, 128) : null,
        input.tool_name ? String(input.tool_name).slice(0, 128) : null,
        createdAt
      );
    return {
      id: Number(info.lastInsertRowid || Date.now()),
      session_id: input.session_id,
      project_id: input.project_id || null,
      role: input.role,
      content: input.content,
      tool_calls: input.tool_calls,
      tool_call_id: input.tool_call_id || null,
      tool_name: input.tool_name || null,
      created_at: createdAt,
    };
  }

  public listCodingMessages(sessionId: string) {
    if (this.isClosed()) return [];
    const rows = this.db
      .prepare('SELECT * FROM coding_session_messages WHERE session_id = ? ORDER BY id ASC LIMIT 200')
      .all(String(sessionId)) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      session_id: String(row.session_id),
      project_id: row.project_id ? String(row.project_id) : null,
      role: String(row.role),
      content: String(row.content),
      tool_calls: row.tool_calls_json ? safeJsonParse<unknown[]>(String(row.tool_calls_json), undefined as any) : undefined,
      tool_call_id: row.tool_call_id ? String(row.tool_call_id) : null,
      tool_name: row.tool_name ? String(row.tool_name) : null,
      created_at: String(row.created_at),
    }));
  }

  public clearCodingMessages(sessionId: string): number {
    if (this.isClosed()) return 0;
    const res = this.db
      .prepare('DELETE FROM coding_session_messages WHERE session_id = ?')
      .run(String(sessionId));
    return Number(res.changes || 0);
  }

  public appendAgentHistoryMessage(
    agentRole: string,
    sessionId: string,
    role: 'user' | 'assistant' | 'tool',
    content: string
  ) {
    const createdAt = nowIso();
    const info = this.db
      .prepare(
        `INSERT INTO agent_conversation_history (agent_role, session_id, role, content, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        normalizeAgentRoleSlug(agentRole),
        String(sessionId || 'default').slice(0, 128),
        role,
        String(content || '').slice(0, 32000),
        createdAt
      );
    return {
      id: Number(info.lastInsertRowid || Date.now()),
      agent_role: normalizeAgentRoleSlug(agentRole),
      session_id: String(sessionId || 'default'),
      role,
      content,
      created_at: createdAt,
    };
  }

  public listAgentHistoryMessages(agentRole: string, sessionId = 'default') {
    if (this.isClosed()) return [];
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_conversation_history
         WHERE agent_role = ? AND session_id = ?
         ORDER BY id ASC LIMIT 200`
      )
      .all(normalizeAgentRoleSlug(agentRole), String(sessionId || 'default')) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      agent_role: String(row.agent_role),
      session_id: String(row.session_id),
      role: String(row.role),
      content: String(row.content),
      created_at: String(row.created_at),
    }));
  }
}
