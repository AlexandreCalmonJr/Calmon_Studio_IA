/**
 * Lógica pura de validação pré-salvamento (ping) para chaves de API de terceiros.
 * Permite verificar se a chave digitada já foi validada via ping no servidor
 * sem jamais armazenar o segredo em texto claro.
 */

export interface ProviderPingRecord {
  ok: boolean;
  statusCode: number;
  latencyMs: number;
  endpointHost: string;
  modelsDetected: string[];
  message: string;
  fingerprint: string;
  testedAt: string;
  savedAnywayOffered?: boolean;
}

/**
 * Gera uma impressão digital não-reversível (FNV-1a 32-bit + comprimento)
 * apenas para detectar se o usuário alterou a chave ou URL desde o último ping.
 */
export function buildDraftKeyFingerprint(apiKey: string, baseUrl: string): string {
  const cleanKey = String(apiKey || '').trim();
  const cleanUrl = String(baseUrl || '').trim().replace(/\/+$/, '').toLowerCase();
  const material = `${cleanKey.length}|${cleanUrl}|${cleanKey}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i += 1) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fp_${cleanKey.length}_${hash.toString(16).padStart(8, '0')}`;
}

export function isDraftPingVerified(
  ping: ProviderPingRecord | null | undefined,
  apiKey: string,
  baseUrl: string
): boolean {
  if (!ping || !ping.ok) return false;
  const cleanKey = String(apiKey || '').trim();
  if (!cleanKey) return false;
  return ping.fingerprint === buildDraftKeyFingerprint(cleanKey, baseUrl);
}

export function shouldRunPingBeforeSave(params: {
  validateBeforeSave: boolean;
  forceSkipPing?: boolean;
  apiKey: string;
  baseUrl: string;
  lastPing?: ProviderPingRecord | null;
}): boolean {
  if (!params.validateBeforeSave || params.forceSkipPing) return false;
  const cleanKey = String(params.apiKey || '').trim();
  if (!cleanKey) return false;
  return !isDraftPingVerified(params.lastPing, cleanKey, params.baseUrl);
}

export function formatPingBadgeLabel(ping: ProviderPingRecord): string {
  if (ping.ok) {
    return ping.latencyMs > 0
      ? `Ping OK · ${ping.latencyMs} ms`
      : 'Ping OK · Validada';
  }
  if (ping.statusCode > 0) {
    return `Falha · HTTP ${ping.statusCode}`;
  }
  return 'Falha de conexão';
}
