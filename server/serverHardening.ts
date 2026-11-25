import type http from 'node:http';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';

export const SESSION_COOKIE = 'jarvis_session';
export const DEFAULT_BOOTSTRAP_ADMIN_EMAIL = 'alexandrecalmonjunior@gmail.com';

export interface BaseSessionRecord {
  session_id: string;
  username: string;
  role: 'admin' | 'developer' | 'auditor';
  kind: 'human' | 'service';
  created_at: number;
}

export interface BaseUserAccount {
  username: string;
  is_active: boolean;
  role?: string;
  [key: string]: unknown;
}

export function parseCookies(header?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    const rawVal = part.slice(idx + 1).trim();
    let val = rawVal;
    try {
      val = decodeURIComponent(rawVal);
    } catch {
      val = rawVal;
    }
    // Strip optional enclosing RFC 6265 quotes (e.g. "value")
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function resolveBootstrapAdminEmail(configuredEmail?: string): string {
  const email = (configuredEmail || process.env.BOOTSTRAP_ADMIN_EMAIL || DEFAULT_BOOTSTRAP_ADMIN_EMAIL).trim().toLowerCase();
  return email;
}

export function isBootstrapAdminUser(
  emailVerified?: boolean,
  email?: string,
  configuredEmail?: string
): boolean {
  if (!emailVerified || !email) return false;
  const targetEmail = resolveBootstrapAdminEmail(configuredEmail);
  return email.trim().toLowerCase() === targetEmail;
}

export function getSessionFromUpgradeRequest<S extends BaseSessionRecord, U extends BaseUserAccount>(
  request: Pick<http.IncomingMessage, 'headers' | 'url'> | undefined | null,
  sessionMap: Map<string, S> | undefined | null,
  userMap?: Map<string, U> | null
): S | null {
  if (!request || !sessionMap) return null;
  const headers = request.headers || {};
  const cookies = parseCookies(headers.cookie);
  const headerToken = String(headers['x-jarvis-session'] || '').trim();
  const authHeader = String(headers['authorization'] || '').trim();
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';

  let queryToken = '';
  try {
    const parsedUrl = new URL(request.url || '', 'http://127.0.0.1');
    queryToken = parsedUrl.searchParams.get('session_token') || parsedUrl.searchParams.get('token') || '';
  } catch {
    // ignore malformed query URL
  }

  const sid = cookies[SESSION_COOKIE] || headerToken || bearerToken || queryToken;
  if (!sid) return null;

  const session = sessionMap.get(sid);
  if (!session) return null;

  if (userMap) {
    const user = userMap.get(session.username);
    if (!user || !user.is_active) return null;
  }

  return session;
}

export interface UpgradeCheckResult<S extends BaseSessionRecord> {
  authorized: boolean;
  session: S | null;
  statusCode?: number;
  statusText?: string;
}

export function verifyWebSocketUpgrade<S extends BaseSessionRecord, U extends BaseUserAccount>(
  request: Pick<http.IncomingMessage, 'headers' | 'url'> | undefined | null,
  options: {
    isProduction?: boolean;
    sessionMap: Map<string, S>;
    userMap?: Map<string, U>;
  }
): UpgradeCheckResult<S> {
  try {
    const isProduction = options?.isProduction ?? (process.env.NODE_ENV === 'production');
    const session = getSessionFromUpgradeRequest(request, options?.sessionMap, options?.userMap);

    if (isProduction && !session) {
      return {
        authorized: false,
        session: null,
        statusCode: 401,
        statusText: 'Unauthorized',
      };
    }

    return {
      authorized: true,
      session,
    };
  } catch {
    return {
      authorized: false,
      session: null,
      statusCode: 400,
      statusText: 'Bad Request',
    };
  }
}

export function handleGlobalServerError(
  err: any,
  req?: Pick<Request, 'method' | 'originalUrl' | 'url'> | null,
  res?: Pick<Response, 'headersSent' | 'status' | 'json'> | null,
  next?: NextFunction
): void {
  if (!res) return;

  if (res.headersSent) {
    if (typeof next === 'function') {
      next(err);
    }
    return;
  }

  const safeMessage = typeof err?.message === 'string' && err.message.trim()
    ? err.message.trim()
    : (typeof err === 'string' && err.trim() ? err.trim() : 'Internal Server Error');

  const method = req?.method || 'GET';
  const url = req?.originalUrl || req?.url || '/';
  console.error(`[JARVIS Server Error] ${method} ${url}:`, safeMessage);

  const rawCode = typeof err?.statusCode === 'number'
    ? err.statusCode
    : (typeof err?.status === 'number' ? err.status : 500);

  const statusCode = rawCode >= 400 && rawCode < 600 ? rawCode : 500;

  res.status(statusCode).json({ error: safeMessage || 'Internal Server Error' });
}

export function requireRole(
  ...allowedRoles: Array<'admin' | 'developer' | 'auditor'>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const session = (req as Request & { jarvisSession?: BaseSessionRecord }).jarvisSession;
    if (!session) {
      res.status(401).json({ detail: 'Sessão não autenticada.' });
      return;
    }
    if (!allowedRoles.includes(session.role)) {
      res.status(403).json({
        detail: `Permissão insuficiente. Esta ação requer perfil: ${allowedRoles.join(' ou ')}.`,
      });
      return;
    }
    next();
  };
}

export function validateSafeExternalUrl(rawUrl: string): {
  valid: boolean;
  normalized?: string;
  reason?: string;
} {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return { valid: true, normalized: '' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'URL inválida. Informe um endereço completo iniciado por https://.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, reason: 'Apenas URLs HTTP/HTTPS são permitidas.' };
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '169.254.169.254' ||
    host.startsWith('169.254.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^fc[0-9a-f]{2}:/i.test(host) ||
    /^fd[0-9a-f]{2}:/i.test(host) ||
    /^fe80:/i.test(host)
  ) {
    return {
      valid: false,
      reason: 'Endereços locais ou redes internas privadas não são permitidos em webhooks externos.',
    };
  }
  return { valid: true, normalized: parsed.toString() };
}

export function resolveSafeProjectFilePath(baseDir: string, relativePath: string): string {
  const cleaned = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!cleaned || cleaned.includes('\0')) {
    throw new Error('Caminho de arquivo inválido.');
  }
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, cleaned);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error('Caminho fora do diretório permitido do projeto.');
  }
  return resolvedTarget;
}

