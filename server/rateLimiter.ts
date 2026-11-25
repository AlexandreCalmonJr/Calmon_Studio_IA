/**
 * Rate Limiter leve em memória para o servidor backend.
 *
 * Protege rotas sensíveis sem dependências externas.
 * Usa janela deslizante simples por chave (IP + rota).
 *
 * Uso:
 *   const { allowed, remaining, retryAfterMs } = serverRateLimit('login', clientIp, 10, 60_000);
 *   if (!allowed) res.status(429).json({ detail: '...' });
 */

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

// Mapa em memória: `${route}::${key}` → bucket
const _buckets = new Map<string, RateLimitBucket>();

// Limpeza periódica de buckets expirados (a cada 5 min)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _buckets) {
    if (now > v.resetAt) _buckets.delete(k);
  }
}, 5 * 60_000).unref();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Verifica e incrementa o contador de taxa para uma rota + chave específica.
 *
 * @param route     Identificador da rota (ex: 'auth/login', 'chat', 'voice/transcribe')
 * @param clientKey IP ou user_id do cliente
 * @param limit     Número máximo de requisições permitidas na janela
 * @param windowMs  Tamanho da janela em milissegundos (padrão: 60s)
 */
export function serverRateLimit(
  route: string,
  clientKey: string,
  limit: number,
  windowMs = 60_000,
): RateLimitResult {
  const mapKey = `${route}::${clientKey}`;
  const now = Date.now();
  const bucket = _buckets.get(mapKey);

  if (!bucket || now > bucket.resetAt) {
    _buckets.set(mapKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count += 1;
  return { allowed: true, remaining: Math.max(0, limit - bucket.count), retryAfterMs: 0 };
}

/** Limites pré-configurados por rota sensível */
export const RATE_LIMITS = {
  /** Login por senha: 10 tentativas/minuto por IP */
  authLogin: { limit: 10, windowMs: 60_000 },
  /** Troca de senha: 5 tentativas/minuto por IP */
  authPassword: { limit: 5, windowMs: 60_000 },
  /** Registro de conta: 5 por hora por IP */
  authRegister: { limit: 5, windowMs: 60 * 60_000 },
  /** Chat / Inferência: 60 mensagens/minuto por usuário */
  chat: { limit: 60, windowMs: 60_000 },
  /** Transcrição de voz: 20 por minuto por usuário */
  voiceTranscribe: { limit: 20, windowMs: 60_000 },
  /** TTS: 30 por minuto por usuário */
  voiceTts: { limit: 30, windowMs: 60_000 },
} as const;

/** Helper: extrai IP do cliente de forma segura */
export function getClientIp(req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() || 'unknown';
  if (Array.isArray(forwarded)) return forwarded[0]?.trim() || 'unknown';
  return String(req.socket?.remoteAddress || 'unknown');
}
