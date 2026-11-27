/**
 * Calmon Studio — Processo Principal Electron (.exe / Desktop)
 *
 * Responsabilidades:
 *  - Garantir instância única do aplicativo
 *  - Gerar segredos criptográficos únicos na primeira execução (%APPDATA%/CalmonStudio/runtime-secrets.json)
 *  - Alocar porta local livre (preferência 3000) e iniciar o servidor Express embarcado
 *  - Exibir splash de carregamento enquanto o servidor sobe
 *  - Fornecer System Tray (bandeja) e encerramento limpo do SQLite WAL
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, Menu, Notification, Tray, dialog, globalShortcut, nativeImage, shell } from 'electron';
import pkg from 'electron-updater';

const { autoUpdater } = pkg;

const APP_NAME = 'Calmon Studio';
let mainWindow = null;
let spotlightWindow = null;
let tray = null;
let serverHandle = null;
let pythonWorkerProc = null;
let isQuitting = false;

function startOptionalPythonWorker(appRoot) {
  if (process.env.CALMON_ENABLE_PYTHON_WORKER === '0') return;
  const workerDir = path.join(appRoot, 'services', 'python-worker');
  if (!fs.existsSync(path.join(workerDir, 'app', 'main.py'))) return;

  const venvPy =
    process.platform === 'win32'
      ? path.join(appRoot, '.venv', 'Scripts', 'python.exe')
      : path.join(appRoot, '.venv', 'bin', 'python3');
  const pythonBin =
    process.env.PYTHON_BIN ||
    (fs.existsSync(venvPy) ? venvPy : process.platform === 'win32' ? 'python' : 'python3');

  try {
    const child = spawn(
      pythonBin,
      ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8001'],
      {
        cwd: workerDir,
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      }
    );
    child.on('error', () => {
      pythonWorkerProc = null;
    });
    child.on('exit', () => {
      if (pythonWorkerProc === child) pythonWorkerProc = null;
    });
    pythonWorkerProc = child;
    process.env.PYTHON_WORKER_URL = process.env.PYTHON_WORKER_URL || 'http://127.0.0.1:8001';
  } catch {
    pythonWorkerProc = null;
  }
}

function findAvailablePort(preferredPort = 3000) {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.once('error', () => {
      const fallback = net.createServer();
      fallback.once('error', reject);
      fallback.listen(0, '127.0.0.1', () => {
        const addr = fallback.address();
        const port = typeof addr === 'object' && addr ? addr.port : 3000;
        fallback.close(() => resolve(port));
      });
    });
    tester.listen(preferredPort, '127.0.0.1', () => {
      tester.close(() => resolve(preferredPort));
    });
  });
}

function ensureRuntimeSecrets(userDataDir) {
  const secretsFile = path.join(userDataDir, 'runtime-secrets.json');
  try {
    if (fs.existsSync(secretsFile)) {
      const parsed = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
      if (parsed?.jwtSecret && parsed?.keyvaultMasterKey) {
        return parsed;
      }
    }
  } catch {
    // Recria arquivo se estiver corrompido
  }

  const generated = {
    jwtSecret: crypto.randomBytes(32).toString('hex'),
    keyvaultMasterKey: crypto.randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(secretsFile, JSON.stringify(generated, null, 2), { mode: 0o600 });
  return generated;
}

function createTrayIcon() {
  // Ícone SVG minimalista embutido convertido para data URL (funciona sem arquivo externo obrigatório)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="16" fill="#0f172a"/>
    <circle cx="32" cy="32" r="20" fill="none" stroke="#f97316" stroke-width="5"/>
    <text x="32" y="39" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="bold" fill="#f8fafc">C</text>
  </svg>`;
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  return nativeImage.createFromDataURL(dataUrl);
}

function setupTray(port) {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip(`${APP_NAME} · Controle & IA`);

  const loginSettings = app.getLoginItemSettings ? app.getLoginItemSettings() : { openAtLogin: false };
  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Abrir ${APP_NAME}`,
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Abrir Controle Remoto (KDE Connect)',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          void mainWindow.loadURL(`http://127.0.0.1:${port}/remote`);
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Iniciar com o Sistema',
      type: 'checkbox',
      checked: Boolean(loginSettings.openAtLogin),
      click: (item) => {
        try {
          app.setLoginItemSettings({ openAtLogin: item.checked });
        } catch {
          // ignorado em plataformas sem suporte
        }
      },
    },
    {
      label: `Modo Rede LAN (${process.env.JARVIS_ALLOW_LAN === '1' ? 'Visível no Wi-Fi' : 'Somente Local'})`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Sair com segurança',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function showDesktopNotification(title, body) {
  try {
    if (Notification.isSupported()) {
      const notif = new Notification({ title, body });
      notif.on('click', () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      });
      notif.show();
    }
  } catch {
    // ignorado se o SO bloquear notificações
  }
}

function buildSplashDataUrl() {
  const html = `<!doctype html>
  <html lang="pt-BR">
  <head><meta charset="utf-8"><title>${APP_NAME}</title></head>
  <body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0b0d12;color:#f8fafc;font-family:system-ui,sans-serif;">
    <div style="width:52px;height:52px;border-radius:14px;border:3px solid #f97316;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:24px;margin-bottom:16px;">C</div>
    <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;">${APP_NAME}</div>
    <div style="font-size:13px;color:#94a3b8;margin-top:6px;">Iniciando banco local e serviços...</div>
  </body>
  </html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function bootDesktopApp() {
  const userDataDir = app.getPath('userData');
  const brainDataDir = path.join(userDataDir, 'calmon-brain');
  const secrets = ensureRuntimeSecrets(userDataDir);
  const port = await findAvailablePort(3000);

  const appRoot = app.getAppPath();
  const distDir = path.join(appRoot, 'dist');
  const serverBundlePath = path.join(appRoot, 'dist-server', 'server.mjs');

  process.env.NODE_ENV = 'production';
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(port);
  process.env.SQLITE_DATA_DIR = brainDataDir;
  process.env.STATIC_DIST_DIR = distDir;
  process.env.BRAIN_NAME = 'Calmon Studio · Local';
  process.env.ASSISTANT_NAME = 'Calmon IA';
  process.env.JWT_SECRET = process.env.JWT_SECRET || secrets.jwtSecret;
  process.env.KEYVAULT_MASTER_KEY = process.env.KEYVAULT_MASTER_KEY || secrets.keyvaultMasterKey;
  process.env.CALMON_APP_VERSION = app.getVersion();

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: '#0b0d12',
    show: false,
    webPreferences: {
      preload: path.join(appRoot, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && process.platform !== 'darwin') {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  await mainWindow.loadURL(buildSplashDataUrl());
  mainWindow.show();
  setupTray(port);

  startOptionalPythonWorker(appRoot);
  const serverModule = await import(pathToFileURL(serverBundlePath).href);
  serverHandle = await serverModule.startServer();

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  showDesktopNotification(APP_NAME, 'Pronto na bandeja para Controle Remoto e IA.');

  try {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
      if (spotlightWindow && !spotlightWindow.isDestroyed()) {
        if (spotlightWindow.isVisible()) {
          spotlightWindow.hide();
        } else {
          spotlightWindow.show();
          spotlightWindow.focus();
        }
        return;
      }
      spotlightWindow = new BrowserWindow({
        width: 720,
        height: 480,
        frame: false,
        alwaysOnTop: true,
        resizable: true,
        backgroundColor: '#0b0d12',
        webPreferences: {
          preload: path.join(appRoot, 'electron', 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      spotlightWindow.on('blur', () => {
        if (spotlightWindow && !spotlightWindow.isDestroyed()) spotlightWindow.hide();
      });
      void spotlightWindow.loadURL(`http://127.0.0.1:${port}/chat`);
    });
  } catch {
    // atalho global indisponível
  }

  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-downloaded', (info) => {
      showDesktopNotification('Atualização Pronta', `Versão ${info?.version || ''} baixada. Clique para reiniciar.`);
      void dialog
        .showMessageBox(mainWindow, {
          type: 'info',
          buttons: ['Reiniciar e Atualizar', 'Depois'],
          defaultId: 0,
          title: 'Calmon Studio · Atualização Disponível',
          message: `A versão ${info?.version || 'mais recente'} foi baixada e está pronta para instalar.`,
        })
        .then((res) => {
          if (res.response === 0) {
            isQuitting = true;
            autoUpdater.quitAndInstall();
          }
        });
    });
    void autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    setInterval(() => void autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 6 * 60 * 60 * 1000);
  } catch {
    // auto-updater ignorado em dev sem publish
  }
}

const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    bootDesktopApp().catch((err) => {
      console.error('[Calmon Studio Desktop] Erro fatal no boot:', err);
      app.quit();
    });
  });

  app.on('before-quit', async () => {
    isQuitting = true;
    try {
      if (pythonWorkerProc && !pythonWorkerProc.killed) {
        pythonWorkerProc.kill();
        pythonWorkerProc = null;
      }
      if (serverHandle?.close) {
        await serverHandle.close();
      }
    } catch {
      // ignora erro no shutdown
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && isQuitting) {
      app.quit();
    }
  });
}
