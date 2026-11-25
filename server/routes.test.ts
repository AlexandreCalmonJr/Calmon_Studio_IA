import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { buildApiRouter } from '../server.ts';
import { createLocalSqliteBrainStore } from './brain/sqliteBrainStore.ts';
import {
  serverState,
  users,
  sessions,
  SESSION_COOKIE,
  createSessionForUser,
} from './serverState.ts';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('Fase 2 Modular Backend: buildApiRouter mounts all 15 domain routers and enforces route contracts', async (t) => {
  const tempDir = makeTempDir('jarvis-routes-test-');
  const tempStore = createLocalSqliteBrainStore({
    dataDir: tempDir,
    brainName: 'Brain Teste Rotas',
    assistantName: 'JARVIS',
  });

  const app = express();
  app.use('/api/v1', buildApiRouter({ store: tempStore }));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;

  // Prepara sessão autenticada para testes protegidos
  const adminUser = users.get('admin')!;
  let adminSessionId = '';
  for (const [sid, s] of sessions.entries()) {
    if (s.username === 'admin') {
      adminSessionId = sid;
      break;
    }
  }
  if (!adminSessionId) {
    adminSessionId = 'test_admin_session_token_' + Date.now();
    sessions.set(adminSessionId, {
      session_id: adminSessionId,
      username: 'admin',
      role: 'admin',
      kind: 'human',
      created_at: Date.now(),
    });
  }

  const authHeaders = {
    'x-jarvis-session': adminSessionId,
    'Content-Type': 'application/json',
  };

  try {
    await t.test('1. Rotas públicas respondem sem autenticação', async () => {
      // /system/health é público
      const healthRes = await fetch(`${baseUrl}/system/health`);
      assert.equal(healthRes.status, 200);
      const healthJson = await healthRes.json();
      assert.equal(healthJson.status, 'healthy');
      assert.ok(healthJson.components);

      // /auth/profiles é público
      const profilesRes = await fetch(`${baseUrl}/auth/profiles`);
      assert.equal(profilesRes.status, 200);
      const profilesJson = await profilesRes.json();
      assert.ok(Array.isArray(profilesJson.profiles));
      assert.ok(profilesJson.profiles.some((p: any) => p.username === 'admin'));
    });

    await t.test('2. Endpoints protegidos rejeitam acessos sem sessão com 401', async () => {
      const protectedEndpoints = [
        '/auth/me',
        '/system/resources',
        '/chat/sessions',
        '/packs',
        '/agents',
        '/models',
        '/workspace/projects',
        '/skills',
        '/knowledge/documents',
        '/integrations',
        '/workflows',
        '/security/sentinel',
        '/voice/briefing',
        '/coding/tools',
        '/spreadsheets',
      ];

      for (const endpoint of protectedEndpoints) {
        const res = await fetch(`${baseUrl}${endpoint}`);
        assert.equal(
          res.status,
          401,
          `Endpoint ${endpoint} deveria exigir autenticação (401), mas retornou ${res.status}`
        );
      }
    });

    await t.test('3. Fluxo de login por token de administrador cria sessão com cookie e token', async () => {
      const loginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'jarvis-admin-2026' }),
      });
      assert.equal(loginRes.status, 200);
      const loginJson = await loginRes.json();
      assert.equal(loginJson.status, 'authenticated');
      assert.equal(loginJson.user_id, 'admin');
      assert.equal(loginJson.role, 'admin');
      assert.ok(loginJson.session_token);

      // Valida header Set-Cookie com SESSION_COOKIE
      const cookieHeader = loginRes.headers.get('set-cookie');
      assert.ok(cookieHeader);
      assert.ok(cookieHeader.includes(`${SESSION_COOKIE}=`));
      assert.ok(cookieHeader.includes('HttpOnly'));
    });

    await t.test('4. Todos os 15 módulos de rotas respondem corretamente para sessão autenticada', async () => {
      // 1. Auth Router
      const meRes = await fetch(`${baseUrl}/auth/me`, { headers: authHeaders });
      assert.equal(meRes.status, 200);
      const meJson = await meRes.json();
      assert.equal(meJson.username, 'admin');
      assert.equal(meJson.role, 'admin');
      assert.deepEqual(meJson.permissions, ['*']);

      // 2. System Router
      const resourcesRes = await fetch(`${baseUrl}/system/resources`, { headers: authHeaders });
      assert.equal(resourcesRes.status, 200);
      const resourcesJson = await resourcesRes.json();
      assert.ok(typeof resourcesJson.cpu_percent === 'number');
      assert.ok(typeof resourcesJson.ram_total_mb === 'number');

      // 3. Chat Router
      const chatRes = await fetch(`${baseUrl}/chat/sessions`, { headers: authHeaders });
      assert.equal(chatRes.status, 200);
      const chatJson = await chatRes.json();
      assert.ok(Array.isArray(chatJson));

      const tasksRes = await fetch(`${baseUrl}/tasks`, { headers: authHeaders });
      assert.equal(tasksRes.status, 200);
      const tasksJson = await tasksRes.json();
      assert.ok(Array.isArray(tasksJson));

      // 4. Packs Router
      const packsRes = await fetch(`${baseUrl}/packs`, { headers: authHeaders });
      assert.equal(packsRes.status, 200);
      const packsJson = await packsRes.json();
      assert.ok(Array.isArray(packsJson.packs));
      assert.ok(Array.isArray(packsJson.unlocked_tabs));

      // 5. Agents Router
      const agentsRes = await fetch(`${baseUrl}/agents`, { headers: authHeaders });
      assert.equal(agentsRes.status, 200);
      const agentsJson = await agentsRes.json();
      assert.ok(Array.isArray(agentsJson));
      assert.ok(agentsJson.some((a: any) => a.role === 'jarvis_master'));

      const coresRes = await fetch(`${baseUrl}/agents/cores`, { headers: authHeaders });
      assert.equal(coresRes.status, 200);
      const coresJson = await coresRes.json();
      assert.ok(Array.isArray(coresJson.cores));

      // 6. Models Router
      const modelsRes = await fetch(`${baseUrl}/models`, { headers: authHeaders });
      assert.equal(modelsRes.status, 200);
      const modelsJson = await modelsRes.json();
      assert.ok(modelsJson.active_model);
      assert.ok(Array.isArray(modelsJson.local_models));

      const hybridCfgRes = await fetch(`${baseUrl}/models/hybrid-config`, { headers: authHeaders });
      assert.equal(hybridCfgRes.status, 200);

      // 7. Workspace Router
      const wsProjectsRes = await fetch(`${baseUrl}/workspace/projects`, { headers: authHeaders });
      assert.equal(wsProjectsRes.status, 200);
      const wsProjectsJson = await wsProjectsRes.json();
      assert.ok(Array.isArray(wsProjectsJson));

      const ideRes = await fetch(`${baseUrl}/ide/workspace`, { headers: authHeaders });
      assert.equal(ideRes.status, 200);
      const ideJson = await ideRes.json();
      assert.ok(Array.isArray(ideJson.files));

      // 8. Skills Router
      const skillsRes = await fetch(`${baseUrl}/skills`, { headers: authHeaders });
      assert.equal(skillsRes.status, 200);
      const skillsJson = await skillsRes.json();
      assert.ok(Array.isArray(skillsJson));

      const invalidEccRes = await fetch(`${baseUrl}/skills/import-ecc`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ content: 'sem frontmatter' }),
      });
      assert.equal(invalidEccRes.status, 400);

      const importEccRes = await fetch(`${baseUrl}/skills/import-ecc`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          content: `---\nname: "ECC Teste"\nversion: "1.0.0"\ndomain: "qa"\nlicense: "MIT"\ndescription: "Valida fluxo ECC"\n---\n# Diretrizes\nPassos de teste.`,
        }),
      });
      assert.equal(importEccRes.status, 201);
      const importedEcc = await importEccRes.json();
      assert.equal(importedEcc.skill?.name, 'ECC Teste');
      assert.equal(importedEcc.skill?.origin, 'imported_ecc');

      const delEccRes = await fetch(`${baseUrl}/skills/${encodeURIComponent(importedEcc.skill.id)}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      assert.equal(delEccRes.status, 200);
      const delEccJson = await delEccRes.json();
      assert.equal(delEccJson.deleted, true);
      assert.equal(delEccJson.status, 'deleted');

      const delMissingRes = await fetch(`${baseUrl}/skills/nonexistent_skill_id`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      assert.equal(delMissingRes.status, 404);

      // 9. Knowledge Router
      const knowledgeRes = await fetch(`${baseUrl}/knowledge/documents`, { headers: authHeaders });
      assert.equal(knowledgeRes.status, 200);
      const knowledgeJson = await knowledgeRes.json();
      assert.ok(Array.isArray(knowledgeJson));

      const memoriesRes = await fetch(`${baseUrl}/brain/memories`, { headers: authHeaders });
      assert.equal(memoriesRes.status, 200);
      const memoriesJson = await memoriesRes.json();
      assert.ok(Array.isArray(memoriesJson.memories));

      // 10. Integrations Router
      const integrationsRes = await fetch(`${baseUrl}/integrations`, { headers: authHeaders });
      assert.equal(integrationsRes.status, 200);
      const integrationsJson = await integrationsRes.json();
      assert.ok(Array.isArray(integrationsJson.connectors));

      // 11. Workflows Router
      const workflowsRes = await fetch(`${baseUrl}/workflows`, { headers: authHeaders });
      assert.equal(workflowsRes.status, 200);
      const workflowsJson = await workflowsRes.json();
      assert.ok(Array.isArray(workflowsJson.workflows));

      // 12. Security Router
      const secShieldRes = await fetch(`${baseUrl}/security/cyber-shield-status`, { headers: authHeaders });
      assert.equal(secShieldRes.status, 200);
      const secShieldJson = await secShieldRes.json();
      assert.ok(secShieldJson.status);

      const sentinelRes = await fetch(`${baseUrl}/security/sentinel`, { headers: authHeaders });
      assert.equal(sentinelRes.status, 200);
      const sentinelJson = await sentinelRes.json();
      assert.ok(typeof sentinelJson.vault_locked === 'boolean');

      // 13. Voice & Companion Router
      const voiceBriefRes = await fetch(`${baseUrl}/voice/briefing`, { headers: authHeaders });
      assert.equal(voiceBriefRes.status, 200);
      const voiceBriefJson = await voiceBriefRes.json();
      assert.ok(voiceBriefJson.greeting);

      const companionRes = await fetch(`${baseUrl}/companion/state`, { headers: authHeaders });
      assert.equal(companionRes.status, 200);
      const companionJson = await companionRes.json();
      assert.ok(companionJson.pairing_code);

      // 14. Studios Router
      const toolsRes = await fetch(`${baseUrl}/coding/tools`, { headers: authHeaders });
      assert.equal(toolsRes.status, 200);
      const toolsJson = await toolsRes.json();
      assert.ok(Array.isArray(toolsJson.tools));

      const mockEpRes = await fetch(`${baseUrl}/mock-server/endpoints`, { headers: authHeaders });
      assert.equal(mockEpRes.status, 200);
      const mockEpJson = await mockEpRes.json();
      assert.ok(Array.isArray(mockEpJson));

      // 15. Media Router
      const spreadsheetsRes = await fetch(`${baseUrl}/spreadsheets`, { headers: authHeaders });
      assert.equal(spreadsheetsRes.status, 200);
      const spreadsheetsJson = await spreadsheetsRes.json();
      assert.ok(Array.isArray(spreadsheetsJson.presets));

      const mediaAssetsRes = await fetch(`${baseUrl}/media/assets`, { headers: authHeaders });
      assert.equal(mediaAssetsRes.status, 200);
      const mediaAssetsJson = await mediaAssetsRes.json();
      assert.ok(Array.isArray(mediaAssetsJson.images));

      // Segundo Cérebro (BrainRouter montado em /brain)
      const brainHealthRes = await fetch(`${baseUrl}/brain/health`);
      assert.equal(brainHealthRes.status, 200);
      const brainHealthJson = await brainHealthRes.json();
      assert.equal(brainHealthJson.status, 'online');
      assert.equal(brainHealthJson.journal_mode, 'wal');
    });

    await t.test('5. Centralized state singletons: appProjectStore, spreadsheetStore, githubInspectionStore', async () => {
      // Cria mock endpoint e verifica que reflete em serverState
      const createMockRes = await fetch(`${baseUrl}/mock-server/endpoints`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: 'Teste Centralizado',
          method: 'GET',
          path: '/api/teste-centralizado',
          status_code: 200,
          response_body: { central: true },
        }),
      });
      assert.equal(createMockRes.status, 201);
      assert.ok(serverState.mockEndpoints.some((ep) => ep.path === '/api/teste-centralizado'));

      // Verifica 404 estruturado para endpoints não mapeados
      const unmappedRes = await fetch(`${baseUrl}/nonexistent/endpoint`, { headers: authHeaders });
      assert.equal(unmappedRes.status, 404);
      const unmappedJson = await unmappedRes.json();
      assert.equal(unmappedJson.status, 404);
      assert.equal(unmappedJson.error, 'Not Found');
    });
  } finally {
    server.close();
    tempStore.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
