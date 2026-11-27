import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Clipboard,
  Cpu,
  Download,
  Lock,
  Monitor,
  MousePointer2,
  Pause,
  Play,
  Power,
  Radar,
  RefreshCw,
  Send,
  ShieldAlert,
  SkipBack,
  SkipForward,
  Smartphone,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { getApiBase } from '../../services/api';
import {
  DiscoveredLanHost,
  RECOMMENDED_MOBILE_MODELS,
  authenticateBiometricNative,
  checkAppUpdateNative,
  discoverLanHostsNative,
  downloadAndInstallApkNative,
  downloadLocalModelNative,
  getPairedHostUrl,
  getSelectedLocalMobileModel,
  isNativeMobileRuntime,
  listDownloadedLocalModelsNative,
  setForegroundBridgeNative,
  setPairedHostUrl,
  setSelectedLocalMobileModel,
  syncDeltaWithDesktop,
} from '../../services/localMobileAi';
import { PageHeader } from '../../shared/layout/PageHeader';
import { notify } from '../../shared/common/Toast';

interface RemoteStatus {
  online: boolean;
  hostname: string;
  platform: string;
  arch: string;
  paired_devices_count: number;
  clipboard_preview?: string;
}

export const RemoteControlView: React.FC = () => {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [hostUrl, setHostUrl] = useState<string>(getPairedHostUrl);
  const [discoveredHosts, setDiscoveredHosts] = useState<DiscoveredLanHost[]>([]);
  const [localModelId, setLocalModelId] = useState<string>(getSelectedLocalMobileModel);
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
  const [downloadingModel, setDownloadingModel] = useState(false);
  const [bridgeActive, setBridgeActive] = useState(false);
  const [clipboardText, setClipboardText] = useState('');
  const [keyboardInput, setKeyboardInput] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [screenPreview, setScreenPreview] = useState<string | null>(null);
  const [wolMac, setWolMac] = useState<string>('');

  const lastTouchRef = useRef<{ x: number; y: number } | null>(null);
  const lastScrollYRef = useRef<number | null>(null);
  const lastMoveSentRef = useRef<number>(0);
  const wsRef = useRef<WebSocket | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/remote/status`, { credentials: 'include' });
      if (res.ok) {
        const data = (await res.json()) as RemoteStatus;
        setStatus(data);
      }
    } catch {
      // ignore offline
    }
    if (isNativeMobileRuntime()) {
      listDownloadedLocalModelsNative().then(setDownloadedModels).catch(() => {});
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const base = hostUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    if (!base) return;
    const wsUrl = `${base.replace(/^http/, 'ws')}/ws`;
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(wsUrl);
      socket.onopen = () => setWsConnected(true);
      socket.onclose = () => setWsConnected(false);
      socket.onerror = () => setWsConnected(false);
      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data || '{}')) as { type?: string };
          if (msg.type === 'ring_phone') {
            const cap = (window as unknown as { Capacitor?: { Plugins?: { CalmonNative?: { ringPhone?: () => Promise<void> } } } }).Capacitor;
            void cap?.Plugins?.CalmonNative?.ringPhone?.();
          }
        } catch {
          // ignore
        }
      };
      wsRef.current = socket;
    } catch {
      setWsConnected(false);
    }
    return () => {
      try {
        socket?.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, [hostUrl]);

  const sendInput = useCallback((payload: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'remote_input', payload }));
      return;
    }
    void fetch(`${getApiBase()}/remote/input`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }, []);

  const sendMedia = async (action: string) => {
    setBusyAction(action);
    try {
      const res = await fetch(`${getApiBase()}/remote/media`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error('Falha no comando de mídia.');
    } catch (err: any) {
      notify(err?.message || 'Erro ao enviar mídia.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const sendMouseDelta = (dx: number, dy: number) => {
    const now = Date.now();
    if (now - lastMoveSentRef.current < 32) return;
    lastMoveSentRef.current = now;
    sendInput({ kind: 'move', dx: Math.round(dx * 1.8), dy: Math.round(dy * 1.8) });
  };

  const sendScrollDelta = (dy: number) => {
    const now = Date.now();
    if (now - lastMoveSentRef.current < 45) return;
    lastMoveSentRef.current = now;
    sendInput({ kind: 'scroll', dy: Math.round(-dy * 4) });
  };

  const sendClick = (button: 'left' | 'right') => {
    sendInput({ kind: 'click', button });
  };

  const sendKeyboardText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyboardInput.trim()) return;
    try {
      const res = await fetch(`${getApiBase()}/remote/input`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'text', text: keyboardInput }),
      });
      if (res.ok) {
        setKeyboardInput('');
        notify('Texto enviado ao PC.', 'success');
      }
    } catch {
      notify('Falha ao enviar texto.', 'error');
    }
  };

  const syncClipboardToPc = async () => {
    if (!clipboardText.trim()) return;
    try {
      const res = await fetch(`${getApiBase()}/remote/clipboard`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clipboardText }),
      });
      if (res.ok) notify('Clipboard enviado para o PC!', 'success');
    } catch {
      notify('Erro ao sincronizar clipboard.', 'error');
    }
  };

  const pullClipboardFromPc = async () => {
    try {
      const res = await fetch(`${getApiBase()}/remote/clipboard`, { credentials: 'include' });
      if (res.ok) {
        const data = (await res.json()) as { text?: string };
        setClipboardText(data.text || '');
        notify('Clipboard puxado do PC.', 'info');
      }
    } catch {
      notify('Erro ao ler clipboard do PC.', 'error');
    }
  };

  const runSystemAction = async (action: string, requiresBiometric = false) => {
    setBusyAction(action);
    try {
      let biometricApproved = false;
      if (requiresBiometric) {
        biometricApproved = await authenticateBiometricNative(`Autorizar "${action}" no PC`);
        if (!biometricApproved) {
          notify('Autenticação biométrica cancelada.', 'info');
          return;
        }
      }
      const res = await fetch(`${getApiBase()}/remote/system-action`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, biometric_approved: biometricApproved }),
      });
      const data = await res.json();
      if (res.status === 202 && data.requires_approval) {
        notify('Ação Nível 2 enviada para Aprovação Biométrica / Desktop!', 'info');
      } else if (res.ok) {
        notify(`Ação "${action}" executada no PC.`, 'success');
      } else {
        notify(data?.detail || 'Ação recusada.', 'error');
      }
    } catch {
      notify('Erro ao acionar sistema remoto.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDiscoverLan = async () => {
    try {
      const hosts = await discoverLanHostsNative();
      setDiscoveredHosts(hosts);
      if (hosts.length === 0) {
        notify('Nenhum PC encontrado via UDP na rede local (use JARVIS_ALLOW_LAN=1 no PC).', 'info');
      } else {
        notify(`${hosts.length} PC(s) encontrado(s) no Wi-Fi!`, 'success');
      }
    } catch (err: any) {
      notify(err?.message || 'Descoberta UDP disponível no app Android.', 'info');
    }
  };

  const handleToggleForegroundBridge = async () => {
    const next = !bridgeActive;
    const running = await setForegroundBridgeNative(next, hostUrl || 'PC Local');
    setBridgeActive(running);
    notify(running ? 'Ponte em 2º plano ativa no Android!' : 'Ponte em 2º plano parada.', 'info');
  };

  const handleDownloadOfflineModel = async () => {
    setDownloadingModel(true);
    try {
      const res = await downloadLocalModelNative(localModelId);
      if (res.ok) {
        notify('Modelo GGUF baixado no aparelho com sucesso!', 'success');
        const list = await listDownloadedLocalModelsNative();
        setDownloadedModels(list);
      } else {
        notify('Download direto disponível apenas no aplicativo Android.', 'info');
      }
    } catch (err: any) {
      notify(err?.message || 'Erro ao baixar modelo GGUF.', 'error');
    } finally {
      setDownloadingModel(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '32px' }}>
      <PageHeader
        title="Controle Remoto & KDE Connect"
        subtitle="Trackpad WS, scroll 2 dedos, mídia, clipboard, ações administrativas biométricas e IA local no celular"
        icon={<Smartphone size={20} color="#f97316" />}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
          gap: '14px',
        }}
      >
        {/* Card 1: Host Pareado & Trackpad */}
        <section
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '14px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.92rem' }}>
              <MousePointer2 size={16} color="#f97316" />
              <span>Trackpad {wsConnected ? 'WS' : 'HTTP'} & Teclado</span>
            </strong>
            <span style={{ fontSize: '0.72rem', color: status?.online ? '#4ade80' : '#fbbf24' }}>
              {status?.online ? `${status.hostname} (${status.platform})` : 'Conectando...'}
            </span>
          </div>

          <div
            onTouchMove={(e) => {
              if (e.touches.length === 2) {
                const avgY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                if (lastScrollYRef.current !== null) {
                  const dy = avgY - lastScrollYRef.current;
                  if (Math.abs(dy) > 1) sendScrollDelta(dy);
                }
                lastScrollYRef.current = avgY;
              }
            }}
            onTouchEnd={() => {
              lastScrollYRef.current = null;
            }}
            onPointerMove={(e) => {
              if (e.buttons !== 1 && e.pointerType === 'mouse') return;
              if (!lastTouchRef.current) {
                lastTouchRef.current = { x: e.clientX, y: e.clientY };
                return;
              }
              const dx = e.clientX - lastTouchRef.current.x;
              const dy = e.clientY - lastTouchRef.current.y;
              lastTouchRef.current = { x: e.clientX, y: e.clientY };
              if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                sendMouseDelta(dx, dy);
              }
            }}
            onPointerUp={() => {
              lastTouchRef.current = null;
            }}
            onPointerCancel={() => {
              lastTouchRef.current = null;
            }}
            style={{
              height: '170px',
              borderRadius: '12px',
              background: 'var(--bg-primary)',
              border: '1px dashed rgba(249, 115, 22, 0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '12px',
              color: 'var(--text-secondary)',
              fontSize: '0.78rem',
              touchAction: 'none',
              userSelect: 'none',
            }}
          >
            1 dedo: mover cursor · 2 dedos: scroll
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => sendClick('left')}>
              Clique Esquerdo
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => sendClick('right')}>
              Clique Direito
            </button>
          </div>

          <form onSubmit={sendKeyboardText} style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={keyboardInput}
              onChange={(e) => setKeyboardInput(e.target.value)}
              placeholder="Digitar no PC..."
              className="input"
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-primary btn-sm">
              <Send size={13} />
            </button>
          </form>
        </section>

        {/* Card 2: Mídia, Volume & Ações Admin */}
        <section
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '14px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <strong style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.92rem' }}>
            <Volume2 size={16} color="#f97316" />
            <span>Mídia & Sistema (Admin)</span>
          </strong>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void sendMedia('previous')}>
              <SkipBack size={14} />
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void sendMedia('play_pause')}>
              <Play size={13} />
              <Pause size={13} />
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void sendMedia('next')}>
              <SkipForward size={14} />
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void sendMedia('volume_down')}>
              Vol -
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void sendMedia('volume_mute')}>
              <VolumeX size={14} />
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void sendMedia('volume_up')}>
              Vol +
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busyAction === 'lock_screen'}
              onClick={() => void runSystemAction('lock_screen', false)}
            >
              <Lock size={13} />
              <span>Bloquear PC</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busyAction === 'power_sleep'}
              onClick={() => void runSystemAction('power_sleep', true)}
            >
              <Power size={13} />
              <span>Suspender (Biometria)</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                const res = await fetch(`${getApiBase()}/remote/screen-peek`, { credentials: 'include' });
                if (res.ok) {
                  const data = (await res.json()) as { image_base64?: string };
                  if (data.image_base64) setScreenPreview(`data:image/jpeg;base64,${data.image_base64}`);
                } else {
                  notify('Screen Peek disponível no host Windows.', 'info');
                }
              }}
            >
              <Monitor size={13} />
              <span>Ver Tela do PC</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                const res = await fetch(`${getApiBase()}/remote/ring`, { method: 'POST', credentials: 'include' });
                if (res.ok) notify('Sinal enviado para tocar o celular!', 'success');
              }}
            >
              <Smartphone size={13} />
              <span>Tocar Celular</span>
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
            {[
              { id: 'start', label: 'F5' },
              { id: 'prev', label: '◀ Slide' },
              { id: 'next', label: 'Slide ▶' },
              { id: 'exit', label: 'Esc' },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={async () => {
                  await fetch(`${getApiBase()}/remote/slides`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: s.id }),
                  });
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {screenPreview && (
            <img
              src={screenPreview}
              alt="Prévia da tela do PC"
              style={{ width: '100%', borderRadius: '10px', border: '1px solid var(--border-color)' }}
            />
          )}

          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              value={wolMac}
              onChange={(e) => setWolMac(e.target.value)}
              placeholder="MAC Wake-on-LAN (AA:BB:CC:DD:EE:FF)"
              className="input"
              style={{ flex: 1, fontSize: '0.74rem' }}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                const res = await fetch(`${getApiBase()}/remote/wol`, {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ mac: wolMac }),
                });
                if (res.ok) notify('Pacote Wake-on-LAN enviado!', 'success');
                else notify('Informe um MAC Address válido.', 'error');
              }}
            >
              WOL
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Clipboard size={13} />
              <span>Clipboard Bidirecional (PC ⇄ Celular)</span>
            </label>
            <textarea
              rows={2}
              value={clipboardText}
              onChange={(e) => setClipboardText(e.target.value)}
              placeholder="Cole aqui para enviar ao PC ou clique em Ler do PC..."
              className="input"
              style={{ resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void pullClipboardFromPc()}>
                Ler do PC
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void syncClipboardToPc()}>
                Enviar ao PC
              </button>
            </div>
          </div>
        </section>

        {/* Card 3: Descoberta LAN, Ponte 2º Plano & IA Local no Mobile */}
        <section
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '14px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <strong style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.92rem' }}>
            <Cpu size={16} color="#f97316" />
            <span>Host LAN & IA Local no Celular</span>
          </strong>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Endereço do PC Pareado
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => void handleDiscoverLan()}
                style={{ fontSize: '0.7rem', gap: '4px' }}
              >
                <Radar size={12} />
                <span>Buscar no Wi-Fi</span>
              </button>
            </div>

            {discoveredHosts.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {discoveredHosts.map((h) => (
                  <button
                    key={h.ip}
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() => {
                      setHostUrl(h.url);
                      setPairedHostUrl(h.url);
                      notify(`Selecionado: ${h.hostname} (${h.url})`, 'success');
                    }}
                  >
                    {h.hostname} ({h.ip})
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="url"
                value={hostUrl}
                onChange={(e) => setHostUrl(e.target.value)}
                placeholder="http://192.168.1.100:3000"
                className="input"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  const saved = setPairedHostUrl(hostUrl);
                  notify(saved ? `Host salvo: ${saved}` : 'Host limpo (usando origem local).', 'success');
                }}
              >
                <Monitor size={13} />
                <span>Salvar</span>
              </button>
            </div>
          </div>

          {isNativeMobileRuntime() && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void handleToggleForegroundBridge()}
            >
              {bridgeActive ? 'Desativar Ponte em 2º Plano' : 'Ativar Ponte em 2º Plano (Android)'}
            </button>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Modelo Local On-Device (Fallback 100% Offline)
            </label>
            <select
              value={localModelId}
              onChange={(e) => {
                setLocalModelId(e.target.value);
                setSelectedLocalMobileModel(e.target.value);
              }}
              className="input"
            >
              {RECOMMENDED_MOBILE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.sizeLabel} {downloadedModels.includes(m.id) ? '✓ Baixado' : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={downloadingModel}
              onClick={() => void handleDownloadOfflineModel()}
            >
              <Download size={13} />
              <span>{downloadingModel ? 'Baixando GGUF...' : 'Baixar Modelo Offline (.gguf)'}</span>
            </button>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  const synced = await syncDeltaWithDesktop(getApiBase());
                  if (synced) {
                    notify(
                      `Sincronizado: ${synced.counts?.agents ?? 0} agentes · ${synced.counts?.sessions ?? 0} conversas`,
                      'success'
                    );
                  } else {
                    notify('Não foi possível sincronizar com o Desktop.', 'error');
                  }
                }}
              >
                <RefreshCw size={13} />
                <span>Sincronizar PC</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  const upd = await checkAppUpdateNative();
                  if (!upd) {
                    notify('Auto-updater disponível no app Android instalado.', 'info');
                    return;
                  }
                  if (upd.hasUpdate && upd.apkUrl) {
                    notify(`Nova versão v${upd.latestVersion} encontrada! Baixando APK...`, 'success');
                    await downloadAndInstallApkNative(upd.apkUrl);
                  } else {
                    notify(`Você já está na versão mais recente (v${upd.currentVersion}).`, 'success');
                  }
                }}
              >
                <Download size={13} />
                <span>Atualizar APK</span>
              </button>
            </div>
          </div>

          <div
            style={{
              padding: '10px',
              borderRadius: '10px',
              background: 'rgba(249, 115, 22, 0.08)',
              border: '1px solid rgba(249, 115, 22, 0.25)',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-start',
            }}
          >
            <ShieldAlert size={15} color="#f97316" style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>
              Ações administrativas (Nível 2) exigem biometria no celular ou aprovação no Desktop.
            </span>
          </div>
        </section>
      </div>
    </div>
  );
};
