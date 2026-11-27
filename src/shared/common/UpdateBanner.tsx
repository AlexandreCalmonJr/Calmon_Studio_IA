import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { getApiBase } from '../../services/api/client';
import {
  checkAppUpdateNative,
  downloadAndInstallApkNative,
  isNativeMobileRuntime,
} from '../../services/localMobileAi';

export const UpdateBanner: React.FC = () => {
  const [updateInfo, setUpdateInfo] = useState<{
    version: string;
    releaseUrl?: string;
    apkUrl?: string;
  } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    const runCheck = async () => {
      try {
        if (isNativeMobileRuntime()) {
          const res = await checkAppUpdateNative();
          if (active && res?.hasUpdate && res.apkUrl) {
            setUpdateInfo({ version: res.latestVersion, apkUrl: res.apkUrl });
          }
          return;
        }
        const resp = await fetch(`${getApiBase()}/system/update-check`, { credentials: 'include' });
        if (!resp.ok) return;
        const data = (await resp.json()) as {
          update_available?: boolean;
          latest_version?: string;
          release_url?: string;
        };
        if (active && data.update_available && data.latest_version) {
          setUpdateInfo({ version: data.latest_version, releaseUrl: data.release_url });
        }
      } catch {
        // offline
      }
    };
    const timer = window.setTimeout(() => void runCheck(), 4000);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  if (!updateInfo || dismissed) return null;

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '8px 14px',
        background: 'rgba(249, 115, 22, 0.14)',
        borderBottom: '1px solid rgba(249, 115, 22, 0.35)',
        fontSize: '0.78rem',
        color: '#ffedd5',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Download size={14} color="#f97316" />
        <span>
          Nova versão <strong>v{updateInfo.version}</strong> disponível para o Calmon Studio!
        </span>
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {updateInfo.apkUrl ? (
          <button
            type="button"
            className="btn btn-primary btn-xs"
            onClick={() => void downloadAndInstallApkNative(updateInfo.apkUrl!)}
          >
            Atualizar APK
          </button>
        ) : updateInfo.releaseUrl ? (
          <a
            href={updateInfo.releaseUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary btn-xs"
          >
            Baixar Release
          </a>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => setDismissed(true)}
          aria-label="Dispensar aviso de atualização"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
};

