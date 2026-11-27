/**
 * Fase 4 + Prioridade 2 — Sandbox Plugável (Local Confinado + Container Docker Linux Efêmero Real).
 *
 * Permite aos agentes executarem comandos de inspeção e validação com segurança:
 *  - Modo `local_confined` (padrão zero-setup): allowlist estrita, ZERO `shell: true`, confinamento por `user_id`
 *  - Modo `docker_ephemeral` (`SANDBOX_DRIVER=docker_ephemeral`): container Linux descartável real (`docker run --rm`)
 *    com `--network=none`, `--read-only`, `--cap-drop=ALL`, `--security-opt=no-new-privileges:true`,
 *    `--pids-limit=64`, `--memory=256m`, `--cpus=0.5`, `--user=65534:65534` e bind mount somente-leitura (`:ro`).
 *  - Trilha completa gravada em `sandbox_sessions` no SQLite.
 */

import { spawn, type ChildProcess } from 'node:child_process';
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
  docker_image: string;
  docker_available: boolean | null;
  docker_version: string | null;
  isolation_flags: string[];
  workspace_root: string;
}

const ALLOWED_BINARIES = new Set(['node', 'python3', 'git', 'ls', 'cat', 'wc', 'pwd']);
const BLOCKED_GIT_SUBCOMMANDS = new Set(['push', 'remote', 'config', 'clean', 'reset', 'checkout', 'clone']);
const BLOCKED_ARG_PATTERNS = [
  /(^|\/)\.\.(\/|$)/, // path traversal
  /\0/, // null byte
  /^-e$|^--eval$|^--print$|^-c$/, // bloqueia eval inline arbitrário sem aprovação dedicada
];

const SAFE_DOCKER_IMAGE_RE = /^[a-z0-9][a-z0-9._/-]{1,96}:[a-z0-9._-]{1,48}$/i;
const DEFAULT_DOCKER_IMAGE = 'node:22-alpine';

export const HARDENED_DOCKER_ISOLATION_FLAGS = [
  '--rm',
  '--network=none',
  '--read-only',
  '--cap-drop=ALL',
  '--security-opt=no-new-privileges:true',
  '--pids-limit=64',
  '--memory=256m',
  '--cpus=0.5',
  '--user=65534:65534',
];

function sanitizeUserDir(userId: string): string {
  return String(userId || 'admin')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 48) || 'admin';
}

export function resolveSafeDockerImage(rawImage?: string): string {
  const candidate = String(rawImage || '').trim();
  if (candidate && SAFE_DOCKER_IMAGE_RE.test(candidate) && !candidate.includes('..')) {
    return candidate;
  }
  return DEFAULT_DOCKER_IMAGE;
}

export function buildDockerRunArgs(params: {
  image: string;
  hostWorkspaceDir: string;
  binary: string;
  args: string[];
}): string[] {
  const safeImage = resolveSafeDockerImage(params.image);
  return [
    'run',
    ...HARDENED_DOCKER_ISOLATION_FLAGS,
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m',
    '-v',
    `${params.hostWorkspaceDir}:/workspace:ro`,
    '-w',
    '/workspace',
    safeImage,
    params.binary,
    ...params.args,
  ];
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

type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; shell: false; env?: Record<string, string> }
) => ChildProcess;

export async function probeDockerDaemon(
  timeoutMs = 1500,
  spawnImpl: SpawnFn = spawn as unknown as SpawnFn
): Promise<{ available: boolean; version: string | null; detail: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const done = (res: { available: boolean; version: string | null; detail: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };

    let child: ChildProcess;
    try {
      child = spawnImpl('docker', ['version', '--format', '{{.Server.Version}}'], {
        shell: false,
        env: { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin' },
      });
    } catch (err) {
      done({
        available: false,
        version: null,
        detail: err instanceof Error ? err.message : 'Docker CLI indisponível',
      });
      return;
    }

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* noop */ }
      done({ available: false, version: null, detail: 'Timeout ao sondar daemon Docker.' });
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => {
      done({ available: false, version: null, detail: 'Docker CLI não instalado neste host.' });
    });
    child.on('close', (code) => {
      const ver = stdout.trim();
      if (code === 0 && ver) {
        done({ available: true, version: ver, detail: `Docker Engine ${ver} ativo` });
      } else {
        done({ available: false, version: null, detail: 'Daemon Docker não está respondendo neste host.' });
      }
    });
  });
}

export class PluggableSandboxRunner {
  public readonly driver: SandboxDriverKind;
  public readonly workspaceRoot: string;
  public readonly dockerImage: string;
  private readonly store: LocalSqliteBrainStore;
  private readonly maxTimeoutMs = 12_000;
  private readonly spawnImpl: SpawnFn;
  private readonly allowLocalFallbackOnDockerMissing: boolean;
  private lastDockerProbe: { available: boolean; version: string | null } | null = null;

