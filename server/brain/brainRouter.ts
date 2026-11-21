/**
 * Fase 8 — Router Modular da API do Servidor "Cérebro" (`/api/v1/brain/*`).
 *
 * Conecta todas as rotas REST do Cérebro diretamente ao `LocalSqliteBrainStore`
 * (modo `local_sqlite` com persistência real em SQLite WAL), mantendo paridade total
 * com o contrato unificado para Docker PostgreSQL, Web Hub e App Android.
 */

import express, { type RequestHandler, type Router } from 'express';
import {
  buildDualModeBundleZip,
  probeBrainHealth,
  resolveDeploymentOptions,
} from '../brainServer.ts';
import type { LocalSqliteBrainStore } from './sqliteBrainStore.ts';
import type { JarvisBrainPack } from '../../src/services/brainArchitectureEngine.ts';

export interface BrainRouterDeps {
  store: LocalSqliteBrainStore;
  requireAuth: RequestHandler;
  isGeminiConfigured: () => boolean;
  getLiveCounts: () => {
    agents: number;
    skills: number;
    workflows: number;
    knowledge: number;
    sessions: number;
    paired_devices: number;
  };
  syncSnapshotBeforeExport: () => void;
  onPackImported?: (pack: JarvisBrainPack) => void;
  onActiveBrainChanged?: (profile: { name: string; baseUrl: string }) => void;
}

