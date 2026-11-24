import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import { isGeminiApiConfigured } from './server/hybridAiEngine.ts';
import {
  handleGlobalServerError,
  verifyWebSocketUpgrade,
} from './server/serverHardening.ts';
import {
  createLocalSqliteBrainStore,
  type LocalSqliteBrainStore,
} from './server/brain/sqliteBrainStore.ts';
import { createBrainRouter } from './server/brain/brainRouter.ts';
import {
  PORT,
  serverState,
  sessions,
  users,
  requireAuth,
  realtimeClients,
  nowIso,
  recordAgentVersion,
  createFreshPairingSession,
  SessionRecord,
} from './server/serverState.ts';
import {
  createAuthRouter,
  createSystemRouter,
  createChatRouter,
  createPacksRouter,
  createAgentsRouter,
  createModelsRouter,
  createWorkspaceRouter,
  createSkillsRouter,
  createKnowledgeRouter,
  createIntegrationsRouter,
  createWorkflowsRouter,
  createSecurityRouter,
  createVoiceCompanionRouter,
  createStudiosRouter,
  createMediaRouter,
} from './server/routes/index.ts';

export function buildApiRouter(options?: { store?: LocalSqliteBrainStore }) {
  const api = express.Router();
  api.use(express.json({ limit: '15mb' }));
  api.use(express.urlencoded({ extended: true, limit: '15mb' }));

  // ==================== SERVIDOR CÉREBRO REAL (LOCAL_SQLITE WAL + STORE) ====================
  const localBrainStore = options?.store || createLocalSqliteBrainStore({
    defaultOrigin: `http://localhost:${process.env.PORT || 3000}`,
    brainName: process.env.BRAIN_NAME || 'Esta Máquina · Local (Sem Docker)',
    assistantName: process.env.ASSISTANT_NAME || 'JARVIS',
  });

  const syncRuntimeToSqlite = () => {
    localBrainStore.syncWorkspaceSnapshot({
      agents: serverState.agentsList,
      skills: serverState.skillsList,
      workflows: serverState.savedWorkflows as any[],
      knowledge: serverState.knowledgeDocs as any[],
    });
  };

  localBrainStore.seedPairedDevicesIfEmpty(serverState.pairedDevicesList);
  serverState.pairedDevicesList = localBrainStore.listPairedDevices();
  syncRuntimeToSqlite();

  // ==================== MÓDULOS DE ROTAS DOMAIN-DRIVEN ====================
  api.use(createAuthRouter());
  api.use(createSystemRouter({ store: localBrainStore }));
  api.use(createChatRouter({ store: localBrainStore }));
  api.use(createPacksRouter({ store: localBrainStore }));
  api.use(createAgentsRouter({ store: localBrainStore }));
  api.use(createModelsRouter({ store: localBrainStore }));
  api.use(createWorkspaceRouter());
  api.use(createSkillsRouter());
  api.use(createKnowledgeRouter());
  api.use(createIntegrationsRouter());
  api.use(createWorkflowsRouter());
  api.use(createSecurityRouter());
  api.use(createVoiceCompanionRouter({ store: localBrainStore }));
  api.use(createStudiosRouter());
  api.use(createMediaRouter());

  // Roteador dedicado do Segundo Cérebro (Brain)
  api.use(
    '/brain',
    createBrainRouter({
      store: localBrainStore,
      requireAuth,
      isGeminiConfigured: isGeminiApiConfigured,
      getLiveCounts: () => ({
        agents: serverState.agentsList.length,
        skills: serverState.skillsList.length,
        workflows: serverState.savedWorkflows.length,
        knowledge: serverState.knowledgeDocs.length,
        sessions: serverState.chatSessions.size,
        paired_devices: serverState.pairedDevicesList.length,
      }),
      syncSnapshotBeforeExport: syncRuntimeToSqlite,
      onPackImported: (pack) => {
        for (const a of pack.agents) {
          if (!serverState.agentsList.some((existing) => existing.role === a.role)) {
            const created = {
              role: a.role,
              name: a.name,
              handle: a.handle || `@${a.role}`,
              description: a.description || 'Agente migrado via .jarvis-pack.',
              system_prompt: a.system_prompt || 'Responda sempre em português do Brasil com clareza.',
              color: '#f97316',
              avatar_icon: 'bot',
              preferred_model: 'gemini-2.5-flash',
              autonomy_level: 'confirm',
              hybrid_policy: {
                mode: 'hybrid',
                fallback_to_cloud: true,
                prefer_local_for_private: true,
              },
              is_custom: true,
              installed_skills: a.installed_skills || [],
              version: 1,
              updated_at: nowIso(),
            };
            serverState.agentsList.unshift(created);
            recordAgentVersion(created, `Migrado de ${pack.sourceBrain.name}`);
          }
        }
        for (const s of pack.skills) {
          if (!serverState.skillsList.some((existing) => existing.name.toLowerCase() === s.name.toLowerCase())) {
            serverState.skillsList.unshift({
              id: s.id || `skill_pack_${Date.now().toString(36)}`,
              name: s.name,
              version: '1.0.0',
              origin: 'custom',
              license: 'JARVIS Pack',
              description: s.description || 'Habilidade migrada via .jarvis-pack.',
              domain: s.domain || 'geral',
              allowed_tools: ['read_file', 'web_search'],
              required_permissions: ['skills:read'],
              assigned_agents: s.assigned_agents || [],
              content_hash: `sha256:${crypto.randomBytes(6).toString('hex')}`,
              is_approved: true,
              is_revoked: false,
              instructions: s.instructions || '',
              created_at: nowIso(),
              updated_at: nowIso(),
            });
          }
        }
        for (const w of pack.workflows) {
          if (!serverState.savedWorkflows.some((existing: any) => existing.title.toLowerCase() === w.title.toLowerCase())) {
            serverState.savedWorkflows.unshift({
              id: w.id || `wf_pack_${Date.now().toString(36)}`,
              title: w.title,
              description: w.description || 'Fluxo migrado via .jarvis-pack.',
              schedule_cron: w.schedule_cron || '0 8 * * *',
              schedule_enabled: Boolean(w.schedule_enabled),
              nodes: Array.isArray(w.nodes) ? w.nodes : [],
              edges: Array.isArray(w.edges) ? w.edges : [],
              updated_at: nowIso(),
            } as any);
          }
        }
        for (const k of pack.knowledge) {
          if (!serverState.knowledgeDocs.some((existing: any) => existing.name === k.name)) {
            serverState.knowledgeDocs.unshift({
              name: k.name,
              category: k.category || 'geral',
              chunks: Math.max(1, Math.ceil(k.content.length / 650)),
              size_bytes: Buffer.byteLength(k.content, 'utf8'),
              file_type: k.file_type || 'md',
              indexed_at: nowIso(),
              content: k.content,
            });
          }
        }
      },
      onActiveBrainChanged: ({ name, baseUrl }) => {
        try {
          serverState.activePairingSession = createFreshPairingSession({
            serverUrl: baseUrl,
            brainName: name,
          });
        } catch {
          // Mantém sessão de pareamento atual se a URL for apenas modelo
        }
      },
    })
  );

  // Fallback para endpoints não mapeados para retornar JSON limpo à interface
  api.use(requireAuth, (_req, res) => {
    res.json({ status: 'ok', items: [] });
  });

  return api;
}

