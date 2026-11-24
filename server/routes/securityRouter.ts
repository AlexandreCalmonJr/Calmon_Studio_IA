import crypto from 'node:crypto';
import express, { Request, Response, Router } from 'express';
import {
  serverState,
  requireAuth,
  nowIso,
  broadcastRealtimeEvent,
  getSentinelStatePayload,
  VAULT_PIN,
  UserAccount,
  SentinelIncidentServer,
} from '../serverState.ts';
import {
  inspectThreatArtifact,
  PermissionAction,
  PermissionMode,
} from '../../src/services/sentinelSecurity.ts';

export function createSecurityRouter(): Router {
  const router = express.Router();

  // --- SECURITY ---
  router.get('/security/cyber-shield-status', requireAuth, (_req: Request, res: Response) => {
    res.json({
      status: serverState.networkIsolated ? 'isolated' : 'protected',
      network_isolated: serverState.networkIsolated,
      kill_switch_active: serverState.killSwitchActive,
      pending_approvals: serverState.approvals.filter((a) => a.status === 'pending').length,
      active_policies: 4,
    });
  });

  router.post('/security/network-isolation', requireAuth, (req: Request, res: Response) => {
    serverState.networkIsolated = Boolean(req.body?.isolated);
    res.json({ isolated: serverState.networkIsolated });
  });

  router.get('/security/policy-templates', requireAuth, (_req: Request, res: Response) => {
    res.json([
      { id: 'strict-csp', name: 'CSP Estrito & Headers OWASP', severity: 'high', description: 'Reforça cabeçalhos HTTP de segurança.' },
      { id: 'secret-guard', name: 'Bloqueio de Segredos em Commit', severity: 'critical', description: 'Impede exposição de tokens e chaves privadas.' },
    ]);
  });

  // --- MATRIZ GRANULAR DE PERMISSÕES ---
  router.get('/security/permissions-matrix', requireAuth, (_req: Request, res: Response) => {
    res.json({
      rules: serverState.permissionsMatrix,
      vault_locked: serverState.vaultLocked,
    });
  });

  router.put('/security/permissions-matrix/:agentRole', requireAuth, (req: Request, res: Response) => {
    const rule = serverState.permissionsMatrix.find((r) => r.agent_role === req.params.agentRole);
    if (!rule) {
      res.status(404).json({ detail: 'Agente não encontrado na matriz de permissões.' });
      return;
    }
    const validModes: PermissionMode[] = ['read_only', 'ask_approval', 'autonomous', 'blocked'];
    if (typeof req.body?.mode === 'string' && validModes.includes(req.body.mode as PermissionMode)) {
      rule.mode = req.body.mode as PermissionMode;
    }
    if (typeof req.body?.folder_scope === 'string' && req.body.folder_scope.trim()) {
      rule.folder_scope = req.body.folder_scope.trim().slice(0, 64);
    }
    if (req.body?.capabilities && typeof req.body.capabilities === 'object') {
      const actions: PermissionAction[] = ['read', 'create', 'modify_diff', 'run_terminal', 'network', 'integrations'];
      for (const act of actions) {
        if (typeof req.body.capabilities[act] === 'boolean') {
          rule.capabilities[act] = req.body.capabilities[act];
        }
      }
    }
    rule.updated_at = nowIso();

    serverState.auditLogs.unshift({
      id: serverState.auditLogs.length + 1,
      timestamp: nowIso(),
      actor: (req as Request & { jarvisUser?: UserAccount }).jarvisUser?.username || 'admin',
      action: 'security.update_permission_matrix',
      resource: `${rule.proper_name} (${rule.folder_scope})`,
      status: 'success',
      details: `Modo atualizado para ${rule.mode}`,
    });

    res.json(rule);
  });

  // --- CENTRAL DE SEGURANÇA & SENTINELA SOC ---
  router.get('/security/sentinel', requireAuth, (_req: Request, res: Response) => {
    res.json(getSentinelStatePayload());
  });

  router.post('/security/sentinel/scan', requireAuth, (req: Request, res: Response) => {
    const content = String(req.body?.content || '').trim();
    const sourceName = String(req.body?.source_name || 'Inspeção Manual').trim();
    if (!content) {
      res.status(400).json({ detail: 'Cole um link, mensagem ou trecho de documento para a Kira analisar.' });
      return;
    }

    const scan = inspectThreatArtifact(content, sourceName);
    let incident: SentinelIncidentServer | null = null;

    if (!scan.safe) {
      incident = {
        id: `inc_${crypto.randomBytes(4).toString('hex')}`,
        severity: scan.severity,
        category: scan.category,
        title: scan.headline,
        description: scan.explanation_pt,
        source: sourceName,
        indicators: scan.indicators,
        status: 'open',
        created_at: nowIso(),
      };
      serverState.sentinelIncidents.unshift(incident);
      broadcastRealtimeEvent('sentinel_incident', incident);

      serverState.auditLogs.unshift({
        id: serverState.auditLogs.length + 1,
        timestamp: nowIso(),
        actor: 'kira_sentinela',
        action: 'sentinel.threat_detected',
        resource: sourceName,
        status: 'warning',
        details: `${scan.severity.toUpperCase()} (${scan.risk_score}/100): ${scan.headline}`,
      });
    }

    res.json({ scan, incident, vault_locked: serverState.vaultLocked });
  });

  router.post('/security/sentinel/incidents/:id/playbook', requireAuth, (req: Request, res: Response) => {
    const incident = serverState.sentinelIncidents.find((i) => i.id === req.params.id);
    if (!incident) {
      res.status(404).json({ detail: 'Incidente não encontrado.' });
      return;
    }

    const playbook = String(req.body?.playbook || 'redact_and_clean');
    const agentRole = typeof req.body?.agent_role === 'string' ? req.body.agent_role : 'coding_agent';

    if (playbook === 'lock_vault') {
      serverState.vaultLocked = true;
      incident.status = 'mitigated';
      incident.playbook_applied = 'lock_vault';
    } else if (playbook === 'quarantine_agent') {
      if (!serverState.quarantinedAgents.includes(agentRole)) {
        serverState.quarantinedAgents = [...serverState.quarantinedAgents, agentRole];
      }
      const targetRule = serverState.permissionsMatrix.find((r) => r.agent_role === agentRole);
      if (targetRule) {
        targetRule.mode = 'blocked';
        targetRule.updated_at = nowIso();
      }
      incident.status = 'quarantined';
      incident.playbook_applied = 'quarantine_agent';
    } else if (playbook === 'redact_and_clean') {
      serverState.piiShieldEnabled = true;
      incident.status = 'mitigated';
      incident.playbook_applied = 'redact_and_clean';
    } else {
      incident.status = 'mitigated';
      incident.playbook_applied = 'dismiss';
    }

    serverState.auditLogs.unshift({
      id: serverState.auditLogs.length + 1,
      timestamp: nowIso(),
      actor: (req as Request & { jarvisUser?: UserAccount }).jarvisUser?.username || 'admin',
      action: `sentinel.playbook.${playbook}`,
      resource: incident.id,
      status: 'success',
      details: `Playbook ${playbook} executado para "${incident.title}"`,
    });

    broadcastRealtimeEvent('sentinel_incident', incident);
    res.json({ incident, state: getSentinelStatePayload() });
  });

  router.post('/security/sentinel/vault', requireAuth, (req: Request, res: Response) => {
    const action = String(req.body?.action || '');
    if (action === 'lock_vault') {
      serverState.vaultLocked = true;
    } else if (action === 'unlock_vault') {
      const pin = String(req.body?.pin || '').trim();
      if (pin !== VAULT_PIN) {
        res.status(403).json({ detail: 'PIN inválido para desbloqueio do Vault Lock. (Dica local: 2026)' });
        return;
      }
      serverState.vaultLocked = false;
    } else if (action === 'toggle_kill_switch') {
      serverState.killSwitchActive = typeof req.body?.enabled === 'boolean' ? req.body.enabled : !serverState.killSwitchActive;
      if (serverState.killSwitchActive) {
        serverState.vaultLocked = true;
      }
    } else if (action === 'toggle_pii_shield') {
      serverState.piiShieldEnabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : !serverState.piiShieldEnabled;
    } else if (action === 'release_quarantine') {
      const role = String(req.body?.agent_role || '');
      serverState.quarantinedAgents = role ? serverState.quarantinedAgents.filter((r) => r !== role) : [];
      if (role) {
        const targetRule = serverState.permissionsMatrix.find((r) => r.agent_role === role);
        if (targetRule && targetRule.mode === 'blocked') {
          targetRule.mode = 'ask_approval';
          targetRule.updated_at = nowIso();
        }
      }
    } else {
      res.status(400).json({ detail: 'Ação de controle da Sentinela não reconhecida.' });
      return;
    }

    res.json(getSentinelStatePayload());
  });

  return router;
}
