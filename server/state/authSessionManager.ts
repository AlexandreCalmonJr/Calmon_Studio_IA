/**
 * Gerenciador de autenticação, contas, sessões persistentes (SQLite + cache em memória) e guardas CSRF/RBAC.
 */
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { parseCookies } from '../serverHardening.ts';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import type { SessionRecord, UserAccount } from './types.ts';

export const SESSION_COOKIE = 'jarvis_session';

export const VALID_ADMIN_TOKENS = new Set([
  process.env.JARVIS_ADMIN_TOKEN || 'jarvis-admin-2026',
]);
export const VALID_BOOTSTRAP_TOKENS = new Set([
  process.env.JARVIS_BOOTSTRAP_TOKEN || 'jarvis-bootstrap-2026',
]);

export function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function verifyPassword(password: string, salt: string, storedHash: string): boolean {
  const candidate = hashPassword(password, salt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function makeAccount(
  username: string,
  display_name: string,
  password: string,
  role: 'admin' | 'developer' | 'auditor',
  must_change_password = false,
): UserAccount {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    username,
    display_name,
    role,
    is_active: true,
    must_change_password,
    salt,
    password_hash: hashPassword(password, salt),
    created_at: new Date().toISOString(),
  };
}

export function permissionsForRole(role: 'admin' | 'developer' | 'auditor'): string[] {
  if (role === 'admin') return ['*'];
  if (role === 'developer') {
    return [
      'chat:read',
      'chat:write',
      'system:read',
      'approvals:read',
      'approvals:write',
      'studios:read',
      'studios:write',
      'agents:read',
      'agents:write',
      'workspace:read',
      'workspace:write',
      'models:read',
      'models:write',
      'coding:read',
      'coding:write',
      'knowledge:read',
      'knowledge:write',
      'tasks:read',
      'tasks:write',
      'skills:read',
      'skills:write',
      'security:read',
      'profile:read',
      'profile:write',
    ];
  }
  return [
    'chat:read',
    'system:read',
    'approvals:read',
    'agents:read',
    'workspace:read',
    'models:read',
    'knowledge:read',
    'tasks:read',
    'skills:read',
    'security:read',
    'profile:read',
  ];
}

export const users = new Map<string, UserAccount>([
  ['admin', makeAccount('admin', 'Administrador', 'Jarvis@2026!Admin', 'admin', false)],
  ['dev', makeAccount('dev', 'Desenvolvedor', 'Jarvis@2026!Dev', 'developer', false)],
]);

export const sessions = new Map<string, SessionRecord>();

export const userProfiles = new Map<string, Record<string, string>>([
  [
    'admin',
    {
      displayName: 'Administrador',
      avatarIcon: 'J',
      developerRole: 'Arquiteto de Sistemas & IA',
      seniorityLevel: 'architect',
      responseStyle: 'detailed',
      customInstructions: 'Priorize respostas técnicas claras, objetivas e em português.',
      assistantName: 'Calmon IA',
      assistantGreeting: '',
      experienceMode: 'engineering',
    },
  ],
  [
    'dev',
    {
      displayName: 'Desenvolvedor',
      avatarIcon: 'D',
      developerRole: 'Engenheiro de Software',
      seniorityLevel: 'senior',
      responseStyle: 'detailed',
      customInstructions: '',
      assistantName: 'Calmon IA',
      assistantGreeting: '',
      experienceMode: 'engineering',
    },
  ],
]);

export const learningProgress = new Map<string, { completed_modules: string[]; updated_at: string }>();

let activeAuthStore: LocalSqliteBrainStore | null = null;

export function bindActiveAuthStore(store: LocalSqliteBrainStore | null): void {
  activeAuthStore = store;
}

export function getActiveAuthStore(): LocalSqliteBrainStore | null {
  return activeAuthStore;
}

export function getSessionFromReq(req: Request): SessionRecord | null {
  const cookies = parseCookies(req.headers.cookie);
  const headerToken = String(req.headers['x-jarvis-session'] || '').trim();
  const authHeader = String(req.headers.authorization || '').trim();
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const queryToken = typeof req.query.session_token === 'string' ? req.query.session_token.trim() : '';

  const sid = cookies[SESSION_COOKIE] || headerToken || bearerToken || queryToken;
  if (!sid) return null;
  const cached = sessions.get(sid);
  if (cached) return cached;

  if (activeAuthStore) {
    try {
      const persisted = activeAuthStore.getAuthSession(sid);
      if (persisted) {
        const hydrated: SessionRecord = {
          session_id: persisted.session_id,
          username: persisted.username,
          role: persisted.role,
          kind: persisted.kind,
          created_at: persisted.created_at,
        };
        sessions.set(sid, hydrated);
        return hydrated;
      }
    } catch {
      // Banco indisponível ou fechado em teardown de teste
    }
  }
  return null;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isCookieOnlyAuthenticatedRequest(req: Request): boolean {
  const cookies = parseCookies(req.headers.cookie);
  const hasCookie = Boolean(cookies[SESSION_COOKIE]);
  const hasExplicitToken = Boolean(
    String(req.headers['x-jarvis-session'] || '').trim() ||
      String(req.headers.authorization || '').trim()
  );
  return hasCookie && !hasExplicitToken;
}

function passesCsrfOriginGuard(req: Request): boolean {
  if (!WRITE_METHODS.has(req.method.toUpperCase())) return true;
  if (!isCookieOnlyAuthenticatedRequest(req)) return true;

  const requestedWith = String(req.headers['x-requested-with'] || '').trim();
  if (requestedWith) return true;

  const host = String(req.headers.host || '').trim().toLowerCase();
  const originHeader = String(req.headers.origin || req.headers.referer || '').trim();
  if (!originHeader || !host) return true;
  try {
    const parsed = new URL(originHeader);
    return parsed.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

export function setSessionCookie(req: Request, res: Response, sessionId: string) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const isHttps = req.secure || forwardedProto.includes('https');
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'Max-Age=86400',
    isHttps ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax',
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(req: Request, res: Response) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const isHttps = req.secure || forwardedProto.includes('https');
  const attrs = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    isHttps ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax',
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function createSessionForUser(
  req: Request,
  res: Response,
  user: UserAccount,
  store?: LocalSqliteBrainStore
): SessionRecord {
  const session_id = crypto.randomBytes(32).toString('hex');
  const record: SessionRecord = {
    session_id,
    username: user.username,
    role: user.role,
    kind: 'human',
    created_at: Date.now(),
  };
  sessions.set(session_id, record);
  const targetStore = store || activeAuthStore;
  try {
    targetStore?.upsertAuthUser(user);
    targetStore?.upsertAuthSession(record);
  } catch {
    // não bloqueia
  }
  setSessionCookie(req, res, session_id);
  return record;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = getSessionFromReq(req);
  if (!session) {
    res.status(401).json({ detail: 'Sessão não autenticada. Faça login para continuar.' });
    return;
  }
  if (!passesCsrfOriginGuard(req)) {
    res.status(403).json({ detail: 'Requisição bloqueada pela verificação de origem da sessão.' });
    return;
  }
  const user = users.get(session.username);
  if (!user || !user.is_active) {
    sessions.delete(session.session_id);
    try {
      activeAuthStore?.deleteAuthSession(session.session_id);
    } catch {
      // não bloqueia
    }
    res.status(401).json({ detail: 'Conta inativa ou sessão revogada.' });
    return;
  }
  (req as Request & { jarvisSession?: SessionRecord; jarvisUser?: UserAccount }).jarvisSession = session;
  (req as Request & { jarvisUser?: UserAccount }).jarvisUser = user;
  next();
}

export function requirePackStudioRole(req: Request, res: Response, next: NextFunction) {
  const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
  if (!user || (user.role !== 'admin' && user.role !== 'developer')) {
    res.status(403).json({
      detail: 'Acesso restrito a administradores e desenvolvedores do Estúdio de Pacotes.',
    });
    return;
  }
  next();
}
