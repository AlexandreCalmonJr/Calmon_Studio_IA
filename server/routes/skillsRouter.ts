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

  router.post('/skills/import-ecc', requireAuth, (req: Request, res: Response) => {
    const raw = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!raw || raw.length > 100_000) {
      res.status(400).json({ detail: 'Conteúdo Markdown ECC inválido ou muito extenso.' });
      return;
    }

    const fmMatch = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n([\s\S]*))?$/);
    if (!fmMatch) {
      res.status(400).json({ detail: 'Frontmatter YAML obrigatório (delimitado por ---).' });
      return;
    }

    const yamlBlock = fmMatch[1];
    const body = (fmMatch[2] || '').trim();
    const meta: Record<string, string> = {};
    for (const line of yamlBlock.split(/\r?\n/)) {
      const colonIdx = line.indexOf(':');
      if (colonIdx <= 0) continue;
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key) meta[key] = val;
    }

    if (!meta.name || !meta.license) {
      res.status(400).json({ detail: 'Frontmatter ECC deve declarar os campos obrigatórios "name" e "license".' });
      return;
    }

    const created = {
      id: `ecc_${meta.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'skill'}_${Date.now().toString(36)}`,
      name: meta.name.slice(0, 120),
      version: (meta.version || '1.0.0').slice(0, 24),
      origin: 'imported_ecc',
      license: meta.license.slice(0, 48),
      description: (meta.description || 'Habilidade importada via especificação ECC Markdown.').slice(0, 400),
      domain: (meta.domain || 'general').slice(0, 48),
      allowed_tools: ['read_file'],
      required_permissions: ['skills:read'],
      assigned_agents: ['jarvis_master'],
      content_hash: `sha256:${crypto.randomBytes(6).toString('hex')}`,
      is_approved: true,
      is_revoked: false,
      instructions: body || meta.description || meta.name,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    serverState.skillsList.unshift(created);
    res.status(201).json({ skill: created });
  });

  router.delete('/skills/:id', requireAuth, (req: Request, res: Response) => {
    const prevLen = serverState.skillsList.length;
    serverState.skillsList = serverState.skillsList.filter((s) => s.id !== req.params.id);
    if (serverState.skillsList.length === prevLen) {
      res.status(404).json({ detail: 'Habilidade não encontrada.', deleted: false, status: 'not_found' });
      return;
    }
    res.json({ deleted: true, status: 'deleted' });
  });

  return router;
}
