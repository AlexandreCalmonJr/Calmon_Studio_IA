/**
 * Repositório SQLite para o cofre criptografado de chaves de provedores (`provider_vault_keys`).
 */
import type { DatabaseSync } from 'node:sqlite';
import { nowIso, safeJsonParse } from './repoUtils.ts';

function sanitizeModelList(list: unknown, maxItems = 250): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of list) {
    const clean = String(item || '').trim().slice(0, 160);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
    if (result.length >= maxItems) break;
  }
  return result;
}

export type AuditLogAppender = (entry: {
  action: string;
  actor?: string;
  resource: string;
  detail?: string;
}) => void;

export class VaultRepository {
  private readonly db: DatabaseSync;
  private readonly appendAuditLog: AuditLogAppender;

  constructor(db: DatabaseSync, appendAuditLog: AuditLogAppender) {
    this.db = db;
    this.appendAuditLog = appendAuditLog;
  }

  public listProviderVaultKeys(ownerUserId: string) {
    const rows = this.db
      .prepare(
        `SELECT id, owner_user_id, provider, label, masked_key, base_url, default_model,
                detected_models_json, enabled_models_json,
                is_active, is_default, last_tested_at, last_test_status, last_test_message,
                last_latency_ms, last_status_code, created_at, updated_at
         FROM provider_vault_keys
         WHERE owner_user_id = ?
         ORDER BY is_default DESC, updated_at DESC`
      )
      .all(ownerUserId) as Array<Record<string, any>>;

    return rows.map((r) => ({
      key_id: String(r.id),
      owner_user_id: String(r.owner_user_id),
      provider: String(r.provider),
      label: String(r.label),
      masked_key: String(r.masked_key),
      base_url: String(r.base_url || ''),
      default_model: String(r.default_model || ''),
      detected_models: sanitizeModelList(safeJsonParse<string[]>(r.detected_models_json, [])),
      enabled_models: sanitizeModelList(safeJsonParse<string[]>(r.enabled_models_json, [])),
      is_active: Boolean(r.is_active),
      is_default: Boolean(r.is_default),
      last_tested_at: r.last_tested_at ? String(r.last_tested_at) : null,
      last_test_status: r.last_test_status ? String(r.last_test_status) : null,
      last_test_message: r.last_test_message ? String(r.last_test_message) : null,
      last_latency_ms:
        typeof r.last_latency_ms === 'number' && Number.isFinite(r.last_latency_ms)
          ? Math.round(r.last_latency_ms)
          : null,
      last_status_code:
        typeof r.last_status_code === 'number' && Number.isFinite(r.last_status_code)
          ? Math.round(r.last_status_code)
          : null,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    }));
  }

