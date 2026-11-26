/**
 * Repositório SQLite para pacotes modulares (`installed_packs`, `custom_packs`) e documentos de conhecimento.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_PREINSTALLED_PACK_IDS,
  getModulePackById,
  normalizePackSlug,
  sanitizeCustomPackInput,
  type CustomPackDraftInput,
  type ModulePackDefinition,
} from '../../../src/services/modulePackEngine.ts';
import { nowIso, safeJsonParse } from './repoUtils.ts';
import type { AuditLogAppender } from './vaultRepo.ts';

export class PacksRepository {
  private readonly db: DatabaseSync;
  private readonly appendAuditLog: AuditLogAppender;

  constructor(db: DatabaseSync, appendAuditLog: AuditLogAppender) {
    this.db = db;
    this.appendAuditLog = appendAuditLog;
  }

  private ensureDefaultPacksSeeded(ownerUserId: string): void {
    const existingCount = (
      this.db
        .prepare('SELECT COUNT(*) AS total FROM installed_packs WHERE owner_user_id = ?')
        .get(ownerUserId) as { total: number }
    ).total;

    if (existingCount > 0) return;

    const now = nowIso();
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO installed_packs (owner_user_id, pack_id, version, is_installed, installed_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`
    );

    for (const packId of DEFAULT_PREINSTALLED_PACK_IDS) {
      const def = getModulePackById(packId);
      stmt.run(ownerUserId, packId, def?.version || '1.0.0', now, now);
    }
  }

  public listInstalledPacks(ownerUserId: string): Array<{
    pack_id: string;
    version: string;
    installed_at: string;
  }> {
    this.ensureDefaultPacksSeeded(ownerUserId);
    const rows = this.db
      .prepare(
        `SELECT pack_id, version, installed_at
         FROM installed_packs
         WHERE owner_user_id = ? AND is_installed = 1
         ORDER BY installed_at ASC`
      )
      .all(ownerUserId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      pack_id: String(row.pack_id),
      version: String(row.version || '1.0.0'),
      installed_at: String(row.installed_at),
    }));
  }

  public installPackRecord(
    ownerUserId: string,
    packId: string,
    version = '1.0.0'
  ): { pack_id: string; version: string; installed_at: string } {
    this.ensureDefaultPacksSeeded(ownerUserId);
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO installed_packs (owner_user_id, pack_id, version, is_installed, installed_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(owner_user_id, pack_id) DO UPDATE SET
           version = excluded.version,
           is_installed = 1,
           installed_at = excluded.installed_at,
           updated_at = excluded.updated_at`
      )
      .run(ownerUserId, packId, version, now, now);

    this.appendAuditLog({
      action: 'module_pack.installed',
      actor: ownerUserId,
      resource: packId,
      detail: `Pacote modular ${packId} v${version} instalado.`,
    });

    return { pack_id: packId, version, installed_at: now };
  }

  public uninstallPackRecord(ownerUserId: string, packId: string): boolean {
    this.ensureDefaultPacksSeeded(ownerUserId);
    const now = nowIso();
    const existing = this.db
      .prepare('SELECT pack_id FROM installed_packs WHERE owner_user_id = ? AND pack_id = ?')
      .get(ownerUserId, packId);

    if (existing) {
      this.db
        .prepare(
          `UPDATE installed_packs
           SET is_installed = 0, updated_at = ?
           WHERE owner_user_id = ? AND pack_id = ?`
        )
        .run(now, ownerUserId, packId);
    } else {
      this.db
        .prepare(
          `INSERT INTO installed_packs (owner_user_id, pack_id, version, is_installed, installed_at, updated_at)
           VALUES (?, ?, '1.0.0', 0, ?, ?)`
        )
        .run(ownerUserId, packId, now, now);
    }

    this.appendAuditLog({
      action: 'module_pack.uninstalled',
      actor: ownerUserId,
      resource: packId,
      detail: `Pacote modular ${packId} removido da navegação ativa.`,
    });
    return true;
  }

  public listCustomPacks(): ModulePackDefinition[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, tagline, description, category, version, definition_json, created_by, updated_at
         FROM custom_packs
         ORDER BY updated_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    const result: ModulePackDefinition[] = [];
    for (const row of rows) {
      const parsed = safeJsonParse<Partial<ModulePackDefinition> | null>(
        typeof row.definition_json === 'string' ? row.definition_json : null,
        null
      );
      if (!parsed) continue;
      const tabs = Array.isArray(parsed.tabs) ? parsed.tabs : [];
      result.push({
        id: String(row.id),
        name: String(row.name || parsed.name || row.id),
        tagline: String(row.tagline || parsed.tagline || ''),
        description: String(row.description || parsed.description || ''),
        category: String(row.category || parsed.category || 'engineering') as ModulePackDefinition['category'],
        category_label: String(parsed.category_label || 'Engenharia & Arquitetura'),
        version: String(row.version || parsed.version || '1.0.0'),
        tabs,
        tab_labels: parsed.tab_labels && typeof parsed.tab_labels === 'object' ? parsed.tab_labels : {},
        agents: Array.isArray(parsed.agents) ? parsed.agents : [],
        skills: Array.isArray(parsed.skills) ? parsed.skills : [],
        mcp_presets: Array.isArray(parsed.mcp_presets) ? parsed.mcp_presets : [],
        workflows: Array.isArray(parsed.workflows) ? parsed.workflows : [],
        study_tracks: Array.isArray(parsed.study_tracks) ? parsed.study_tracks : [],
        is_custom: true,
        created_by: String(row.created_by || 'admin'),
      });
    }
    return result;
  }

  public upsertCustomPack(createdBy: string, input: CustomPackDraftInput): ModulePackDefinition {
    const normalized = sanitizeCustomPackInput(input, createdBy);
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO custom_packs (
          id, name, tagline, description, category, version, accent_color,
          definition_json, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          tagline = excluded.tagline,
          description = excluded.description,
          category = excluded.category,
          version = excluded.version,
          definition_json = excluded.definition_json,
          updated_at = excluded.updated_at`
      )
      .run(
        normalized.id,
        normalized.name,
        normalized.tagline,
        normalized.description,
        normalized.category,
        normalized.version,
        '#f97316',
        JSON.stringify(normalized),
        createdBy,
        now,
        now
      );

    this.appendAuditLog({
      action: 'custom_pack.saved',
      actor: createdBy,
      resource: normalized.id,
      detail: `Pacote personalizado "${normalized.name}" v${normalized.version} salvo com ${normalized.tabs.length} módulo(s) e ${normalized.agents.length} agente(s).`,
    });

    return normalized;
  }

  public deleteCustomPack(actor: string, packId: string): boolean {
    const cleanId = normalizePackSlug(packId);
    const existing = this.db.prepare('SELECT id FROM custom_packs WHERE id = ?').get(cleanId);
    if (!existing) return false;

    this.db.prepare('DELETE FROM custom_packs WHERE id = ?').run(cleanId);
    this.db.prepare('DELETE FROM installed_packs WHERE pack_id = ?').run(cleanId);

    this.appendAuditLog({
      action: 'custom_pack.deleted',
      actor,
      resource: cleanId,
      detail: `Pacote personalizado ${cleanId} removido do Estúdio de Pacotes.`,
    });
    return true;
  }

  public upsertKnowledgeDocumentRecord(input: {
    name: string;
    category: string;
    content: string;
    fileType?: string;
  }): void {
    const cleanName = String(input.name || '').trim().slice(0, 180);
    if (!cleanName) return;
    const content = String(input.content || '');
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO knowledge_documents (name, category, file_type, content, chunks, size_bytes, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           category = excluded.category,
           content = excluded.content,
           chunks = excluded.chunks,
           size_bytes = excluded.size_bytes,
           indexed_at = excluded.indexed_at`
      )
      .run(
        cleanName,
        String(input.category || 'estudos').slice(0, 64),
        String(input.fileType || 'md').slice(0, 16),
        content,
        Math.max(1, Math.ceil(content.length / 650)),
        Buffer.byteLength(content, 'utf8'),
        now
      );
  }
}
