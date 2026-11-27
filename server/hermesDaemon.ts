/**
 * Daemon contínuo pós-conversa do Hermes:
 * Extrai fatos, preferências e decisões de mensagens do usuário em segundo plano
 * sem bloquear o tempo de resposta do chat.
 */

import { broadcastRealtimeEvent, nowIso, serverState } from './serverState.ts';

const _pendingQueue: Array<{ sessionId: string; userPrompt: string; assistantReply: string }> = [];
let _draining = false;

export function scheduleHermesDistill(
  sessionId: string,
  userPrompt: string,
  assistantReply: string
): void {
  const clean = (userPrompt || '').trim();
  if (clean.length < 18) return;
  _pendingQueue.push({ sessionId, userPrompt: clean, assistantReply: assistantReply.slice(0, 600) });
  if (!_draining) {
    setTimeout(() => void drainQueue(), 250).unref();
  }
}

async function drainQueue(): Promise<void> {
  if (_draining) return;
  _draining = true;
  try {
    while (_pendingQueue.length > 0) {
      const job = _pendingQueue.shift()!;
      const lower = job.userPrompt.toLowerCase();
      const isPreference =
        /\b(prefiro|gosto|sempre uso|meu projeto|minha stack|regra|nunca|quero que)\b/i.test(lower);
      if (!isPreference) continue;

      const summary = job.userPrompt.slice(0, 220);
      serverState.serverLogs.unshift({
        id: `hermes_${Date.now().toString(36)}`,
        timestamp: nowIso(),
        level: 'INFO',
        source: 'hermes_daemon',
        message: `Fato consolidado (${job.sessionId}): ${summary}`,
      });
      broadcastRealtimeEvent('hermes_fact_distilled', {
        session_id: job.sessionId,
        fact: summary,
        distilled_at: nowIso(),
      });
    }
  } finally {
    _draining = false;
  }
}