  constructor(
    store: LocalSqliteBrainStore,
    dataDir: string,
    env: NodeJS.ProcessEnv = process.env,
    opts?: { spawnImpl?: SpawnFn }
  ) {
    this.store = store;
    this.workspaceRoot = path.resolve(dataDir, 'sandbox_workspaces');
    fs.mkdirSync(this.workspaceRoot, { recursive: true });
    const configured = String(env.SANDBOX_DRIVER || '').trim().toLowerCase();
    this.driver =
      configured === 'docker' || configured === 'docker_ephemeral'
        ? 'docker_ephemeral'
        : 'local_confined';
    this.dockerImage = resolveSafeDockerImage(env.SANDBOX_DOCKER_IMAGE);
    this.allowLocalFallbackOnDockerMissing = env.SANDBOX_DOCKER_FALLBACK_LOCAL === 'true';
    this.spawnImpl = opts?.spawnImpl || (spawn as unknown as SpawnFn);
  }

  public getDiagnostics(): SandboxDiagnostics {
    return {
      driver: this.driver,
      driver_label:
        this.driver === 'docker_ephemeral'
          ? `Container Linux Efêmero (${this.dockerImage})`
          : 'Sandbox Local Confinado (Allowlist + Timeout)',
      allowlisted_binaries: Array.from(ALLOWED_BINARIES),
      max_timeout_ms: this.maxTimeoutMs,
      container_mode_enabled: this.driver === 'docker_ephemeral',
      docker_image: this.dockerImage,
      docker_available: this.lastDockerProbe ? this.lastDockerProbe.available : null,
      docker_version: this.lastDockerProbe ? this.lastDockerProbe.version : null,
      isolation_flags: [...HARDENED_DOCKER_ISOLATION_FLAGS],
      workspace_root: this.workspaceRoot,
    };
  }

  public async getDiagnosticsAsync(probeDocker = false): Promise<SandboxDiagnostics> {
    if (probeDocker) {
      const probe = await probeDockerDaemon(1500, this.spawnImpl);
      this.lastDockerProbe = { available: probe.available, version: probe.version };
    }
    return this.getDiagnostics();
  }

  private runProcess(
    execBinary: string,
    execArgs: string[],
    cwd: string,
    timeoutMs: number
  ): Promise<{
    status: SandboxSessionModel['status'];
    exitCode: number | null;
    stdout: string;
    stderr: string;
    spawnErrorCode?: string;
  }> {
    const MAX_STDOUT = 8192;
    const MAX_STDERR = 4096;

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = this.spawnImpl(execBinary, execArgs, {
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

      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        resolve({
          status: 'failed',
          exitCode: null,
          stdout,
          stderr: err.message,
          spawnErrorCode: err.code,
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
      const reason = 'reason' in validation ? validation.reason : 'Bloqueado';
      const blocked = this.store.recordSandboxSession({
        user_id: req.userId,
        run_id: req.runId || null,
        driver: this.driver,
        command: displayCmd,
        cwd,
        status: 'blocked',
        exit_code: null,
        stdout_excerpt: '',
        stderr_excerpt: reason,
        duration_ms: 0,
      });
      return { session: blocked, allowed: false, reason };
    }

    const timeoutMs = Math.max(500, Math.min(this.maxTimeoutMs, Number(req.timeoutMs || 6000)));
    const startedAt = Date.now();
    let effectiveDriver: SandboxDriverKind = this.driver;

    let outcome: {
      status: SandboxSessionModel['status'];
      exitCode: number | null;
      stdout: string;
      stderr: string;
      spawnErrorCode?: string;
    };

    if (this.driver === 'docker_ephemeral') {
      const dockerArgs = buildDockerRunArgs({
        image: this.dockerImage,
        hostWorkspaceDir: cwd,
        binary: validation.binary,
        args: validation.args,
      });
      outcome = await this.runProcess('docker', dockerArgs, cwd, timeoutMs);
      if (outcome.spawnErrorCode === 'ENOENT' && this.allowLocalFallbackOnDockerMissing) {
        effectiveDriver = 'local_confined';
        outcome = await this.runProcess(validation.binary, validation.args, cwd, timeoutMs);
      } else if (outcome.spawnErrorCode === 'ENOENT') {
        outcome = {
          status: 'failed',
          exitCode: null,
          stdout: '',
          stderr:
            'Docker CLI não encontrado neste host para SANDBOX_DRIVER=docker_ephemeral. Instale/inicie o Docker ou use SANDBOX_DRIVER=local_confined.',
        };
      }
    } else {
      outcome = await this.runProcess(validation.binary, validation.args, cwd, timeoutMs);
    }

    const durationMs = Math.max(0, Date.now() - startedAt);
    const session = this.store.recordSandboxSession({
      user_id: req.userId,
      run_id: req.runId || null,
      driver: effectiveDriver,
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
