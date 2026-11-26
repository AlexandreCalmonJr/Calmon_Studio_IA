/**
 * Repositório SQLite para contas e sessões de autenticação (`auth_users`, `auth_sessions`).
 */
import type { DatabaseSync } from 'node:sqlite';
import { nowIso } from './repoUtils.ts';

export interface AuthUserRow {
  username: string;
  display_name: string;
  role: 'admin' | 'developer' | 'auditor';
  is_active: boolean;
  must_change_password: boolean;
  salt: string;
  password_hash: string;
  created_at: string;
}

export interface AuthSessionRow {
  session_id: string;
  username: string;
  role: 'admin' | 'developer' | 'auditor';
  kind: 'human' | 'service';
  created_at: number;
}

export class AuthRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public upsertAuthUser(user: AuthUserRow): void {
    const now = nowIso();
    this.db.prepare(`
      INSERT INTO auth_users (username, display_name, role, is_active, must_change_password, salt, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        display_name = excluded.display_name,
        role = excluded.role,
        is_active = excluded.is_active,
        must_change_password = excluded.must_change_password,
        salt = excluded.salt,
        password_hash = excluded.password_hash,
        updated_at = excluded.updated_at
    `).run(
      user.username.slice(0, 64),
      user.display_name.slice(0, 80),
      user.role,
      user.is_active ? 1 : 0,
      user.must_change_password ? 1 : 0,
      user.salt,
      user.password_hash,
      user.created_at,
      now,
    );
  }

  public getAuthUser(username: string): AuthUserRow | null {
    const row = this.db.prepare('SELECT * FROM auth_users WHERE username = ?').get(username) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      username: String(row.username),
      display_name: String(row.display_name),
      role: String(row.role) as 'admin' | 'developer' | 'auditor',
      is_active: Boolean(row.is_active),
      must_change_password: Boolean(row.must_change_password),
      salt: String(row.salt),
      password_hash: String(row.password_hash),
      created_at: String(row.created_at),
    };
  }

  public listAuthUsers(): AuthUserRow[] {
    const rows = this.db.prepare('SELECT * FROM auth_users ORDER BY created_at ASC').all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      username: String(row.username),
      display_name: String(row.display_name),
      role: String(row.role) as 'admin' | 'developer' | 'auditor',
      is_active: Boolean(row.is_active),
      must_change_password: Boolean(row.must_change_password),
      salt: String(row.salt),
      password_hash: String(row.password_hash),
      created_at: String(row.created_at),
    }));
  }

  public deleteAuthUser(username: string): void {
    this.db.prepare('DELETE FROM auth_users WHERE username = ?').run(username);
  }

  public upsertAuthSession(session: AuthSessionRow): void {
    const expiresAt = session.created_at + 86_400_000;
    this.db.prepare(`
      INSERT INTO auth_sessions (session_id, username, role, kind, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO NOTHING
    `).run(
      session.session_id,
      session.username,
      session.role,
      session.kind,
      session.created_at,
      expiresAt,
    );
  }

  public getAuthSession(sessionId: string): AuthSessionRow | null {
    const now = Date.now();
    const row = this.db
      .prepare('SELECT * FROM auth_sessions WHERE session_id = ? AND expires_at > ?')
      .get(sessionId, now) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      session_id: String(row.session_id),
      username: String(row.username),
      role: String(row.role) as 'admin' | 'developer' | 'auditor',
      kind: String(row.kind) as 'human' | 'service',
      created_at: Number(row.created_at),
    };
  }

  public deleteAuthSession(sessionId: string): void {
    this.db.prepare('DELETE FROM auth_sessions WHERE session_id = ?').run(sessionId);
  }

  public deleteAuthSessionsByUser(username: string, exceptSessionId?: string): void {
    if (exceptSessionId) {
      this.db.prepare('DELETE FROM auth_sessions WHERE username = ? AND session_id != ?').run(username, exceptSessionId);
    } else {
      this.db.prepare('DELETE FROM auth_sessions WHERE username = ?').run(username);
    }
  }

  public listActiveAuthSessions(): AuthSessionRow[] {
    const now = Date.now();
    const rows = this.db
      .prepare('SELECT * FROM auth_sessions WHERE expires_at > ? ORDER BY created_at DESC LIMIT 500')
      .all(now) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      session_id: String(row.session_id),
      username: String(row.username),
      role: String(row.role) as 'admin' | 'developer' | 'auditor',
      kind: String(row.kind) as 'human' | 'service',
      created_at: Number(row.created_at),
    }));
  }

  public purgeExpiredAuthSessions(): number {
    const now = Date.now();
    const result = this.db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now) as { changes: number };
    return result.changes;
  }

  public migrateUsersSnapshotIfNeeded(snapshotUsers: Array<[string, AuthUserRow]>): number {
    const existing = this.db.prepare('SELECT COUNT(*) as cnt FROM auth_users').get() as { cnt: number };
    if (existing.cnt > 0) return 0;
    let migrated = 0;
    try {
      this.db.exec('BEGIN IMMEDIATE');
      for (const [, user] of snapshotUsers) {
        if (!user?.username) continue;
        this.db.prepare(`
          INSERT OR IGNORE INTO auth_users
            (username, display_name, role, is_active, must_change_password, salt, password_hash, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          user.username.slice(0, 64),
          (user.display_name || user.username).slice(0, 80),
          user.role || 'developer',
          user.is_active ? 1 : 0,
          user.must_change_password ? 1 : 0,
          user.salt || '',
          user.password_hash || '',
          user.created_at || nowIso(),
          nowIso(),
        );
        migrated++;
      }
      this.db.exec('COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* já revertido */ }
      throw err;
    }
    return migrated;
  }
}
