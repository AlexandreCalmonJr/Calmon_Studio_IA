import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  SESSION_COOKIE,
  DEFAULT_BOOTSTRAP_ADMIN_EMAIL,
  parseCookies,
  resolveBootstrapAdminEmail,
  isBootstrapAdminUser,
  getSessionFromUpgradeRequest,
  verifyWebSocketUpgrade,
  handleGlobalServerError,
  type BaseSessionRecord,
  type BaseUserAccount,
} from './serverHardening.ts';

test('Acessibilidade & Contraste WCAG AAA em src/index.css', () => {
  const cssPath = path.resolve(process.cwd(), 'src/index.css');
  assert.ok(fs.existsSync(cssPath), 'src/index.css must exist');
  const rootCss = fs.readFileSync(cssPath, 'utf8');
  const cssDir = path.dirname(cssPath);
  // Resolve @import './styles/*.css' para validar tokens e classes após modularização (Fase 5)
  const importedParts = Array.from(rootCss.matchAll(/@import\s+['"](\.[^'"]+)['"]\s*;/g)).map((m) => {
    const target = path.resolve(cssDir, m[1]);
    return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  });
  const css = [rootCss, ...importedParts].join('\n');

  // Verify --btn-primary-text token
  assert.match(
    css,
    /--btn-primary-text:\s*#0b0d12;/,
    '--btn-primary-text should be set to high-contrast #0b0d12'
  );

  // Verify .btn-primary has #0b0d12 and font-weight 600
  const btnPrimaryMatch = css.match(/\.btn-primary\s*\{([^}]+)\}/);
  assert.ok(btnPrimaryMatch, '.btn-primary block must exist in index.css');
  const btnPrimaryBody = btnPrimaryMatch[1];

  assert.match(
    btnPrimaryBody,
    /color:\s*(#0b0d12|var\(--btn-primary-text,\s*#0b0d12\))/,
    '.btn-primary must have text color #0b0d12 for WCAG AAA compliance'
  );
  assert.match(
    btnPrimaryBody,
    /font-weight:\s*600/,
    '.btn-primary must have font-weight: 600'
  );
});

test('resolveBootstrapAdminEmail & isBootstrapAdminUser handle defaults and env overrides', () => {
  // Default fallback
  const defaultAdmin = resolveBootstrapAdminEmail('');
  assert.equal(defaultAdmin, DEFAULT_BOOTSTRAP_ADMIN_EMAIL);

  // Configured override with case normalization & whitespace trimming
  const customAdmin = resolveBootstrapAdminEmail('  Admin.Root@Company.Org  ');
  assert.equal(customAdmin, 'admin.root@company.org');

  // isBootstrapAdminUser checks
  assert.equal(isBootstrapAdminUser(true, 'alexandrecalmonjunior@gmail.com'), true);
  assert.equal(isBootstrapAdminUser(true, 'AlexandreCalmonJunior@Gmail.Com'), true);
  assert.equal(isBootstrapAdminUser(false, 'alexandrecalmonjunior@gmail.com'), false, 'Unverified email must be rejected');
  assert.equal(isBootstrapAdminUser(true, 'attacker@gmail.com'), false, 'Non-admin email must be rejected');
  assert.equal(isBootstrapAdminUser(true, undefined), false);
  assert.equal(isBootstrapAdminUser(false, undefined), false);

  // With custom admin email configured
  assert.equal(isBootstrapAdminUser(true, 'devops@mycorp.com', 'devops@mycorp.com'), true);
  assert.equal(isBootstrapAdminUser(true, 'alexandrecalmonjunior@gmail.com', 'devops@mycorp.com'), false);
});

