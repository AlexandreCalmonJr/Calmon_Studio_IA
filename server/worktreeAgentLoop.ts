import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface WorktreeRunResult {
  ok: boolean;
  worktreePath: string;
  branchName: string;
  stdout: string;
  error?: string;
}

/**
 * Executa uma verificação em um git worktree isolado e remove o worktree ao final.
 */
export async function runIsolatedWorktreeCheck(
  repoRoot: string,
  taskSlug: string,
  testCommand: { cmd: string; args: string[] } = { cmd: 'npm', args: ['test'] }
): Promise<WorktreeRunResult> {
  const safeSlug = taskSlug.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32) || 'task';
  const branchName = `calmon/wt-${safeSlug}-${Date.now().toString(36)}`;
  const worktreePath = path.join(repoRoot, '.worktrees', branchName.replace(/\//g, '-'));

  try {
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    await execFileAsync('git', ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'], {
      cwd: repoRoot,
      timeout: 20_000,
    });

    const { stdout } = await execFileAsync(testCommand.cmd, testCommand.args, {
      cwd: worktreePath,
      timeout: 120_000,
      shell: process.platform === 'win32',
    });

    return { ok: true, worktreePath, branchName, stdout: stdout.slice(0, 4000) };
  } catch (err: any) {
    return {
      ok: false,
      worktreePath,
      branchName,
      stdout: String(err?.stdout || '').slice(0, 2000),
      error: err?.message || 'Falha no loop isolado em worktree.',
    };
  } finally {
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoRoot,
        timeout: 15_000,
      });
    } catch {
      // ignora limpeza se não foi criado
    }
  }
}

