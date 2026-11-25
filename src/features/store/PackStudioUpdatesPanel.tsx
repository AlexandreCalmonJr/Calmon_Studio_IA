import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpCircle,
  CheckCircle2,
  Cpu,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  applyAdminPackageUpdate,
  fetchPackageUpdatesStatus,
  type ApplyPackageUpdateResponse,
  type VersionCheckReport,
} from '../../services/api/packs';

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
  const [showUpToDate, setShowUpToDate] = useState<boolean>(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPackageUpdatesStatus();
      setReport(data);
    } catch (err) {
      onError?.(
        err instanceof Error
          ? err.message
          : 'Não foi possível verificar atualizações de pacotes e agentes.'
      );
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void loadReport();
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

  const pendingPacks = (report?.packages || []).filter((p) => p.has_update);
  const pendingAgents = (report?.agents || []).filter((a) => a.has_update);
  const totalUpdates = report?.summary.total_updates_available ?? 0;

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
                border:
                  totalUpdates > 0
                    ? '1px solid rgba(217, 119, 6, 0.45)'
                    : '1px solid rgba(22, 163, 74, 0.45)',
                backgroundColor:
                  totalUpdates > 0 ? 'rgba(217, 119, 6, 0.14)' : 'rgba(22, 163, 74, 0.14)',
                color: 'var(--text-primary)',
              }}
            >
              {totalUpdates > 0
                ? `${totalUpdates} pendente(s)`
                : 'Tudo atualizado'}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Dispare atualizações verificadas por SHA-256 a partir do cache local de artefatos e sincronize o status exibido em Cérebros &amp; Servidor.
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
          <span>Consultando manifesto de versões...</span>
        </div>
      ) : totalUpdates === 0 ? (
        <div
          data-testid="pack-studio-all-updated"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            padding: '12px 14px',
            borderRadius: '10px',
            border: '1px solid rgba(22, 163, 74, 0.35)',
            backgroundColor: 'rgba(22, 163, 74, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--text-primary)' }}>
            <CheckCircle2 size={16} color="#16a34a" />
            <span>
              Todos os {report?.summary.installed_packages ?? 0} pacote(s) instalado(s) e{' '}
              {report?.summary.total_agents ?? 0} agente(s) estão na versão mais recente do cache local.
            </span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowUpToDate((prev) => !prev)}
          >
            {showUpToDate ? 'Ocultar inventário' : 'Ver versões instaladas'}
          </button>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '14px',
          }}
        >
          {/* Lista de Pacotes Pendentes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              <Package size={14} color="var(--accent-primary)" />
              <span>Pacotes com atualização ({pendingPacks.length})</span>
            </div>
            {pendingPacks.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.77rem', color: 'var(--text-muted)' }}>
                Nenhum pacote pendente de atualização.
              </p>
            ) : (
              pendingPacks.map((pkg) => {
                const isUpdating = busyKey === `pack:${pkg.pack_id}` || busyKey === 'all';
                return (
                  <article
                    key={pkg.pack_id}
                    data-testid={`pack-studio-pending-pack-${pkg.pack_id}`}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-primary)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <div>
                        <strong style={{ fontSize: '0.86rem', color: 'var(--text-primary)' }}>
                          {pkg.name}
                        </strong>
                        <div style={{ fontSize: '0.73rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                          v{pkg.installed_version} → v{pkg.latest_version} · {pkg.artifact_size_kb} KB
                        </div>
                      </div>
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
                    </div>
                    <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                      {pkg.changelog}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.69rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                      <ShieldCheck size={11} />
                      <span>{pkg.checksum_sha256}</span>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {/* Lista de Agentes Pendentes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              <Cpu size={14} color="var(--accent-primary)" />
              <span>Agentes com atualização ({pendingAgents.length})</span>
            </div>
            {pendingAgents.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.77rem', color: 'var(--text-muted)' }}>
                Todos os agentes estão na versão mais recente.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '340px', overflowY: 'auto', paddingRight: '2px' }}>
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
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                          <strong style={{ fontSize: '0.84rem', color: 'var(--text-primary)' }}>
                            {ag.proper_name}{' '}
                            <span style={{ fontWeight: 500, fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              {ag.handle}
                            </span>
                          </strong>
                          <div style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
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
                      <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        {ag.reason}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {showUpToDate && report && (
        <div
          style={{
            marginTop: '10px',
            paddingTop: '10px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          {report.packages
            .filter((p) => p.installed)
            .map((p) => (
              <span
                key={p.pack_id}
                style={{
                  fontSize: '0.72rem',
                  fontFamily: 'var(--font-mono)',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)',
                }}
              >
                {p.name}: v{p.installed_version}
              </span>
            ))}
        </div>
      )}
    </section>
  );
};
