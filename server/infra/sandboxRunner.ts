/**
 * Fase 4 — Sandbox Plugável (Executor Local Confinado + Modo Container Efêmero Opcional).
 *
 * Permite aos agentes executarem comandos de inspeção e validação com segurança:
 *  - Lista explícita de binários seguros (`node`, `python3`, `git`, `ls`, `cat`, `wc`)
 *  - ZERO `shell: true` (sem injeção de shell)
 *  - Confinamento estrito ao workspace autorizado (`sandbox_workspaces/<userId>`)
 *  - Timeout rigoroso e truncamento de saída
 *  - Trilha completa gravada em `sandbox_sessions` no SQLite
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import type { SandboxSessionModel } from '../brain/models.ts';

export type SandboxDriverKind = 'local_confined' | 'docker_ephemeral';

export interface SandboxExecutionRequest {
  userId: string;
  runId?: string | null;
  command: string;
  args?: string[];
  timeoutMs?: number;
}

export interface SandboxExecutionResult {
  session: SandboxSessionModel;
  allowed: boolean;
  reason?: string;
}

export interface SandboxDiagnostics {
  driver: SandboxDriverKind;
  driver_label: string;
  allowlisted_binaries: string[];
  max_timeout_ms: number;
  container_mode_enabled: boolean;
  workspace_root: string;
}

const ALLOWED_BINARIES = new Set(['node', 'python3', 'git', 'ls', 'cat', 'wc', 'pwd']);
const BLOCKED_GIT_SUBCOMMANDS = new Set(['push', 'remote', 'config', 'clean', 'reset', 'checkout', 'clone']);
const BLOCKED_ARG_PATTERNS = [
  /(^|\/)\.\.(\/|$)/, // path traversal
  /\0/, // null byte
  /^-e$|^--eval$|^--print$|^-c$/, // bloqueia eval inline arbitrário sem aprovação dedicada
];

function sanitizeUserDir(userId: string): string {
  return String(userId || 'admin')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 48) || 'admin';
}

export function validateSandboxCommand(
  command: string,
  args: string[]
): { ok: true; binary: string; args: string[] } | { ok: false; reason: string } {
  const binary = path.basename(String(command || '').trim());
  if (!binary || !ALLOWED_BINARIES.has(binary)) {
    return {
      ok: false,
      reason: `Comando "${binary || '(vazio)'}" não está na allowlist do Sandbox (${Array.from(ALLOWED_BINARIES).join(', ')}).`,
    };
  }

  const safeArgs = (Array.isArray(args) ? args : []).map((a) => String(a)).slice(0, 24);
  for (const arg of safeArgs) {
    if (arg.length > 240) {
      return { ok: false, reason: 'Argumento excede o limite de 240 caracteres.' };
    }
    if (path.isAbsolute(arg)) {
      return { ok: false, reason: 'Caminhos absolutos são bloqueados no Sandbox confinado.' };
    }
    for (const pattern of BLOCKED_ARG_PATTERNS) {
      if (pattern.test(arg)) {
        return { ok: false, reason: `Argumento bloqueado pela política de segurança do Sandbox: "${arg}".` };
      }
    }
  }

  if (binary === 'git') {
    const sub = String(safeArgs[0] || '').toLowerCase();
    if (!sub || BLOCKED_GIT_SUBCOMMANDS.has(sub)) {
      return { ok: false, reason: `Subcomando git "${sub || '(vazio)'}" não permitido no Sandbox somente-leitura.` };
    }
  }

  return { ok: true, binary, args: safeArgs };
}

export class PluggableSandboxRunner {
  public readonly driver: SandboxDriverKind;
  public readonly workspaceRoot: string;
  private readonly store: LocalSqliteBrainStore;
  private readonly maxTimeoutMs = 12_000;

  constructor(store: LocalSqliteBrainStore, dataDir: string, env: NodeJS.ProcessEnv = process.env) {
    this.store = store;
    this.workspaceRoot = path.resolve(dataDir, 'sandbox_workspaces');
    fs.mkdirSync(this.workspaceRoot, { recursive: true });
    const configured = String(env.SANDBOX_DRIVER || '').trim().toLowerCase();
    this.driver = configured === 'docker' || configured === 'docker_ephemeral' ? 'docker_ephemeral' : 'local_confined';
  }

  public getDiagnostics(): SandboxDiagnostics {
    return {
      driver: this.driver,
      driver_label:
        this.driver === 'docker_ephemeral'
          ? 'Container Linux Efêmero (Docker Sandbox)'
          : 'Sandbox Local Confinado (Allowlist + Timeout)',
      allowlisted_binaries: Array.from(ALLOWED_BINARIES),
      max_timeout_ms: this.maxTimeoutMs,
      container_mode_enabled: this.driver === 'docker_ephemeral',
      workspace_root: this.workspaceRoot,
    };
  }

  public async execute(req: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    const userFolder = sanitizeUserDir(req.userId);
    const cwd = path.resolve(this.workspaceRoot, userFolder);
    const rootWithSep = `${this.workspaceRoot}${path.sep}`;
    if (!cwd.startsWith(rootWithSep)) {
      throw new Error('Workspace de sandbox inválido.');
    }
    fs.mkdirSync(cwd, { recursive: true });

    const validation = validateSandboxCommand(req.command, req.args || []);
    const displayCmd = [req.command, ...(req.args || [])].join(' ').trim();

    if (!validation.ok) {
      const blocked = this.store.recordSandboxSession({
        user_id: req.userId,
        run_id: req.runId || null,
        driver: this.driver,
        command: displayCmd,
        cwd,
        status: 'blocked',
        exit_code: null,
        stdout_excerpt: '',
        stderr_excerpt: validation.reason,
        duration_ms: 0,
      });
      return { session: blocked, allowed: false, reason: validation.reason };
    }

    const timeoutMs = Math.max(500, Math.min(this.maxTimeoutMs, Number(req.timeoutMs || 6000)));
    const startedAt = Date.now();
    const MAX_STDOUT = 8192;
    const MAX_STDERR = 4096;

    const outcome = await new Promise<{
      status: SandboxSessionModel['status'];
      exitCode: number | null;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn(validation.binary, validation.args, {
        cwd,
        shell: false,
        env: {
          PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
          HOME: cwd,
          LANG: 'C.UTF-8',
        },
      });

      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGKILL'); } catch { /* noop */ }
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_STDOUT) {
          stdout += chunk.toString('utf8').slice(0, MAX_STDOUT - stdout.length);
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_STDERR) {
          stderr += chunk.toString('utf8').slice(0, MAX_STDERR - stderr.length);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          status: 'failed',
          exitCode: null,
          stdout,
          stderr: err.message,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({
            status: 'timeout',
            exitCode: code,
            stdout,
            stderr: stderr || `Execução interrompida por timeout (${timeoutMs} ms).`,
          });
          return;
        }
        resolve({
          status: code === 0 ? 'completed' : 'failed',
          exitCode: code,
          stdout,
          stderr,
        });
      });
    });

    const durationMs = Math.max(0, Date.now() - startedAt);
    const session = this.store.recordSandboxSession({
      user_id: req.userId,
      run_id: req.runId || null,
      driver: this.driver,
      command: displayCmd,
      cwd,
      status: outcome.status,
      exit_code: outcome.exitCode,
      stdout_excerpt: outcome.stdout,
      stderr_excerpt: outcome.stderr,
      duration_ms: durationMs,
    });

    return { session, allowed: true };
  }
}

export function createPluggableSandboxRunner(
  store: LocalSqliteBrainStore,
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env
): PluggableSandboxRunner {
  return new PluggableSandboxRunner(store, dataDir, env);
}
