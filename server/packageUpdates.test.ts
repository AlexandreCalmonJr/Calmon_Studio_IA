import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createLocalSqliteBrainStore } from './brain/sqliteBrainStore.ts';
import { createPacksRouter } from './routes/packsRouter.ts';
import { serverState, sessions, users } from './serverState.ts';

async function withTestServer(fn: (baseUrl: string, tokens: { admin: string; auditor: string }) => Promise<void>) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-pack-updates-test-'));
  const store = createLocalSqliteBrainStore({ dataDir: tmpDir });
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createPacksRouter({ store }));

  const adminToken = `tok_admin_${Date.now()}`;
  const auditorToken = `tok_auditor_${Date.now()}`;

  users.set('test_admin', {
    username: 'test_admin',
    display_name: 'Admin Teste',
    role: 'admin',
    is_active: true,
    must_change_password: false,
    salt: 's',
    password_hash: 'h',
    created_at: new Date().toISOString(),
  });
  users.set('test_auditor', {
    username: 'test_auditor',
    display_name: 'Auditor Teste',
    role: 'auditor',
    is_active: true,
    must_change_password: false,
    salt: 's',
    password_hash: 'h',
    created_at: new Date().toISOString(),
  });
  sessions.set(adminToken, {
    session_id: adminToken,
    username: 'test_admin',
    role: 'admin',
    kind: 'human',
    created_at: Date.now(),
  });
  sessions.set(auditorToken, {
    session_id: auditorToken,
    username: 'test_auditor',
    role: 'auditor',
    kind: 'human',
    created_at: Date.now(),
  });

  const snapshotAgents = serverState.agentsList.map((a) => ({ ...a }));
  const snapshotSkills = serverState.skillsList.map((s) => ({ ...s }));

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  try {
    await fn(`http://127.0.0.1:${port}/api/v1`, { admin: adminToken, auditor: auditorToken });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    sessions.delete(adminToken);
    sessions.delete(auditorToken);
    users.delete('test_admin');
    users.delete('test_auditor');
    serverState.agentsList = snapshotAgents;
    serverState.skillsList = snapshotSkills;
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

test('GET /packs/updates detects pending updates and POST /admin/packs/updates/apply enforces RBAC & persists updates', async () => {
  await withTestServer(async (baseUrl, tokens) => {
    // 1. Unauthenticated request is rejected
    const unauthRes = await fetch(`${baseUrl}/packs/updates`);
    assert.equal(unauthRes.status, 401);

    // 2. Authenticated user receives pending updates report (default preinstalled creative_productivity v1.1.0 -> v1.2.0)
    const initialRes = await fetch(`${baseUrl}/packs/updates`, {
      headers: { Authorization: `Bearer ${tokens.admin}` },
    });
    assert.equal(initialRes.status, 200);
    const initialReport = (await initialRes.json()) as any;
    assert.ok(initialReport.summary.outdated_packages >= 1);
    assert.ok(initialReport.summary.total_updates_available >= 1);

    const creativePack = initialReport.packages.find((p: any) => p.pack_id === 'creative_productivity');
    assert.equal(creativePack?.installed, true);
    assert.equal(creativePack?.has_update, true);
    assert.equal(creativePack?.installed_version, '1.1.0');
    assert.equal(creativePack?.latest_version, '1.2.0');

    // 3. Non-admin (auditor) is blocked from triggering updates (403)
    const forbiddenRes = await fetch(`${baseUrl}/admin/packs/updates/apply`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.auditor}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target_type: 'pack', target_id: 'creative_productivity' }),
    });
    assert.equal(forbiddenRes.status, 403);

    // 4. Admin triggers single pack update
    const packUpdateRes = await fetch(`${baseUrl}/admin/packs/updates/apply`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.admin}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target_type: 'pack', target_id: 'creative_productivity' }),
    });
    assert.equal(packUpdateRes.status, 200);
    const packUpdateData = (await packUpdateRes.json()) as any;
    assert.equal(packUpdateData.status, 'updated');
    assert.equal(packUpdateData.updated_packs.length, 1);
    assert.equal(packUpdateData.updated_packs[0].new_version, '1.2.0');

    const updatedCreative = packUpdateData.report.packages.find(
      (p: any) => p.pack_id === 'creative_productivity'
    );
    assert.equal(updatedCreative?.has_update, false);
    assert.equal(updatedCreative?.installed_version, '1.2.0');

    // 5. Admin triggers update-all for remaining agents
    const updateAllRes = await fetch(`${baseUrl}/admin/packs/updates/apply`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.admin}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target_type: 'all' }),
    });
    assert.equal(updateAllRes.status, 200);
    const updateAllData = (await updateAllRes.json()) as any;
    assert.equal(updateAllData.report.summary.outdated_packages, 0);
    assert.equal(updateAllData.report.summary.outdated_agents, 0);
    assert.equal(updateAllData.report.summary.total_updates_available, 0);

    // 6. Fresh GET confirms zero pending updates persisted
    const verifyRes = await fetch(`${baseUrl}/packs/updates`, {
      headers: { Authorization: `Bearer ${tokens.admin}` },
    });
    const verifyReport = (await verifyRes.json()) as any;
    assert.equal(verifyReport.summary.total_updates_available, 0);
  });
});
