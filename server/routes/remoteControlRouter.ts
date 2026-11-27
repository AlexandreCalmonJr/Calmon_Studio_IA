import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import express, { Request, Response, Router } from 'express';
import { expressRateLimit } from '../rateLimiter.ts';
import {
  requireAuth,
  serverState,
  broadcastRealtimeEvent,
  nowIso,
  UserAccount,
} from '../serverState.ts';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';

const execFileAsync = promisify(execFile);

let latestClipboardText = '';
let latestClipboardUpdatedAt = '';
let persistentPsWorker: ChildProcessWithoutNullStreams | null = null;

function ensurePersistentPsWorker(): ChildProcessWithoutNullStreams | null {
  if (process.platform !== 'win32') return null;
  if (persistentPsWorker && !persistentPsWorker.killed && persistentPsWorker.exitCode === null) {
    return persistentPsWorker;
  }
  try {
    const child = spawn('powershell', ['-NoProfile', '-NoLogo', '-NonInteractive', '-Command', '-'], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdin.write(
      'Add-Type -AssemblyName System.Windows.Forms\n' +
        'Add-Type -TypeDefinition "using System; using System.Runtime.InteropServices; public class JarvisWin32 { [DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint f, uint dx, uint dy, int d, UIntPtr e); }"\n'
    );
    child.on('exit', () => {
      if (persistentPsWorker === child) persistentPsWorker = null;
    });
    child.on('error', () => {
      if (persistentPsWorker === child) persistentPsWorker = null;
    });
    persistentPsWorker = child;
    return child;
  } catch {
    return null;
  }
}

async function runWindowsPowershell(script: string): Promise<{ ok: boolean; stdout: string; error?: string }> {
  if (process.platform !== 'win32') {
    return { ok: false, stdout: '', error: 'Controle Win32 disponível apenas no Windows.' };
  }
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 6000, windowsHide: true }
    );
    return { ok: true, stdout: stdout.trim() };
  } catch (err: any) {
    return { ok: false, stdout: '', error: err?.message || 'Falha ao executar comando de controle.' };
  }
}

const MEDIA_VK_MAP: Record<string, number> = {
  play_pause: 0xb3,
  next: 0xb0,
  previous: 0xb1,
  stop: 0xb2,
  volume_up: 0xaf,
  volume_down: 0xae,
  volume_mute: 0xad,
};

