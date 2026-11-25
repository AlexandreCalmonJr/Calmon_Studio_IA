import React from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  HardDrive,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { VersionCheckReport } from '../../services/packageVersionEngine';

interface BrainUpdatesPanelProps {
  report: VersionCheckReport | null;
  loading: boolean;
  canManagePacks: boolean;
  onRefresh: () => void;
  onOpenPackStudio?: () => void;
}

export const BrainUpdatesPanel: React.FC<BrainUpdatesPanelProps> = ({
  report,
  loading,
  canManagePacks,
  onRefresh,
  onOpenPackStudio,
}) => {
  const totalUpdates = report?.summary.total_updates_available ?? 0;
  const outdatedPacks = report?.summary.outdated_packages ?? 0;
  const outdatedAgents = report?.summary.outdated_agents ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }} data-testid="brain-updates-panel">
      {/* Banner de Status & Ação para Admin */}
      <section
        className="jarvis-settings-card"
        style={{
          padding: '20px 22px',
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          borderLeft: totalUpdates > 0 ? '4px solid #d97706' : '4px solid #16a34a',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: '1 1 420px', minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
            <span
              data-testid="brain-updates-panel-status"
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '3px 9px',
                borderRadius: '6px',
                border: totalUpdates > 0 ? '1px solid rgba(217, 119, 6, 0.45)' : '1px solid rgba(22, 163, 74, 0.45)',
                backgroundColor:
                  totalUpdates > 0 ? 'rgba(217, 119, 6, 0.14)' : 'rgba(22, 163, 74, 0.14)',
                color: 'var(--text-primary)',
              }}
            >
              {totalUpdates > 0
                ? `${totalUpdates} atualização(ões) pendente(s)`
                : 'Todos os pacotes e agentes atualizados'}
            </span>
            <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Cache Local de Artefatos · Hub v{report?.summary.hub_current_version || '3.0.1'}
            </span>
          </div>

          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Verificação de Versões — Pacotes Modulares &amp; Agentes
          </h2>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {totalUpdates > 0
              ? `Detectamos ${outdatedPacks} pacote(s) e ${outdatedAgents} agente(s) com novas versões verificadas no cache local. Administradores podem disparar o update em 1 clique no Estúdio de Pacotes.`
              : 'Nenhuma divergência de versão encontrada entre o SQLite local e o manifesto do registro de artefatos.'}
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="btn btn-secondary btn-sm"
            data-testid="brain-check-updates-btn"
          >
            {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            <span>{loading ? 'Verificando...' : 'Verificar versões'}</span>
          </button>

          {canManagePacks && onOpenPackStudio ? (
            <button
              type="button"
              onClick={onOpenPackStudio}
              className="btn btn-primary btn-sm"
              data-testid="brain-open-pack-studio-btn"
            >
              <Sparkles size={14} />
              <span>Atualizar no Estúdio de Pacotes</span>
              <ArrowUpRight size={14} />
            </button>
          ) : (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Apenas administradores podem aplicar updates no Estúdio de Pacotes.
            </span>
          )}
        </div>
      </section>

      {/* Grid 2 Colunas: Pacotes Modulares + Agentes */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          gap: '18px',
          alignItems: 'start',
        }}
      >
        {/* Pacotes Modulares */}
        <section className="jarvis-settings-card" style={{ padding: '20px', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Package size={17} color="var(--accent-primary)" />
              <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Pacotes Modulares ({report?.packages.length ?? 0})
              </h3>
            </div>
            <span style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
              {outdatedPacks} pendente(s)
            </span>
          </div>

          {loading && !report ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              <Loader2 size={15} className="spin" />
              <span>Consultando versões dos pacotes...</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {(report?.packages || []).map((pkg) => (
                <article
                  key={pkg.pack_id}
                  className="jarvis-settings-subcard"
                  data-testid={`brain-pack-version-${pkg.pack_id}`}
                  style={{
                    padding: '13px 14px',
                    gap: '7px',
                    borderLeft: pkg.has_update
                      ? '3px solid #d97706'
                      : pkg.installed
                        ? '3px solid #16a34a'
                        : '3px solid var(--border-color)',
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                      <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>{pkg.name}</strong>
                      <span
                        style={{
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: '5px',
                          border: pkg.has_update
                            ? '1px solid rgba(217, 119, 6, 0.45)'
                            : pkg.installed
                              ? '1px solid rgba(22, 163, 74, 0.4)'
                              : '1px solid var(--border-color)',
                          backgroundColor: pkg.has_update
                            ? 'rgba(217, 119, 6, 0.14)'
                            : pkg.installed
                              ? 'rgba(22, 163, 74, 0.12)'
                              : 'var(--bg-elevated)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        {pkg.has_update
                          ? 'Update disponível'
                          : pkg.installed
                            ? 'Atualizado'
                            : 'Não instalado'}
                      </span>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {pkg.installed
                        ? pkg.has_update
                          ? `v${pkg.installed_version} → v${pkg.latest_version}`
                          : `v${pkg.installed_version}`
                        : `v${pkg.latest_version}`}
                    </span>
                  </div>

                  <p style={{ margin: 0, fontSize: '0.77rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                    {pkg.changelog}
                  </p>

                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: '10px',
                      fontSize: '0.7rem',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <HardDrive size={11} />
                      <span>Cache local · {pkg.artifact_size_kb} KB</span>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <ShieldCheck size={11} />
                      <span>{pkg.checksum_sha256.slice(0, 22)}…</span>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* Agentes Ativos */}
        <section className="jarvis-settings-card" style={{ padding: '20px', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={17} color="var(--accent-primary)" />
              <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Agentes &amp; Núcleos ({report?.agents.length ?? 0})
              </h3>
            </div>
            <span style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
              {outdatedAgents} pendente(s)
            </span>
          </div>

          {loading && !report ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              <Loader2 size={15} className="spin" />
              <span>Auditando versões dos agentes...</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '560px', overflowY: 'auto', paddingRight: '2px' }}>
              {(report?.agents || []).map((ag) => (
                <article
                  key={ag.role}
                  className="jarvis-settings-subcard"
                  data-testid={`brain-agent-version-${ag.role}`}
                  style={{
                    padding: '12px 14px',
                    gap: '6px',
                    borderLeft: ag.has_update ? '3px solid #d97706' : '3px solid #16a34a',
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                      <strong style={{ fontSize: '0.86rem', color: 'var(--text-primary)' }}>
                        {ag.proper_name}
                      </strong>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {ag.handle}
                      </span>
                      <span
                        style={{
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: '5px',
                          border: ag.has_update
                            ? '1px solid rgba(217, 119, 6, 0.45)'
                            : '1px solid rgba(22, 163, 74, 0.4)',
                          backgroundColor: ag.has_update
                            ? 'rgba(217, 119, 6, 0.14)'
                            : 'rgba(22, 163, 74, 0.12)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        {ag.has_update ? 'Update disponível' : 'Atualizado'}
                      </span>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {ag.has_update ? `v${ag.current_version} → v${ag.latest_version}` : `v${ag.current_version}`}
                    </span>
                  </div>

                  <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                    {ag.reason}
                  </p>

                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: '10px',
                      fontSize: '0.7rem',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <span>
                      Modelo:{' '}
                      {ag.preferred_model !== ag.recommended_model
                        ? `${ag.preferred_model} → ${ag.recommended_model}`
                        : ag.preferred_model}
                    </span>
                    <span>· {ag.skills_count} skill(s)</span>
                    {!ag.has_update && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)' }}>
                        <CheckCircle2 size={11} color="#16a34a" />
                        <span>Sincronizado</span>
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
