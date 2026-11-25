import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpCircle,
  CheckCircle2,
  CloudDownload,
  Cpu,
  HardDrive,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  applyAdminPackageUpdate,
  fetchPackageUpdatesStatus,
  PACKS_UPDATED_EVENT,
  type ApplyPackageUpdateResponse,
  type VersionCheckReport,
} from '../../services/api/packs';
import { resolvePackageCacheStatusMeta } from '../../services/packageVersionEngine';

interface PackStudioUpdatesPanelProps {
  onUpdateApplied?: (res: ApplyPackageUpdateResponse) => void;
  onError?: (message: string) => void;
}

export const PackStudioUpdatesPanel: React.FC<PackStudioUpdatesPanelProps> = ({
  onUpdateApplied,
  onError,
}) => {
  const [report, setReport] = useState<VersionCheckReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const reqSeqRef = useRef<number>(0);

  const loadReport = useCallback(
    async (silent = false) => {
      const seq = ++reqSeqRef.current;
      if (!silent) setLoading(true);
      try {
        const data = await fetchPackageUpdatesStatus();
        if (seq !== reqSeqRef.current) return;
        setReport(data);
      } catch (err) {
        if (seq === reqSeqRef.current && !silent) {
          onError?.(
            err instanceof Error
              ? err.message
              : 'Não foi possível verificar atualizações de pacotes e agentes.'
          );
        }
      } finally {
        if (seq === reqSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [onError]
  );

  useEffect(() => {
    void loadReport(false);
  }, [loadReport]);

  useEffect(() => {
    const onPacksUpdated = () => {
      void loadReport(true);
    };
    window.addEventListener(PACKS_UPDATED_EVENT, onPacksUpdated);
    return () => window.removeEventListener(PACKS_UPDATED_EVENT, onPacksUpdated);
  }, [loadReport]);

  const handleApply = async (targetType: 'pack' | 'agent' | 'all', targetId?: string) => {
    const key = targetType === 'all' ? 'all' : `${targetType}:${targetId}`;
    setBusyKey(key);
    try {
      const res = await applyAdminPackageUpdate({
        target_type: targetType,
        target_id: targetId,
      });
      setReport(res.report);
      onUpdateApplied?.(res);
    } catch (err) {
      onError?.(
        err instanceof Error ? err.message : 'Falha ao disparar atualização no Estúdio de Pacotes.'
      );
    } finally {
      setBusyKey(null);
    }
  };

  const allPackages = report?.packages || [];
  const pendingAgents = (report?.agents || []).filter((a) => a.has_update);
  const totalUpdates = report?.summary.total_updates_available ?? 0;

  const cacheSummary = useMemo(() => {
    let localReady = 0;
    let remoteRequired = 0;
    for (const pkg of allPackages) {
      const meta = resolvePackageCacheStatusMeta(pkg.cache_status, pkg.installed, pkg.has_update);
      if (meta.readyForImmediateDeploy) localReady += 1;
      else remoteRequired += 1;
    }
    return { localReady, remoteRequired };
  }, [allPackages]);

  return (
    <section
      className="jarvis-arch-panel"
      data-testid="pack-studio-updates-panel"
      style={{
        borderLeft: totalUpdates > 0 ? '4px solid #d97706' : '4px solid #16a34a',
        marginBottom: '18px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
            <h2 className="jarvis-arch-panel-title" style={{ margin: 0 }}>
              <ArrowUpCircle size={16} />
              <span>Central de Atualizações Admin (Pacotes &amp; Agentes)</span>
            </h2>
            <span
              data-testid="pack-studio-updates-count"
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '6px',
                border: totalUpdates > 0 ? '1px solid #d97706' : '1px solid #16a34a',
                backgroundColor: totalUpdates > 0 ? '#fef3c7' : '#dcfce7',
                color: totalUpdates > 0 ? '#92400e' : '#166534',
              }}
            >
              {totalUpdates > 0 ? `${totalUpdates} pendente(s)` : 'Tudo atualizado'}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Acompanhe versões, integridade SHA-256 e prontidão do cache local de artefatos para
            deploy imediato ou download remoto, sincronizado com Cérebros &amp; Servidor.
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void loadReport()}
            disabled={loading || busyKey !== null}
            data-testid="pack-studio-refresh-updates-btn"
          >
            {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            <span>Verificar</span>
          </button>

          {totalUpdates > 0 && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busyKey !== null}
              onClick={() => void handleApply('all')}
              data-testid="pack-studio-update-all-btn"
            >
              {busyKey === 'all' ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <ArrowUpCircle size={14} />
              )}
              <span>
                {busyKey === 'all' ? 'Atualizando...' : `Atualizar Todos (${totalUpdates})`}
              </span>
            </button>
          )}
        </div>
      </div>

      {loading && !report ? (
        <div className="jarvis-pack-loading" style={{ paddingTop: '8px' }}>
          <Loader2 size={15} className="spin" />
          <span>Consultando manifesto de versões e status do cache local...</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {totalUpdates === 0 && (
            <div
              data-testid="pack-studio-all-updated"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                padding: '10px 14px',
                borderRadius: '10px',
                border: '1px solid rgba(22, 163, 74, 0.35)',
                backgroundColor: 'rgba(22, 163, 74, 0.08)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '0.82rem',
                  color: 'var(--text-primary)',
                }}
              >
                <CheckCircle2 size={16} color="#16a34a" />
                <span>
                  Todos os {report?.summary.installed_packages ?? 0} pacote(s) instalado(s) e{' '}
                  {report?.summary.total_agents ?? 0} agente(s) estão sincronizados na versão mais
                  recente.
                </span>
              </div>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-secondary)',
                }}
              >
                {cacheSummary.localReady} em cache local · {cacheSummary.remoteRequired} download
                remoto
              </span>
            </div>
          )}

          {/* Tabela de Pacotes com coluna Cache Status */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                }}
              >
                <Package size={14} color="var(--accent-primary)" />
                <span>Inventário de Pacotes ({allPackages.length})</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: '10px',
                  fontSize: '0.73rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  <HardDrive size={12} color="#047857" />
                  <span>
                    <strong>{cacheSummary.localReady}</strong> pronto(s) para deploy imediato
                  </span>
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  <CloudDownload size={12} color="#1d4ed8" />
                  <span>
                    <strong>{cacheSummary.remoteRequired}</strong> via download remoto
                  </span>
                </span>
              </div>
            </div>

            <div
              style={{
                width: '100%',
                overflowX: 'auto',
                borderRadius: '10px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-primary)',
              }}
            >
              <table
                data-testid="pack-studio-packages-table"
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  minWidth: '720px',
                  fontSize: '0.8rem',
                }}
              >
                <thead>
                  <tr
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      borderBottom: '1px solid var(--border-color)',
                      textAlign: 'left',
                    }}
                  >
                    <th
                      style={{
                        padding: '10px 14px',
                        fontSize: '0.71rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: 'var(--text-muted)',
                      }}
                    >
                      Pacote
                    </th>
                    <th
                      style={{
                        padding: '10px 12px',
                        fontSize: '0.71rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: 'var(--text-muted)',
                      }}
                    >
                      Versão
                    </th>
                    <th
                      style={{
                        padding: '10px 12px',
                        fontSize: '0.71rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: 'var(--text-muted)',
                      }}
                    >
                      Estado
                    </th>
                    <th
                      data-testid="pack-studio-cache-status-col"
                      style={{
                        padding: '10px 12px',
                        fontSize: '0.71rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: 'var(--text-muted)',
                      }}
                    >
                      Cache Status
                    </th>
                    <th
                      style={{
                        padding: '10px 14px',
                        fontSize: '0.71rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: 'var(--text-muted)',
                        textAlign: 'right',
                      }}
                    >
                      Ação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allPackages.map((pkg, idx) => {
                    const isUpdating = busyKey === `pack:${pkg.pack_id}` || busyKey === 'all';
                    const cacheMeta = resolvePackageCacheStatusMeta(
                      pkg.cache_status,
                      pkg.installed,
                      pkg.has_update
                    );
                    const isLast = idx === allPackages.length - 1;

                    return (
                      <tr
                        key={pkg.pack_id}
                        data-testid={
                          pkg.has_update
                            ? `pack-studio-pending-pack-${pkg.pack_id}`
                            : `pack-studio-pack-row-${pkg.pack_id}`
                        }
                        style={{
                          borderBottom: isLast ? 'none' : '1px solid var(--border-subtle)',
                          backgroundColor: pkg.has_update
                            ? 'rgba(245, 158, 11, 0.05)'
                            : 'transparent',
                        }}
                      >
                        <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: '6px',
                              }}
                            >
                              <strong style={{ color: 'var(--text-primary)', fontSize: '0.84rem' }}>
                                {pkg.name}
                              </strong>
                              {pkg.is_custom && (
                                <span
                                  style={{
                                    fontSize: '0.66rem',
                                    fontWeight: 700,
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    backgroundColor: 'rgba(99, 102, 241, 0.14)',
                                    color: '#4338ca',
                                  }}
                                >
                                  Personalizado
                                </span>
                              )}
                            </div>
                            <span
                              style={{
                                fontSize: '0.73rem',
                                color: 'var(--text-secondary)',
                                lineHeight: 1.35,
                              }}
                            >
                              {pkg.changelog}
                            </span>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '0.68rem',
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--text-muted)',
                              }}
                            >
                              <ShieldCheck size={11} />
                              <span>{pkg.checksum_sha256.slice(0, 26)}…</span>
                            </span>
                          </div>
                        </td>

                        <td
                          style={{
                            padding: '12px',
                            verticalAlign: 'middle',
                            whiteSpace: 'nowrap',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.75rem',
                            color: 'var(--text-primary)',
                            fontWeight: 600,
                          }}
                        >
                          {pkg.installed ? (
                            pkg.has_update ? (
                              <span style={{ color: '#b45309' }}>
                                v{pkg.installed_version} → v{pkg.latest_version}
                              </span>
                            ) : (
                              <span>v{pkg.installed_version}</span>
                            )
                          ) : (
                            <span style={{ color: 'var(--text-secondary)' }}>
                              v{pkg.latest_version}
                            </span>
                          )}
                        </td>

                        <td
                          style={{
                            padding: '12px',
                            verticalAlign: 'middle',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              padding: '3px 8px',
                              borderRadius: '6px',
                              border: pkg.has_update
                                ? '1px solid #d97706'
                                : pkg.installed
                                  ? '1px solid #16a34a'
                                  : '1px solid var(--border-color)',
                              backgroundColor: pkg.has_update
                                ? '#fef3c7'
                                : pkg.installed
                                  ? '#dcfce7'
                                  : 'var(--bg-secondary)',
                              color: pkg.has_update
                                ? '#92400e'
                                : pkg.installed
                                  ? '#166534'
                                  : 'var(--text-secondary)',
                            }}
                          >
                            {pkg.has_update
                              ? 'Update disponível'
                              : pkg.installed
                                ? 'Atualizado'
                                : 'Disponível'}
                          </span>
                        </td>

                        <td
                          data-testid={`pack-cache-status-${pkg.pack_id}`}
                          data-cache-code={cacheMeta.code}
                          style={{
                            padding: '12px',
                            verticalAlign: 'middle',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                width: 'fit-content',
                                fontSize: '0.71rem',
                                fontWeight: 700,
                                padding: '3px 8px',
                                borderRadius: '6px',
                                border: cacheMeta.readyForImmediateDeploy
                                  ? '1px solid rgba(22, 163, 74, 0.45)'
                                  : '1px solid rgba(37, 99, 235, 0.4)',
                                backgroundColor: cacheMeta.readyForImmediateDeploy
                                  ? '#dcfce7'
                                  : '#dbeafe',
                                color: cacheMeta.readyForImmediateDeploy ? '#166534' : '#1e40af',
                              }}
                            >
                              {cacheMeta.readyForImmediateDeploy ? (
                                <HardDrive size={12} />
                              ) : (
                                <CloudDownload size={12} />
                              )}
                              <span>{cacheMeta.badgeLabel}</span>
                            </span>
                            <span
                              style={{
                                fontSize: '0.69rem',
                                color: 'var(--text-muted)',
                                fontFamily: 'var(--font-mono)',
                              }}
                            >
                              {cacheMeta.detailLabel} · {pkg.artifact_size_kb} KB
                            </span>
                          </div>
                        </td>

                        <td
                          style={{
                            padding: '12px 14px',
                            verticalAlign: 'middle',
                            textAlign: 'right',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {pkg.has_update ? (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={busyKey !== null}
                              aria-label={`Atualizar pacote ${pkg.name}`}
                              data-testid={`update-pack-btn-${pkg.pack_id}`}
                              onClick={() => void handleApply('pack', pkg.pack_id)}
                            >
                              {isUpdating ? (
                                <Loader2 size={13} className="spin" />
                              ) : (
                                <ArrowUpCircle size={13} />
                              )}
                              <span>{isUpdating ? 'Atualizando...' : 'Atualizar pacote'}</span>
                            </button>
                          ) : pkg.installed ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                fontSize: '0.74rem',
                                fontWeight: 600,
                                color: '#15803d',
                              }}
                            >
                              <CheckCircle2 size={14} />
                              <span>Sincronizado</span>
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: '0.73rem',
                                color: 'var(--text-muted)',
                              }}
                            >
                              Não instalado
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Agentes Pendentes (quando houver) */}
          {pendingAgents.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                }}
              >
                <Cpu size={14} color="var(--accent-primary)" />
                <span>Agentes com atualização ({pendingAgents.length})</span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                  gap: '10px',
                }}
              >
                {pendingAgents.map((ag) => {
                  const isUpdating = busyKey === `agent:${ag.role}` || busyKey === 'all';
                  return (
                    <article
                      key={ag.role}
                      data-testid={`pack-studio-pending-agent-${ag.role}`}
                      style={{
                        padding: '11px 13px',
                        borderRadius: '10px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'var(--bg-primary)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: '10px',
                        }}
                      >
                        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                          <strong style={{ fontSize: '0.84rem', color: 'var(--text-primary)' }}>
                            {ag.proper_name}{' '}
                            <span
                              style={{
                                fontWeight: 500,
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.72rem',
                                color: 'var(--text-muted)',
                              }}
                            >
                              {ag.handle}
                            </span>
                          </strong>
                          <div
                            style={{
                              fontSize: '0.72rem',
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--text-secondary)',
                              wordBreak: 'break-word',
                            }}
                          >
                            v{ag.current_version} → v{ag.latest_version}
                            {ag.preferred_model !== ag.recommended_model
                              ? ` · ${ag.preferred_model} → ${ag.recommended_model}`
                              : ` · ${ag.preferred_model}`}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ flexShrink: 0 }}
                          disabled={busyKey !== null}
                          aria-label={`Atualizar agente ${ag.proper_name}`}
                          data-testid={`update-agent-btn-${ag.role}`}
                          onClick={() => void handleApply('agent', ag.role)}
                        >
                          {isUpdating ? (
                            <Loader2 size={13} className="spin" />
                          ) : (
                            <ArrowUpCircle size={13} />
                          )}
                          <span>{isUpdating ? 'Atualizando...' : 'Atualizar agente'}</span>
                        </button>
                      </div>
                      <p
                        style={{
                          margin: 0,
                          fontSize: '0.74rem',
                          color: 'var(--text-secondary)',
                          lineHeight: 1.4,
                        }}
                      >
                        {ag.reason}
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
