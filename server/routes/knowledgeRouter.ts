import crypto from 'node:crypto';
import express, { Request, Response, Router } from 'express';
import {
  serverState,
  userProfiles,
  requireAuth,
  nowIso,
  broadcastRealtimeEvent,
  UserAccount,
} from '../serverState.ts';
import {
  AssistantPeer,
  AssistantRelayMessage,
  BrainLayer,
  BrainMemoryItem,
  SharedAssetTransfer,
  computeTextEmbedding,
  distillConversationToMemory,
  searchBrainMemories,
} from '../../src/services/secondBrain.ts';

export function createKnowledgeRouter(): Router {
  const router = express.Router();

  // --- KNOWLEDGE ---
  router.get('/knowledge/documents', requireAuth, (_req: Request, res: Response) => {
    res.json(serverState.knowledgeDocs);
  });

  router.post('/knowledge/index-text', requireAuth, (req: Request, res: Response) => {
    const doc = {
      name: String(req.body?.doc_name || `nota-${Date.now()}.md`),
      category: String(req.body?.category || 'anotacoes'),
      chunks: 1,
      size_bytes: String(req.body?.content || '').length,
      file_type: 'md',
      indexed_at: nowIso(),
      content: String(req.body?.content || ''),
    };
    serverState.knowledgeDocs.unshift(doc);
    res.status(201).json(doc);
  });

  router.post('/knowledge/search', requireAuth, (req: Request, res: Response) => {
    const q = String(req.body?.query || '').toLowerCase();
    const results = serverState.knowledgeDocs
      .filter((d) => !q || d.name.toLowerCase().includes(q) || d.content.toLowerCase().includes(q))
      .map((d) => ({ doc_name: d.name, category: d.category, score: 0.94, snippet: d.content }));
    res.json(results);
  });

  router.delete('/knowledge/documents/:name', requireAuth, (req: Request, res: Response) => {
    serverState.knowledgeDocs = serverState.knowledgeDocs.filter((d) => d.name !== req.params.name);
    res.json({ deleted: true });
  });

  // --- FASE 3: SEGUNDO CÉREBRO VIVO (3 CAMADAS + AUTO-DESTILAÇÃO) ---
  router.get('/brain/memories', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser: UserAccount }).jarvisUser;
    const q = String(req.query.q || '');
    const layer = String(req.query.layer || 'all') as BrainLayer | 'all';
    const agentRole = req.query.agent_role ? String(req.query.agent_role) : undefined;
    const pinnedOnly = req.query.pinned_only === 'true';

    const allVisible = searchBrainMemories(serverState.brainMemories, '', { username: user.username, limit: 200 });
    const hits = searchBrainMemories(serverState.brainMemories, q, {
      layer,
      agentRole,
      pinnedOnly,
      username: user.username,
      limit: 60,
    });

    res.json({
      memories: hits,
      counts: {
        total: allVisible.length,
        private: allVisible.filter((h) => h.memory.layer === 'private').length,
        agent: allVisible.filter((h) => h.memory.layer === 'agent').length,
        household: allVisible.filter((h) => h.memory.layer === 'household').length,
        pinned: allVisible.filter((h) => h.memory.pinned).length,
      },
      auto_distill_enabled: serverState.brainAutoDistill,
    });
  });

  router.post('/brain/memories', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser: UserAccount }).jarvisUser;
    const title = String(req.body?.title || '').trim();
    const content = String(req.body?.content || '').trim();
    if (!title || !content) {
      res.status(400).json({ detail: 'Título e conteúdo são obrigatórios para salvar no Cérebro.' });
      return;
    }
    const layerRaw = String(req.body?.layer || 'private');
    const layer: BrainLayer =
      layerRaw === 'household' || layerRaw === 'agent' ? layerRaw : 'private';
    const tags = Array.isArray(req.body?.tags)
      ? req.body.tags.map((t: unknown) => String(t).trim()).filter(Boolean)
      : [];
    const created: BrainMemoryItem = {
      id: `mem_${crypto.randomBytes(5).toString('hex')}`,
      title,
      content,
      layer,
      owner_user_id: user.username,
      owner_name: user.display_name,
      agent_role: req.body?.agent_role ? String(req.body.agent_role) : null,
      agent_name: req.body?.agent_name ? String(req.body.agent_name) : null,
      source_kind: (req.body?.source_kind as BrainMemoryItem['source_kind']) || 'manual',
      source_label: String(req.body?.source_label || `Adicionado por ${user.display_name}`),
      source_url: req.body?.source_url ? String(req.body.source_url) : null,
      tags,
      pinned: Boolean(req.body?.pinned),
      confidence: 0.96,
      embedding: computeTextEmbedding(`${title} ${content} ${tags.join(' ')}`),
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    serverState.brainMemories.unshift(created);
    broadcastRealtimeEvent('brain_memory_updated', { action: 'created', memory: created });
    res.status(201).json(created);
  });

  router.post('/brain/distill', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser: UserAccount }).jarvisUser;
    const prompt = String(req.body?.prompt || '').trim();
    const answer = String(req.body?.answer || '').trim();
    if (!prompt && !answer) {
      res.status(400).json({ detail: 'Conteúdo insuficiente para destilar.' });
      return;
    }
    const distilled = distillConversationToMemory({
      prompt: prompt || answer.slice(0, 60),
      answer: answer || prompt,
      ownerUserId: user.username,
      ownerName: user.display_name,
      agentRole: req.body?.agent_role ? String(req.body.agent_role) : undefined,
      agentName: req.body?.agent_name ? String(req.body.agent_name) : undefined,
      sources: Array.isArray(req.body?.sources) ? req.body.sources : undefined,
      layer: req.body?.layer as BrainLayer | undefined,
    });
    const created: BrainMemoryItem = {
      ...distilled,
      id: `mem_${crypto.randomBytes(5).toString('hex')}`,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    serverState.brainMemories.unshift(created);
    broadcastRealtimeEvent('brain_memory_updated', { action: 'distilled', memory: created });
    res.status(201).json(created);
  });

  router.put('/brain/memories/:id', requireAuth, (req: Request, res: Response) => {
    const mem = serverState.brainMemories.find((m) => m.id === req.params.id);
    if (!mem) {
      res.status(404).json({ detail: 'Memória não encontrada.' });
      return;
    }
    if (typeof req.body?.title === 'string' && req.body.title.trim()) mem.title = req.body.title.trim();
    if (typeof req.body?.content === 'string' && req.body.content.trim()) mem.content = req.body.content.trim();
    if (req.body?.layer === 'private' || req.body?.layer === 'agent' || req.body?.layer === 'household') {
      mem.layer = req.body.layer;
    }
    if (typeof req.body?.pinned === 'boolean') mem.pinned = req.body.pinned;
    if (Array.isArray(req.body?.tags)) {
      mem.tags = req.body.tags.map((t: unknown) => String(t).trim()).filter(Boolean);
    }
    mem.embedding = computeTextEmbedding(`${mem.title} ${mem.content} ${mem.tags.join(' ')}`);
    mem.updated_at = nowIso();
    broadcastRealtimeEvent('brain_memory_updated', { action: 'updated', memory: mem });
    res.json(mem);
  });

  router.delete('/brain/memories/:id', requireAuth, (req: Request, res: Response) => {
    serverState.brainMemories = serverState.brainMemories.filter((m) => m.id !== req.params.id);
    broadcastRealtimeEvent('brain_memory_updated', { action: 'deleted', id: req.params.id });
    res.json({ deleted: true });
  });

  router.put('/brain/settings', requireAuth, (req: Request, res: Response) => {
    serverState.brainAutoDistill = Boolean(req.body?.auto_distill_enabled);
    res.json({ auto_distill_enabled: serverState.brainAutoDistill });
  });

  // --- FASE 3: COMUNICAÇÃO ASSISTENTE ↔ ASSISTENTE (JOÃO ↔ MARIA / CASA) ---
  router.get('/assistants/federation', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser: UserAccount }).jarvisUser;
    const profile = userProfiles.get(user.username);
    const localName = profile?.assistantName || 'JARVIS';
    const hydratedPeers = serverState.assistantPeers.map((p) =>
      p.id === 'peer-principal' ? { ...p, assistant_name: localName, last_seen_at: nowIso() } : p
    );
    res.json({
      peers: hydratedPeers,
      messages: serverState.assistantRelayMessages,
      shared_assets: serverState.sharedAssetTransfers,
      household_memories_count: serverState.brainMemories.filter((m) => m.layer === 'household').length,
    });
  });

  router.put('/assistants/peers/:id', requireAuth, (req: Request, res: Response) => {
    const peer = serverState.assistantPeers.find((p) => p.id === req.params.id);
    if (!peer) {
      res.status(404).json({ detail: 'Assistente conectado não encontrado.' });
      return;
    }
    if (typeof req.body?.shared_memory_enabled === 'boolean') {
      peer.shared_memory_enabled = req.body.shared_memory_enabled;
    }
    peer.last_seen_at = nowIso();
    res.json(peer);
  });

  router.post('/assistants/relay', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser: UserAccount }).jarvisUser;
    const profile = userProfiles.get(user.username);
    const content = String(req.body?.content || '').trim();
    if (!content) {
      res.status(400).json({ detail: 'Digite o recado para enviar ao outro assistente.' });
      return;
    }
    const targetPeer =
      serverState.assistantPeers.find((p) => p.id === req.body?.to_peer_id) ||
      serverState.assistantPeers.find((p) => p.id === 'peer-casa-maria')!;
    const fromName = String(req.body?.from_assistant || profile?.assistantName || 'JARVIS');
    const saveToHousehold = Boolean(req.body?.save_to_household_brain);

    let createdMemory: BrainMemoryItem | undefined;
    if (saveToHousehold) {
      createdMemory = {
        id: `mem_${crypto.randomBytes(5).toString('hex')}`,
        title: `Recado ${fromName} → ${targetPeer.assistant_name}`,
        content,
        layer: 'household',
        owner_user_id: user.username,
        owner_name: user.display_name,
        agent_role: null,
        agent_name: null,
        source_kind: 'assistant_sync',
        source_label: `Canal ${fromName} ↔ ${targetPeer.assistant_name}`,
        source_url: null,
        tags: ['casa', 'recado', targetPeer.assistant_name.toLowerCase()],
        pinned: false,
        confidence: 0.95,
        embedding: computeTextEmbedding(`${fromName} ${targetPeer.assistant_name} ${content}`),
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      serverState.brainMemories.unshift(createdMemory);
      broadcastRealtimeEvent('brain_memory_updated', { action: 'created', memory: createdMemory });
    }

    const msg: AssistantRelayMessage = {
      id: `relay_${crypto.randomBytes(5).toString('hex')}`,
      from_peer_id: 'peer-principal',
      from_assistant: fromName,
      from_owner: user.display_name,
      to_peer_id: targetPeer.id,
      to_assistant: targetPeer.assistant_name,
      content,
      saved_to_household_brain: saveToHousehold,
      memory_id: createdMemory?.id || null,
      created_at: nowIso(),
    };
    serverState.assistantRelayMessages.push(msg);
    broadcastRealtimeEvent('assistant_message', msg);

    const ackReply: AssistantRelayMessage = {
      id: `relay_${crypto.randomBytes(5).toString('hex')}`,
      from_peer_id: targetPeer.id,
      from_assistant: targetPeer.assistant_name,
      from_owner: targetPeer.owner_name,
      to_peer_id: 'peer-principal',
      to_assistant: fromName,
      content: saveToHousehold
        ? `Recebido por ${targetPeer.assistant_name}! Já sincronizei este recado na Memória Compartilhada da Casa para referência nos dois notebooks.`
        : `Recebido por ${targetPeer.assistant_name} no ${targetPeer.device_label}! Vou avisar assim que ela abrir o painel.`,
      saved_to_household_brain: saveToHousehold,
      memory_id: createdMemory?.id || null,
      created_at: nowIso(),
    };
    serverState.assistantRelayMessages.push(ackReply);
    broadcastRealtimeEvent('assistant_message', ackReply);

    res.status(201).json({ message: msg, reply: ackReply, memory: createdMemory });
  });

  router.post('/assistants/share-asset', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser: UserAccount }).jarvisUser;
    const profile = userProfiles.get(user.username);
    const kind = (req.body?.kind || 'agent') as SharedAssetTransfer['kind'];
    const assetName = String(req.body?.asset_name || '').trim();
    if (!assetName) {
      res.status(400).json({ detail: 'Selecione um agente, fluxo ou Context Set para compartilhar.' });
      return;
    }
    const targetPeer =
      serverState.assistantPeers.find((p) => p.id === req.body?.to_peer_id) ||
      serverState.assistantPeers.find((p) => p.id === 'peer-casa-maria')!;
    const transfer: SharedAssetTransfer = {
      id: `share_${crypto.randomBytes(5).toString('hex')}`,
      kind,
      asset_id: String(req.body?.asset_id || `asset_${Date.now()}`),
      asset_name: assetName,
      summary: String(req.body?.summary || 'Compartilhado em 1 clique entre assistentes da casa.'),
      from_assistant: String(req.body?.from_assistant || profile?.assistantName || 'JARVIS'),
      to_assistant: targetPeer.assistant_name,
      status: 'pending',
      created_at: nowIso(),
      accepted_at: null,
    };
    serverState.sharedAssetTransfers.unshift(transfer);
    broadcastRealtimeEvent('shared_asset_received', transfer);
    res.status(201).json(transfer);
  });

  router.post('/assistants/shared-assets/:id/accept', requireAuth, (req: Request, res: Response) => {
    const transfer = serverState.sharedAssetTransfers.find((t) => t.id === req.params.id);
    if (!transfer) {
      res.status(404).json({ detail: 'Item compartilhado não encontrado.' });
      return;
    }
    transfer.status = 'accepted';
    transfer.accepted_at = nowIso();
    broadcastRealtimeEvent('shared_asset_received', transfer);
    res.json({ transfer, installed_name: transfer.asset_name });
  });

  return router;
}
