import express, { Request, Response, Router } from 'express';
import {
  requireAuth,
  serverState,
  broadcastRealtimeEvent,
  nowIso,
  UserAccount,
} from '../serverState.ts';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';

export function createSyncRouter(deps?: { store?: LocalSqliteBrainStore }): Router {
  const router = express.Router();
  const store = deps?.store;

  /**
   * GET /api/v1/sync/delta?since=<ISO>
   * Retorna o estado sincronizável (agentes, sessões de chat, mídias, macros,
   * skills e status dos provedores de IA do Desktop) para espelhamento no Mobile.
   */
  router.get('/sync/delta', requireAuth, (req: Request, res: Response) => {
    const since = String(req.query.since || '').trim();
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const ownerUserId = user?.username || 'admin';

    const sessions = Array.from(serverState.chatSessions.values())
      .filter((s) => !since || s.last_activity > since)
      .slice(0, 60)
      .map((s) => ({
        session_id: s.session_id,
        title: s.title,
        first_prompt: s.first_prompt,
        last_activity: s.last_activity,
        messages_count: s.messages.length,
        messages: s.messages.slice(-40),
      }));

    const agents = serverState.agentsList
      .filter((a) => !since || a.updated_at > since)
      .map((a) => ({
        role: a.role,
        name: a.name,
        proper_name: a.proper_name,
        handle: a.handle,
        category: a.category,
        mission: a.mission,
        preferred_model: a.preferred_model,
        routing_policy: a.routing_policy,
        installed_skills: a.installed_skills || [],
        updated_at: a.updated_at,
      }));

    const skills = serverState.skillsList
      .filter((sk) => !since || (sk.updated_at && sk.updated_at > since))
      .map((sk) => ({
        id: sk.id,
        name: sk.name,
        domain: sk.domain,
        description: sk.description,
        is_approved: sk.is_approved,
        assigned_agents: sk.assigned_agents,
        updated_at: sk.updated_at,
      }));

    const rawMedia = ((serverState as Record<string, unknown>).mediaAssets ||
      (serverState as Record<string, unknown>).generatedImages ||
      []) as Array<Record<string, unknown>>;
    const media = rawMedia.slice(0, 40).map((img) => ({
      id: img.id,
      prompt: img.prompt,
      model: img.model,
      mime_type: img.mime_type,
      created_at: img.created_at,
      has_data: Boolean(img.data_url),
    }));

    res.json({
      sync_cursor: nowIso(),
      owner_user_id: ownerUserId,
      desktop_ai: {
        ollama_connected: Boolean(serverState.providerConnectivity?.ollama_connected),
        gemini_connected: Boolean(serverState.providerConnectivity?.gemini_connected),
        default_model: serverState.hybridConfig?.default_model || 'gemini-2.5-flash',
      },
      counts: {
        agents: agents.length,
        sessions: sessions.length,
        skills: skills.length,
        media: media.length,
      },
      agents,
      sessions,
      skills,
      media,
      paired_devices: serverState.pairedDevicesList.length,
      sqlite_ready: Boolean(store),
    });
  });

  /**
   * POST /api/v1/sync/delta
   * Recebe mensagens criadas offline no Mobile ou preferências sincronizadas
   * e persiste no Desktop, propagando via WebSocket /ws.
   */
  router.post('/sync/delta', requireAuth, (req: Request, res: Response) => {
    const incomingSessions = Array.isArray(req.body?.sessions) ? req.body.sessions : [];
    const incomingVoiceCalibration = req.body?.voice_calibration;
    let mergedSessions = 0;

    for (const s of incomingSessions) {
      const sid = String(s?.session_id || '').trim();
      if (!sid) continue;
      const existing = serverState.chatSessions.get(sid);
      const msgs = Array.isArray(s.messages) ? s.messages : [];
      if (!existing) {
        serverState.chatSessions.set(sid, {
          session_id: sid,
          title: String(s.title || 'Conversa Mobile').slice(0, 120),
          first_prompt: String(s.first_prompt || msgs[0]?.content || '').slice(0, 200),
          first_intent: 'mobile_sync',
          last_activity: String(s.last_activity || nowIso()),
          messages: msgs,
          tasks: [],
        });
        mergedSessions += 1;
      } else if (msgs.length > existing.messages.length) {
        existing.messages = msgs;
        existing.last_activity = String(s.last_activity || nowIso());
        mergedSessions += 1;
      }
    }

    if (incomingVoiceCalibration && typeof incomingVoiceCalibration === 'object') {
      broadcastRealtimeEvent('voice_calibration_synced', incomingVoiceCalibration);
    }

    broadcastRealtimeEvent('sync_delta_applied', {
      merged_sessions: mergedSessions,
      cursor: nowIso(),
    });

    res.json({
      ok: true,
      merged_sessions: mergedSessions,
      sync_cursor: nowIso(),
    });
  });

  return router;
}

