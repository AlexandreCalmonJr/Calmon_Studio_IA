/**
 * Fase 8 — Driver e Repositório Persistente do Cérebro no Modo `local_sqlite`.
 *
 * Usa o motor SQLite nativo do Node.js 22 (`node:sqlite` / DatabaseSync) em modo WAL,
 * com todas as consultas estritamente parametrizadas, pasta única limpa (`.jarvis-brain/`
 * ou `SQLITE_DATA_DIR`), backups reais em disco e migração transacional `.jarvis-pack`.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  createDefaultBrainProfiles,
  validateBrainProfileUrl,
  validateJarvisBrainPack,
  type BrainConnectionProfile,
  type BrainMode,
  type JarvisBrainPack,
} from '../../src/services/brainArchitectureEngine.ts';
import type { PairedDeviceRecord } from '../../src/services/androidAppEngine.ts';
import {
  buildDefaultAgentCore,
  deriveAgentWorkspaceSlug,
  normalizeAgentRoleSlug,
  sanitizeAgentCorePatch,
  type AgentCoreConfig,
  type AgentCorePatch,
  type AgentCoreSeedMeta,
} from '../../src/services/agentCoreEngine.ts';
import {
  DEFAULT_PREINSTALLED_PACK_IDS,
  getModulePackById,
  normalizePackSlug,
  sanitizeCustomPackInput,
  type CustomPackDraftInput,
  type ModulePackDefinition,
} from '../../src/services/modulePackEngine.ts';
import {
  BRAIN_SCHEMA_VERSION,
  CORE_SQLITE_TABLES,
  SCHEMA_MIGRATIONS,
  SCHEMA_USER_VERSION,
  SQLITE_SCHEMA_DDL,
  type AgentRunModel,
  type AgentRunStatus,
  type AgentRunStepModel,
  type AgentStepKind,
  type AgentStepStatus,
  type AgentWorkspaceModel,
  type AuditLogModel,
  type BrainBackupRecord,
  type BrainIdentityModel,
  type BrainProfileModel,
  type ChannelBindingModel,
  type ChannelProvider,
  type McpServerModel,
  type McpToolDescriptor,
  type McpToolLogModel,
  type McpTransport,
  type RunArtifactModel,
  type SandboxSessionModel,
  type ScheduledJobModel,
  type SessionLaneJobModel,
  type SqliteTableStats,
} from './models.ts';
import {
  resolveConfinedPath,
  sanitizeWorkspaceSlug,
  WorkspaceMemoryStore,
} from './workspaceMemoryStore.ts';
import { AuthRepository, type AuthSessionRow, type AuthUserRow } from './repos/authRepo.ts';
import { ChatRepository } from './repos/chatRepo.ts';
import { VaultRepository } from './repos/vaultRepo.ts';
import { PacksRepository } from './repos/packsRepo.ts';
import { AgentsRepository } from './repos/agentsRepo.ts';

export interface LocalSqliteStoreOptions {
  dataDir?: string;
  dbFilename?: string;
  brainName?: string;
  assistantName?: string;
  defaultOrigin?: string;
}

export function resolveSafeSqliteStorageDir(rawDir?: string): string {
  const configured = String(rawDir || process.env.SQLITE_DATA_DIR || '').trim();
  if (!configured) {
    return path.resolve(process.cwd(), '.jarvis-brain');
  }
  const expanded = configured.startsWith('~/')
    ? path.join(os.homedir(), configured.slice(2))
    : configured;
  return path.resolve(expanded);
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToConnectionProfile(row: BrainProfileModel): BrainConnectionProfile {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    mode: row.mode,
    databaseEngine: row.database_engine,
    description: row.description,
    isDefault: Boolean(row.is_default),
    isLocalCurrent: Boolean(row.is_local_current),
    status: row.status,
    latencyMs: row.latency_ms,
    lastCheckedAt: row.last_checked_at,
    capabilities: safeJsonParse<string[]>(row.capabilities_json, []),
    version: row.version,
  };
}

export class LocalSqliteBrainStore {
  public readonly dataDir: string;
  public readonly dbPath: string;
  public readonly backupsDir: string;
  public readonly workspacesDir: string;
  private readonly db: DatabaseSync;
  private readonly workspaceStores = new Map<string, WorkspaceMemoryStore>();
  private readonly startedAtMs: number;
  private closed = false;
  private readonly authRepo: AuthRepository;
  private readonly chatRepo: ChatRepository;
  private readonly vaultRepo: VaultRepository;
  private readonly packsRepo: PacksRepository;
  private readonly agentsRepo: AgentsRepository;

  private static isSqliteCorruptionError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const rec = err as { code?: string; errcode?: number; errstr?: string; message?: string };
    if (rec.errcode === 11 || rec.errcode === 26) return true;
    const text = `${rec.errstr || ''} ${rec.message || ''}`.toLowerCase();
    return (
      text.includes('database disk image is malformed') ||
      text.includes('file is not a database') ||
      text.includes('sqlite_corrupt') ||
      text.includes('sqlite_notadb')
    );
  }

  private quarantineFiles(paths: string[], label: string): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const filePath of paths) {
      try {
        if (!fs.existsSync(filePath)) continue;
        const base = path.basename(filePath);
        const dest = path.join(this.backupsDir, `${label}-${stamp}-${base}`);
        fs.renameSync(filePath, dest);
      } catch {
        try {
          fs.rmSync(filePath, { force: true });
        } catch {
          // Ignora falha ao remover arquivo corrompido
        }
      }
    }
  }

  private openAndInitializeDatabase(): DatabaseSync {
    const tryInit = (): DatabaseSync => {
      const db = new DatabaseSync(this.dbPath);
      try {
        const check = db.prepare('PRAGMA quick_check(1)').get() as { quick_check?: string } | undefined;
        if (check?.quick_check && check.quick_check.toLowerCase() !== 'ok') {
          throw Object.assign(new Error(`database disk image is malformed (${check.quick_check})`), {
            errcode: 11,
          });
        }
        db.exec(SQLITE_SCHEMA_DDL);
        return db;
      } catch (err) {
        try {
          db.close();
        } catch {
          // Ignora erro ao fechar handle corrompido
        }
        throw err;
      }
    };

    try {
      return tryInit();
    } catch (firstErr) {
      if (!LocalSqliteBrainStore.isSqliteCorruptionError(firstErr)) {
        throw firstErr;
      }

      const walPath = `${this.dbPath}-wal`;
      const shmPath = `${this.dbPath}-shm`;
      if (fs.existsSync(walPath) || fs.existsSync(shmPath)) {
        console.warn(
          '[JARVIS Brain SQLite] Sidecar WAL/SHM desalinhado detectado; isolando em backups/ para preservar o banco principal.'
        );
        this.quarantineFiles([walPath, shmPath], 'corrupted-wal');
        try {
          return tryInit();
        } catch (secondErr) {
          if (!LocalSqliteBrainStore.isSqliteCorruptionError(secondErr)) {
            throw secondErr;
          }
        }
      }

      console.warn(
        '[JARVIS Brain SQLite] Banco SQLite corrompido detectado; movendo arquivo original para backups/ e recriando banco limpo.'
      );
      this.quarantineFiles([this.dbPath, walPath, shmPath], 'corrupted-db');
      return tryInit();
    }
  }

  constructor(options: LocalSqliteStoreOptions = {}) {
    this.startedAtMs = Date.now();
    this.dataDir = resolveSafeSqliteStorageDir(options.dataDir);
    this.backupsDir = path.join(this.dataDir, 'backups');
    this.workspacesDir = path.join(this.dataDir, 'workspaces');
    const safeFilename = path.basename(options.dbFilename || 'brain.db').replace(/[^a-zA-Z0-9._-]/g, '_') || 'brain.db';
    this.dbPath = path.join(this.dataDir, safeFilename);

    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(path.join(this.dataDir, 'media'), { recursive: true });
    fs.mkdirSync(path.join(this.dataDir, 'spreadsheets'), { recursive: true });
    fs.mkdirSync(this.backupsDir, { recursive: true });
    fs.mkdirSync(this.workspacesDir, { recursive: true });

    this.db = this.openAndInitializeDatabase();
    this.runSchemaMigrations();

    const auditLogger = (entry: { action: string; actor?: string; resource: string; detail?: string }) =>
      this.appendAuditLog(entry);
    this.authRepo = new AuthRepository(this.db);
    this.chatRepo = new ChatRepository(this.db, () => this.closed);
    this.vaultRepo = new VaultRepository(this.db, auditLogger);
    this.packsRepo = new PacksRepository(this.db, auditLogger);
    this.agentsRepo = new AgentsRepository(this.db, this.workspacesDir, auditLogger);

    this.ensureInitialRecords(options);
    this.ensureDefaultWorkspaceAndMcp();
  }

  /**
   * Sistema de migrations versionadas via PRAGMA user_version.
   * Aplica automaticamente todas as migrations pendentes em ordem sequencial,
   * com backup automático antes da primeira migration em produção.
   */
  private runSchemaMigrations(): void {
    const currentVersion = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (currentVersion >= SCHEMA_USER_VERSION) return;

    // Backup automático antes de qualquer alteração de schema em banco existente
    if (currentVersion > 0) {
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(this.backupsDir, `pre-migration-v${currentVersion}-to-v${SCHEMA_USER_VERSION}-${stamp}.db`);
        fs.copyFileSync(this.dbPath, backupPath);
      } catch {
        // Não bloqueia a migration se o backup falhar (ex: disco cheio temporário)
      }
    }

    for (const migration of SCHEMA_MIGRATIONS) {
      if (migration.version <= currentVersion) continue;
      if (!migration.sql.trim()) {
        // Migration sem SQL (ex: v1 que apenas marca a versão inicial)
        this.db.exec(`PRAGMA user_version = ${migration.version}`);
        continue;
      }
      try {
        this.db.exec('BEGIN IMMEDIATE');
        this.db.exec(migration.sql);
        this.db.exec(`PRAGMA user_version = ${migration.version}`);
        this.db.exec('COMMIT');
      } catch (err) {
        try { this.db.exec('ROLLBACK'); } catch { /* já revertido */ }
        throw new Error(`Migration v${migration.version} (${migration.description}) falhou: ${String(err)}`);
      }
    }
  }

  private ensureInitialRecords(options: LocalSqliteStoreOptions): void {
    const now = nowIso();
    const existingIdentity = this.db
      .prepare('SELECT id FROM brain_identity LIMIT 1')
      .get() as { id: string } | undefined;

    if (!existingIdentity) {
      const brainName =
        String(options.brainName || process.env.BRAIN_NAME || 'Esta Máquina · Local (Sem Docker)')
          .trim()
          .slice(0, 64) || 'Esta Máquina · Local (Sem Docker)';
      const assistantName =
        String(options.assistantName || process.env.ASSISTANT_NAME || 'JARVIS').trim().slice(0, 32) || 'JARVIS';

      this.db
        .prepare(
          `INSERT INTO brain_identity
            (id, name, mode, schema_version, database_engine, assistant_name, mdns_service, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `brain_local_${crypto.randomBytes(4).toString('hex')}`,
          brainName,
          'local_sqlite',
          BRAIN_SCHEMA_VERSION,
          'SQLite WAL (node:sqlite)',
          assistantName,
          '_jarvis-brain._tcp.local',
          now,
          now
        );
    }

    const profileCount = (
      this.db.prepare('SELECT COUNT(*) AS total FROM brain_profiles').get() as { total: number }
    ).total;

    if (profileCount === 0) {
      const origin = options.defaultOrigin || `http://localhost:${process.env.PORT || 3000}`;
      const defaults = createDefaultBrainProfiles(origin);
      const insertStmt = this.db.prepare(
        `INSERT INTO brain_profiles
          (id, name, base_url, mode, database_engine, description, is_default, is_local_current, is_active,
           status, latency_ms, last_checked_at, capabilities_json, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (let i = 0; i < defaults.length; i += 1) {
        const p = defaults[i];
        insertStmt.run(
          p.id,
          p.name,
          p.baseUrl,
          p.mode,
          p.databaseEngine,
          p.description,
          p.isDefault ? 1 : 0,
          p.isLocalCurrent ? 1 : 0,
          i === 0 ? 1 : 0,
          p.status,
          p.latencyMs,
          p.lastCheckedAt,
          JSON.stringify(p.capabilities || []),
          p.version || '3.8.0-dual',
          now,
          now
        );
      }
    }
  }

  public getUptimeSeconds(): number {
    return Math.floor((Date.now() - this.startedAtMs) / 1000);
  }

  public getIdentity(): BrainIdentityModel {
    return this.db.prepare('SELECT * FROM brain_identity LIMIT 1').get() as unknown as BrainIdentityModel;
  }

  public updateIdentity(patch: { name?: string; assistant_name?: string }): BrainIdentityModel {
    const current = this.getIdentity();
    const nextName = patch.name !== undefined ? String(patch.name).trim().slice(0, 64) || current.name : current.name;
    const nextAssistant =
      patch.assistant_name !== undefined
        ? String(patch.assistant_name).trim().slice(0, 32) || current.assistant_name
        : current.assistant_name;
    const now = nowIso();

    this.db
      .prepare('UPDATE brain_identity SET name = ?, assistant_name = ?, updated_at = ? WHERE id = ?')
      .run(nextName, nextAssistant, now, current.id);

    this.appendAuditLog({
      action: 'brain.identity.updated',
      actor: 'admin',
      resource: current.id,
      detail: `Nome="${nextName}", Assistente="${nextAssistant}"`,
    });
    return this.getIdentity();
  }

  public getDatabaseHealth(): {
    ok: boolean;
    journalMode: string;
    dbSizeBytes: number;
    integrity: string;
  } {
    const jm = this.db.prepare('PRAGMA journal_mode').get() as { journal_mode?: string } | undefined;
    const check = this.db.prepare('PRAGMA quick_check(1)').get() as { quick_check?: string } | undefined;
    let dbSizeBytes = 0;
    try {
      dbSizeBytes = fs.statSync(this.dbPath).size;
    } catch {
      dbSizeBytes = 0;
    }
    const integrity = String(check?.quick_check || 'ok');
    return {
      ok: integrity.toLowerCase() === 'ok',
      journalMode: String(jm?.journal_mode || 'wal').toLowerCase(),
      dbSizeBytes,
      integrity,
    };
  }

  public getTableStats(): SqliteTableStats[] {
    const core = CORE_SQLITE_TABLES.map((table) => {
      const row = this.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number };
      return { table, rows: Number(row?.total || 0) };
    });
    const wsStats = this.getActiveWorkspaceStore().getTableStats();
    return [...core, ...wsStats];
  }

  // ==================== MULTI-BRAIN PROFILES ====================
  public listBrainProfiles(): { activeProfileId: string; profiles: BrainConnectionProfile[] } {
    const rows = this.db
      .prepare('SELECT * FROM brain_profiles ORDER BY is_local_current DESC, created_at ASC')
      .all() as unknown as BrainProfileModel[];

    const activeRow = rows.find((r) => r.is_active === 1) || rows[0];
    return {
      activeProfileId: activeRow?.id || 'brain_local_primary',
      profiles: rows.map(rowToConnectionProfile),
    };
  }

  public getActiveBrainProfile(): BrainConnectionProfile {
    const { activeProfileId, profiles } = this.listBrainProfiles();
    return profiles.find((p) => p.id === activeProfileId) || profiles[0];
  }

  public addBrainProfile(input: {
    name: string;
    baseUrl: string;
    mode: BrainMode;
    description?: string;
  }): { created: BrainConnectionProfile; activeProfileId: string; profiles: BrainConnectionProfile[] } {
    const name = String(input.name || '').trim().slice(0, 64);
    if (name.length < 2) {
      throw new Error('Informe um nome amigável para este Cérebro (mínimo 2 caracteres).');
    }
    const check = validateBrainProfileUrl(input.baseUrl);
    if (!check.valid) {
      throw new Error(check.error || 'Endereço de servidor inválido.');
    }

    const mode: BrainMode =
      input.mode === 'local_sqlite' || input.mode === 'cloud' ? input.mode : 'docker_postgres';
    const databaseEngine =
      mode === 'local_sqlite'
        ? 'SQLite WAL + sqlite-vec'
        : mode === 'cloud'
        ? 'PostgreSQL 16 + HTTPS'
        : 'PostgreSQL 16 + pgvector + Redis';
    const description =
      String(input.description || '').trim().slice(0, 220) ||
      (mode === 'local_sqlite'
        ? 'Instância local sem Docker rodando diretamente na máquina.'
        : mode === 'cloud'
        ? 'Instância remota protegida por HTTPS.'
        : 'Contêiner Docker Compose com PostgreSQL + pgvector e Redis.');
    const capabilities =
      mode === 'local_sqlite'
        ? ['sqlite-wal', 'gemini-cloud']
        : ['postgres-pgvector', 'redis-queue', 'ollama-local'];

    const id = `brain_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    const now = nowIso();

    this.db
      .prepare(
        `INSERT INTO brain_profiles
          (id, name, base_url, mode, database_engine, description, is_default, is_local_current, is_active,
           status, latency_ms, last_checked_at, capabilities_json, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 'offline', NULL, NULL, ?, '3.8.0', ?, ?)`
      )
      .run(id, name, check.normalizedUrl, mode, databaseEngine, description, JSON.stringify(capabilities), now, now);

    this.appendAuditLog({
      action: 'brain.profile.created',
      actor: 'admin',
      resource: id,
      detail: `${name} (${mode}) -> ${check.normalizedUrl}`,
    });

    const listed = this.listBrainProfiles();
    const created = listed.profiles.find((p) => p.id === id)!;
    return { created, ...listed };
  }

  public setActiveBrainProfile(id: string): {
    active: BrainConnectionProfile;
    activeProfileId: string;
    profiles: BrainConnectionProfile[];
  } {
    const existing = this.db
      .prepare('SELECT id, name FROM brain_profiles WHERE id = ?')
      .get(id) as { id: string; name: string } | undefined;

    if (!existing) {
      throw new Error('Cérebro não encontrado.');
    }

    const now = nowIso();
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE brain_profiles SET is_active = 0').run();
      this.db.prepare('UPDATE brain_profiles SET is_active = 1, updated_at = ? WHERE id = ?').run(now, id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.appendAuditLog({
      action: 'brain.profile.activated',
      actor: 'admin',
      resource: id,
      detail: `Cérebro ativo alterado para "${existing.name}"`,
    });

    const listed = this.listBrainProfiles();
    const active = listed.profiles.find((p) => p.id === id)!;
    return { active, ...listed };
  }

  public updateBrainProfileHealth(
    id: string,
    status: 'online' | 'offline',
    latencyMs: number | null,
    checkedAt: string
  ): { profile: BrainConnectionProfile; profiles: BrainConnectionProfile[] } {
    const existing = this.db.prepare('SELECT id FROM brain_profiles WHERE id = ?').get(id) as
      | { id: string }
      | undefined;
    if (!existing) {
      throw new Error('Cérebro não encontrado.');
    }

    this.db
      .prepare('UPDATE brain_profiles SET status = ?, latency_ms = ?, last_checked_at = ?, updated_at = ? WHERE id = ?')
      .run(status, latencyMs, checkedAt, nowIso(), id);

    const listed = this.listBrainProfiles();
    const profile = listed.profiles.find((p) => p.id === id)!;
    return { profile, profiles: listed.profiles };
  }

  public deleteBrainProfile(id: string): { activeProfileId: string; profiles: BrainConnectionProfile[] } {
    const existing = this.db
      .prepare('SELECT id, name, is_local_current, is_active FROM brain_profiles WHERE id = ?')
      .get(id) as { id: string; name: string; is_local_current: number; is_active: number } | undefined;

    if (!existing) {
      throw new Error('Cérebro não encontrado.');
    }
    if (existing.is_local_current === 1) {
      throw new Error('O Cérebro local padrão desta máquina não pode ser removido.');
    }

    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM brain_profiles WHERE id = ?').run(id);
      if (existing.is_active === 1) {
        this.db
          .prepare('UPDATE brain_profiles SET is_active = 1 WHERE is_local_current = 1')
          .run();
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.appendAuditLog({
      action: 'brain.profile.deleted',
      actor: 'admin',
      resource: id,
      detail: `Cérebro "${existing.name}" removido`,
    });

    return this.listBrainProfiles();
  }

  // ==================== DISPOSITIVOS PAREADOS ====================
  public seedPairedDevicesIfEmpty(devices: PairedDeviceRecord[]): void {
    const count = (
      this.db.prepare('SELECT COUNT(*) AS total FROM paired_devices').get() as { total: number }
    ).total;
    if (count > 0) return;

    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO paired_devices
        (id, name, platform, model, os_version, status, token_hint, paired_at, last_seen, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    );
    for (const d of devices) {
      stmt.run(d.id, d.name, d.platform, d.model, d.os_version, d.status, d.token_hint, d.paired_at, d.last_seen);
    }
  }

  public listPairedDevices(): PairedDeviceRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM paired_devices WHERE revoked_at IS NULL ORDER BY paired_at DESC')
      .all() as unknown as Array<{
      id: string;
      name: string;
      platform: 'android' | 'desktop' | 'web';
      model: string;
      os_version: string;
      status: 'online' | 'offline';
      token_hint: string;
      paired_at: string;
      last_seen: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      platform: r.platform,
      model: r.model,
      os_version: r.os_version,
      status: r.status,
      token_hint: r.token_hint,
      paired_at: r.paired_at,
      last_seen: r.last_seen,
    }));
  }

  public savePairedDevice(device: PairedDeviceRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO paired_devices
          (id, name, platform, model, os_version, status, token_hint, paired_at, last_seen, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        device.id,
        device.name,
        device.platform,
        device.model,
        device.os_version,
        device.status,
        device.token_hint,
        device.paired_at,
        device.last_seen
      );
  }

  public revokePairedDevice(id: string): boolean {
    const res = this.db
      .prepare('UPDATE paired_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(nowIso(), id);
    return Number(res.changes || 0) > 0;
  }

  // ==================== SINCRONIZAÇÃO DE AGENTES, SKILLS, FLUXOS E CONHECIMENTO ====================
  public syncWorkspaceSnapshot(snapshot: {
    agents: Array<{
      role: string;
      name: string;
      handle: string;
      description: string;
      system_prompt: string;
      preferred_model?: string;
      autonomy_level?: string;
      is_custom?: boolean;
      installed_skills?: string[];
      version?: number;
      updated_at?: string;
    }>;
    skills: Array<{
      id: string;
      name: string;
      origin?: string;
      domain?: string;
      description: string;
      instructions?: string;
      is_approved?: boolean;
      assigned_agents?: string[];
      updated_at?: string;
    }>;
    workflows: Array<{
      id: string;
      title: string;
      description?: string;
      schedule_cron?: string | null;
      schedule_enabled?: boolean;
      nodes?: unknown[];
      edges?: unknown[];
      updated_at?: string;
    }>;
    knowledge: Array<{
      name: string;
      category?: string;
      file_type?: string;
      content: string;
      chunks?: number;
      size_bytes?: number;
      indexed_at?: string;
    }>;
  }): void {
    const now = nowIso();
    const upsertAgent = this.db.prepare(
      `INSERT INTO agents
        (role, name, handle, description, system_prompt, preferred_model, autonomy_level, is_custom, installed_skills_json, version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(role) DO UPDATE SET
        name = excluded.name,
        handle = excluded.handle,
        description = excluded.description,
        system_prompt = excluded.system_prompt,
        preferred_model = excluded.preferred_model,
        autonomy_level = excluded.autonomy_level,
        is_custom = excluded.is_custom,
        installed_skills_json = excluded.installed_skills_json,
        version = excluded.version,
        updated_at = excluded.updated_at`
    );

    const upsertSkill = this.db.prepare(
      `INSERT INTO skills
        (id, name, origin, domain, description, instructions, is_approved, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        origin = excluded.origin,
        domain = excluded.domain,
        description = excluded.description,
        instructions = excluded.instructions,
        is_approved = excluded.is_approved,
        updated_at = excluded.updated_at`
    );

    const insertLink = this.db.prepare(
      `INSERT OR IGNORE INTO agent_skills (agent_role, skill_id, linked_at) VALUES (?, ?, ?)`
    );

    const upsertWorkflow = this.db.prepare(
      `INSERT INTO workflows
        (id, title, description, schedule_cron, schedule_enabled, nodes_json, edges_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        schedule_cron = excluded.schedule_cron,
        schedule_enabled = excluded.schedule_enabled,
        nodes_json = excluded.nodes_json,
        edges_json = excluded.edges_json,
        updated_at = excluded.updated_at`
    );

    const upsertDoc = this.db.prepare(
      `INSERT INTO knowledge_documents
        (name, category, file_type, content, chunks, size_bytes, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
        category = excluded.category,
        file_type = excluded.file_type,
        content = excluded.content,
        chunks = excluded.chunks,
        size_bytes = excluded.size_bytes,
        indexed_at = excluded.indexed_at`
    );

    this.db.exec('BEGIN');
    try {
      const validRoles = new Set<string>();
      for (const a of snapshot.agents) {
        if (!a?.role) continue;
        validRoles.add(a.role);
        upsertAgent.run(
          a.role,
          a.name || a.role,
          a.handle || `@${a.role}`,
          a.description || '',
          a.system_prompt || '',
          a.preferred_model || 'gemini-2.5-flash',
          a.autonomy_level || 'confirm',
          a.is_custom ? 1 : 0,
          JSON.stringify(Array.isArray(a.installed_skills) ? a.installed_skills : []),
          Number(a.version || 1),
          a.updated_at || now
        );
      }

      for (const s of snapshot.skills) {
        if (!s?.id) continue;
        upsertSkill.run(
          s.id,
          s.name || s.id,
          s.origin || 'system',
          s.domain || 'geral',
          s.description || '',
          s.instructions || '',
          s.is_approved === false ? 0 : 1,
          s.updated_at || now
        );
        if (Array.isArray(s.assigned_agents)) {
          for (const agentRole of s.assigned_agents) {
            if (validRoles.has(agentRole)) {
              insertLink.run(agentRole, s.id, now);
            }
          }
        }
      }

      for (const w of snapshot.workflows) {
        if (!w?.id) continue;
        upsertWorkflow.run(
          w.id,
          w.title || 'Fluxo',
          w.description || '',
          w.schedule_cron || null,
          w.schedule_enabled ? 1 : 0,
          JSON.stringify(Array.isArray(w.nodes) ? w.nodes : []),
          JSON.stringify(Array.isArray(w.edges) ? w.edges : []),
          w.updated_at || now
        );
      }

      for (const k of snapshot.knowledge) {
        if (!k?.name) continue;
        const content = String(k.content || '');
        upsertDoc.run(
          k.name,
          k.category || 'geral',
          k.file_type || 'md',
          content,
          Number(k.chunks || Math.max(1, Math.ceil(content.length / 650))),
          Number(k.size_bytes || Buffer.byteLength(content, 'utf8')),
          k.indexed_at || now
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ==================== EXPORTAÇÃO & IMPORTAÇÃO .jarvis-pack ====================
  public exportJarvisPack(): JarvisBrainPack {
    const active = this.getActiveBrainProfile();
    const identity = this.getIdentity();

    const agentsRows = this.db.prepare('SELECT * FROM agents ORDER BY is_custom DESC, name ASC').all() as Array<
      Record<string, any>
    >;
    const skillsRows = this.db.prepare('SELECT * FROM skills ORDER BY updated_at DESC').all() as Array<
      Record<string, any>
    >;
    const linkRows = this.db.prepare('SELECT agent_role, skill_id FROM agent_skills').all() as Array<{
      agent_role: string;
      skill_id: string;
    }>;
    const workflowRows = this.db.prepare('SELECT * FROM workflows ORDER BY updated_at DESC').all() as Array<
      Record<string, any>
    >;
    const docRows = this.db.prepare('SELECT * FROM knowledge_documents ORDER BY indexed_at DESC').all() as Array<
      Record<string, any>
    >;

    const linksBySkill = new Map<string, string[]>();
    for (const l of linkRows) {
      const list = linksBySkill.get(l.skill_id) || [];
      list.push(l.agent_role);
      linksBySkill.set(l.skill_id, list);
    }

    return {
      schemaVersion: '1.0',
      format: 'jarvis-brain-pack',
      exportedAt: nowIso(),
      sourceBrain: {
        name: active?.name || identity.name,
        mode: active?.mode || identity.mode,
        databaseEngine: active?.databaseEngine || identity.database_engine,
        version: '3.8.0-dual',
      },
      agents: agentsRows.map((a) => ({
        role: String(a.role),
        name: String(a.name),
        handle: String(a.handle),
        description: String(a.description || ''),
        system_prompt: String(a.system_prompt || ''),
        installed_skills: safeJsonParse<string[]>(a.installed_skills_json, []),
        is_custom: Boolean(a.is_custom),
      })),
      skills: skillsRows.map((s) => ({
        id: String(s.id),
        name: String(s.name),
        description: String(s.description || ''),
        domain: String(s.domain || 'geral'),
        instructions: String(s.instructions || ''),
        assigned_agents: linksBySkill.get(String(s.id)) || [],
      })),
      workflows: workflowRows.map((w) => ({
        id: String(w.id),
        title: String(w.title),
        description: String(w.description || ''),
        schedule_cron: w.schedule_cron ? String(w.schedule_cron) : '0 8 * * *',
        schedule_enabled: Boolean(w.schedule_enabled),
        nodes: safeJsonParse<unknown[]>(w.nodes_json, []),
        edges: safeJsonParse<unknown[]>(w.edges_json, []),
      })),
      knowledge: docRows.map((k) => ({
        name: String(k.name),
        category: String(k.category || 'geral'),
        content: String(k.content || ''),
        file_type: String(k.file_type || 'md'),
      })),
    };
  }

  public importJarvisPack(rawPack: unknown): {
    pack: JarvisBrainPack;
    imported: { agents: number; skills: number; workflows: number; knowledge: number };
  } {
    const check = validateJarvisBrainPack(rawPack);
    if (!check.valid || !check.pack) {
      throw new Error(check.error || 'Pacote .jarvis-pack inválido.');
    }

    const pack = check.pack;
    const now = nowIso();
    let agentsCount = 0;
    let skillsCount = 0;
    let workflowsCount = 0;
    let knowledgeCount = 0;

    const hasAgent = this.db.prepare('SELECT 1 FROM agents WHERE role = ?');
    const insertAgent = this.db.prepare(
      `INSERT INTO agents
        (role, name, handle, description, system_prompt, preferred_model, autonomy_level, is_custom, installed_skills_json, version, updated_at)
       VALUES (?, ?, ?, ?, ?, 'gemini-2.5-flash', 'confirm', 1, ?, 1, ?)`
    );

    const hasSkill = this.db.prepare('SELECT 1 FROM skills WHERE lower(name) = lower(?)');
    const insertSkill = this.db.prepare(
      `INSERT INTO skills (id, name, origin, domain, description, instructions, is_approved, updated_at)
       VALUES (?, ?, 'custom', ?, ?, ?, 1, ?)`
    );

    const insertLink = this.db.prepare(
      `INSERT OR IGNORE INTO agent_skills (agent_role, skill_id, linked_at) VALUES (?, ?, ?)`
    );

    const hasWorkflow = this.db.prepare('SELECT 1 FROM workflows WHERE lower(title) = lower(?)');
    const insertWorkflow = this.db.prepare(
      `INSERT INTO workflows (id, title, description, schedule_cron, schedule_enabled, nodes_json, edges_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const hasDoc = this.db.prepare('SELECT 1 FROM knowledge_documents WHERE name = ?');
    const insertDoc = this.db.prepare(
      `INSERT INTO knowledge_documents (name, category, file_type, content, chunks, size_bytes, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    this.db.exec('BEGIN');
    try {
      for (const a of pack.agents) {
        if (!hasAgent.get(a.role)) {
          insertAgent.run(
            a.role,
            a.name,
            a.handle || `@${a.role}`,
            a.description || 'Agente migrado via .jarvis-pack.',
            a.system_prompt || 'Responda sempre em português do Brasil.',
            JSON.stringify(a.installed_skills || []),
            now
          );
          agentsCount += 1;
        }
      }

      for (const s of pack.skills) {
        if (!hasSkill.get(s.name)) {
          const skillId = s.id || `skill_pack_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
          insertSkill.run(
            skillId,
            s.name,
            s.domain || 'geral',
            s.description || 'Habilidade migrada via .jarvis-pack.',
            s.instructions || '',
            now
          );
          for (const agentRole of s.assigned_agents || []) {
            if (hasAgent.get(agentRole)) {
              insertLink.run(agentRole, skillId, now);
            }
          }
          skillsCount += 1;
        }
      }

      for (const w of pack.workflows) {
        if (!hasWorkflow.get(w.title)) {
          const wfId = w.id || `wf_pack_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
          insertWorkflow.run(
            wfId,
            w.title,
            w.description || 'Fluxo migrado via .jarvis-pack.',
            w.schedule_cron || '0 8 * * *',
            w.schedule_enabled ? 1 : 0,
            JSON.stringify(w.nodes || []),
            JSON.stringify(w.edges || []),
            now
          );
          workflowsCount += 1;
        }
      }

      for (const k of pack.knowledge) {
        if (!hasDoc.get(k.name)) {
          insertDoc.run(
            k.name,
            k.category || 'geral',
            k.file_type || 'md',
            k.content,
            Math.max(1, Math.ceil(k.content.length / 650)),
            Buffer.byteLength(k.content, 'utf8'),
            now
          );
          knowledgeCount += 1;
        }
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.appendAuditLog({
      action: 'brain.pack.imported',
      actor: 'admin',
      resource: pack.sourceBrain.name,
      detail: `+${agentsCount} agentes, +${skillsCount} skills, +${workflowsCount} fluxos, +${knowledgeCount} docs`,
    });

    return {
      pack,
      imported: {
        agents: agentsCount,
        skills: skillsCount,
        workflows: workflowsCount,
        knowledge: knowledgeCount,
      },
    };
  }

  // ==================== BACKUPS REAIS DO SQLITE ====================
  public createSqliteBackup(): BrainBackupRecord {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `brain-backup-${stamp}.db`;
    const targetPath = path.join(this.backupsDir, filename);

    // Garante flush consistente do WAL antes da cópia/snapshot
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    // Usa VACUUM INTO para gerar snapshot limpo e consistente mesmo com leitores ativos
    const escapedTarget = targetPath.replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${escapedTarget}'`);

    const size_bytes = fs.statSync(targetPath).size;
    const created_at = nowIso();

    this.appendAuditLog({
      action: 'brain.sqlite.backup',
      actor: 'admin',
      resource: filename,
      detail: `Snapshot SQLite gerado (${size_bytes} bytes)`,
    });

    return {
      filename,
      path: targetPath,
      size_bytes,
      created_at,
    };
  }

  public listBackups(): BrainBackupRecord[] {
    if (!fs.existsSync(this.backupsDir)) return [];
    const entries = fs
      .readdirSync(this.backupsDir)
      .filter((name) => name.endsWith('.db'))
      .map((filename) => {
        const full = path.join(this.backupsDir, filename);
        const stat = fs.statSync(full);
        return {
          filename,
          path: full,
          size_bytes: stat.size,
          created_at: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return entries.slice(0, 20);
  }

  // ==================== AUDITORIA ====================
  public appendAuditLog(entry: { action: string; actor?: string; resource: string; detail?: string }): void {
    const id = `aud_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    this.db
      .prepare('INSERT INTO audit_logs (id, action, actor, resource, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, entry.action, entry.actor || 'system', entry.resource, entry.detail || '', nowIso());
  }

  public listAuditLogs(limit = 30): AuditLogModel[] {
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
    return this.db
      .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?')
      .all(safeLimit) as unknown as AuditLogModel[];
  }

  // ==================== PERFIS ISOLADOS (HERMES / OPENCLAW) ====================
  private ensureDefaultWorkspaceAndMcp(): void {
    const now = nowIso();
    const wsCount = (
      this.db.prepare('SELECT COUNT(*) AS total FROM agent_workspaces').get() as { total: number }
    ).total;

    if (wsCount === 0) {
      this.db
        .prepare(
          `INSERT INTO agent_workspaces (slug, name, description, storage_subdir, db_filename, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'state.db', 1, ?, ?)`
        )
        .run(
          'default',
          'Perfil Principal',
          'Workspace local-first padrão com memória Markdown (SOUL/MEMORY/USER.md) e índice híbrido SQLite FTS5 + vetores.',
          'workspaces/default',
          now,
          now
        );
    }

    // Garante inicialização em disco do workspace ativo
    this.getActiveWorkspaceStore();

    const mcpCount = (
      this.db.prepare('SELECT COUNT(*) AS total FROM mcp_servers').get() as { total: number }
    ).total;

    if (mcpCount === 0) {
      const builtinServers: Array<{
        id: string;
        name: string;
        transport: McpTransport;
        endpoint: string;
        description: string;
        tools: McpToolDescriptor[];
      }> = [
        {
          id: 'mcp_jarvis_memory',
          name: 'JARVIS Memory MCP',
          transport: 'stdio',
          endpoint: 'builtin://memory-hybrid',
          description: 'Servidor MCP nativo de leitura/busca híbrida FTS5 + vetores e consulta aos arquivos SOUL.md, MEMORY.md e USER.md.',
          tools: [
            {
              name: 'memory.search_hybrid',
              description: 'Executa busca híbrida BM25 + cosseno (RRF) no perfil ativo',
              requires_approval: false,
              input_hint: '{"query": "sqlite wal"}',
            },
            {
              name: 'memory.list_facts',
              description: 'Lista fatos consolidados nas camadas memory e user (estilo Hermes)',
              requires_approval: false,
              input_hint: '{"scope": "memory"}',
            },
          ],
        },
        {
          id: 'mcp_jarvis_workspace',
          name: 'JARVIS Workspace Ops MCP',
          transport: 'stdio',
          endpoint: 'builtin://workspace-ops',
          description: 'Servidor MCP nativo para diagnóstico do SQLite WAL, perfis isolados e estatísticas de filas seriais.',
          tools: [
            {
              name: 'workspace.health_report',
              description: 'Retorna integridade SQLite WAL, tamanho do banco e tabelas ativas',
              requires_approval: false,
              input_hint: '{}',
            },
            {
              name: 'workspace.snapshot_backup',
              description: 'Dispara snapshot consistente VACUUM INTO do banco SQLite local',
              requires_approval: true,
              input_hint: '{}',
            },
          ],
        },
      ];

      const ins = this.db.prepare(
        `INSERT INTO mcp_servers
          (id, name, transport, endpoint, description, is_approved, is_builtin, status, tools_json, last_checked_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 1, 'online', ?, ?, ?, ?)`
      );
      for (const s of builtinServers) {
        ins.run(s.id, s.name, s.transport, s.endpoint, s.description, JSON.stringify(s.tools), now, now, now);
      }
    }
  }

  public listWorkspaces(): { activeSlug: string; workspaces: AgentWorkspaceModel[] } {
    const rows = this.db
      .prepare('SELECT * FROM agent_workspaces ORDER BY is_active DESC, created_at ASC')
      .all() as unknown as AgentWorkspaceModel[];
    const active = rows.find((r) => r.is_active === 1) || rows[0];
    return {
      activeSlug: active?.slug || 'default',
      workspaces: rows,
    };
  }

  public getActiveWorkspace(): AgentWorkspaceModel {
    const { activeSlug, workspaces } = this.listWorkspaces();
    return workspaces.find((w) => w.slug === activeSlug) || workspaces[0];
  }

  public getWorkspaceStore(slug: string): WorkspaceMemoryStore {
    const clean = sanitizeWorkspaceSlug(slug);
    const cached = this.workspaceStores.get(clean);
    if (cached) return cached;

    const row = this.db
      .prepare('SELECT slug, name FROM agent_workspaces WHERE slug = ?')
      .get(clean) as { slug: string; name: string } | undefined;

    if (!row) {
      throw new Error(`Perfil isolado "${clean}" não encontrado.`);
    }

    const identity = this.getIdentity();
    const store = new WorkspaceMemoryStore({
      workspacesRootDir: this.workspacesDir,
      slug: row.slug,
      workspaceName: row.name,
      assistantName: identity?.assistant_name || 'JARVIS',
    });
    this.workspaceStores.set(clean, store);
    return store;
  }

  public getActiveWorkspaceStore(): WorkspaceMemoryStore {
    const active = this.getActiveWorkspace();
    return this.getWorkspaceStore(active.slug);
  }

  public createWorkspace(input: { name: string; description?: string; slug?: string }): {
    created: AgentWorkspaceModel;
    activeSlug: string;
    workspaces: AgentWorkspaceModel[];
  } {
    const name = String(input.name || '').trim().slice(0, 64);
    if (name.length < 2) {
      throw new Error('Informe um nome para o perfil isolado (mínimo 2 caracteres).');
    }
    const baseSlug = sanitizeWorkspaceSlug(input.slug || name);
    let slug = baseSlug;
    let suffix = 2;
    while (this.db.prepare('SELECT 1 FROM agent_workspaces WHERE slug = ?').get(slug)) {
      slug = `${baseSlug.slice(0, 28)}-${suffix}`;
      suffix += 1;
    }

    // Garante confinamento estrito do diretório do perfil
    resolveConfinedPath(this.workspacesDir, slug);
    const description =
      String(input.description || '').trim().slice(0, 220) ||
      `Ambiente isolado "${name}" com banco SQLite WAL próprio e arquivos Markdown dedicados.`;
    const now = nowIso();

    this.db
      .prepare(
        `INSERT INTO agent_workspaces (slug, name, description, storage_subdir, db_filename, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'state.db', 0, ?, ?)`
      )
      .run(slug, name, description, `workspaces/${slug}`, now, now);

    // Inicializa imediatamente state.db + SOUL.md / MEMORY.md / USER.md em disco
    this.getWorkspaceStore(slug);

    this.appendAuditLog({
      action: 'brain.workspace.created',
      actor: 'admin',
      resource: slug,
      detail: `Perfil isolado "${name}" criado em workspaces/${slug}/state.db`,
    });

    const listed = this.listWorkspaces();
    const created = listed.workspaces.find((w) => w.slug === slug)!;
    return { created, ...listed };
  }

  public activateWorkspace(slug: string): {
    active: AgentWorkspaceModel;
    activeSlug: string;
    workspaces: AgentWorkspaceModel[];
  } {
    const clean = sanitizeWorkspaceSlug(slug);
    const existing = this.db
      .prepare('SELECT slug, name FROM agent_workspaces WHERE slug = ?')
      .get(clean) as { slug: string; name: string } | undefined;
    if (!existing) {
      throw new Error('Perfil isolado não encontrado.');
    }

    const now = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE agent_workspaces SET is_active = 0').run();
      this.db.prepare('UPDATE agent_workspaces SET is_active = 1, updated_at = ? WHERE slug = ?').run(now, clean);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.getWorkspaceStore(clean);
    this.appendAuditLog({
      action: 'brain.workspace.activated',
      actor: 'admin',
      resource: clean,
      detail: `Perfil isolado ativo alterado para "${existing.name}"`,
    });

    const listed = this.listWorkspaces();
    const active = listed.workspaces.find((w) => w.slug === clean)!;
    return { active, ...listed };
  }

  // ==================== FILAS SERIAIS POR SESSÃO ====================
  public recordLaneJob(job: SessionLaneJobModel): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO session_lane_jobs
          (id, session_id, workspace_slug, job_type, status, duration_ms, summary, error_message, created_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        job.id,
        job.session_id,
        job.workspace_slug,
        job.job_type,
        job.status,
        job.duration_ms,
        job.summary,
        job.error_message,
        job.created_at,
        job.finished_at
      );
  }

  public listLaneJobs(limit = 25): SessionLaneJobModel[] {
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
    return this.db
      .prepare('SELECT * FROM session_lane_jobs ORDER BY created_at DESC LIMIT ?')
      .all(safeLimit) as unknown as SessionLaneJobModel[];
  }

  // ==================== GATEWAY MCP NATIVO ====================
  private rowToMcpServer(r: Record<string, any>): McpServerModel {
    return {
      id: String(r.id),
      name: String(r.name),
      transport: r.transport === 'http' ? 'http' : 'stdio',
      endpoint: String(r.endpoint),
      description: String(r.description || ''),
      is_approved: Boolean(r.is_approved),
      is_builtin: Boolean(r.is_builtin),
      status: r.status === 'online' || r.status === 'error' ? r.status : 'standby',
      tools: safeJsonParse<McpToolDescriptor[]>(r.tools_json, []),
      last_checked_at: r.last_checked_at ? String(r.last_checked_at) : null,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  }

  public listMcpServers(): McpServerModel[] {
    const rows = this.db
      .prepare('SELECT * FROM mcp_servers ORDER BY is_builtin DESC, created_at ASC')
      .all() as Array<Record<string, any>>;
    return rows.map((r) => this.rowToMcpServer(r));
  }

  public addMcpServer(input: {
    name: string;
    transport: McpTransport;
    endpoint: string;
    description?: string;
  }): McpServerModel {
    const name = String(input.name || '').trim().slice(0, 64);
    if (name.length < 2) {
      throw new Error('Informe um nome para o servidor MCP (mínimo 2 caracteres).');
    }
    const transport: McpTransport = input.transport === 'http' ? 'http' : 'stdio';
    let endpoint = String(input.endpoint || '').trim().slice(0, 240);
    if (!endpoint) {
      throw new Error('Informe o endpoint ou comando de identificação do servidor MCP.');
    }

    if (transport === 'http') {
      const check = validateBrainProfileUrl(endpoint);
      if (!check.valid) {
        throw new Error(check.error || 'URL MCP inválida.');
      }
      endpoint = check.normalizedUrl;
    } else {
      // Para transporte stdio, bloqueia metacaracteres de shell
      if (/[;&|`$<>]/.test(endpoint)) {
        throw new Error('Identificador stdio não pode conter operadores de shell.');
      }
    }

    const description =
      String(input.description || '').trim().slice(0, 240) ||
      `Servidor MCP (${transport.toUpperCase()}) aguardando aprovação e descoberta de ferramentas.`;
    const id = `mcp_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    const now = nowIso();

    this.db
      .prepare(
        `INSERT INTO mcp_servers
          (id, name, transport, endpoint, description, is_approved, is_builtin, status, tools_json, last_checked_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, 'standby', '[]', NULL, ?, ?)`
      )
      .run(id, name, transport, endpoint, description, now, now);

    this.appendAuditLog({
      action: 'brain.mcp.registered',
      actor: 'admin',
      resource: id,
      detail: `${name} (${transport}) -> ${endpoint}`,
    });

    const row = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as Record<string, any>;
    return this.rowToMcpServer(row);
  }

  public toggleMcpServerApproval(id: string, isApproved: boolean): McpServerModel {
    const existing = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as Record<string, any> | undefined;
    if (!existing) throw new Error('Servidor MCP não encontrado.');
    const now = nowIso();
    this.db
      .prepare('UPDATE mcp_servers SET is_approved = ?, updated_at = ? WHERE id = ?')
      .run(isApproved ? 1 : 0, now, id);
    this.appendAuditLog({
      action: isApproved ? 'brain.mcp.approved' : 'brain.mcp.revoked',
      actor: 'admin',
      resource: id,
      detail: `Servidor MCP "${existing.name}" ${isApproved ? 'aprovado' : 'bloqueado'}`,
    });
    const updated = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as Record<string, any>;
    return this.rowToMcpServer(updated);
  }

  public updateMcpServerDiscovery(
    id: string,
    status: 'online' | 'standby' | 'error',
    tools: McpToolDescriptor[]
  ): McpServerModel {
    const existing = this.db.prepare('SELECT id FROM mcp_servers WHERE id = ?').get(id) as { id: string } | undefined;
    if (!existing) throw new Error('Servidor MCP não encontrado.');
    const now = nowIso();
    this.db
      .prepare('UPDATE mcp_servers SET status = ?, tools_json = ?, last_checked_at = ?, updated_at = ? WHERE id = ?')
      .run(status, JSON.stringify(tools), now, now, id);
    const updated = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as Record<string, any>;
    return this.rowToMcpServer(updated);
  }

  public deleteMcpServer(id: string): void {
    const existing = this.db
      .prepare('SELECT id, name, is_builtin FROM mcp_servers WHERE id = ?')
      .get(id) as { id: string; name: string; is_builtin: number } | undefined;
    if (!existing) throw new Error('Servidor MCP não encontrado.');
    if (existing.is_builtin === 1) {
      throw new Error('Servidores MCP nativos do sistema não podem ser removidos.');
    }
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
    this.appendAuditLog({
      action: 'brain.mcp.deleted',
      actor: 'admin',
      resource: id,
      detail: `Servidor MCP "${existing.name}" removido`,
    });
  }

  public recordMcpToolLog(entry: Omit<McpToolLogModel, 'id' | 'created_at'>): McpToolLogModel {
    const id = `mcplog_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    const created_at = nowIso();
    this.db
      .prepare(
        `INSERT INTO mcp_tool_logs
          (id, server_id, server_name, tool_name, arguments_json, status, output_summary, duration_ms, actor, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        entry.server_id,
        entry.server_name,
        entry.tool_name,
        entry.arguments_json,
        entry.status,
        entry.output_summary.slice(0, 600),
        Math.max(0, Number(entry.duration_ms || 0)),
        entry.actor || 'admin',
        created_at
      );
    return { id, ...entry, created_at };
  }

  public listMcpToolLogs(limit = 25): McpToolLogModel[] {
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
    return this.db
      .prepare('SELECT * FROM mcp_tool_logs ORDER BY created_at DESC LIMIT ?')
      .all(safeLimit) as unknown as McpToolLogModel[];
  }

  // ==================== COFRE CRIPTOGRAFADO DE CHAVES DE PROVEDORES (SESSÃO) ====================
  public listProviderVaultKeys(ownerUserId: string) {
    return this.vaultRepo.listProviderVaultKeys(ownerUserId);
  }

  public upsertProviderVaultKey(input: Parameters<VaultRepository['upsertProviderVaultKey']>[0]) {
    return this.vaultRepo.upsertProviderVaultKey(input);
  }

  public getEncryptedProviderVaultRecord(ownerUserId: string, keyIdOrProvider: string) {
    return this.vaultRepo.getEncryptedProviderVaultRecord(ownerUserId, keyIdOrProvider);
  }

  public listAllEncryptedProviderVaultRecords(ownerUserId: string) {
    return this.vaultRepo.listAllEncryptedProviderVaultRecords(ownerUserId);
  }

  public getDefaultEncryptedProviderVaultRecord(ownerUserId: string) {
    return this.vaultRepo.getDefaultEncryptedProviderVaultRecord(ownerUserId);
  }

  public recordProviderVaultTestResult(
    ownerUserId: string,
    keyId: string,
    status: 'ok' | 'error',
    message: string,
    latencyMs?: number | null,
    statusCode?: number | null
  ): void {
    this.vaultRepo.recordProviderVaultTestResult(ownerUserId, keyId, status, message, latencyMs, statusCode);
  }

  public setDefaultProviderVaultKey(ownerUserId: string, keyIdOrProvider: string): boolean {
    return this.vaultRepo.setDefaultProviderVaultKey(ownerUserId, keyIdOrProvider);
  }

  public clearDefaultProviderVaultKey(ownerUserId: string): void {
    this.vaultRepo.clearDefaultProviderVaultKey(ownerUserId);
  }

  public deleteProviderVaultKey(ownerUserId: string, keyIdOrProvider: string): boolean {
    return this.vaultRepo.deleteProviderVaultKey(ownerUserId, keyIdOrProvider);
  }

  // ==================== PACOTES MODULARES (MODULE PACK ENGINE) ====================

  public listInstalledPacks(ownerUserId: string) {
    return this.packsRepo.listInstalledPacks(ownerUserId);
  }

  public installPackRecord(ownerUserId: string, packId: string, version = '1.0.0') {
    return this.packsRepo.installPackRecord(ownerUserId, packId, version);
  }

  public uninstallPackRecord(ownerUserId: string, packId: string): boolean {
    return this.packsRepo.uninstallPackRecord(ownerUserId, packId);
  }

  public listCustomPacks(): ModulePackDefinition[] {
    return this.packsRepo.listCustomPacks();
  }

  public upsertCustomPack(createdBy: string, input: CustomPackDraftInput): ModulePackDefinition {
    return this.packsRepo.upsertCustomPack(createdBy, input);
  }

  public deleteCustomPack(actor: string, packId: string): boolean {
    return this.packsRepo.deleteCustomPack(actor, packId);
  }

  public upsertKnowledgeDocumentRecord(input: {
    name: string;
    category: string;
    content: string;
    fileType?: string;
  }): void {
    this.packsRepo.upsertKnowledgeDocumentRecord(input);
  }

  // ==================== NÚCLEOS INDIVIDUAIS DE AGENTES (AGENT CORE SCHEMA) ====================

  public listAgentCores(ownerUserId: string): AgentCoreConfig[] {
    return this.agentsRepo.listAgentCores(ownerUserId);
  }

  public getAgentCore(ownerUserId: string, agentRole: string, seedMeta?: AgentCoreSeedMeta): AgentCoreConfig {
    return this.agentsRepo.getAgentCore(ownerUserId, agentRole, seedMeta);
  }

  public upsertAgentCore(
    ownerUserId: string,
    agentRole: string,
    patch: AgentCorePatch,
    seedMeta?: AgentCoreSeedMeta
  ): AgentCoreConfig {
    return this.agentsRepo.upsertAgentCore(ownerUserId, agentRole, patch, seedMeta);
  }

  public deleteAgentCore(ownerUserId: string, agentRole: string): boolean {
    return this.agentsRepo.deleteAgentCore(ownerUserId, agentRole);
  }

  // ==================== PERSISTÊNCIA OPERACIONAL UNIFICADA (SQLITE WAL) ====================

  public saveStateNamespace(namespace: string, payload: unknown): void {
    const cleanNs = String(namespace || '').trim().slice(0, 80);
    if (!cleanNs || this.closed) return;
    this.db
      .prepare(
        `INSERT INTO app_state_snapshots (namespace, payload_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(namespace) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`
      )
      .run(cleanNs, JSON.stringify(payload), nowIso());
  }

  public loadStateNamespace<T>(namespace: string): T | null {
    const cleanNs = String(namespace || '').trim().slice(0, 80);
    if (!cleanNs || this.closed) return null;
    const row = this.db
      .prepare('SELECT payload_json FROM app_state_snapshots WHERE namespace = ?')
      .get(cleanNs) as { payload_json?: string } | undefined;
    if (!row?.payload_json) return null;
    return safeJsonParse<T | null>(row.payload_json, null);
  }

  public upsertTaskRecord(task: Record<string, unknown>): void {
    this.chatRepo.upsertTaskRecord(task);
  }

  public listTaskRecords(limit = 200): Record<string, unknown>[] {
    return this.chatRepo.listTaskRecords(limit);
  }

  public deleteTaskRecord(taskId: string): boolean {
    return this.chatRepo.deleteTaskRecord(taskId);
  }

  public purgeOldTaskRecords(daysRetention: number): number {
    return this.chatRepo.purgeOldTaskRecords(daysRetention);
  }

  public upsertChatSessionRecord(session: {
    id: string;
    user_id?: string;
    title: string;
    mode?: string;
    created_at?: string;
    updated_at?: string;
  }): void {
    this.chatRepo.upsertChatSessionRecord(session);
  }

  public appendChatMessageRecord(msg: {
    id: string;
    session_id: string;
    role: string;
    content: string;
    agent_role?: string | null;
    created_at?: string;
  }): void {
    this.chatRepo.appendChatMessageRecord(msg);
  }

  public listChatSessionsRelational(limit = 100) {
    return this.chatRepo.listChatSessionsRelational(limit);
  }

  public getChatSessionMessagesRelational(sessionId: string, limit = 250) {
    return this.chatRepo.getChatSessionMessagesRelational(sessionId, limit);
  }

  public deleteChatSessionRecord(sessionId: string): boolean {
    return this.chatRepo.deleteChatSessionRecord(sessionId);
  }

  public migrateLegacyChatSessionsSnapshotIfNeeded(): number {
    return this.chatRepo.migrateLegacyChatSessionsSnapshotIfNeeded((ns) => this.loadStateNamespace(ns));
  }

  public appendCodingMessage(input: Parameters<ChatRepository['appendCodingMessage']>[0]) {
    return this.chatRepo.appendCodingMessage(input);
  }

  public listCodingMessages(sessionId: string) {
    return this.chatRepo.listCodingMessages(sessionId);
  }

  public clearCodingMessages(sessionId: string): number {
    return this.chatRepo.clearCodingMessages(sessionId);
  }

  public appendAgentHistoryMessage(
    agentRole: string,
    sessionId: string,
    role: 'user' | 'assistant' | 'tool',
    content: string
  ) {
    return this.chatRepo.appendAgentHistoryMessage(agentRole, sessionId, role, content);
  }

  public listAgentHistoryMessages(agentRole: string, sessionId = 'default') {
    return this.chatRepo.listAgentHistoryMessages(agentRole, sessionId);
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const ws of this.workspaceStores.values()) {
      ws.close();
    }
    this.workspaceStores.clear();
    this.db.close();
  }

  // ==================== AUTH USERS & SESSIONS (SQLite persistente) ====================

  public upsertAuthUser(user: AuthUserRow): void {
    this.authRepo.upsertAuthUser(user);
  }

  public getAuthUser(username: string): AuthUserRow | null {
    return this.authRepo.getAuthUser(username);
  }

  public listAuthUsers(): AuthUserRow[] {
    return this.authRepo.listAuthUsers();
  }

  public deleteAuthUser(username: string): void {
    this.authRepo.deleteAuthUser(username);
  }

  public upsertAuthSession(session: AuthSessionRow): void {
    this.authRepo.upsertAuthSession(session);
  }

  public getAuthSession(sessionId: string): AuthSessionRow | null {
    return this.authRepo.getAuthSession(sessionId);
  }

  public deleteAuthSession(sessionId: string): void {
    this.authRepo.deleteAuthSession(sessionId);
  }

  public deleteAuthSessionsByUser(username: string, exceptSessionId?: string): void {
    this.authRepo.deleteAuthSessionsByUser(username, exceptSessionId);
  }

  public listActiveAuthSessions(): AuthSessionRow[] {
    return this.authRepo.listActiveAuthSessions();
  }

  public purgeExpiredAuthSessions(): number {
    return this.authRepo.purgeExpiredAuthSessions();
  }

  // ==================== EXECUÇÃO DURÁVEL DE AGENTES (CHECKPOINTS & RETOMADA) ====================

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
      agent_name: String(input.agent_name || 'JARVIS').slice(0, 80),
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

  /** No boot do servidor, marca execuções em andamento como interrompidas para retomada explícita pelo usuário. */
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

  // ==================== SANDBOX SESSIONS, AGENDADOR PERSISTENTE & CANAIS 24/7 ====================

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
    return rows.map((r) => ({
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
    }));
  }

  public findChannelBinding(provider: ChannelProvider, externalChatId: string): ChannelBindingModel | null {
    const r = this.db
      .prepare('SELECT * FROM channel_bindings WHERE provider = ? AND external_chat_id = ? AND enabled = 1 LIMIT 1')
      .get(provider, externalChatId) as Record<string, unknown> | undefined;
    if (!r) return null;
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

  /**
   * Migra usuários do namespace 'users' em app_state_snapshots para auth_users.
   * Roda uma única vez na inicialização se auth_users estiver vazio.
   */
  public migrateUsersSnapshotIfNeeded(snapshotUsers: Array<[string, {
    username: string; display_name: string; role: 'admin' | 'developer' | 'auditor';
    is_active: boolean; must_change_password: boolean; salt: string; password_hash: string; created_at: string;
  }]>): number {
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

export function createLocalSqliteBrainStore(options?: LocalSqliteStoreOptions): LocalSqliteBrainStore {
  return new LocalSqliteBrainStore(options);
}