export async function executeRemoteInput(payload: {
  kind?: string;
  dx?: number;
  dy?: number;
  button?: string;
  text?: string;
}): Promise<{ ok: boolean; kind: string }> {
  const kind = String(payload.kind || 'move');
  if (kind === 'move') {
    const dx = Math.max(-250, Math.min(250, Math.round(Number(payload.dx) || 0)));
    const dy = Math.max(-250, Math.min(250, Math.round(Number(payload.dy) || 0)));
    const worker = ensurePersistentPsWorker();
    if (worker) {
      worker.stdin.write(
        `$p=[System.Windows.Forms.Cursor]::Position;[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(($p.X+(${dx})),($p.Y+(${dy})))\n`
      );
      return { ok: true, kind };
    }
    const out = await runWindowsPowershell(
      `Add-Type -AssemblyName System.Windows.Forms; $p=[System.Windows.Forms.Cursor]::Position; [System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(($p.X+(${dx})),($p.Y+(${dy})))`
    );
    return { ok: out.ok, kind };
  }

  if (kind === 'scroll') {
    const delta = Math.max(-600, Math.min(600, Math.round(Number(payload.dy) || 0)));
    const worker = ensurePersistentPsWorker();
    if (worker) {
      worker.stdin.write(`[JarvisWin32]::mouse_event(0x0800,0,0,${delta},[UIntPtr]::Zero)\n`);
      return { ok: true, kind };
    }
    const out = await runWindowsPowershell(
      `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class JarvisMouseWheel { [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo); }'; [JarvisMouseWheel]::mouse_event(0x0800, 0, 0, ${delta}, [UIntPtr]::Zero)`
    );
    return { ok: out.ok, kind };
  }

  if (kind === 'click') {
    const button = String(payload.button || 'left') === 'right' ? 'right' : 'left';
    const downFlag = button === 'right' ? 0x0008 : 0x0002;
    const upFlag = button === 'right' ? 0x0010 : 0x0004;
    const ps = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class JarvisMouseClick {
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
[JarvisMouseClick]::mouse_event(${downFlag}, 0, 0, 0, [UIntPtr]::Zero)
[JarvisMouseClick]::mouse_event(${upFlag}, 0, 0, 0, [UIntPtr]::Zero)
`;
    const out = await runWindowsPowershell(ps);
    return { ok: out.ok, kind };
  }

  if (kind === 'text') {
    const rawText = String(payload.text || '').slice(0, 200);
    if (!rawText) return { ok: false, kind };
    const escaped = rawText.replace(/'/g, "''").replace(/[+^%~(){}[\]]/g, '{$&}');
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
`;
    const out = await runWindowsPowershell(ps);
    return { ok: out.ok, kind };
  }

  return { ok: false, kind };
}

export function createRemoteControlRouter(deps?: { store?: LocalSqliteBrainStore }): Router {
  const router = express.Router();
  void deps;

  router.get('/remote/status', requireAuth, (_req: Request, res: Response) => {
    res.json({
      online: true,
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      uptime_seconds: Math.round(os.uptime()),
      paired_devices_count: serverState.pairedDevicesList.length,
      clipboard_preview: latestClipboardText.slice(0, 120),
      clipboard_updated_at: latestClipboardUpdatedAt || null,
      capabilities: ['touchpad', 'keyboard', 'media', 'clipboard', 'admin_actions'],
    });
  });

  router.post('/remote/media', requireAuth, async (req: Request, res: Response) => {
    const action = String(req.body?.action || '').trim();
    const vk = MEDIA_VK_MAP[action];
    if (!vk) {
      res.status(400).json({ detail: 'Ação de mídia inválida.' });
      return;
    }
    const ps = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class JarvisMediaKey {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
[JarvisMediaKey]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero)
[JarvisMediaKey]::keybd_event(${vk}, 0, 2, [UIntPtr]::Zero)
`;
    const out = await runWindowsPowershell(ps);
    res.json({ ok: out.ok, action, detail: out.error || 'Comando de mídia enviado.' });
  });

  router.post('/remote/input', requireAuth, async (req: Request, res: Response) => {
    const kind = String(req.body?.kind || 'move');
    if (!['move', 'scroll', 'click', 'text'].includes(kind)) {
      res.status(400).json({ detail: 'Tipo de entrada inválido.' });
      return;
    }
    if (kind === 'text' && !String(req.body?.text || '').trim()) {
      res.status(400).json({ detail: 'Texto vazio.' });
      return;
    }
    const out = await executeRemoteInput(req.body || {});
    res.json(out);
  });

  router.get('/remote/clipboard', requireAuth, async (_req: Request, res: Response) => {
    const out = await runWindowsPowershell('Get-Clipboard -Raw');
    if (out.ok && out.stdout) {
      latestClipboardText = out.stdout;
      latestClipboardUpdatedAt = nowIso();
    }
    res.json({ text: latestClipboardText, updated_at: latestClipboardUpdatedAt || null });
  });

  router.post('/remote/clipboard', requireAuth, async (req: Request, res: Response) => {
    const text = String(req.body?.text || '').slice(0, 16000);
    latestClipboardText = text;
    latestClipboardUpdatedAt = nowIso();
    const safeB64 = Buffer.from(text, 'utf8').toString('base64');
    await runWindowsPowershell(
      `$bytes = [Convert]::FromBase64String('${safeB64}'); $txt = [System.Text.Encoding]::UTF8.GetString($bytes); Set-Clipboard -Value $txt`
    );
    broadcastRealtimeEvent('clipboard_sync', { text, updated_at: latestClipboardUpdatedAt });
    res.json({ ok: true, updated_at: latestClipboardUpdatedAt });
  });

  router.post('/remote/system-action', requireAuth, expressRateLimit('remote/system-action', 15, 60_000), async (req: Request, res: Response) => {
    const action = String(req.body?.action || '').trim();
    const biometricApproved = req.body?.biometric_approved === true;
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const actor = user?.username || 'admin';

    if (action === 'lock_screen') {
      const out = await runWindowsPowershell('rundll32.exe user32.dll,LockWorkStation');
      res.json({ ok: out.ok, action, tier: 1 });
      return;
    }

    if (action === 'list_services') {
      const out = await runWindowsPowershell(
        'Get-Service | Select-Object -First 25 Name, DisplayName, Status | ConvertTo-Json'
      );
      let services: unknown[] = [];
      try {
        services = out.stdout ? JSON.parse(out.stdout) : [];
      } catch {
        services = [];
      }
      res.json({ ok: out.ok, action, tier: 1, services });
      return;
    }

    // Nível 2 — Ações administrativas exigem aprovação ou confirmação biométrica
    if (
      action === 'power_sleep' ||
      action === 'admin_command' ||
      action === 'restart_service' ||
      action === 'winget_list'
    ) {
      if (!biometricApproved || user?.role !== 'admin') {
        const approvalId = `apr_remote_${Date.now().toString(36)}`;
        serverState.approvals.unshift({
          id: approvalId,
          task_id: `remote_${action}`,
          agent_role: 'system_admin',
          action_type: action,
          target: os.hostname(),
          reason: `Solicitação remota de ${actor}: ${action}`,
          risk_level: 'high',
          status: 'pending',
          created_at: nowIso(),
        } as any);
        broadcastRealtimeEvent('approval_requested', { id: approvalId, action, actor });
        res.status(202).json({
          ok: false,
          requires_approval: true,
          approval_id: approvalId,
          tier: 2,
          detail: 'Ação administrativa aguardando confirmação biométrica ou aprovação no Desktop.',
        });
        return;
      }

      serverState.auditLogs.unshift({
        id: serverState.auditLogs.length + 1,
        timestamp: nowIso(),
        actor,
        action: `remote.admin.${action}`,
        resource: os.hostname(),
        status: 'success',
        details: `Executado com confirmação biométrica por ${actor}`,
      });

      if (action === 'power_sleep') {
        const out = await runWindowsPowershell(
          'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState("Suspend", $false, $false)'
        );
        res.json({ ok: out.ok, action, tier: 2 });
        return;
      }

      if (action === 'winget_list') {
        const out = await runWindowsPowershell('winget list --count 15');
        res.json({ ok: out.ok, action, tier: 2, output: out.stdout.slice(0, 4000) });
        return;
      }

      if (action === 'restart_service') {
        const svc = String(req.body?.service_name || '').replace(/[^a-zA-Z0-9_.-]/g, '');
        if (!svc) {
          res.status(400).json({ detail: 'Informe service_name válido.' });
          return;
        }
        const out = await runWindowsPowershell(`Restart-Service -Name '${svc}' -Force`);
        res.json({ ok: out.ok, action, service: svc, tier: 2, detail: out.error || 'Serviço reiniciado.' });
        return;
      }

      if (action === 'admin_command') {
        const cmd = String(req.body?.command || '').trim();
        if (!cmd || cmd.length > 500) {
          res.status(400).json({ detail: 'Comando administrativo inválido.' });
          return;
        }
        const out = await runWindowsPowershell(cmd);
        res.json({ ok: out.ok, action, tier: 2, output: out.stdout.slice(0, 4000), error: out.error });
        return;
      }
    }

    res.status(400).json({ detail: 'Ação de sistema não suportada.' });
  });

  router.post('/remote/notification', requireAuth, (req: Request, res: Response) => {
    const title = String(req.body?.title || 'Notificação Mobile').slice(0, 120);
    const body = String(req.body?.body || '').slice(0, 500);
    const appName = String(req.body?.app_name || 'Android').slice(0, 60);
    broadcastRealtimeEvent('mobile_notification', {
      title,
      body,
      app_name: appName,
      received_at: nowIso(),
    });
    res.json({ ok: true });
  });

  router.post('/remote/upload', requireAuth, expressRateLimit('remote/upload', 20, 60_000), (req: Request, res: Response) => {
    const rawName = path.basename(String(req.body?.filename || `arquivo_${Date.now()}.bin`)).replace(/[^a-zA-Z0-9._-]/g, '_');
    const rawBase64 = String(req.body?.content_base64 || '').trim();
    if (!rawBase64 || rawBase64.length > 25 * 1024 * 1024) {
      res.status(400).json({ detail: 'Arquivo ausente ou maior que o limite permitido.' });
      return;
    }
    try {
      const receiveDir = path.join(os.homedir(), 'Downloads', 'CalmonReceive');
      fs.mkdirSync(receiveDir, { recursive: true });
      const targetPath = path.join(receiveDir, rawName);
      const buf = Buffer.from(rawBase64, 'base64');
      fs.writeFileSync(targetPath, buf);
      broadcastRealtimeEvent('mobile_file_received', { filename: rawName, size_bytes: buf.length, path: targetPath });
      res.status(201).json({ ok: true, filename: rawName, size_bytes: buf.length, path: targetPath });
    } catch (err: any) {
      res.status(500).json({ detail: err?.message || 'Falha ao salvar arquivo recebido.' });
    }
  });

  router.get('/remote/screen-peek', requireAuth, expressRateLimit('remote/screen-peek', 12, 60_000), async (_req: Request, res: Response) => {
    const ps = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$g.Dispose(); $bmp.Dispose()
[Convert]::ToBase64String($ms.ToArray())
`;
    const out = await runWindowsPowershell(ps);
    if (!out.ok || !out.stdout) {
      res.status(500).json({ detail: out.error || 'Falha ao capturar tela do PC.' });
      return;
    }
    res.json({ ok: true, mime_type: 'image/jpeg', image_base64: out.stdout });
  });

  router.post('/remote/slides', requireAuth, async (req: Request, res: Response) => {
    const cmd = String(req.body?.action || '').trim();
    const keyMap: Record<string, string> = {
      start: '{F5}',
      next: '{RIGHT}',
      prev: '{LEFT}',
      exit: '{ESC}',
    };
    const sendKey = keyMap[cmd];
    if (!sendKey) {
      res.status(400).json({ detail: 'Ação de apresentação inválida.' });
      return;
    }
    const out = await runWindowsPowershell(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${sendKey}')`
    );
    res.json({ ok: out.ok, action: cmd });
  });

  router.post('/remote/wol', requireAuth, (req: Request, res: Response) => {
    const macClean = String(req.body?.mac || '').replace(/[^a-fA-F0-9]/g, '');
    if (macClean.length !== 12) {
      res.status(400).json({ detail: 'MAC Address inválido (esperado AA:BB:CC:DD:EE:FF).' });
      return;
    }
    const macBytes = Buffer.from(macClean, 'hex');
    const magic = Buffer.alloc(6 + 16 * 6, 0xff);
    for (let i = 0; i < 16; i += 1) {
      macBytes.copy(magic, 6 + i * 6);
    }
    const sock = dgram.createSocket('udp4');
    sock.bind(() => {
      sock.setBroadcast(true);
      sock.send(magic, 0, magic.length, 9, '255.255.255.255', (err) => {
        sock.close();
        if (err) {
          res.status(500).json({ detail: err.message });
        } else {
          res.json({ ok: true, mac: macClean });
        }
      });
    });
  });

  router.post('/remote/ring', requireAuth, (_req: Request, res: Response) => {
    broadcastRealtimeEvent('ring_phone', { triggered_at: nowIso() });
    res.json({ ok: true, message: 'Sinal enviado para tocar o celular.' });
  });

  router.post('/remote/battery', requireAuth, (req: Request, res: Response) => {
    const level = Math.max(0, Math.min(100, Math.round(Number(req.body?.level) || 0)));
    const charging = Boolean(req.body?.charging);
    broadcastRealtimeEvent('mobile_battery_updated', { level, charging, updated_at: nowIso() });
    res.json({ ok: true, level, charging });
  });

  return router;
}