  public upsertProviderVaultKey(input: {
    key_id: string;
    owner_user_id: string;
    provider: string;
    label: string;
    encrypted_api_key?: string;
    masked_key?: string;
    base_url: string;
    default_model: string;
    detected_models?: string[];
    enabled_models?: string[];
    is_active: boolean;
    is_default: boolean;
  }) {
    const now = nowIso();
    const existing = this.db
      .prepare('SELECT * FROM provider_vault_keys WHERE id = ? AND owner_user_id = ?')
      .get(input.key_id, input.owner_user_id) as Record<string, any> | undefined;

    const encrypted = input.encrypted_api_key || (existing ? String(existing.encrypted_api_key) : '');
    const masked = input.masked_key || (existing ? String(existing.masked_key) : '');
    if (!encrypted || !masked) {
      throw new Error('Informe a chave de API para salvar este provedor no cofre da sessão.');
    }

    const detectedModelsJson = JSON.stringify(
      input.detected_models !== undefined
        ? sanitizeModelList(input.detected_models)
        : safeJsonParse<string[]>(existing?.detected_models_json, [])
    );
    const enabledModelsJson = JSON.stringify(
      input.enabled_models !== undefined
        ? sanitizeModelList(input.enabled_models)
        : safeJsonParse<string[]>(existing?.enabled_models_json, [])
    );

    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (input.is_default) {
        this.db
          .prepare('UPDATE provider_vault_keys SET is_default = 0 WHERE owner_user_id = ?')
          .run(input.owner_user_id);
      }

      if (existing) {
        this.db
          .prepare(
            `UPDATE provider_vault_keys
             SET provider = ?, label = ?, encrypted_api_key = ?, masked_key = ?,
                 base_url = ?, default_model = ?, detected_models_json = ?, enabled_models_json = ?,
                 is_active = ?, is_default = ?, updated_at = ?
             WHERE id = ? AND owner_user_id = ?`
          )
          .run(
            input.provider,
            input.label,
            encrypted,
            masked,
            input.base_url,
            input.default_model,
            detectedModelsJson,
            enabledModelsJson,
            input.is_active ? 1 : 0,
            input.is_default ? 1 : 0,
            now,
            input.key_id,
            input.owner_user_id
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO provider_vault_keys
              (id, owner_user_id, provider, label, encrypted_api_key, masked_key, base_url, default_model,
               detected_models_json, enabled_models_json,
               is_active, is_default, last_tested_at, last_test_status, last_test_message, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`
          )
          .run(
            input.key_id,
            input.owner_user_id,
            input.provider,
            input.label,
            encrypted,
            masked,
            input.base_url,
            input.default_model,
            detectedModelsJson,
            enabledModelsJson,
            input.is_active ? 1 : 0,
            input.is_default ? 1 : 0,
            now,
            now
          );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.appendAuditLog({
      action: 'vault.provider_key.saved',
      actor: input.owner_user_id,
      resource: `${input.provider}:${input.key_id}`,
      detail: `Credencial ${input.provider} (${masked}) salva criptografada na sessão protegida.`,
    });

    return this.listProviderVaultKeys(input.owner_user_id).find((k) => k.key_id === input.key_id)!;
  }

  public getEncryptedProviderVaultRecord(ownerUserId: string, keyIdOrProvider: string) {
    const row = this.db
      .prepare(
        `SELECT * FROM provider_vault_keys
         WHERE owner_user_id = ? AND (id = ? OR provider = ?)
         ORDER BY is_default DESC, updated_at DESC
         LIMIT 1`
      )
      .get(ownerUserId, keyIdOrProvider, keyIdOrProvider) as Record<string, any> | undefined;

    if (!row) return null;
    return {
      key_id: String(row.id),
      owner_user_id: String(row.owner_user_id),
      provider: String(row.provider),
      label: String(row.label),
      encrypted_api_key: String(row.encrypted_api_key),
      masked_key: String(row.masked_key),
      base_url: String(row.base_url || ''),
      default_model: String(row.default_model || ''),
      enabled_models: sanitizeModelList(safeJsonParse<string[]>(row.enabled_models_json, [])),
      is_active: Boolean(row.is_active),
      is_default: Boolean(row.is_default),
    };
  }

  public listAllEncryptedProviderVaultRecords(ownerUserId: string) {
    const rows = this.db
      .prepare(
        `SELECT * FROM provider_vault_keys
         WHERE owner_user_id = ? AND is_active = 1
         ORDER BY is_default DESC, updated_at DESC`
      )
      .all(ownerUserId) as Array<Record<string, any>>;

    return rows.map((row) => ({
      key_id: String(row.id),
      owner_user_id: String(row.owner_user_id),
      provider: String(row.provider),
      label: String(row.label),
      encrypted_api_key: String(row.encrypted_api_key),
      masked_key: String(row.masked_key),
      base_url: String(row.base_url || ''),
      default_model: String(row.default_model || ''),
      enabled_models: sanitizeModelList(safeJsonParse<string[]>(row.enabled_models_json, [])),
      is_active: Boolean(row.is_active),
      is_default: Boolean(row.is_default),
    }));
  }

  public getDefaultEncryptedProviderVaultRecord(ownerUserId: string) {
    const row = this.db
      .prepare(
        `SELECT * FROM provider_vault_keys
         WHERE owner_user_id = ? AND is_active = 1 AND is_default = 1
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(ownerUserId) as Record<string, any> | undefined;

    if (!row) return null;
    return {
      key_id: String(row.id),
      owner_user_id: String(row.owner_user_id),
      provider: String(row.provider),
      label: String(row.label),
      encrypted_api_key: String(row.encrypted_api_key),
      masked_key: String(row.masked_key),
      base_url: String(row.base_url || ''),
      default_model: String(row.default_model || ''),
      enabled_models: sanitizeModelList(safeJsonParse<string[]>(row.enabled_models_json, [])),
      is_active: Boolean(row.is_active),
      is_default: Boolean(row.is_default),
    };
  }

  public recordProviderVaultTestResult(
    ownerUserId: string,
    keyId: string,
    status: 'ok' | 'error',
    message: string,
    latencyMs?: number | null,
    statusCode?: number | null,
    detectedModels?: string[]
  ): void {
    const cleanLatency =
      typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0
        ? Math.round(latencyMs)
        : null;
    const cleanStatusCode =
      typeof statusCode === 'number' && Number.isFinite(statusCode) && statusCode > 0
        ? Math.round(statusCode)
        : null;
    const now = nowIso();
    if (Array.isArray(detectedModels) && detectedModels.length > 0) {
      this.db
        .prepare(
          `UPDATE provider_vault_keys
           SET last_tested_at = ?, last_test_status = ?, last_test_message = ?,
               last_latency_ms = ?, last_status_code = ?, detected_models_json = ?, updated_at = ?
           WHERE id = ? AND owner_user_id = ?`
        )
        .run(
          now,
          status,
          message.slice(0, 280),
          cleanLatency,
          cleanStatusCode,
          JSON.stringify(sanitizeModelList(detectedModels)),
          now,
          keyId,
          ownerUserId
        );
      return;
    }
    this.db
      .prepare(
        `UPDATE provider_vault_keys
         SET last_tested_at = ?, last_test_status = ?, last_test_message = ?,
             last_latency_ms = ?, last_status_code = ?, updated_at = ?
         WHERE id = ? AND owner_user_id = ?`
      )
      .run(now, status, message.slice(0, 280), cleanLatency, cleanStatusCode, now, keyId, ownerUserId);
  }

  public setDefaultProviderVaultKey(ownerUserId: string, keyIdOrProvider: string): boolean {
    const target = this.getEncryptedProviderVaultRecord(ownerUserId, keyIdOrProvider);
    if (!target) return false;
    const now = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE provider_vault_keys SET is_default = 0 WHERE owner_user_id = ?').run(ownerUserId);
      this.db
        .prepare(
          'UPDATE provider_vault_keys SET is_default = 1, is_active = 1, updated_at = ? WHERE id = ? AND owner_user_id = ?'
        )
        .run(now, target.key_id, ownerUserId);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    this.appendAuditLog({
      action: 'vault.provider_key.default_set',
      actor: ownerUserId,
      resource: `${target.provider}:${target.key_id}`,
      detail: `Provedor ${target.provider} definido como padrão de inferência na sessão.`,
    });
    return true;
  }

  public clearDefaultProviderVaultKey(ownerUserId: string): void {
    this.db
      .prepare('UPDATE provider_vault_keys SET is_default = 0, updated_at = ? WHERE owner_user_id = ?')
      .run(nowIso(), ownerUserId);
  }

  public deleteProviderVaultKey(ownerUserId: string, keyIdOrProvider: string): boolean {
    const target = this.getEncryptedProviderVaultRecord(ownerUserId, keyIdOrProvider);
    if (!target) return false;
    this.db
      .prepare('DELETE FROM provider_vault_keys WHERE id = ? AND owner_user_id = ?')
      .run(target.key_id, ownerUserId);
    this.appendAuditLog({
      action: 'vault.provider_key.deleted',
      actor: ownerUserId,
      resource: `${target.provider}:${target.key_id}`,
      detail: `Credencial ${target.provider} (${target.masked_key}) removida do cofre da sessão.`,
    });
    return true;
  }
}
