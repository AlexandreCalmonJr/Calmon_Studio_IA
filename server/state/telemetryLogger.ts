/**
 * Utilitários de telemetria, logs do servidor e broadcast em tempo real via WebSocket.
 */
import crypto from 'node:crypto';
import { WebSocket } from 'ws';

export const realtimeClients = new Set<WebSocket>();

export function broadcastRealtimeEvent(type: string, payload: unknown): void {
  const frame = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  realtimeClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(frame);
      } catch {
        // ignore dropped socket
      }
    }
  });
}

export interface ServerLogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARNING' | 'ERROR';
  source: string;
  message: string;
}

export function createServerLogEntry(
  level: 'INFO' | 'WARNING' | 'ERROR',
  source: string,
  message: string
): ServerLogEntry {
  return {
    id: `log_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
  };
}
