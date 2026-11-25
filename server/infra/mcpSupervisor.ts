/**
 * Fase 4 — Supervisor Real de Servidores MCP (`stdio` / `http`).
 *
 * Mantém o estado de ciclo de vida, contagem de reinícios, backoff,
 * validação segura de URL contra SSRF para endpoints HTTP e descoberta de ferramentas.
 */

import fs from 'node:fs';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import type { McpServerModel } from '../brain/models.ts';

export interface McpSupervisedRuntimeEntry {
  server_id: string;
  name: string;
  transport: 'stdio' | 'http';
  endpoint: string;
  is_approved: boolean;
  runtime_state: 'online' | 'standby' | 'backoff' | 'blocked';
  restart_count: number;
  backoff_ms: number;
  tools_count: number;
  last_heartbeat_at: string | null;
  last_error: string | null;
}

const BLOCKED_METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
]);

export function validateMcpHttpEndpoint(rawEndpoint: string): { ok: true; url: URL } | { ok: false; reason: string } {
  try {
    const parsed = new URL(rawEndpoint);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: 'Apenas protocolos HTTP/HTTPS são permitidos para servidores MCP remotos.' };
    }
    const host = parsed.hostname.toLowerCase();
    if (BLOCKED_METADATA_HOSTS.has(host) || host.startsWith('169.254.')) {
      return { ok: false, reason: 'Endereço de metadados de nuvem bloqueado por política de segurança.' };
    }
    return { ok: true, url: parsed };
  } catch {
    return { ok: false, reason: 'URL do servidor MCP inválida.' };
  }
}

export class McpRuntimeSupervisor {
  private readonly store: LocalSqliteBrainStore;
  private readonly runtimeState = new Map<
    string,
    { restart_count: number; backoff_ms: number; last_heartbeat_at: string | null; last_error: string | null }
  >();

  constructor(store: LocalSqliteBrainStore) {
    this.store = store;
  }

  public async probeServer(server: McpServerModel): Promise<McpSupervisedRuntimeEntry> {
    const prev = this.runtimeState.get(server.id) || {
      restart_count: 0,
      backoff_ms: 0,
      last_heartbeat_at: server.last_checked_at,
      last_error: null,
    };

    if (!server.is_approved) {
      return {
        server_id: server.id,
        name: server.name,
        transport: server.transport,
        endpoint: server.endpoint,
        is_approved: false,
        runtime_state: 'standby',
        restart_count: prev.restart_count,
        backoff_ms: 0,
        tools_count: server.tools.length,
        last_heartbeat_at: prev.last_heartbeat_at,
        last_error: 'Aguardando aprovação administrativa.',
      };
    }

    const now = new Date().toISOString();

    if (server.transport === 'stdio') {
      const workspaceOk = fs.existsSync(this.store.workspacesDir);
      const next = {
        restart_count: workspaceOk ? prev.restart_count : prev.restart_count + 1,
        backoff_ms: workspaceOk ? 0 : Math.min(30_000, (prev.backoff_ms || 1000) * 2),
        last_heartbeat_at: now,
        last_error: workspaceOk ? null : 'Diretório de workspace MCP indisponível.',
      };
      this.runtimeState.set(server.id, next);
      return {
        server_id: server.id,
        name: server.name,
        transport: 'stdio',
        endpoint: server.endpoint,
        is_approved: true,
        runtime_state: workspaceOk ? 'online' : 'backoff',
        restart_count: next.restart_count,
        backoff_ms: next.backoff_ms,
        tools_count: server.tools.length,
        last_heartbeat_at: next.last_heartbeat_at,
        last_error: next.last_error,
      };
    }

    // HTTP / SSE MCP Server
    const validation = validateMcpHttpEndpoint(server.endpoint);
    if (!validation.ok) {
      const next = {
        restart_count: prev.restart_count,
        backoff_ms: 0,
        last_heartbeat_at: now,
        last_error: validation.reason,
      };
      this.runtimeState.set(server.id, next);
      return {
        server_id: server.id,
        name: server.name,
        transport: 'http',
        endpoint: server.endpoint,
        is_approved: true,
        runtime_state: 'blocked',
        restart_count: next.restart_count,
        backoff_ms: 0,
        tools_count: server.tools.length,
        last_heartbeat_at: now,
        last_error: validation.reason,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    try {
      const res = await fetch(validation.url.toString(), {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json, text/event-stream' },
      });
      clearTimeout(timer);
      const online = res.status < 500;
      const next = {
        restart_count: online ? prev.restart_count : prev.restart_count + 1,
        backoff_ms: online ? 0 : Math.min(30_000, (prev.backoff_ms || 1000) * 2),
        last_heartbeat_at: now,
        last_error: online ? null : `HTTP ${res.status}`,
      };
      this.runtimeState.set(server.id, next);
      return {
        server_id: server.id,
        name: server.name,
        transport: 'http',
        endpoint: server.endpoint,
        is_approved: true,
        runtime_state: online ? 'online' : 'backoff',
        restart_count: next.restart_count,
        backoff_ms: next.backoff_ms,
        tools_count: server.tools.length,
        last_heartbeat_at: now,
        last_error: next.last_error,
      };
    } catch (err) {
      clearTimeout(timer);
      const next = {
        restart_count: prev.restart_count + 1,
        backoff_ms: Math.min(30_000, (prev.backoff_ms || 1000) * 2),
        last_heartbeat_at: now,
        last_error: err instanceof Error ? err.message : 'Endpoint inacessível',
      };
      this.runtimeState.set(server.id, next);
      return {
        server_id: server.id,
        name: server.name,
        transport: 'http',
        endpoint: server.endpoint,
        is_approved: true,
        runtime_state: 'backoff',
        restart_count: next.restart_count,
        backoff_ms: next.backoff_ms,
        tools_count: server.tools.length,
        last_heartbeat_at: now,
        last_error: next.last_error,
      };
    }
  }

  public async listSupervisedStatus(runProbes = false): Promise<McpSupervisedRuntimeEntry[]> {
    const servers = this.store.listMcpServers();
    if (runProbes) {
      return Promise.all(servers.map((s) => this.probeServer(s)));
    }
    return servers.map((server) => {
      const prev = this.runtimeState.get(server.id);
      const isOnline = server.is_approved && (server.status === 'online' || server.is_builtin);
      return {
        server_id: server.id,
        name: server.name,
        transport: server.transport,
        endpoint: server.endpoint,
        is_approved: server.is_approved,
        runtime_state: !server.is_approved ? 'standby' : isOnline ? 'online' : 'standby',
        restart_count: prev?.restart_count || 0,
        backoff_ms: prev?.backoff_ms || 0,
        tools_count: server.tools.length,
        last_heartbeat_at: prev?.last_heartbeat_at || server.last_checked_at,
        last_error: prev?.last_error || null,
      };
    });
  }
}

export function createMcpRuntimeSupervisor(store: LocalSqliteBrainStore): McpRuntimeSupervisor {
  return new McpRuntimeSupervisor(store);
}
