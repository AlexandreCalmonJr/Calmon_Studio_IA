import crypto from 'node:crypto';
import express, { Request, Response, Router } from 'express';
import {
  UserAccount,
  SessionRecord,
  users,
  sessions,
  userProfiles,
  learningProgress,
  VALID_ADMIN_TOKENS,
  VALID_BOOTSTRAP_TOKENS,
  nowIso,
  hashPassword,
  verifyPassword,
  makeAccount,
  permissionsForRole,
  getSessionFromReq,
  clearSessionCookie,
  createSessionForUser,
  requireAuth,
  persistAllUsersAndProfiles,
} from '../serverState.ts';
import { isBootstrapAdminUser } from '../serverHardening.ts';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';

export interface AuthRouterDeps {
  store?: LocalSqliteBrainStore;
}

export function createAuthRouter(deps?: AuthRouterDeps): Router {
  const router = express.Router();
  const store = deps?.store;

  // --- AUTH ---
  router.get('/auth/me', (req: Request, res: Response) => {
    const session = getSessionFromReq(req);
    if (!session) {
      res.status(401).json({ detail: 'Não autenticado.' });
      return;
    }
    const user = users.get(session.username);
    if (!user || !user.is_active) {
      sessions.delete(session.session_id);
      res.status(401).json({ detail: 'Conta inativa.' });
      return;
    }
    res.json({
      user_id: user.username,
      subject_id: user.username,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      kind: session.kind,
      permissions: permissionsForRole(user.role),
      must_change_password: user.must_change_password,
    });
  });

  router.post('/auth/password-login', (req: Request, res: Response) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = users.get(username);
    if (!user || !user.is_active || !verifyPassword(password, user.salt, user.password_hash)) {
      res.status(401).json({ detail: 'Utilizador ou palavra-passe inválidos.' });
      return;
    }
    const record = createSessionForUser(req, res, user);
    res.json({
      status: 'authenticated',
      user_id: user.username,
      role: user.role,
      display_name: user.display_name,
      session_token: record.session_id,
    });
  });

  router.post('/auth/login', (req: Request, res: Response) => {
    const token = String(req.body?.token || '').trim();
    if (!VALID_ADMIN_TOKENS.has(token)) {
      res.status(401).json({ detail: 'Token de administrador inválido.' });
      return;
    }
    const admin = users.get('admin')!;
    const record = createSessionForUser(req, res, admin);
    res.json({
      status: 'authenticated',
      user_id: admin.username,
      role: admin.role,
      session_token: record.session_id,
    });
  });

  router.post('/auth/bootstrap/exchange', (req: Request, res: Response) => {
    const token = String(req.body?.token || '').trim();
    if (!VALID_BOOTSTRAP_TOKENS.has(token)) {
      res.status(401).json({ detail: 'Token inicial inválido ou expirado.' });
      return;
    }
    const admin = users.get('admin')!;
    const record = createSessionForUser(req, res, admin);
    res.json({
      status: 'authenticated',
      user_id: admin.username,
      role: admin.role,
      session_token: record.session_id,
    });
  });

  // Safe public profile selector cards (no credentials or PII exposed)
  router.get('/auth/profiles', (_req: Request, res: Response) => {
    const cards = Array.from(users.values())
      .filter((u) => u.is_active && !u.username.startsWith('fb_'))
      .map((u) => {
        const prof = userProfiles.get(u.username);
        return {
          username: u.username,
          display_name: prof?.displayName || u.display_name,
          assistant_name: prof?.assistantName || 'JARVIS',
          experience_mode: prof?.experienceMode === 'simple' ? 'simple' : 'engineering',
          role: u.role,
          avatar_icon: prof?.avatarIcon || u.display_name.slice(0, 1).toUpperCase(),
        };
      });
    res.json({ profiles: cards });
  });

  // Simplified household / personal account registration (starts in Simple Mode with custom assistant name)
  router.post('/auth/register-personal', (req: Request, res: Response) => {
    const rawUsername = String(req.body?.username || '').trim().toLowerCase();
    const display_name = String(req.body?.display_name || '').trim();
    const password = String(req.body?.password || '');
    const assistant_name = String(req.body?.assistant_name || 'JARVIS').trim().slice(0, 40) || 'JARVIS';
    const experience_mode = req.body?.experience_mode === 'engineering' ? 'engineering' : 'simple';

    if (!/^[a-z0-9._-]{3,32}$/.test(rawUsername)) {
      res.status(400).json({ detail: 'Use entre 3 e 32 caracteres no utilizador (letras, números, ponto ou traço).' });
      return;
    }
    if (display_name.length < 2 || display_name.length > 80) {
      res.status(400).json({ detail: 'Informe o seu nome (entre 2 e 80 caracteres).' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ detail: 'Escolha uma senha com pelo menos 8 caracteres.' });
      return;
    }
    if (users.has(rawUsername)) {
      res.status(409).json({ detail: `O utilizador @${rawUsername} já existe. Escolha outro ou faça login.` });
      return;
    }

    const account = makeAccount(rawUsername, display_name, password, 'developer', false);
    users.set(rawUsername, account);
    userProfiles.set(rawUsername, {
      displayName: display_name,
      avatarIcon: Array.from(display_name)[0]?.toUpperCase() || 'U',
      developerRole: experience_mode === 'simple' ? 'Uso Pessoal & Estudos' : 'Engenharia & IA',
      seniorityLevel: experience_mode === 'simple' ? 'junior' : 'senior',
      responseStyle: experience_mode === 'simple' ? 'educational' : 'detailed',
      customInstructions: experience_mode === 'simple'
        ? 'Responda em português claro, acolhedor e sem jargões técnicos desnecessários.'
        : 'Priorize respostas técnicas claras e organizadas.',
      assistantName: assistant_name,
      assistantGreeting: '',
      experienceMode: experience_mode,
    });

    const record = createSessionForUser(req, res, account);
    persistAllUsersAndProfiles(store);
    res.status(201).json({
      status: 'authenticated',
      user_id: account.username,
      role: account.role,
      display_name: account.display_name,
      assistant_name,
      experience_mode,
      session_token: record.session_id,
    });
  });

  // Bridge verified Google / Firebase Auth client sign-in to local API session
  router.post('/auth/firebase-session', (req: Request, res: Response) => {
    const uid = String(req.body?.uid || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const display_name = String(req.body?.display_name || 'Usuário').trim().slice(0, 80) || 'Usuário';
    const email_verified = req.body?.email_verified === true;

    if (!uid || !/^[a-zA-Z0-9_-]{6,128}$/.test(uid)) {
      res.status(400).json({ detail: 'Identificador Firebase inválido.' });
      return;
    }

    const username = `fb_${uid.slice(0, 20).toLowerCase()}`;
    const isBootstrappedAdmin = isBootstrapAdminUser(email_verified, email, process.env.BOOTSTRAP_ADMIN_EMAIL);
    const role: 'admin' | 'developer' = isBootstrappedAdmin ? 'admin' : 'developer';

    let user = users.get(username);
    if (!user) {
      user = makeAccount(username, display_name, crypto.randomBytes(24).toString('hex'), role, false);
      users.set(username, user);
      userProfiles.set(username, {
        displayName: display_name,
        avatarIcon: Array.from(display_name)[0]?.toUpperCase() || 'J',
        developerRole: isBootstrappedAdmin ? 'Arquiteto & Administrador' : 'Uso Pessoal & Estudos',
        seniorityLevel: isBootstrappedAdmin ? 'architect' : 'mid',
        responseStyle: isBootstrappedAdmin ? 'detailed' : 'educational',
        customInstructions: '',
        assistantName: 'JARVIS',
        assistantGreeting: '',
        experienceMode: isBootstrappedAdmin ? 'engineering' : 'simple',
      });
    } else {
      if (isBootstrappedAdmin && user.role !== 'admin') {
        user.role = 'admin';
      }
      if (!user.is_active) {
        res.status(403).json({ detail: 'Conta desativada pelo administrador.' });
        return;
      }
    }

    const record = createSessionForUser(req, res, user);
    persistAllUsersAndProfiles(store);
    res.json({
      status: 'authenticated',
      user_id: user.username,
      role: user.role,
      display_name: user.display_name,
      session_token: record.session_id,
    });
  });

  router.post('/auth/logout', (req: Request, res: Response) => {
    const session = getSessionFromReq(req);
    if (session) sessions.delete(session.session_id);
    clearSessionCookie(req, res);
    res.json({ status: 'logged_out' });
  });

  router.post('/auth/change-password', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser: UserAccount }).jarvisUser;
    const newPassword = String(req.body?.new_password || req.body?.password || '');
    if (newPassword.length < 12) {
      res.status(400).json({ detail: 'A nova palavra-passe deve ter pelo menos 12 caracteres.' });
      return;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    user.salt = salt;
    user.password_hash = hashPassword(newPassword, salt);
    user.must_change_password = false;
    persistAllUsersAndProfiles(store);
    res.json({ status: 'updated' });
  });

  router.get('/auth/users', requireAuth, (req: Request, res: Response) => {
    const session = (req as Request & { jarvisSession: SessionRecord }).jarvisSession;
    if (session.role !== 'admin') {
      res.status(403).json({ detail: 'Apenas administradores podem gerir contas.' });
      return;
    }
    const list = Array.from(users.values()).map((u) => ({
      username: u.username,
      display_name: u.display_name,
      role: u.role,
      is_active: u.is_active,
      created_at: u.created_at,
    }));
    res.json({ users: list });
  });

  router.post('/auth/users', requireAuth, (req: Request, res: Response) => {
    const session = (req as Request & { jarvisSession: SessionRecord }).jarvisSession;
    if (session.role !== 'admin') {
      res.status(403).json({ detail: 'Apenas administradores podem criar contas.' });
      return;
    }
    const username = String(req.body?.username || '').trim().toLowerCase();
    const display_name = String(req.body?.display_name || '').trim();
    const password = String(req.body?.password || '');
    const role = (req.body?.role || 'developer') as 'admin' | 'developer' | 'auditor';
    if (!username || !display_name || password.length < 12) {
      res.status(400).json({ detail: 'Preencha utilizador, nome apresentado e senha (mínimo 12 caracteres).' });
      return;
    }
    if (users.has(username)) {
      res.status(409).json({ detail: `O utilizador @${username} já existe.` });
      return;
    }
    users.set(username, makeAccount(username, display_name, password, role, false));
    persistAllUsersAndProfiles(store);
    res.status(201).json({ status: 'created', username });
  });

  router.put('/auth/users/:username/password', requireAuth, (req: Request, res: Response) => {
    const session = (req as Request & { jarvisSession: SessionRecord }).jarvisSession;
    if (session.role !== 'admin') {
      res.status(403).json({ detail: 'Apenas administradores podem redefinir senhas.' });
      return;
    }
    const target = users.get(req.params.username.toLowerCase());
    const password = String(req.body?.password || '');
    if (!target) {
      res.status(404).json({ detail: 'Utilizador não encontrado.' });
      return;
    }
    if (password.length < 12) {
      res.status(400).json({ detail: 'A palavra-passe precisa de pelo menos 12 caracteres.' });
      return;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    target.salt = salt;
    target.password_hash = hashPassword(password, salt);
    for (const [sid, sess] of sessions.entries()) {
      if (sess.username === target.username && sid !== session.session_id) {
        sessions.delete(sid);
      }
    }
    persistAllUsersAndProfiles(store);
    res.json({ status: 'password_updated' });
  });

  router.patch('/auth/users/:username/status', requireAuth, (req: Request, res: Response) => {
    const session = (req as Request & { jarvisSession: SessionRecord }).jarvisSession;
    if (session.role !== 'admin') {
      res.status(403).json({ detail: 'Apenas administradores podem alterar estados de contas.' });
      return;
    }
    const target = users.get(req.params.username.toLowerCase());
    if (!target) {
      res.status(404).json({ detail: 'Utilizador não encontrado.' });
      return;
    }
    if (target.username === session.username) {
      res.status(400).json({ detail: 'Não é possível desativar a própria conta ativa.' });
      return;
    }
    target.is_active = Boolean(req.body?.is_active);
    persistAllUsersAndProfiles(store);
    res.json({ status: 'updated', is_active: target.is_active });
  });

  router.post('/mobile/pair', requireAuth, (req: Request, res: Response) => {
    const device_name = String(req.body?.device_name || 'Meu Android').trim();
    const device_token = `jrv_dev_${crypto.randomBytes(20).toString('hex')}`;
    const origin = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers.host}`;
    res.json({
      device_name,
      device_token,
      server_url: origin,
      pairing_payload: JSON.stringify({
        hub: 'jarvis-hub',
        v: '3.0.1',
        url: origin,
        token: device_token,
        device_name,
      }),
    });
  });

  // --- PROFILE & LEARNING ---
  router.get('/user/profile', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser: UserAccount }).jarvisUser;
    const stored = userProfiles.get(user.username) || {
      displayName: user.display_name,
      avatarIcon: user.display_name.slice(0, 1).toUpperCase(),
      developerRole: user.role === 'admin' ? 'Administrador' : 'Uso Pessoal & Estudos',
      seniorityLevel: 'senior',
      responseStyle: 'detailed',
      customInstructions: '',
      assistantName: 'JARVIS',
      assistantGreeting: '',
      experienceMode: user.role === 'admin' ? 'engineering' : 'simple',
    };
    res.json(stored);
  });

  router.post('/user/profile', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser: UserAccount }).jarvisUser;
    const prev = userProfiles.get(user.username) || {};
    const merged = {
      ...prev,
      ...req.body,
      assistantName: String(req.body?.assistantName || prev.assistantName || 'JARVIS').trim().slice(0, 40) || 'JARVIS',
      experienceMode: req.body?.experienceMode === 'simple' ? 'simple' : 'engineering',
    };
    userProfiles.set(user.username, merged);
    if (typeof req.body?.displayName === 'string' && req.body.displayName.trim()) {
      user.display_name = req.body.displayName.trim().slice(0, 80);
    }
    persistAllUsersAndProfiles(store);
    res.json({ status: 'saved', profile: merged });
  });

  router.get('/learning/progress', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser: UserAccount }).jarvisUser;
    res.json(learningProgress.get(user.username) || { completed_modules: [], updated_at: nowIso() });
  });

  router.post('/learning/progress', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser: UserAccount }).jarvisUser;
    const next = {
      completed_modules: Array.isArray(req.body?.completed_modules) ? req.body.completed_modules : [],
      updated_at: nowIso(),
    };
    learningProgress.set(user.username, next);
    persistAllUsersAndProfiles(store);
    res.json(next);
  });

  return router;
}