export function createBrainRouter(deps: BrainRouterDeps): Router {
  const router = express.Router();
  const { store, requireAuth } = deps;

  // Healthcheck enxuto público (Docker HEALTHCHECK e ping Multi-Brain, sem segredos)
  router.get('/health', (_req, res) => {
    const active = store.getActiveBrainProfile();
    const dbHealth = store.getDatabaseHealth();
    res.json({
      status: dbHealth.ok ? 'online' : 'degraded',
      brain_mode: active?.mode || 'local_sqlite',
      database_engine:
        active?.databaseEngine || `SQLite ${dbHealth.journalMode.toUpperCase()} (node:sqlite)`,
      journal_mode: dbHealth.journalMode,
      sqlite_integrity: dbHealth.integrity,
      db_size_bytes: dbHealth.dbSizeBytes,
      gemini_configured: deps.isGeminiConfigured(),
      uptime_seconds: store.getUptimeSeconds(),
      timestamp: new Date().toISOString(),
    });
  });

  // Identidade, estado do SQLite local e contadores sincronizados
  router.get('/info', requireAuth, (_req, res) => {
    const identity = store.getIdentity();
    const active = store.getActiveBrainProfile();
    const dbHealth = store.getDatabaseHealth();
    const backups = store.listBackups();
    const isDocker = active?.mode === 'docker_postgres';

    res.json({
      brain_id: active?.id || identity.id,
      name: active?.name || identity.name,
      version: '3.8.0-dual',
      schema_version: identity.schema_version,
      mode: active?.mode || identity.mode,
      database_engine:
        active?.databaseEngine ||
        (isDocker ? 'PostgreSQL 16 + pgvector + Redis' : `SQLite ${dbHealth.journalMode.toUpperCase()} (node:sqlite)`),
      storage_path: isDocker
        ? 'Volume Docker (jarvis_pg_data + jarvis_brain_storage)'
        : store.dbPath,
      db_size_bytes: dbHealth.dbSizeBytes,
      journal_mode: dbHealth.journalMode,
      backups_count: backups.length,
      mdns_service: identity.mdns_service,
      active_profile_id: active?.id || 'brain_local_primary',
      uptime_seconds: store.getUptimeSeconds(),
      services: {
        database: dbHealth.ok ? 'online' : 'offline',
        gemini_cloud: deps.isGeminiConfigured() ? 'configured' : 'standby',
        ollama_local: process.env.OLLAMA_HOST ? 'detected' : 'optional',
        redis_queue: isDocker ? 'online' : 'local_scheduler',
      },
      counts: deps.getLiveCounts(),
    });
  });

  // Atualizar identidade do Cérebro local
  router.patch('/identity', requireAuth, (req, res) => {
    try {
      const updated = store.updateIdentity({
        name: req.body?.name,
        assistant_name: req.body?.assistant_name,
      });
      res.json({ identity: updated });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Não foi possível atualizar a identidade do Cérebro.' });
    }
  });

  // Introspecção do esquema SQLite real (tabelas e contagem de registros em disco)
  router.get('/schema', requireAuth, (_req, res) => {
    const identity = store.getIdentity();
    const dbHealth = store.getDatabaseHealth();
    res.json({
      mode: 'local_sqlite',
      schema_version: identity.schema_version,
      storage_path: store.dbPath,
      journal_mode: dbHealth.journalMode,
      db_size_bytes: dbHealth.dbSizeBytes,
      tables: store.getTableStats(),
    });
  });

  // Gerenciador Multi-Cérebros persistido em SQLite
  router.get('/profiles', requireAuth, (_req, res) => {
    res.json(store.listBrainProfiles());
  });

  router.post('/profiles', requireAuth, (req, res) => {
    try {
      const result = store.addBrainProfile({
        name: String(req.body?.name || ''),
        baseUrl: String(req.body?.baseUrl || ''),
        mode: req.body?.mode || 'docker_postgres',
        description: req.body?.description,
      });
      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Não foi possível cadastrar este Cérebro.' });
    }
  });

  router.post('/profiles/:id/activate', requireAuth, (req, res) => {
    try {
      const id = String(req.params.id || '');
      const result = store.setActiveBrainProfile(id);
      deps.onActiveBrainChanged?.({
        name: result.active.name,
        baseUrl: result.active.baseUrl,
      });
      res.json(result);
    } catch (err: any) {
      res.status(404).json({ error: err?.message || 'Cérebro não encontrado.' });
    }
  });

  router.post('/profiles/:id/ping', requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id || '');
      const listed = store.listBrainProfiles();
      const target = listed.profiles.find((p) => p.id === id);
      if (!target) {
        res.status(404).json({ error: 'Cérebro não encontrado.' });
        return;
      }
      const probed = await probeBrainHealth(target.baseUrl, target.isLocalCurrent);
      const updated = store.updateBrainProfileHealth(id, probed.status, probed.latencyMs, probed.checkedAt);
      res.json({
        profile: updated.profile,
        profiles: updated.profiles,
        detail: probed.detail,
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Falha ao testar conexão com o Cérebro.' });
    }
  });

  router.delete('/profiles/:id', requireAuth, (req, res) => {
    try {
      const id = String(req.params.id || '');
      const result = store.deleteBrainProfile(id);
      res.json(result);
    } catch (err: any) {
      const status = String(err?.message || '').includes('não encontrado') ? 404 : 400;
      res.status(status).json({ error: err?.message || 'Não foi possível remover este Cérebro.' });
    }
  });

  // Exportação e Importação Portátil (.jarvis-pack) contra SQLite real
  router.post('/export', requireAuth, (_req, res) => {
    try {
      deps.syncSnapshotBeforeExport();
      const pack = store.exportJarvisPack();
      res.json(pack);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Falha ao exportar pacote .jarvis-pack.' });
    }
  });

  router.post('/import', requireAuth, (req, res) => {
    try {
      deps.syncSnapshotBeforeExport();
      const { pack, imported } = store.importJarvisPack(req.body);
      deps.onPackImported?.(pack);
      res.json({
        imported,
        message: `Migração de "${pack.sourceBrain.name}" gravada no SQLite local: +${imported.agents} agentes, +${imported.skills} habilidades, +${imported.workflows} fluxos e +${imported.knowledge} documentos.`,
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Falha ao importar pacote .jarvis-pack.' });
    }
  });

  // Backups reais do SQLite local (VACUUM INTO em .jarvis-brain/backups/)
  router.get('/backups', requireAuth, (_req, res) => {
    res.json({
      backups_dir: store.backupsDir,
      backups: store.listBackups(),
    });
  });

  router.post('/backup', requireAuth, (_req, res) => {
    try {
      deps.syncSnapshotBeforeExport();
      const created = store.createSqliteBackup();
      res.status(201).json({
        backup: created,
        backups: store.listBackups(),
        message: `Backup SQLite "${created.filename}" criado (${(created.size_bytes / 1024).toFixed(1)} KB).`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Não foi possível gerar o backup do banco SQLite.' });
    }
  });

  // Pacote Dual-Mode (.zip) personalizável (Local SQLite + Docker Compose)
  router.post('/bundle/preview', requireAuth, async (req, res) => {
    try {
      const options = resolveDeploymentOptions(req.body || {});
      const { files, zipBuffer, filename } = await buildDualModeBundleZip(options);
      res.json({
        options,
        files,
        zip_size_bytes: zipBuffer.length,
        filename,
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Não foi possível gerar os arquivos do servidor.' });
    }
  });

  router.post('/bundle.zip', requireAuth, async (req, res) => {
    try {
      const options = resolveDeploymentOptions(req.body || {});
      const { zipBuffer, filename } = await buildDualModeBundleZip(options);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(zipBuffer);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Falha ao compactar o servidor Dual-Mode.' });
    }
  });

  return router;
}
