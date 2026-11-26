import type { Request, Response } from 'express';
import {
  CookieVaultEnvelope,
  EXTERNAL_PROVIDERS,
  ExternalProviderId,
  ResolvedExternalCredential,
  VAULT_COOKIE_NAME,
  buildSecureVaultCookieHeader,
  decryptProviderSecret,
  getEnvProviderCredential,
  inferExternalProviderFromModel,
  normalizeProviderId,
  parseCookieHeader,
  sealVaultCookieEnvelope,
  unsealVaultCookieEnvelope,
} from '../providerEngine.ts';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import type { UserAccount } from './types.ts';
import { selectLeastUsedKeyCandidate } from './tokenQuotaManager.ts';

export const isHttpsReq = (req: Request): boolean => {
  const fwd = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return req.secure || fwd.includes('https');
};

export const getOwnerUserId = (req: Request): string => {
  const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
  return user?.username || 'admin';
};

export const readVaultCookieEnvelope = (req: Request, ownerUserId: string): CookieVaultEnvelope | null => {
  const cookies = parseCookieHeader(req.headers.cookie);
  return unsealVaultCookieEnvelope(cookies[VAULT_COOKIE_NAME], ownerUserId);
};

export const syncVaultHttpOnlyCookie = (
  req: Request,
  res: Response,
  ownerUserId: string,
  store: LocalSqliteBrainStore
): void => {
  const dbRecords = store.listAllEncryptedProviderVaultRecords(ownerUserId);
  const entries: CookieVaultEnvelope['entries'] = {};
  for (const rec of dbRecords) {
    const prov = normalizeProviderId(rec.provider);
    if (!prov) continue;
    try {
      const plainKey = decryptProviderSecret(rec.encrypted_api_key);
      entries[prov] = {
        provider: prov,
        apiKey: plainKey,
        baseUrl: rec.base_url || EXTERNAL_PROVIDERS[prov].defaultBaseUrl,
        defaultModel: rec.default_model || EXTERNAL_PROVIDERS[prov].defaultModel,
        isDefault: rec.is_default,
        label: rec.label,
      };
    } catch {
      // Ignora registros cuja chave efêmera expirou entre reinicializações sem KEYVAULT_MASTER_KEY
    }
  }

  const hasEntries = Object.keys(entries).length > 0;
  if (!hasEntries) {
    res.append('Set-Cookie', buildSecureVaultCookieHeader('', isHttpsReq(req), 0));
    return;
  }

  const sealed = sealVaultCookieEnvelope({
    ownerUserId,
    updatedAt: new Date().toISOString(),
    entries,
  });
  res.append('Set-Cookie', buildSecureVaultCookieHeader(sealed, isHttpsReq(req)));
};

export const resolveExternalCredentialForRequest = (
  req: Request,
  store: LocalSqliteBrainStore,
  ownerUserId: string,
  requestedModel?: string,
  explicitProvider?: ExternalProviderId | null
): ResolvedExternalCredential | null => {
  const inferredProvider = explicitProvider || inferExternalProviderFromModel(requestedModel);

  const resolveFromProvider = (prov: ExternalProviderId): ResolvedExternalCredential | null => {
    if (!EXTERNAL_PROVIDERS[prov]) return null;
    const dbRec = store.getEncryptedProviderVaultRecord(ownerUserId, prov);
    if (dbRec && dbRec.is_active) {
      try {
        return {
          provider: prov,
          apiKey: decryptProviderSecret(dbRec.encrypted_api_key),
          baseUrl: dbRec.base_url || EXTERNAL_PROVIDERS[prov].defaultBaseUrl,
          model: dbRec.default_model || EXTERNAL_PROVIDERS[prov].defaultModel,
          source: 'session_vault',
          keyId: dbRec.key_id,
          label: dbRec.label,
        };
      } catch {
        // Segue para cookie HttpOnly ou env
      }
    }

    const cookieEnv = readVaultCookieEnvelope(req, ownerUserId);
    const fromCookie = cookieEnv?.entries?.[prov];
    if (fromCookie?.apiKey) {
      return {
        provider: prov,
        apiKey: fromCookie.apiKey,
        baseUrl: fromCookie.baseUrl || EXTERNAL_PROVIDERS[prov].defaultBaseUrl,
        model: fromCookie.defaultModel || EXTERNAL_PROVIDERS[prov].defaultModel,
        source: 'http_only_cookie',
        label: fromCookie.label || EXTERNAL_PROVIDERS[prov].name,
      };
    }

    return getEnvProviderCredential(prov);
  };

  if (inferredProvider) {
    const inferred = resolveFromProvider(inferredProvider);
    if (inferred) return inferred;
  }

  // Se o modelo solicitado pertence aos modelos habilitados (ou padrão) de algum provedor salvo,
  // balanceia automaticamente entre múltiplas chaves que possuem o mesmo modelo (menor consumo de tokens).
  const cleanRequested = String(requestedModel || '').trim().toLowerCase();
  if (cleanRequested) {
    const allSaved = store.listAllEncryptedProviderVaultRecords(ownerUserId);
    const matching = allSaved.filter((rec) => {
      const prov = normalizeProviderId(rec.provider);
      if (!prov) return false;
      return (
        rec.default_model.toLowerCase() === cleanRequested ||
        (Array.isArray(rec.enabled_models) &&
          rec.enabled_models.some((m) => m.toLowerCase() === cleanRequested))
      );
    });
    const chosen = selectLeastUsedKeyCandidate(matching);
    if (chosen) {
      const prov = normalizeProviderId(chosen.provider);
      if (prov) {
        try {
          return {
            provider: prov,
            apiKey: decryptProviderSecret(chosen.encrypted_api_key),
            baseUrl: chosen.base_url || EXTERNAL_PROVIDERS[prov].defaultBaseUrl,
            model: requestedModel!.trim(),
            source: 'session_vault',
            keyId: chosen.key_id,
            label: chosen.label,
          };
        } catch {
          // Segue para fallback
        }
      }
    }
  }

  const defaultDb = store.getDefaultEncryptedProviderVaultRecord(ownerUserId);
  if (defaultDb) {
    const prov = normalizeProviderId(defaultDb.provider);
    if (prov) {
      try {
        return {
          provider: prov,
          apiKey: decryptProviderSecret(defaultDb.encrypted_api_key),
          baseUrl: defaultDb.base_url || EXTERNAL_PROVIDERS[prov].defaultBaseUrl,
          model: defaultDb.default_model || EXTERNAL_PROVIDERS[prov].defaultModel,
          source: 'session_vault',
          keyId: defaultDb.key_id,
          label: defaultDb.label,
        };
      } catch {
        // Segue para cookie HttpOnly
      }
    }
  }

  const cookieEnv = readVaultCookieEnvelope(req, ownerUserId);
  if (cookieEnv?.entries) {
    for (const entry of Object.values(cookieEnv.entries)) {
      if (entry && entry.isDefault && entry.apiKey) {
        return {
          provider: entry.provider,
          apiKey: entry.apiKey,
          baseUrl: entry.baseUrl || EXTERNAL_PROVIDERS[entry.provider].defaultBaseUrl,
          model: entry.defaultModel || EXTERNAL_PROVIDERS[entry.provider].defaultModel,
          source: 'http_only_cookie',
          label: entry.label || EXTERNAL_PROVIDERS[entry.provider].name,
        };
      }
    }
  }

  return null;
};