export async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  app.use('/api/v1', buildApiRouter());

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.use((_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // Global Error Handler Middleware (Standardized JSON Error Envelope)
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    handleGlobalServerError(err, req, res, next);
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    realtimeClients.add(ws);
    try {
      ws.send(JSON.stringify({ type: 'connected', payload: { status: 'ready' } }));
    } catch {
      // ignore
    }
    ws.on('close', () => {
      realtimeClients.delete(ws);
    });
  });

  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => {
      socket.destroy();
    });

    try {
      const urlPath = (request.url || '').split('?')[0];
      if (urlPath === '/ws') {
        const upgradeCheck = verifyWebSocketUpgrade(request, {
          isProduction: process.env.NODE_ENV === 'production',
          sessionMap: sessions,
          userMap: users,
        });

        if (!upgradeCheck.authorized) {
          if (socket.writable) {
            socket.write(
              'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n{"error":"Unauthorized WebSocket connection"}\r\n'
            );
          }
          socket.destroy();
          return;
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
          if (upgradeCheck.session) {
            (ws as WebSocket & { jarvisSession?: SessionRecord }).jarvisSession = upgradeCheck.session;
          }
          wss.emit('connection', ws, request);
        });
      } else {
        if (socket.writable) {
          socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        }
        socket.destroy();
      }
    } catch (err) {
      console.error('[JARVIS WebSocket Upgrade Error]:', err);
      try {
        if (socket.writable) {
          socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n');
        }
      } catch {
        // ignore write failure
      }
      socket.destroy();
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`JARVIS AI Hub server listening on http://0.0.0.0:${PORT}`);
  });
}

// Inicia o servidor se executado diretamente
if (process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error('Failed to start JARVIS AI Hub server:', err);
    process.exit(1);
  });
}
