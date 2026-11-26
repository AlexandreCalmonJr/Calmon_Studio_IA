/**
 * Detecção automática do perfil de hardware real da máquina host (CPU, RAM, GPU, Ollama).
 */
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import type { NotebookHardwareProfile } from '../../src/services/hardwareAdvisor.ts';

export function detectRealMachineHardwareProfile(): NotebookHardwareProfile {
  const cpus = os.cpus();
  const cpuModel = (cpus[0]?.model || os.arch()).replace(/\s+/g, ' ').trim();
  const cpuLabel = cpus.length > 0 ? `${cpuModel} (${cpus.length} threads)` : cpuModel;
  const ramGb = Math.max(1, Math.round(os.totalmem() / 1024 ** 3));

  let gpuName = `GPU integrada (${os.platform()} ${os.arch()})`;
  let vramGb = 0;

  try {
    const nvidiaOut = execFileSync(
      'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', timeout: 1200, stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (nvidiaOut) {
      const [namePart, memPart] = nvidiaOut.split('\n')[0].split(',').map((s) => s.trim());
      if (namePart) gpuName = namePart;
      const mb = Number(memPart);
      if (Number.isFinite(mb) && mb > 0) vramGb = Math.max(1, Math.round(mb / 1024));
    }
  } catch {
    if (os.platform() === 'linux') {
      try {
        const lspciOut = execFileSync('lspci', [], {
          encoding: 'utf8',
          timeout: 1200,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const gpuLine = lspciOut
          .split('\n')
          .find((l) => /vga compatible controller|3d controller|display controller/i.test(l));
        if (gpuLine) {
          const parsed = gpuLine
            .replace(/^[^:]+:\s*(?:VGA compatible controller|3D controller|Display controller):\s*/i, '')
            .replace(/\s*\(rev [^)]+\)\s*$/i, '')
            .trim();
          if (parsed) gpuName = parsed;
        }
      } catch {
        // mantém fallback seguro
      }
    }
  }

  let owner = os.hostname() || 'Local';
  try {
    owner = os.userInfo().username || owner;
  } catch {
    // ignore
  }

  return {
    id: 'local_machine_real',
    label: `Este Computador (${ramGb} GB RAM)`,
    owner,
    cpu: cpuLabel,
    ram_gb: ramGb,
    gpu_name: gpuName,
    vram_gb: vramGb,
    ollama_url: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    is_active: true,
  };
}
