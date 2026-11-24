import crypto from 'node:crypto';
import express, { Request, Response, Router } from 'express';
import {
  serverState,
  requireAuth,
  nowIso,
} from '../serverState.ts';

export function createSkillsRouter(): Router {
  const router = express.Router();

  // --- SKILLS ---
  router.get('/skills', requireAuth, (_req: Request, res: Response) => {
    res.json(serverState.skillsList);
  });

  router.post('/skills/:id/toggle', requireAuth, (req: Request, res: Response) => {
    const s = serverState.skillsList.find((item) => item.id === req.params.id);
    if (!s) {
      res.status(404).json({ detail: 'Habilidade não encontrada.' });
      return;
    }
    s.is_approved = !s.is_approved;
    res.json(s);
  });

  router.post('/skills/:id/assign-agents', requireAuth, (req: Request, res: Response) => {
    const s = serverState.skillsList.find((item) => item.id === req.params.id);
    if (!s) {
      res.status(404).json({ detail: 'Habilidade não encontrada.' });
      return;
    }
    const nextRoles: string[] = Array.isArray(req.body?.agent_roles)
      ? Array.from(new Set(req.body.agent_roles.map(String)))
      : [];
    s.assigned_agents = nextRoles;
    s.updated_at = nowIso();

    // Sincronização bidirecional: reflete imediatamente nos agentes instalados
    for (const ag of serverState.agentsList) {
      const linked = serverState.skillsList
        .filter((sk) => sk.is_approved && sk.assigned_agents.includes(ag.role))
        .map((sk) => sk.name);
      ag.installed_skills = linked;
    }

    res.json(s);
  });

  router.get('/skills/ponytail', requireAuth, (_req: Request, res: Response) => {
    res.json(serverState.ponytailState);
  });

  router.post('/skills/ponytail', requireAuth, (req: Request, res: Response) => {
    serverState.ponytailState = { ...serverState.ponytailState, level: String(req.body?.level || 'senior') };
    res.json(serverState.ponytailState);
  });

  router.post('/skills/create', requireAuth, (req: Request, res: Response) => {
    const created = {
      id: req.body?.id || `skill_${Date.now()}`,
      name: String(req.body?.name || 'Nova Habilidade'),
      version: '1.0.0',
      origin: 'user',
      license: 'Custom',
      description: String(req.body?.description || ''),
      domain: String(req.body?.domain || 'general'),
      allowed_tools: ['read_file'],
      required_permissions: ['skills:read'],
      assigned_agents: Array.isArray(req.body?.assigned_agents) ? req.body.assigned_agents : [],
      content_hash: `sha256:${crypto.randomBytes(6).toString('hex')}`,
      is_approved: true,
      is_revoked: false,
      instructions: String(req.body?.instructions || ''),
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    serverState.skillsList.unshift(created);
    res.status(201).json(created);
  });

  router.delete('/skills/:id', requireAuth, (req: Request, res: Response) => {
    serverState.skillsList = serverState.skillsList.filter((s) => s.id !== req.params.id);
    res.json({ deleted: true });
  });

  return router;
}
