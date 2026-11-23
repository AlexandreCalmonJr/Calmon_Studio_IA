import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
const firebaseVerifier = await readFile(new URL('../server/firebaseTokenVerifier.ts', import.meta.url), 'utf8');
const authGate = await readFile(new URL('../src/features/auth/AuthGate.tsx', import.meta.url), 'utf8');

test('chat sessions carry an explicit account owner', () => {
  assert.match(source, /interface StoredChatSession\s*\{\s*owner_user_id: string;/);
  assert.match(source, /owner_user_id: 'admin'/);
  assert.match(source, /owner_user_id: ownerUserId/);
});

test('chat list and search are scoped to the authenticated owner', () => {
  assert.match(source, /filter\(\(s\) => s\.owner_user_id === ownerUserId\)/);
  assert.match(source, /s\.owner_user_id === ownerUserId && \(s\.title/);
});

test('chat read, delete, export and write reject another account session', () => {
  const guards = source.match(/s\.owner_user_id !== getOwnerUserId\(req\)/g) || [];
  assert.equal(guards.length, 3, 'detail, delete and export routes must check ownership');
  assert.match(source, /existingSession\.owner_user_id !== ownerUserId/);
});

test('API session tokens are not accepted in query strings and expire server-side', () => {
  assert.match(source, /const SESSION_TTL_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /Date\.now\(\) - session\.created_at > SESSION_TTL_MS/);
  assert.doesNotMatch(source, /req\.query\.session_token/);
});

test('websocket upgrades require an active, unexpired cookie session', () => {
  assert.match(source, /const sessionId = parseCookies\(request\.headers\.cookie\)\[SESSION_COOKIE\]/);
  assert.match(source, /HTTP\/1\.1 401 Unauthorized/);
  assert.match(source, /realtimeClients\.set\(ws, session\.username\)/);
});

test('realtime broadcasts fail closed unless an owner is specified', () => {
  assert.match(source, /if \(!eventOwner\) return/);
  assert.match(source, /clientOwner === eventOwner/);
});

test('Firebase session exchange verifies a signed ID token server-side', () => {
  assert.match(source, /verifyFirebaseIdToken\(idToken, projectId\)/);
  assert.match(source, /FIREBASE_PROJECT_ID/);
  assert.doesNotMatch(source, /req\.body\?\.uid|req\.body\?\.email_verified/);
  assert.match(authGate, /fbUser\.getIdToken\(\)/);
  assert.match(authGate, /JSON\.stringify\(\{ id_token: idToken \}\)/);
});

test('Firebase verifier checks signature, project audience, issuer and expiry', () => {
  assert.match(firebaseVerifier, /crypto\.verify\(/);
  assert.match(firebaseVerifier, /new crypto\.X509Certificate\(certificate\)/);
  assert.match(firebaseVerifier, /claims\.aud !== projectId/);
  assert.match(firebaseVerifier, /claims\.iss !== expectedIssuer/);
  assert.match(firebaseVerifier, /claims\.exp <= nowSeconds/);
});

test('no default administrator credentials or fallback tokens remain', () => {
  assert.match(source, /const users = new Map<string, UserAccount>\(\)/);
  assert.doesNotMatch(source, /Jarvis@2026!Admin|Jarvis@2026!Dev|jarvis-admin-2026|jarvis-bootstrap-2026/);
  assert.match(source, /process\.env\.JARVIS_ADMIN_PASSWORD/);
  assert.match(source, /process\.env\.JARVIS_BOOTSTRAP_TOKEN/);
  assert.match(source, /Configure JARVIS_ADMIN_PASSWORD/);
});

test('Firebase administrator role comes only from a verified-email allowlist', () => {
  assert.match(source, /JARVIS_FIREBASE_ADMIN_EMAILS/);
  assert.match(source, /email_verified && Boolean\(email\) && adminEmails\.has\(email\)/);
  assert.doesNotMatch(source, /alexandrecalmonjunior@gmail\.com/);
});

test('authentication and registration endpoints have rate limits', () => {
  assert.match(source, /function createAuthRateLimit\(/);
  for (const route of ['password-login', 'login', 'bootstrap/exchange', 'register-personal', 'firebase-session']) {
    assert.match(source, new RegExp('createAuthRateLimit\\('));
    assert.ok(source.includes(`/auth/${route}`), `expected route ${route}`);
  }
});

test('password-change-required accounts are restricted until their password is changed', () => {
  assert.match(source, /user\.must_change_password && req\.path !== '\/auth\/change-password'/);
  assert.match(authGate, /passwordChangeRequired && status === 'authenticated'/);
  assert.match(authGate, /\/api\/v1\/auth\/change-password/);
  assert.match(authGate, /setPasswordChangeRequired\(Boolean\(nextSession\.must_change_password\)\)/);
});

test('each public authentication route is wired to a specific rate limit', () => {
  assert.match(source, /api\.post\('\/auth\/password-login', createAuthRateLimit\('password-login', 10\)/);
  assert.match(source, /api\.post\('\/auth\/login', createAuthRateLimit\('admin-login', 5\)/);
  assert.match(source, /api\.post\('\/auth\/bootstrap\/exchange', createAuthRateLimit\('bootstrap', 5\)/);
  assert.match(source, /api\.post\('\/auth\/register-personal', createAuthRateLimit\('register', 5\)/);
  assert.match(source, /api\.post\('\/auth\/firebase-session', createAuthRateLimit\('firebase-login', 10\)/);
});

test('system account names cannot be claimed through public registration', () => {
  assert.match(source, /rawUsername === 'admin' \|\| rawUsername === 'dev' \|\| rawUsername\.startsWith\('fb_'\)/);
  assert.match(source, /admin\.role !== 'admin'/);
});

test('Firebase admin privilege is reconciled against the server allowlist', () => {
  assert.match(source, /else if \(!isBootstrappedAdmin && user\.role === 'admin'\)/);
  assert.match(source, /user\.role = 'developer'/);
});
