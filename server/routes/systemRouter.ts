import fs from 'node:fs';
import os from 'node:os';
import express, { Request, Response, Router } from 'express';
import {
  serverState,
  requireAuth,
  PORT,
  BOOT_TIME,
  nowIso,
  persistStateNamespace,
} from '../serverState.ts';
import { requireRole, validateSafeExternalUrl } from '../serverHardening.ts';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';

export interface SystemRouterDeps {
  store: LocalSqliteBrainStore;
}

export function createSystemRouter(deps: SystemRouterDeps): Router {
  const router = express.Router();
  const { store } = deps;

  // --- SYSTEM ---
  router.get('/system/health', (_req: Request, res: Response) => {
    res.json({
      status: serverState.killSwitchActive ? 'degraded' : 'healthy',
      components: {
        security_core: serverState.killSwitchActive ? 'contained' : 'active',
        approval_engine: 'ready',
        model_runtime: 'online',
        inference_queue: { active: 0, waiting: 0 },
        kill_switch: { global_killed: serverState.killSwitchActive },
      },
    });
  });

  router.get('/system/health/details', requireAuth, (_req: Request, res: Response) => {
    res.json({
      status: serverState.killSwitchActive ? 'degraded' : 'healthy',
      uptime_seconds: Math.floor((Date.now() - BOOT_TIME) / 1000),
      node_version: process.version,
      platform: os.platform(),
      arch: os.arch(),
      kill_switch: serverState.killSwitchActive,
      network_isolated: serverState.networkIsolated,
    });
  });

  router.get('/system/resources', requireAuth, (_req: Request, res: Response) => {
    const totalMb = Math.round(os.totalmem() / (1024 * 1024));
    const freeMb = Math.round(os.freemem() / (1024 * 1024));
    const usedMb = Math.max(0, totalMb - freeMb);
    const load = os.loadavg()[0] || 0;
    const cpuCount = Math.max(1, os.cpus().length);
    const cpuPercent = Math.min(100, Math.round((load / cpuCount) * 100 * 10) / 10);

    let diskTotalGb = 0;
    let diskFreeGb = 0;
    let diskPercent = 0;
    try {
      const statfs = fs.statfsSync('/');
      const totalBytes = Number(statfs.blocks) * Number(statfs.bsize);
      const freeBytes = Number(statfs.bavail) * Number(statfs.bsize);
      if (totalBytes > 0) {
        diskTotalGb = Math.round((totalBytes / 1024 ** 3) * 10) / 10;
        diskFreeGb = Math.round((freeBytes / 1024 ** 3) * 10) / 10;
        diskPercent = Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10;
      }
    } catch {
      // Ambiente sem suporte a statfsSync mantém zeros reais
    }

    res.json({
      cpu_percent: cpuPercent,
      ram_used_mb: usedMb,
      ram_total_mb: totalMb,
      ram_percent: totalMb > 0 ? Math.round((usedMb / totalMb) * 1000) / 10 : 0,
      disk_free_gb: diskFreeGb,
      disk_total_gb: diskTotalGb,
      disk_percent: diskPercent,
      inference_queue_active: 0,
      inference_queue_waiting: 0,
      is_throttled: false,
      offline_mode_active: serverState.networkIsolated,
    });
  });

  router.get('/system/onboarding', requireAuth, (_req: Request, res: Response) => {
    res.json({ completed: serverState.onboardingCompleted });
  });

  router.post('/system/onboarding/complete', requireAuth, (_req: Request, res: Response) => {
    serverState.onboardingCompleted = true;
    persistStateNamespace(store, 'security_flags', {
      networkIsolated: serverState.networkIsolated,
      killSwitchActive: serverState.killSwitchActive,
      vaultLocked: serverState.vaultLocked,
      piiShieldEnabled: serverState.piiShieldEnabled,
      quarantinedAgents: serverState.quarantinedAgents,
      onboardingCompleted: serverState.onboardingCompleted,
      brainAutoDistill: serverState.brainAutoDistill,
    });
    res.json({ completed: true });
  });

  router.get('/system/discovery', requireAuth, (req: Request, res: Response) => {
    const origin = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers.host}`;
    res.json({
      hub_name: 'JARVIS AI Hub',
      version: '3.0.1',
      local_url: origin,
      lan_ip: '127.0.0.1',
      port: PORT,
    });
  });

  router.get('/system/inference-telemetry', requireAuth, (req: Request, res: Response) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
    const taskId = req.query.task_id ? String(req.query.task_id) : null;
    const filtered = taskId
      ? serverState.telemetryRecords.filter((r) => r.task_id === taskId)
      : serverState.telemetryRecords.slice(0, limit);

    const totalTokens = filtered.reduce((acc, r) => acc + r.prompt_tokens + r.completion_tokens, 0);
    const totalCost = Number(filtered.reduce((acc, r) => acc + (r.cost_usd || 0), 0).toFixed(4));
    const avgLatency = filtered.length
      ? Math.round(filtered.reduce((acc, r) => acc + r.duration_ms, 0) / filtered.length)
      : 0;

    const perfMap = new Map<
      string,
      {
        model_name: string;
        provider: string;
        agent_role: string;
        total_inferences: number;
        successful: number;
        failed: number;
        latency_sum: number;
        tokens_sum: number;
        cost_sum: number;
        rating_sum: number;
        rating_count: number;
      }
    >();

    for (const r of filtered) {
      const k = `${r.model_name}::${r.provider}::${r.agent_role}`;
      const existing = perfMap.get(k) || {
        model_name: r.model_name,
        provider: r.provider,
        agent_role: r.agent_role,
        total_inferences: 0,
        successful: 0,
        failed: 0,
        latency_sum: 0,
        tokens_sum: 0,
        cost_sum: 0,
        rating_sum: 0,
        rating_count: 0,
      };
      existing.total_inferences += 1;
      if (r.status === 'success') existing.successful += 1;
      else existing.failed += 1;
      existing.latency_sum += r.duration_ms;
      existing.tokens_sum += r.prompt_tokens + r.completion_tokens;
      existing.cost_sum += r.cost_usd || 0;
      if (typeof r.feedback_rating === 'number' && r.feedback_rating > 0) {
        existing.rating_sum += r.feedback_rating;
        existing.rating_count += 1;
      }
      perfMap.set(k, existing);
    }

    const model_performance = Array.from(perfMap.values()).map((entry) => ({
      model_name: entry.model_name,
      provider: entry.provider,
      agent_role: entry.agent_role,
      total_inferences: entry.total_inferences,
      successful: entry.successful,
      failed: entry.failed,
      success_rate: entry.total_inferences
        ? Math.round((entry.successful / entry.total_inferences) * 100)
        : 0,
      average_latency_ms: entry.total_inferences
        ? Math.round(entry.latency_sum / entry.total_inferences)
        : 0,
      average_tokens: entry.total_inferences
        ? Math.round(entry.tokens_sum / entry.total_inferences)
        : 0,
      total_cost_usd: Number(entry.cost_sum.toFixed(4)),
    }));

    const model_quality = Array.from(perfMap.values())
      .filter((entry) => entry.rating_count > 0)
      .map((entry) => ({
        model_name: entry.model_name,
        provider: entry.provider,
        agent_role: entry.agent_role,
        feedback_count: entry.rating_count,
        average_rating: Number((entry.rating_sum / entry.rating_count).toFixed(2)),
        sample_sufficient: entry.rating_count >= 5,
      }));

    res.json({
      summary: {
        total_inferences: filtered.length,
        successful: filtered.filter((r) => r.status === 'success').length,
        failed: filtered.filter((r) => r.status !== 'success').length,
        total_tokens: totalTokens,
        total_cost_usd: totalCost,
        average_latency_ms: avgLatency,
      },
      records: filtered,
      model_performance,
      model_quality,
    });
  });

  router.post('/system/inference-feedback', requireAuth, (req: Request, res: Response) => {
    const id = String(req.body?.inference_id || '');
    const rating = Math.min(5, Math.max(1, Number(req.body?.rating || 5)));
    const rec = serverState.telemetryRecords.find((r) => r.id === id);
    if (rec) {
      rec.feedback_rating = rating;
      persistStateNamespace(store, 'telemetry_records', serverState.telemetryRecords.slice(0, 500));
    }
    res.json({ status: 'recorded' });
  });

  router.get('/system/server-logs', requireAuth, (req: Request, res: Response) => {
    const level = req.query.level ? String(req.query.level).toUpperCase() : '';
    const search = req.query.search ? String(req.query.search).toLowerCase() : '';
    let list = [...serverState.serverLogs];
    if (level && level !== 'ALL') list = list.filter((l) => l.level === level);
    if (search) list = list.filter((l) => l.message.toLowerCase().includes(search) || l.source.toLowerCase().includes(search));
    res.json({ total: list.length, logs: list });
  });

  router.post('/system/server-logs/clear', requireAuth, requireRole('admin'), (_req: Request, res: Response) => {
    serverState.serverLogs.length = 0;
    res.json({ status: 'cleared' });
  });

  router.get('/system/server-logs/stream', requireAuth, (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const keepalive = setInterval(() => {
      res.write(`: ping ${Date.now()}\n\n`);
    }, 20000);
    req.on('close', () => clearInterval(keepalive));
  });

  router.post('/system/backup', requireAuth, requireRole('admin', 'developer'), (_req: Request, res: Response) => {
    try {
      const backup = store.createSqliteBackup();
      serverState.serverLogs.unshift({
        id: `log_bkp_${Date.now().toString(36)}`,
        timestamp: nowIso(),
        level: 'INFO',
        source: 'sqlite_backup',
        message: `Backup consistente SQLite criado: ${backup.filename} (${backup.size_bytes} bytes).`,
      });
      res.json({ status: 'created', ...backup });
    } catch (err: any) {
      res.status(500).json({ detail: err?.message || 'Falha ao gerar backup SQLite.' });
    }
  });

  router.post('/system/kill-switch', requireAuth, requireRole('admin'), (req: Request, res: Response) => {
    const target = String(req.body?.target || 'global');
    if (target === 'global') {
      serverState.killSwitchActive = !serverState.killSwitchActive;
      persistStateNamespace(store, 'security_flags', {
        networkIsolated: serverState.networkIsolated,
        killSwitchActive: serverState.killSwitchActive,
        vaultLocked: serverState.vaultLocked,
        piiShieldEnabled: serverState.piiShieldEnabled,
        quarantinedAgents: serverState.quarantinedAgents,
        onboardingCompleted: serverState.onboardingCompleted,
        brainAutoDistill: serverState.brainAutoDistill,
      });
    }
    res.json({ status: serverState.killSwitchActive ? 'triggered' : 'reset', global_killed: serverState.killSwitchActive });
  });

  router.get('/system/webhooks', requireAuth, (_req: Request, res: Response) => res.json(serverState.webhooksConfig));
  router.post('/system/webhooks', requireAuth, (req: Request, res: Response) => {
    const urlFields = ['discord_url', 'slack_url', 'custom_url', 'webhook_url'] as const;
    for (const field of urlFields) {
      if (typeof req.body?.[field] === 'string' && req.body[field].trim()) {
        const check = validateSafeExternalUrl(req.body[field]);
        if (!check.valid) {
          res.status(400).json({ detail: check.reason || 'URL de webhook inválida.' });
          return;
        }
      }
    }
    serverState.webhooksConfig = { ...serverState.webhooksConfig, ...req.body };
    persistStateNamespace(store, 'webhooks_config', serverState.webhooksConfig);
    res.json(serverState.webhooksConfig);
  });
  router.post('/system/webhooks/test', requireAuth, (_req: Request, res: Response) => {
    res.json({ status: 'sent', message: 'Notificação de teste registrada com sucesso.' });
  });

  // --- HARDWARE ---
  router.get('/system/hardware-profile', requireAuth, (_req: Request, res: Response) => {
    const cpus = os.cpus();
    const cpuCount = Math.max(1, cpus.length);
    const loadPercent = Math.min(100, Math.round(((os.loadavg()[0] || 0) / cpuCount) * 1000) / 10);
    const totalGb = Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10;
    const availGb = Math.round((os.freemem() / (1024 ** 3)) * 10) / 10;
    const usedGb = Math.max(0, Math.round((totalGb - availGb) * 10) / 10);
    res.json({
      specs: {
        cpu: {
          model: cpus[0]?.model || 'Host CPU',
          cores: Math.max(1, Math.floor(cpus.length / 2)),
          threads: cpus.length,
          current_load_percent: loadPercent,
        },
        ram: {
          total_gb: totalGb,
          used_gb: usedGb,
          available_gb: availGb,
          percent: totalGb > 0 ? Math.round((usedGb / totalGb) * 1000) / 10 : 0,
        },
        gpu: {
          model: 'Aceleração CPU / Runtime Local',
          vram_gb: 0,
          available: false,
        },
      },
      recommendations: {
        tier: 'standard',
        recommended_models: ['qwen2.5-coder:7b', 'llama3.1:8b'],
        notes: 'Modo balanceado recomendado para respostas rápidas com baixo consumo de memória.',
      },
    });
  });

  router.post('/system/apply-hardware-optimizations', requireAuth, (_req: Request, res: Response) => {
    res.json({ status: 'applied', message: 'Otimizações aplicadas ao perfil local.' });
  });

  router.get('/hardware/performance-mode', requireAuth, (_req: Request, res: Response) => res.json(serverState.performanceModeState));
  router.post('/hardware/performance-mode', requireAuth, (req: Request, res: Response) => {
    serverState.performanceModeState = { ...serverState.performanceModeState, ...req.body };
    persistStateNamespace(store, 'performance_mode', serverState.performanceModeState);
    res.json(serverState.performanceModeState);
  });

  // --- APPROVALS ---
  router.get('/approvals', requireAuth, (_req: Request, res: Response) => res.json(serverState.approvals));
  router.post('/approvals/:id/decide', requireAuth, (req: Request, res: Response) => {
    const item = serverState.approvals.find((a) => a.id === req.params.id);
    if (!item) {
      res.status(404).json({ detail: 'Solicitação de aprovação não encontrada.' });
      return;
    }
    const action = req.body?.action === 'approve' ? 'approved' : 'rejected';
    item.status = action;
    persistStateNamespace(store, 'approvals', serverState.approvals);
    res.json({ status: action, id: item.id });
  });

  // --- AUDIT LOGS ---
  router.get('/audit/logs', requireAuth, (_req: Request, res: Response) => {
    const dbAudit = store.listAuditLogs(80).map((row) => ({
      id: row.id,
      timestamp: row.created_at,
      actor: row.actor,
      operation: row.action,
      status: 'recorded',
      severity: 'info',
      details: row.detail || row.resource,
    }));
    const merged = [...serverState.auditLogs, ...dbAudit]
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
      .slice(0, 100);
    res.json({ total: merged.length, logs: merged });
  });

  return router;
}
