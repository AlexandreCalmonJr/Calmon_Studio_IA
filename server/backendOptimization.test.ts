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
import { serverState, users, sessions } from './serverState.ts';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function ensureSession(username: string, role: 'admin' | 'developer' | 'auditor'): string {
  if (!users.has(username)) {
    users.set(username, {
      id: `u_${username}`,
      username,
      display_name: username,
      role,
      permissions: role === 'admin' ? ['*'] : ['tasks:read', 'agents:use'],
      is_active: true,
      password_hash: 'test_hash',
      created_at: new Date().toISOString(),
    });
  }
  const sid = `test_sid_${username}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  sessions.set(sid, {
    session_id: sid,
    username,
    role,
    kind: 'human',
    created_at: Date.now(),
  });
  return sid;
}

async function startTestApp(tempDir: string) {
  const store = createLocalSqliteBrainStore({
    dataDir: tempDir,
    brainName: 'Brain Audit Test',
    assistantName: 'JARVIS',
  });
  const app = express();
  app.use('/api/v1', buildApiRouter({ store }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    store,
    server,
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    close: () => {
      server.close();
      store.close();
    },
  };
}

test('Otimização Backend: 404 real, rotas implementadas, persistência SQLite pós-restart e segurança', async (t) => {
  const tempDir = makeTempDir('jarvis-opt-test-');
  const adminSid = ensureSession('admin', 'admin');
  const auditorSid = ensureSession('auditor_opt', 'auditor');

  const adminHeaders = {
    'x-jarvis-session': adminSid,
    'Content-Type': 'application/json',
  };
  const auditorHeaders = {
    'x-jarvis-session': auditorSid,
    'Content-Type': 'application/json',
  };

  let instance = await startTestApp(tempDir);
  const prevOllama = serverState.providerConnectivity.ollama_connected;
  const prevGemini = serverState.providerConnectivity.gemini_connected;
  serverState.providerConnectivity.ollama_connected = false;
  serverState.providerConnectivity.gemini_connected = false;

  try {
    await t.test('1. Rotas inexistentes retornam 404 JSON estruturado', async () => {
      const res = await fetch(`${instance.baseUrl}/rota/que/nao/existe`, { headers: adminHeaders });
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.error, 'Not Found');
      assert.equal(body.status, 404);
    });

    await t.test('2. RBAC bloqueia rotas administrativas para perfis não-admin (403)', async () => {
      const adminOnlyChecks = [
        { method: 'POST', path: '/system/kill-switch', body: { scope: 'global' } },
        { method: 'POST', path: '/system/server-logs/clear', body: {} },
        { method: 'POST', path: '/security/network-isolation', body: { enabled: true } },
        { method: 'POST', path: '/models/huggingface/install', body: { model_tag: 'qwen2.5:3b' } },
      ];

      for (const check of adminOnlyChecks) {
        const res = await fetch(`${instance.baseUrl}${check.path}`, {
          method: check.method,
          headers: auditorHeaders,
          body: JSON.stringify(check.body),
        });
        assert.equal(res.status, 403, `${check.method} ${check.path} deveria retornar 403 para auditor`);
      }
    });

    await t.test('3. Validação segura de URLs bloqueia endereços internos em webhooks e push', async () => {
      const badWebhook = await fetch(`${instance.baseUrl}/system/webhooks`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ webhook_url: 'http://127.0.0.1:9999/hook' }),
      });
      assert.equal(badWebhook.status, 400);

      const badPush = await fetch(`${instance.baseUrl}/push/config`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ webhook_url: 'http://169.254.169.254/latest/meta-data/' }),
      });
      assert.equal(badPush.status, 400);

      const okPush = await fetch(`${instance.baseUrl}/push/config`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({
          web_push_enabled: true,
          webhook_url: 'https://hooks.example.com/jarvis-notify',
        }),
      });
      assert.equal(okPush.status, 200);
    });

    await t.test('4. Companion heartbeat exige sessão ou código de pareamento válido', async () => {
      const unauthRes = await fetch(`${instance.baseUrl}/companion/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_name: 'Intruso', pairing_code: 'INVALID-0000' }),
      });
      assert.equal(unauthRes.status, 401);

      const validRes = await fetch(`${instance.baseUrl}/companion/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_name: 'Notebook Autorizado',
          pairing_code: serverState.currentPairingCode,
          cpu_percent: 22,
          ram_percent: 48,
        }),
      });
      assert.equal(validRes.status, 200);
      const validJson = await validRes.json();
      assert.equal(validJson.ok, true);
    });

    await t.test('5. Workspace CRUD completo, proteção contra path traversal e export ZIP', async () => {
      const badImportRes = await fetch(`${instance.baseUrl}/workspace/import`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ folder_path: '../../etc' }),
      });
      assert.equal(badImportRes.status, 400);

      const importRes = await fetch(`${instance.baseUrl}/workspace/import`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          name: 'Projeto Auditoria',
          folder_path: 'server/brain',
        }),
      });
      assert.equal(importRes.status, 201);
      const created = await importRes.json();
      const projectId = created.project?.id || created.id;
      assert.ok(projectId);

      // Escreve arquivo válido
      const writeRes = await fetch(`${instance.baseUrl}/workspace/projects/${projectId}/files/write`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ path: 'src/app.ts', content: 'export const ok = 42;\n' }),
      });
      assert.equal(writeRes.status, 200);

      // Lê arquivo válido
      const readRes = await fetch(
        `${instance.baseUrl}/workspace/projects/${projectId}/file?path=${encodeURIComponent('src/app.ts')}`,
        { headers: adminHeaders }
      );
      assert.equal(readRes.status, 200);
      const readJson = await readRes.json();
      assert.equal(readJson.content, 'export const ok = 42;\n');

      // Bloqueia path traversal
      const travRead = await fetch(
        `${instance.baseUrl}/workspace/projects/${projectId}/file?path=${encodeURIComponent('../../etc/passwd')}`,
        { headers: adminHeaders }
      );
      assert.equal(travRead.status, 400);

      const travWrite = await fetch(`${instance.baseUrl}/workspace/projects/${projectId}/files/write`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ path: '../evil.sh', content: 'echo pwn' }),
      });
      assert.equal(travWrite.status, 400);

      // Rollback, preview, dockerize, export-zip
      const rollbackRes = await fetch(`${instance.baseUrl}/workspace/projects/${projectId}/rollback`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ path: 'src/app.ts' }),
      });
      assert.equal(rollbackRes.status, 200);

      const previewRes = await fetch(`${instance.baseUrl}/workspace/projects/${projectId}/preview`, {
        headers: adminHeaders,
      });
      assert.equal(previewRes.status, 200);

      const dockerRes = await fetch(`${instance.baseUrl}/workspace/projects/${projectId}/dockerize`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({}),
      });
      assert.equal(dockerRes.status, 200);

      const zipRes = await fetch(`${instance.baseUrl}/workspace/projects/${projectId}/export-zip`, {
        headers: adminHeaders,
      });
      assert.equal(zipRes.status, 200);
      assert.ok(zipRes.headers.get('content-type')?.includes('application/zip'));
      const zipBuf = Buffer.from(await zipRes.arrayBuffer());
      assert.ok(zipBuf.length > 30);

      // DevSecOps scan & red team no projeto real
      const cveRes = await fetch(`${instance.baseUrl}/security/scan-cves/${projectId}`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({}),
      });
      assert.equal(cveRes.status, 200);
      const cveJson = await cveRes.json();
      assert.ok(typeof cveJson.security_score === 'number');

      const rtRes = await fetch(`${instance.baseUrl}/security/red-team/${projectId}`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({}),
      });
      assert.equal(rtRes.status, 200);
      const rtJson = await rtRes.json();
      assert.ok(typeof rtJson.score === 'number');

      const policyRes = await fetch(`${instance.baseUrl}/security/apply-policy`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ project_id: projectId, template_id: 'headers-strict' }),
      });
      assert.equal(policyRes.status, 200);
      const policyJson = await policyRes.json();
      assert.ok(policyJson.status === 'approval_required' || policyJson.status === 'applied');

      // Remove projeto no final
      const delRes = await fetch(`${instance.baseUrl}/workspace/projects/${projectId}`, {
        method: 'DELETE',
        headers: adminHeaders,
      });
      assert.equal(delRes.status, 200);
    });

    await t.test('6. Rotas previamente ausentes (Knowledge, Coding, Agents, Tasks Purge, Voice, MCP)', async () => {
      const uploadRes = await fetch(`${instance.baseUrl}/knowledge/upload`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          name: 'manual-arquitetura.md',
          category: 'engenharia',
          content: '# Manual\nDiretrizes persistentes do hub.',
        }),
      });
      assert.equal(uploadRes.status, 201);

      const codingPost = await fetch(`${instance.baseUrl}/coding/sessions/sess_opt_1/messages`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ role: 'user', content: 'Verificar arquitetura modular' }),
      });
      assert.equal(codingPost.status, 201);

      const codingGet = await fetch(`${instance.baseUrl}/coding/sessions/sess_opt_1/messages`, {
        headers: adminHeaders,
      });
      assert.equal(codingGet.status, 200);
      const codingList = await codingGet.json();
      assert.ok(Array.isArray(codingList.messages));
      assert.ok(codingList.messages.some((m: any) => m.content === 'Verificar arquitetura modular'));

      const streamRes = await fetch(`${instance.baseUrl}/coding/run/stream`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ session_id: 'sess_opt_1', prompt: 'Listar arquivos' }),
      });
      assert.equal(streamRes.status, 200);
      const streamText = await streamRes.text();
      assert.ok(streamText.includes('data:'));

      const mcpReload = await fetch(`${instance.baseUrl}/mcp/reload`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({}),
      });
      assert.equal(mcpReload.status, 200);

      const agentHist = await fetch(`${instance.baseUrl}/agents/software_architect/history`, {
        headers: adminHeaders,
      });
      assert.equal(agentHist.status, 200);
      const agentHistJson = await agentHist.json();
      assert.ok(Array.isArray(agentHistJson.messages));

      const voiceRes = await fetch(`${instance.baseUrl}/voice/transcribe`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ text: 'Ei JARVIS, resumo do dia' }),
      });
      assert.equal(voiceRes.status, 200);
      const voiceJson = await voiceRes.json();
      assert.ok(String(voiceJson.text || voiceJson.transcript).includes('resumo'));

      const purgeRes = await fetch(`${instance.baseUrl}/tasks/purge`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ days_retention: 365 }),
      });
      assert.equal(purgeRes.status, 200);
      const purgeJson = await purgeRes.json();
      assert.equal(typeof purgeJson.purged_count, 'number');
    });

    await t.test('7. Persistência real SQLite WAL sobrevive ao reinício completo do servidor', async () => {
      // Cria um workflow e um mock endpoint no servidor #1
      const wfRes = await fetch(`${instance.baseUrl}/workflows`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          title: 'Fluxo Persistente Pós-Restart',
          description: 'Verifica hidratação automática do SQLite',
          schedule_cron: '0 9 * * 1-5',
          schedule_enabled: false,
          nodes: [],
          connections: [],
        }),
      });
      assert.equal(wfRes.status, 201);

      const mockRes = await fetch(`${instance.baseUrl}/mock-server/endpoints`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          name: 'Mock Persistente',
          method: 'GET',
          path: '/api/persistente-restart',
          status_code: 200,
          response_body: { survived: true },
        }),
      });
      assert.equal(mockRes.status, 201);

      // Fecha instância #1 e limpa memória para simular reinício frio do processo
      instance.close();
      serverState.savedWorkflows = [];
      serverState.mockEndpoints = [];
      serverState.knowledgeDocs = [];
      serverState.pushBridgeConfig.webhook_url = '';

      // Sobe instância #2 apontando para o MESMO banco SQLite WAL
      instance = await startTestApp(tempDir);

      const wfAfter = await (await fetch(`${instance.baseUrl}/workflows`, { headers: adminHeaders })).json();
      assert.ok(
        wfAfter.workflows.some((w: any) => w.title === 'Fluxo Persistente Pós-Restart'),
        'Workflow deveria ser restaurado do SQLite após reinício'
      );

      const mocksAfter = await (
        await fetch(`${instance.baseUrl}/mock-server/endpoints`, { headers: adminHeaders })
      ).json();
      assert.ok(
        mocksAfter.some((ep: any) => ep.path === '/api/persistente-restart'),
        'Mock endpoint deveria ser restaurado do SQLite após reinício'
      );

      const docsAfter = await (
        await fetch(`${instance.baseUrl}/knowledge/documents`, { headers: adminHeaders })
      ).json();
      assert.ok(
        docsAfter.some((d: any) => d.name === 'manual-arquitetura.md'),
        'Documento da base de conhecimento deveria ser restaurado após reinício'
      );

      const codingAfter = await (
        await fetch(`${instance.baseUrl}/coding/sessions/sess_opt_1/messages`, { headers: adminHeaders })
      ).json();
      assert.ok(
        codingAfter.messages.some((m: any) => m.content === 'Verificar arquitetura modular'),
        'Mensagens de coding deveriam permanecer no SQLite após reinício'
      );

      const pushAfter = await (await fetch(`${instance.baseUrl}/push/config`, { headers: adminHeaders })).json();
      assert.equal(pushAfter.webhook_url, 'https://hooks.example.com/jarvis-notify');
    });
  } finally {
    serverState.providerConnectivity.ollama_connected = prevOllama;
    serverState.providerConnectivity.gemini_connected = prevGemini;
    instance.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
