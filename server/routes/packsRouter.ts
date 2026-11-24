import crypto from 'node:crypto';
import express, { Request, Response, Router } from 'express';
import {
  serverState,
  requireAuth,
  requirePackStudioRole,
  getOwnerUserId,
  recordAgentVersion,
  nowIso,
  AgentServerRecord,
} from '../serverState.ts';
import {
  MODULE_PACK_CATALOG,
  getModulePackById,
  getUnlockedTabsForPacks,
  mergeCatalogWithCustomPacks,
  normalizePackSlug,
  summarizeInstalledPacks,
  type ModulePackDefinition,
} from '../../src/services/modulePackEngine.ts';
import { normalizeAgentRoleSlug } from '../../src/services/agentCoreEngine.ts';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';

export interface PacksRouterDeps {
  store: LocalSqliteBrainStore;
}

export function createPacksRouter(deps: PacksRouterDeps): Router {
  const router = express.Router();
  const { store } = deps;

  const provisionPackResources = (ownerUserId: string, pack: ModulePackDefinition) => {
    const provisionedAgents: string[] = [];

    for (const spec of pack.agents) {
      const existing = serverState.agentsList.find((a) => a.role === spec.role);
      if (!existing) {
        const created: AgentServerRecord = {
          role: spec.role,
          name: spec.name,
          proper_name: spec.proper_name,
          handle: spec.handle,
          category: spec.category,
          mission: spec.mission,
          preferred_model: spec.preferred_model,
          routing_policy: 'auto_hybrid',
          autonomy_level: spec.autonomy_level,
          is_read_only: spec.autonomy_level === 'read_only',
          strict_focus: true,
          strict_topic: spec.name,
          delegation_targets: [],
          allowed_tools: [...spec.allowed_tools],
          system_prompt: `Você é ${spec.proper_name} (${spec.name}), especialista do pacote ${pack.name}. Missão: ${spec.mission}`,
          mascot: {
            id: 'maestro_slime',
            color: spec.mascot_color || '#f97316',
            accessory: 'none',
            mood: 'idle',
          },
          is_custom: true,
          template_id: `pack:${pack.id}`,
          installed_skills: [...spec.installed_skills],
          version: 1,
          updated_at: nowIso(),
        };
        serverState.agentsList.unshift(created);
        recordAgentVersion(created, `Instalado via pacote ${pack.name}`);
        provisionedAgents.push(created.role);
      }

      // Garante que o núcleo individual (AgentCore) existe no SQLite
      store.getAgentCore(ownerUserId, spec.role, {
        name: spec.name,
        proper_name: spec.proper_name,
        handle: spec.handle,
        mission: spec.mission,
        preferred_model: spec.preferred_model,
        pack_id: pack.id,
      });

      // Garante skills do pacote no catálogo em memória
      for (const skillName of spec.installed_skills) {
        const existingSkill = serverState.skillsList.find(
          (s) => s.name.toLowerCase() === skillName.toLowerCase()
        );
        if (existingSkill) {
          if (!existingSkill.assigned_agents.includes(spec.role)) {
            existingSkill.assigned_agents.push(spec.role);
            existingSkill.updated_at = nowIso();
          }
        } else {
          const slug = normalizeAgentRoleSlug(skillName);
          serverState.skillsList.unshift({
            id: `skill_pack_${pack.id}_${slug}`,
            name: skillName,
            version: pack.version,
            origin: `pack:${pack.id}`,
            license: 'MIT',
            description: `Habilidade instalada automaticamente pelo pacote ${pack.name}.`,
            domain: pack.category,
            allowed_tools: [...spec.allowed_tools],
            required_permissions: ['skills:read'],
            assigned_agents: [spec.role],
            content_hash: `sha256:${crypto.randomBytes(6).toString('hex')}`,
            is_approved: true,
            is_revoked: false,
            instructions: `Habilidade "${skillName}" vinculada ao pacote ${pack.name} (${spec.proper_name}).`,
            created_at: nowIso(),
            updated_at: nowIso(),
          });
        }
      }
    }

    // Semeia trilhas de estudo do pacote no SQLite e na base de conhecimento ativa
    for (const track of pack.study_tracks) {
      store.upsertKnowledgeDocumentRecord({
        name: track.document_name,
        category: pack.category,
        content: track.markdown_content,
        fileType: 'md',
      });
      if (!serverState.knowledgeDocs.some((d: any) => d.name === track.document_name)) {
        serverState.knowledgeDocs.unshift({
          name: track.document_name,
          category: pack.category,
          chunks: Math.max(1, Math.ceil(track.markdown_content.length / 650)),
          size_bytes: Buffer.byteLength(track.markdown_content, 'utf8'),
          file_type: 'md',
          indexed_at: nowIso(),
          content: track.markdown_content,
        });
      }
    }

    return provisionedAgents;
  };

  const hydrateInstalledPackResourcesForUser = (ownerUserId: string) => {
    const installed = store.listInstalledPacks(ownerUserId);
    const customPacks = store.listCustomPacks();
    for (const rec of installed) {
      const def = getModulePackById(rec.pack_id, customPacks);
      if (def) {
        provisionPackResources(ownerUserId, def);
      }
    }
    return installed;
  };

  const buildPacksResponsePayload = (ownerUserId: string) => {
    const installedRecords = hydrateInstalledPackResourcesForUser(ownerUserId);
    const customPacks = store.listCustomPacks();
    const mergedCatalog = mergeCatalogWithCustomPacks(customPacks);
    const installedMap = new Map(installedRecords.map((r) => [r.pack_id, r]));
    const installedIds = installedRecords.map((r) => r.pack_id);
    const packs = mergedCatalog.map((pack) => {
      const rec = installedMap.get(pack.id);
      return {
        ...pack,
        installed: Boolean(rec),
        installed_at: rec?.installed_at || null,
      };
    });
    return {
      packs,
      custom_packs: customPacks,
      installed_pack_ids: installedIds,
      unlocked_tabs: getUnlockedTabsForPacks(installedIds, customPacks),
      summary: summarizeInstalledPacks(installedIds, customPacks),
    };
  };

  // --- MODULE PACKS ---
  router.get('/packs', requireAuth, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    res.json(buildPacksResponsePayload(ownerUserId));
  });

  router.post('/packs/:packId/install', requireAuth, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const packId = String(req.params.packId || '').trim();
    const customPacks = store.listCustomPacks();
    const pack = getModulePackById(packId, customPacks);
    if (!pack) {
      res.status(404).json({ detail: 'Pacote modular não encontrado no catálogo.' });
      return;
    }

    store.installPackRecord(ownerUserId, pack.id, pack.version);
    const provisionedAgents = provisionPackResources(ownerUserId, pack);
    res.json({
      pack_id: pack.id,
      installed: true,
      provisioned_agents: provisionedAgents,
      ...buildPacksResponsePayload(ownerUserId),
    });
  });

  router.delete('/packs/:packId', requireAuth, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const packId = String(req.params.packId || '').trim();
    const customPacks = store.listCustomPacks();
    const pack = getModulePackById(packId, customPacks);
    if (!pack) {
      res.status(404).json({ detail: 'Pacote modular não encontrado no catálogo.' });
      return;
    }

    store.uninstallPackRecord(ownerUserId, pack.id);
    const packTemplateTag = `pack:${pack.id}`;
    serverState.agentsList = serverState.agentsList.filter(
      (a) => a.role === 'jarvis_master' || a.template_id !== packTemplateTag
    );

    res.json({
      pack_id: pack.id,
      installed: false,
      ...buildPacksResponsePayload(ownerUserId),
    });
  });

  // --- ESTÚDIO DE PACOTES (DEV / ADMIN CRUD) ---
  router.get('/admin/packs', requireAuth, requirePackStudioRole, (_req: Request, res: Response) => {
    const customPacks = store.listCustomPacks();
    res.json({
      custom_packs: customPacks,
      official_pack_ids: MODULE_PACK_CATALOG.map((p) => p.id),
    });
  });

  router.post('/admin/packs', requireAuth, requirePackStudioRole, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const desiredId = normalizePackSlug(String(body.id || body.name || ''));
      if (MODULE_PACK_CATALOG.some((p) => p.id === desiredId)) {
        res.status(409).json({
          detail: 'Este identificador pertence a um pacote oficial. Escolha outro ID para o pacote personalizado.',
        });
        return;
      }
      const saved = store.upsertCustomPack(ownerUserId, { ...body, id: desiredId });
      res.status(201).json({
        pack: saved,
        ...buildPacksResponsePayload(ownerUserId),
      });
    } catch (err) {
      res.status(400).json({
        detail: err instanceof Error ? err.message : 'Dados inválidos para criar pacote.',
      });
    }
  });

  router.put('/admin/packs/:packId', requireAuth, requirePackStudioRole, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const packId = normalizePackSlug(String(req.params.packId || ''));
    if (MODULE_PACK_CATALOG.some((p) => p.id === packId)) {
      res.status(409).json({
        detail: 'Pacotes oficiais são protegidos. Crie um pacote personalizado com outro identificador.',
      });
      return;
    }
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const saved = store.upsertCustomPack(ownerUserId, { ...body, id: packId });
      res.json({
        pack: saved,
        ...buildPacksResponsePayload(ownerUserId),
      });
    } catch (err) {
      res.status(400).json({
        detail: err instanceof Error ? err.message : 'Falha ao atualizar pacote personalizado.',
      });
    }
  });

  router.delete('/admin/packs/:packId', requireAuth, requirePackStudioRole, (req: Request, res: Response) => {
    const ownerUserId = getOwnerUserId(req);
    const packId = normalizePackSlug(String(req.params.packId || ''));
    const deleted = store.deleteCustomPack(ownerUserId, packId);
    if (!deleted) {
      res.status(404).json({ detail: 'Pacote personalizado não encontrado.' });
      return;
    }
    const packTemplateTag = `pack:${packId}`;
    serverState.agentsList = serverState.agentsList.filter(
      (a) => a.role === 'jarvis_master' || a.template_id !== packTemplateTag
    );
    res.json({
      deleted_pack_id: packId,
      ...buildPacksResponsePayload(ownerUserId),
    });
  });

  return router;
}