test('parseCookies handles various header formats, RFC 6265 quotes, and malformed encoding', () => {
  assert.deepEqual(parseCookies(), {});
  assert.deepEqual(parseCookies(''), {});

  const parsed = parseCookies('jarvis_session=abc123xyz; other_cookie=val%20space; empty=');
  assert.equal(parsed.jarvis_session, 'abc123xyz');
  assert.equal(parsed.other_cookie, 'val space');
  assert.equal(parsed.empty, '');

  // RFC 6265 double-quoted cookies
  const quoted = parseCookies('jarvis_session="quoted_session_token_123"; path=/');
  assert.equal(quoted.jarvis_session, 'quoted_session_token_123');

  // Resilient against malformed percent-encoding without throwing URIError
  const malformed = parseCookies('jarvis_session=%; bad=%E0%A4%A; trailing=ok');
  assert.equal(malformed.jarvis_session, '%');
  assert.equal(malformed.bad, '%E0%A4%A');
  assert.equal(malformed.trailing, 'ok');
});

test('handleGlobalServerError returns structured JSON response with safety precautions', () => {
  let capturedStatus = 0;
  let capturedJson: any = null;
  let nextCalledWith: any = null;

  const mockRes = {
    headersSent: false,
    status(code: number) {
      capturedStatus = code;
      return this;
    },
    json(body: any) {
      capturedJson = body;
      return this;
    },
  };

  const mockReq = {
    method: 'GET',
    originalUrl: '/api/v1/test',
    url: '/api/v1/test',
  };

  // Case 1: Standard Error
  handleGlobalServerError(new Error('Database connection failed'), mockReq, mockRes, (err) => {
    nextCalledWith = err;
  });
  assert.equal(capturedStatus, 500);
  assert.deepEqual(capturedJson, { error: 'Database connection failed' });
  assert.equal(nextCalledWith, null);

  // Case 2: Custom status code on error (both statusCode and status properties)
  const customErr: any = new Error('Invalid query payload');
  customErr.statusCode = 400;
  handleGlobalServerError(customErr, mockReq, mockRes);
  assert.equal(capturedStatus, 400);
  assert.deepEqual(capturedJson, { error: 'Invalid query payload' });

  const statusOnlyErr: any = { message: 'Entity unprocessable', status: 422 };
  handleGlobalServerError(statusOnlyErr, mockReq, mockRes);
  assert.equal(capturedStatus, 422);
  assert.deepEqual(capturedJson, { error: 'Entity unprocessable' });

  // Case 3: When headers already sent, delegates to next(err) without write
  const sentRes = {
    headersSent: true,
    status(code: number) {
      capturedStatus = code;
      return this;
    },
    json(body: any) {
      capturedJson = body;
      return this;
    },
  };
  let delegatedErr: any = null;
  handleGlobalServerError(new Error('Late error'), mockReq, sentRes, (err) => {
    delegatedErr = err;
  });
  assert.equal(delegatedErr?.message, 'Late error');

  // Case 4: Defensive null safety
  assert.doesNotThrow(() => {
    handleGlobalServerError(new Error('Ignore null res'), null, null);
    handleGlobalServerError(null, null, mockRes);
  });
});

