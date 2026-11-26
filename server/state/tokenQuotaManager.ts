/**
 * Controlador de cota de tokens e balanceamento entre múltiplas chaves de API.
 * Evita consumo excessivo em uma única chave e alterna automaticamente quando
 * várias chaves possuem o mesmo modelo habilitado ou sofrem rate-limit (HTTP 429).
 */

export interface KeyTokenUsageSnapshot {
  keyId: string;
  tokensToday: number;
  dailyLimit: number;
  requestsToday: number;
  rateLimitedUntil: number;
  lastUsedAt: number;
}

interface KeyUsageBucket {
  dayKey: string;
  tokensToday: number;
  requestsToday: number;
  dailyLimit: number;
  rateLimitedUntil: number;
  lastUsedAt: number;
}

const DEFAULT_DAILY_TOKEN_LIMIT = Number(process.env.KEYVAULT_DAILY_TOKEN_LIMIT || 500_000);
const usageBuckets = new Map<string, KeyUsageBucket>();
let persistCallback: ((snapshot: Record<string, KeyUsageBucket>) => void) | null = null;

export function bindQuotaPersistCallback(
  cb: ((snapshot: Record<string, KeyUsageBucket>) => void) | null
): void {
  persistCallback = cb;
}

export function exportQuotaBucketsSnapshot(): Record<string, KeyUsageBucket> {
  const out: Record<string, KeyUsageBucket> = {};
  for (const [k, v] of usageBuckets.entries()) {
    out[k] = { ...v };
  }
  return out;
}

export function hydrateQuotaBucketsSnapshot(snapshot: Record<string, KeyUsageBucket> | null | undefined): void {
  if (!snapshot || typeof snapshot !== 'object') return;
  const today = currentDayKey();
  for (const [keyId, bucket] of Object.entries(snapshot)) {
    if (!keyId || !bucket || bucket.dayKey !== today) continue;
    usageBuckets.set(keyId, {
      dayKey: today,
      tokensToday: Math.max(0, Number(bucket.tokensToday) || 0),
      requestsToday: Math.max(0, Number(bucket.requestsToday) || 0),
      dailyLimit: Math.max(0, Number(bucket.dailyLimit ?? DEFAULT_DAILY_TOKEN_LIMIT)),
      rateLimitedUntil: Math.max(0, Number(bucket.rateLimitedUntil) || 0),
      lastUsedAt: Math.max(0, Number(bucket.lastUsedAt) || 0),
    });
  }
}

function flushPersist(): void {
  if (persistCallback) {
    try {
      persistCallback(exportQuotaBucketsSnapshot());
    } catch {
      // Não bloqueia inferência se SQLite estiver fechado em teardown
    }
  }
}

function currentDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureBucket(keyId: string): KeyUsageBucket {
  const today = currentDayKey();
  const existing = usageBuckets.get(keyId);
  if (!existing || existing.dayKey !== today) {
    const fresh: KeyUsageBucket = {
      dayKey: today,
      tokensToday: 0,
      requestsToday: 0,
      dailyLimit: existing?.dailyLimit ?? DEFAULT_DAILY_TOKEN_LIMIT,
      rateLimitedUntil: 0,
      lastUsedAt: 0,
    };
    usageBuckets.set(keyId, fresh);
    return fresh;
  }
  return existing;
}

export function setKeyDailyTokenLimit(keyId: string, dailyLimit: number): void {
  const bucket = ensureBucket(keyId);
  bucket.dailyLimit = Math.max(0, Math.round(dailyLimit));
  flushPersist();
}

export function recordKeyTokenUsage(keyId: string, estimatedTokens: number): void {
  if (!keyId) return;
  const bucket = ensureBucket(keyId);
  const safeTokens = Math.max(0, Math.round(Number(estimatedTokens) || 0));
  bucket.tokensToday += safeTokens;
  bucket.requestsToday += 1;
  bucket.lastUsedAt = Date.now();
  flushPersist();
}

export function markKeyRateLimited(keyId: string, cooldownMs = 60_000): void {
  if (!keyId) return;
  const bucket = ensureBucket(keyId);
  bucket.rateLimitedUntil = Date.now() + Math.max(5_000, cooldownMs);
  flushPersist();
}

export function isKeyAvailableForDispatch(keyId: string): boolean {
  const bucket = ensureBucket(keyId);
  const now = Date.now();
  if (bucket.rateLimitedUntil > now) return false;
  if (bucket.dailyLimit > 0 && bucket.tokensToday >= bucket.dailyLimit) return false;
  return true;
}

export function getKeyTokenUsageSnapshot(keyId: string): KeyTokenUsageSnapshot {
  const bucket = ensureBucket(keyId);
  return {
    keyId,
    tokensToday: bucket.tokensToday,
    dailyLimit: bucket.dailyLimit,
    requestsToday: bucket.requestsToday,
    rateLimitedUntil: bucket.rateLimitedUntil,
    lastUsedAt: bucket.lastUsedAt,
  };
}

/**
 * Seleciona a melhor chave candidata para um modelo quando há múltiplas chaves
 * disponíveis: prioriza chaves dentro do limite diário e fora de cooldown,
 * escolhendo a que consumiu menos tokens hoje (least-used balancing).
 */
export function selectLeastUsedKeyCandidate<T extends { key_id: string }>(
  candidates: T[]
): T | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const available = candidates.filter((c) => isKeyAvailableForDispatch(c.key_id));
  const pool = available.length > 0 ? available : candidates;

  return [...pool].sort((a, b) => {
    const ua = ensureBucket(a.key_id);
    const ub = ensureBucket(b.key_id);
    if (ua.tokensToday !== ub.tokensToday) return ua.tokensToday - ub.tokensToday;
    return ua.lastUsedAt - ub.lastUsedAt;
  })[0];
}
