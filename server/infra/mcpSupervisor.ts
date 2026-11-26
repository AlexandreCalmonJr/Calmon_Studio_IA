/**
 * Fase 4 + Prioridade 1 — Supervisor & Cliente JSON-RPC 2.0 Real de Servidores MCP (`stdio` / `http`).
 *
 * Mantém:
 *  - Proteção estrita contra SSRF (bloqueio de metadados, loopback e redes privadas RFC1918 por padrão)
 *  - Allowlist estrita para binários `stdio` com `shell: false` e ambiente mínimo isolado
 *  - Handshake e invocação real JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`) sobre HTTP/SSE e stdio
 *  - Contagem de reinícios, backoff exponencial e telemetria de ciclo de vida
 */

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import type { McpServerModel, McpToolDescriptor } from '../brain/models.ts';

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
  protocol_version?: string;
}

const BLOCKED_METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
]);

const ALLOWED_STDIO_BINARIES = new Set(['node', 'npx', 'python3', 'uvx']);
const FORBIDDEN_SHELL_META_RE = /[;&|`$><\n\r]/;

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h === '::') return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h.startsWith('127.') || h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('169.254.')) {
    return true;
  }
  const m172 = /^172\.(\d{1,3})\./.exec(h);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  // IPv6 ULA (fc00::/7) e link-local (fe80::/10)
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) return true;
  return false;
}

export function validateMcpHttpEndpoint(
  rawEndpoint: string,
  options?: { allowLocal?: boolean }
): { ok: true; url: URL } | { ok: false; reason: string } {
  try {
    const parsed = new URL(rawEndpoint);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: 'Apenas protocolos HTTP/HTTPS são permitidos para servidores MCP remotos.' };
    }
    const host = parsed.hostname.toLowerCase();
    if (BLOCKED_METADATA_HOSTS.has(host) || host.startsWith('169.254.')) {
      return { ok: false, reason: 'Endereço de metadados de nuvem bloqueado por política de segurança.' };
    }
    const allowLocal =
      options?.allowLocal === true || process.env.MCP_ALLOW_LOCAL_HTTP === 'true';
    if (!allowLocal && isPrivateOrLoopbackHost(host)) {
      return {
        ok: false,
        reason:
          'Endereços locais ou de rede privada são bloqueados por padrão em servidores MCP HTTP (configure MCP_ALLOW_LOCAL_HTTP=true se necessário).',
      };
    }
    return { ok: true, url: parsed };
  } catch {
    return { ok: false, reason: 'URL do servidor MCP inválida.' };
  }
}

/** Valida comando stdio sem uso de shell, restringindo estritamente à allowlist de runtimes MCP. */
export function validateMcpStdioCommand(
  rawEndpoint: string
): { ok: true; command: string; args: string[] } | { ok: false; reason: string } {
  const trimmed = String(rawEndpoint || '').trim();
  if (!trimmed) {
    return { ok: false, reason: 'Comando stdio MCP vazio.' };
  }
  if (FORBIDDEN_SHELL_META_RE.test(trimmed)) {
    return { ok: false, reason: 'Caracteres de controle de shell são bloqueados no transporte stdio.' };
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { ok: false, reason: 'Comando stdio MCP inválido.' };
  }
  const [command, ...args] = tokens;
  if (!ALLOWED_STDIO_BINARIES.has(command)) {
    return {
      ok: false,
      reason: `Binário "${command}" não está na allowlist MCP stdio (${Array.from(ALLOWED_STDIO_BINARIES).join(', ')}).`,
    };
  }
  if (args.some((a) => a.includes('..') || a.includes('\0'))) {
    return { ok: false, reason: 'Argumento stdio bloqueado por conter travessia de diretório.' };
  }
  return { ok: true, command, args };
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

function parseSseOrJsonRpcPayload(rawText: string, contentType: string): JsonRpcResponse | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;
  if (contentType.includes('text/event-stream') || trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
    const lines = trimmed.split(/\r?\n/);
    let lastParsed: JsonRpcResponse | null = null;
    for (const line of lines) {
      if (line.startsWith('data:')) {
        const dataStr = line.slice(5).trim();
        if (!dataStr || dataStr === '[DONE]') continue;
        try {
          lastParsed = JSON.parse(dataStr) as JsonRpcResponse;
        } catch {
          // ignora frames SSE não-JSON
        }
      }
    }
    return lastParsed;
  }
  try {
    return JSON.parse(trimmed) as JsonRpcResponse;
  } catch {
    return null;
  }
}

async function callHttpMcpJsonRpc(
  endpointUrl: URL,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 6_000,
  sessionId?: string
): Promise<{ result: Record<string, unknown>; sessionId?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const rpcId = Math.floor(Math.random() * 100_000) + 1;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;

    const res = await fetch(endpointUrl.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: rpcId,
        method,
        params,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const nextSessionId = res.headers.get('mcp-session-id') || sessionId;
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`Servidor MCP HTTP respondeu ${res.status}: ${rawText.slice(0, 140)}`);
    }
    const parsed = parseSseOrJsonRpcPayload(rawText, res.headers.get('content-type') || '');
    if (!parsed) {
      throw new Error('Resposta MCP inválida (JSON-RPC 2.0 não reconhecido).');
    }
    if (parsed.error) {
      throw new Error(`MCP JSON-RPC erro ${parsed.error.code ?? ''}: ${parsed.error.message || 'falha remota'}`);
    }
    return { result: parsed.result || {}, sessionId: nextSessionId };
  } finally {
    clearTimeout(timer);
  }
}

async function callStdioMcpJsonRpc(
  command: string,
  args: string[],
  method: string,
  params: Record<string, unknown>,
  cwd: string,
  timeoutMs = 7_000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const safeEnv: Record<string, string> = {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME || cwd,
      NODE_ENV: process.env.NODE_ENV || 'production',
    };

    const child = spawn(command, args, {
      cwd,
      shell: false,
      env: safeEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let settled = false;
    let stdoutBuffer = '';
    let stderrExcerpt = '';

    const finish = (err?: Error, value?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.stdin?.end();
      } catch {
        // ignore
      }
      try {
        if (!child.killed) child.kill('SIGKILL');
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve(value || {});
    };

    const timer = setTimeout(() => {
      finish(new Error(`Timeout (${timeoutMs} ms) aguardando resposta JSON-RPC do processo MCP stdio.`));
    }, timeoutMs);

    child.on('error', (err) => {
      finish(new Error(`Falha ao iniciar processo MCP stdio: ${err.message}`));
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrExcerpt.length < 400) {
        stderrExcerpt += chunk.toString('utf8');
      }
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8');
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as JsonRpcResponse;
          if (msg.id === 2) {
            if (msg.error) {
              finish(new Error(`MCP stdio erro ${msg.error.code ?? ''}: ${msg.error.message || 'falha'}`));
              return;
            }
            finish(undefined, msg.result || {});
            return;
          }
        } catch {
          // ignora logs não-JSON no stdout
        }
      }
    });

    child.on('close', (code) => {
      if (!settled) {
        finish(
          new Error(
            `Processo MCP stdio encerrou (código ${code ?? 'nulo'}) antes de responder${stderrExcerpt ? `: ${stderrExcerpt.trim().slice(0, 140)}` : ''}.`
          )
        );
      }
    });

    // Sequência oficial MCP JSON-RPC 2.0: initialize -> notifications/initialized -> método alvo
    const initMsg = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'jarvis-hub-mcp-client', version: '1.0.0' },
      },
    });
    const initializedNotif = JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    });
    const targetMsg = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method,
      params,
    });

    child.stdin?.write(`${initMsg}\n${initializedNotif}\n${targetMsg}\n`);
  });
}

function mapRawMcpTools(rawTools: unknown): McpToolDescriptor[] {
  if (!Array.isArray(rawTools)) return [];
  return rawTools
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && typeof (item as any).name === 'string'))
    .slice(0, 100)
    .map((tool) => ({
      name: String(tool.name).slice(0, 120),
      description: String(tool.description || 'Ferramenta descoberta via protocolo MCP JSON-RPC 2.0').slice(0, 260),
      requires_approval: false,
      input_hint:
        tool.inputSchema && typeof tool.inputSchema === 'object'
          ? JSON.stringify(tool.inputSchema).slice(0, 240)
          : '{}',
    }));
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

  public async discoverTools(
    server: McpServerModel,
    options?: { allowLocalHttp?: boolean; timeoutMs?: number }
  ): Promise<{ status: 'online' | 'standby' | 'blocked'; tools: McpToolDescriptor[]; detail: string }> {
    const now = new Date().toISOString();
    const prev = this.runtimeState.get(server.id) || {
      restart_count: 0,
      backoff_ms: 0,
      last_heartbeat_at: server.last_checked_at,
      last_error: null,
    };

    if (server.is_builtin) {
      this.runtimeState.set(server.id, {
        restart_count: prev.restart_count,
        backoff_ms: 0,
        last_heartbeat_at: now,
        last_error: null,
      });
      return {
        status: 'online',
        tools: server.tools,
        detail: `${server.tools.length} ferramenta(s) nativas prontas para execução.`,
      };
    }

    if (server.transport === 'http') {
      const validation = validateMcpHttpEndpoint(server.endpoint, { allowLocal: options?.allowLocalHttp });
      if (!validation.ok) {
        this.runtimeState.set(server.id, {
          restart_count: prev.restart_count,
          backoff_ms: 0,
          last_heartbeat_at: now,
          last_error: validation.reason,
        });
        return { status: 'blocked', tools: server.tools, detail: validation.reason };
      }

      try {
        let sessionId: string | undefined;
        try {
          const initRes = await callHttpMcpJsonRpc(
            validation.url,
            'initialize',
            {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'jarvis-hub-mcp-client', version: '1.0.0' },
            },
            options?.timeoutMs ?? 5_000
          );
          sessionId = initRes.sessionId;
        } catch {
          // Alguns endpoints HTTP stateless aceitam tools/list direto sem initialize prévio
        }
        const listRes = await callHttpMcpJsonRpc(
          validation.url,
          'tools/list',
          {},
          options?.timeoutMs ?? 5_000,
          sessionId
        );
        const tools = mapRawMcpTools(listRes.result.tools);
        try {
          this.store.updateMcpServerDiscovery(server.id, 'online', tools);
        } catch {
          // Mantém resposta online mesmo se o registro for efêmero
        }
        this.runtimeState.set(server.id, {
          restart_count: prev.restart_count,
          backoff_ms: 0,
          last_heartbeat_at: now,
          last_error: null,
        });
        return {
          status: 'online',
          tools,
          detail: `${tools.length} ferramenta(s) descobertas via MCP JSON-RPC 2.0 (HTTP).`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Falha ao consultar tools/list remoto.';
        this.runtimeState.set(server.id, {
          restart_count: prev.restart_count + 1,
          backoff_ms: Math.min(30_000, (prev.backoff_ms || 1000) * 2),
          last_heartbeat_at: now,
          last_error: msg,
        });
        return { status: 'standby', tools: server.tools, detail: msg };
      }
    }

    // Transporte stdio externo real via JSON-RPC 2.0
    const cmdCheck = validateMcpStdioCommand(server.endpoint);
    if (!cmdCheck.ok) {
      this.runtimeState.set(server.id, {
        restart_count: prev.restart_count,
        backoff_ms: 0,
        last_heartbeat_at: now,
        last_error: cmdCheck.reason,
      });
      return { status: 'blocked', tools: server.tools, detail: cmdCheck.reason };
    }

    try {
      const result = await callStdioMcpJsonRpc(
        cmdCheck.command,
        cmdCheck.args,
        'tools/list',
        {},
        this.store.workspacesDir,
        options?.timeoutMs ?? 7_000
      );
      const tools = mapRawMcpTools(result.tools);
      try {
        this.store.updateMcpServerDiscovery(server.id, 'online', tools);
      } catch {
        // Mantém resposta online mesmo se o registro for efêmero
      }
      this.runtimeState.set(server.id, {
        restart_count: prev.restart_count,
        backoff_ms: 0,
        last_heartbeat_at: now,
        last_error: null,
      });
      return {
        status: 'online',
        tools,
        detail: `${tools.length} ferramenta(s) descobertas via MCP JSON-RPC 2.0 (stdio).`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao consultar tools/list via stdio.';
      this.runtimeState.set(server.id, {
        restart_count: prev.restart_count + 1,
        backoff_ms: Math.min(30_000, (prev.backoff_ms || 1000) * 2),
        last_heartbeat_at: now,
        last_error: msg,
      });
      return { status: 'standby', tools: server.tools, detail: msg };
    }
  }

  public async invokeTool(
    server: McpServerModel,
    toolName: string,
    args: Record<string, unknown>,
    options?: { allowLocalHttp?: boolean; timeoutMs?: number }
  ): Promise<{ output: Record<string, unknown>; summary: string }> {
    if (!server.is_approved) {
      throw new Error('Servidor MCP não aprovado para invocação de ferramentas.');
    }
    const cleanTool = String(toolName || '').trim();
    if (!cleanTool) {
      throw new Error('Informe o nome da ferramenta MCP a ser invocada.');
    }

    const now = new Date().toISOString();
    const prev = this.runtimeState.get(server.id) || {
      restart_count: 0,
      backoff_ms: 0,
      last_heartbeat_at: server.last_checked_at,
      last_error: null,
    };

    let result: Record<string, unknown>;
    if (server.transport === 'http') {
      const validation = validateMcpHttpEndpoint(server.endpoint, { allowLocal: options?.allowLocalHttp });
      if (!validation.ok) {
        throw new Error(validation.reason);
      }
      const rpcRes = await callHttpMcpJsonRpc(
        validation.url,
        'tools/call',
        { name: cleanTool, arguments: args || {} },
        options?.timeoutMs ?? 8_000
      );
      result = rpcRes.result;
    } else {
      const cmdCheck = validateMcpStdioCommand(server.endpoint);
      if (!cmdCheck.ok) {
        throw new Error(cmdCheck.reason);
      }
      result = await callStdioMcpJsonRpc(
        cmdCheck.command,
        cmdCheck.args,
        'tools/call',
        { name: cleanTool, arguments: args || {} },
        this.store.workspacesDir,
        options?.timeoutMs ?? 8_000
      );
    }

    this.runtimeState.set(server.id, {
      restart_count: prev.restart_count,
      backoff_ms: 0,
      last_heartbeat_at: now,
      last_error: null,
    });

    const contentArray = Array.isArray(result.content) ? result.content : [];
    const textSnippet = contentArray
      .filter((c): c is { type?: string; text?: string } => Boolean(c && typeof c === 'object'))
      .map((c) => (typeof c.text === 'string' ? c.text : ''))
      .filter(Boolean)
      .join(' ')
      .trim();

    const summary = textSnippet
      ? `${cleanTool}: ${textSnippet.slice(0, 220)}`
      : `Ferramenta "${cleanTool}" executada via MCP JSON-RPC 2.0 (${server.transport.toUpperCase()}).`;

    return { output: result, summary };
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
        protocol_version: 'JSON-RPC 2.0',
      };
    }

    const now = new Date().toISOString();

    if (server.transport === 'stdio') {
      if (server.is_builtin) {
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
          protocol_version: 'JSON-RPC 2.0',
        };
      }

      const cmdCheck = validateMcpStdioCommand(server.endpoint);
      if (!cmdCheck.ok) {
        const next = {
          restart_count: prev.restart_count,
          backoff_ms: 0,
          last_heartbeat_at: now,
          last_error: cmdCheck.reason,
        };
        this.runtimeState.set(server.id, next);
        return {
          server_id: server.id,
          name: server.name,
          transport: 'stdio',
          endpoint: server.endpoint,
          is_approved: true,
          runtime_state: 'blocked',
          restart_count: next.restart_count,
          backoff_ms: 0,
          tools_count: server.tools.length,
          last_heartbeat_at: now,
          last_error: cmdCheck.reason,
          protocol_version: 'JSON-RPC 2.0',
        };
      }

      const disc = await this.discoverTools(server, { timeoutMs: 2_500 });
      const latest = this.runtimeState.get(server.id) || prev;
      return {
        server_id: server.id,
        name: server.name,
        transport: 'stdio',
        endpoint: server.endpoint,
        is_approved: true,
        runtime_state: disc.status === 'online' ? 'online' : disc.status === 'blocked' ? 'blocked' : 'backoff',
        restart_count: latest.restart_count,
        backoff_ms: latest.backoff_ms,
        tools_count: disc.tools.length,
        last_heartbeat_at: latest.last_heartbeat_at,
        last_error: latest.last_error,
        protocol_version: 'JSON-RPC 2.0',
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
        protocol_version: 'JSON-RPC 2.0',
      };
    }

    const disc = await this.discoverTools(server, { timeoutMs: 2_000 });
    const latest = this.runtimeState.get(server.id) || prev;
    return {
      server_id: server.id,
      name: server.name,
      transport: 'http',
      endpoint: server.endpoint,
      is_approved: true,
      runtime_state: disc.status === 'online' ? 'online' : disc.status === 'blocked' ? 'blocked' : 'backoff',
      restart_count: latest.restart_count,
      backoff_ms: latest.backoff_ms,
      tools_count: disc.tools.length,
      last_heartbeat_at: latest.last_heartbeat_at,
      last_error: latest.last_error,
      protocol_version: 'JSON-RPC 2.0',
    };
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
        protocol_version: 'JSON-RPC 2.0',
      };
    });
  }
}

export function createMcpRuntimeSupervisor(store: LocalSqliteBrainStore): McpRuntimeSupervisor {
  return new McpRuntimeSupervisor(store);
}