test('verifyWebSocketUpgrade enforces session authentication in production and accepts valid channels', () => {
  const sessions = new Map<string, BaseSessionRecord>();
  const users = new Map<string, BaseUserAccount>();

  users.set('admin_user', { username: 'admin_user', is_active: true });
  users.set('inactive_user', { username: 'inactive_user', is_active: false });

  sessions.set('sess_active_123', {
    session_id: 'sess_active_123',
    username: 'admin_user',
    role: 'admin',
    kind: 'human',
    created_at: Date.now(),
  });

  sessions.set('sess_inactive_456', {
    session_id: 'sess_inactive_456',
    username: 'inactive_user',
    role: 'developer',
    kind: 'human',
    created_at: Date.now(),
  });

  // 1. Production without auth -> Rejected with 401
  const reqNoAuth = {
    headers: {},
    url: '/ws',
  };
  const prodNoAuth = verifyWebSocketUpgrade(reqNoAuth, {
    isProduction: true,
    sessionMap: sessions,
    userMap: users,
  });
  assert.equal(prodNoAuth.authorized, false);
  assert.equal(prodNoAuth.statusCode, 401);
  assert.equal(prodNoAuth.session, null);

  // 2. Production with invalid cookie -> Rejected with 401
  const reqInvalidCookie = {
    headers: { cookie: `${SESSION_COOKIE}=nonexistent_token` },
    url: '/ws',
  };
  const prodInvalid = verifyWebSocketUpgrade(reqInvalidCookie, {
    isProduction: true,
    sessionMap: sessions,
    userMap: users,
  });
  assert.equal(prodInvalid.authorized, false);
  assert.equal(prodInvalid.statusCode, 401);

  // 3. Production with inactive account session -> Rejected with 401
  const reqInactive = {
    headers: { cookie: `${SESSION_COOKIE}=sess_inactive_456` },
    url: '/ws',
  };
  const prodInactive = verifyWebSocketUpgrade(reqInactive, {
    isProduction: true,
    sessionMap: sessions,
    userMap: users,
  });
  assert.equal(prodInactive.authorized, false);
  assert.equal(prodInactive.statusCode, 401);

  // 4. Production with valid jarvis_session cookie -> Authorized
  const reqValidCookie = {
    headers: { cookie: `${SESSION_COOKIE}=sess_active_123; tracking=ok` },
    url: '/ws',
  };
  const prodValidCookie = verifyWebSocketUpgrade(reqValidCookie, {
    isProduction: true,
    sessionMap: sessions,
    userMap: users,
  });
  assert.equal(prodValidCookie.authorized, true);
  assert.equal(prodValidCookie.session?.username, 'admin_user');

  // 5. Production with Bearer authorization header -> Authorized
  const reqBearer = {
    headers: { authorization: 'Bearer sess_active_123' },
    url: '/ws',
  };
  const prodValidBearer = verifyWebSocketUpgrade(reqBearer, {
    isProduction: true,
    sessionMap: sessions,
    userMap: users,
  });
  assert.equal(prodValidBearer.authorized, true);
  assert.equal(prodValidBearer.session?.username, 'admin_user');

  // 6. Production with query token ?session_token=... -> Authorized
  const reqQuery = {
    headers: {},
    url: '/ws?session_token=sess_active_123',
  };
  const prodValidQuery = verifyWebSocketUpgrade(reqQuery, {
    isProduction: true,
    sessionMap: sessions,
    userMap: users,
  });
  assert.equal(prodValidQuery.authorized, true);
  assert.equal(prodValidQuery.session?.username, 'admin_user');

  // 7. Non-production (development mode) without auth -> Authorized for dev convenience
  const devNoAuth = verifyWebSocketUpgrade(reqNoAuth, {
    isProduction: false,
    sessionMap: sessions,
    userMap: users,
  });
  assert.equal(devNoAuth.authorized, true);
  assert.equal(devNoAuth.session, null);

  // 8. Production with quoted session cookie -> Authorized
  const reqQuoted = {
    headers: { cookie: `${SESSION_COOKIE}="sess_active_123"` },
    url: '/ws',
  };
  const prodQuoted = verifyWebSocketUpgrade(reqQuoted, {
    isProduction: true,
    sessionMap: sessions,
    userMap: users,
  });
  assert.equal(prodQuoted.authorized, true);
  assert.equal(prodQuoted.session?.username, 'admin_user');

  // 9. Malformed requests with missing headers or percent encoding -> safely rejected without throwing
  assert.doesNotThrow(() => {
    const malformedReq = {
      headers: { cookie: `${SESSION_COOKIE}=%` },
      url: '/ws?token=%',
    };
    const res = verifyWebSocketUpgrade(malformedReq, {
      isProduction: true,
      sessionMap: sessions,
      userMap: users,
    });
    assert.equal(res.authorized, false);

    // Empty object request
    const emptyRes = verifyWebSocketUpgrade({} as any, {
      isProduction: true,
      sessionMap: sessions,
    });
    assert.equal(emptyRes.authorized, false);
  });
});
