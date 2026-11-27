import React from 'react';
import { RefreshCw, ShieldAlert, Smartphone, Trash2, WifiOff } from 'lucide-react';
import type { OfflineCommandItem } from '../../services/voiceCompanion';

interface CompanionOfflineTabProps {
  isOnline: boolean;
  queue: OfflineCommandItem[];
  syncing: boolean;
  offlineInput: string;
  onOfflineInputChange: (val: string) => void;
  onAddOfflineCommand: (e: React.FormEvent) => void;
  onRemoveCommand: (id: string) => void;
  onSyncNow: () => Promise<void>;
  onNavigate: (tab: string) => void;
}

export const CompanionOfflineTab: React.FC<CompanionOfflineTabProps> = ({
  isOnline,
  queue,
  syncing,
  offlineInput,
  onOfflineInputChange,
  onAddOfflineCommand,
  onRemoveCommand,
  onSyncNow,
  onNavigate,
}) => {
  return (
    <div className="calmon-two-col-grid">
      <section className="calmon-surface-card">
        <h2 className="calmon-card-title">
          <Smartphone size={16} color="var(--accent-color)" />
          <span>App Mobile Nativo & Conexão</span>
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
          Modo PWA desativado em favor do aplicativo Android nativo (`.apk`) com todas as 28 rotas do Calmon Studio, Controle Remoto estilo KDE Connect e fila offline local.
        </p>
        <div className="calmon-metric-grid">
          {[
            { label: 'App Mobile Nativo', status: 'Android APK (Capacitor)', ok: true },
            { label: 'Modo PWA / Service Worker', status: 'Desativado', ok: true },
            { label: 'Fila de Comandos Offline', status: `${queue.length} na fila`, ok: true },
            { label: 'Controle Remoto & Admin', status: 'Integrado via WS', ok: true },
          ].map((item) => (
            <div key={item.label} className="calmon-metric-box">
              <span className="calmon-metric-label">{item.label}</span>
              <strong style={{ fontSize: '0.8rem', color: item.ok ? '#4ade80' : '#fbbf24' }}>
                {item.status}
              </strong>
            </div>
          ))}
        </div>
      </section>

      <section className="calmon-surface-card">
        <h2 className="calmon-card-title">
          <WifiOff size={16} color="var(--accent-color)" />
          <span>Fila Offline ({queue.length})</span>
        </h2>
        <form onSubmit={onAddOfflineCommand} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={offlineInput}
            onChange={(e) => onOfflineInputChange(e.target.value)}
            placeholder="Enfileirar comando offline..."
            className="input"
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-secondary btn-sm">
            Adicionar
          </button>
        </form>

        {queue.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {queue.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  fontSize: '0.78rem',
                }}
              >
                <span>{item.text}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => onRemoveCommand(item.id)}
                  aria-label="Remover comando offline"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!isOnline || syncing || queue.length === 0}
            onClick={() => void onSyncNow()}
          >
            <RefreshCw size={13} />
            <span>{syncing ? 'Sincronizando...' : 'Sincronizar Fila'}</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onNavigate('remote')}
          >
            <ShieldAlert size={13} />
            <span>Abrir Controle Remoto</span>
          </button>
        </div>
      </section>
    </div>
  );
};

