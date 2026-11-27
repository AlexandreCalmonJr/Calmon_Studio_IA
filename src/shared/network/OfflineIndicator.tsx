import React from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { useOfflineQueue } from './useOfflineQueue';
import { notify } from '../common/Toast';

export const OfflineIndicator: React.FC = () => {
  const { isOnline, queue, syncing, syncNow } = useOfflineQueue();

  if (isOnline && queue.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 'calc(18px + var(--jarvis-dock-clearance, 0px))',
        left: '18px',
        zIndex: 450,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '9px 14px',
        borderRadius: '10px',
        backgroundColor: isOnline ? 'rgba(249, 115, 22, 0.16)' : 'rgba(245, 158, 11, 0.18)',
        border: `1px solid ${isOnline ? 'rgba(249, 115, 22, 0.45)' : 'rgba(245, 158, 11, 0.5)'}`,
        color: '#fef3c7',
        fontSize: '0.78rem',
        fontWeight: 600,
        backdropFilter: 'blur(8px)',
        boxShadow: 'var(--shadow-md)',
      }}
    >
      <WifiOff size={15} color="#fbbf24" />
      <span>
        {!isOnline
          ? `Modo Offline — ${queue.length > 0 ? `${queue.length} comando(s) na fila` : 'Usando cache local'}`
          : `${queue.length} comando(s) offline prontos para sincronizar`}
      </span>
      {isOnline && queue.length > 0 && (
        <button
          type="button"
          onClick={async () => {
            const res = await syncNow();
            if (res.synced > 0) notify(`${res.synced} comando(s) sincronizado(s)!`, 'success');
          }}
          disabled={syncing}
          className="btn btn-primary btn-sm"
          style={{ padding: '4px 10px', fontSize: '0.72rem' }}
        >
          <RefreshCw size={12} className={syncing ? 'spin' : ''} />
          <span>{syncing ? 'Sincronizando...' : 'Sincronizar'}</span>
        </button>
      )}
    </div>
  );
};

