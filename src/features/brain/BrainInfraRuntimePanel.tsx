import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  Database,
  HardDrive,
  Layers,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Terminal,
  Trash2,
} from 'lucide-react';
import {
  deleteChannelBindingApi,
  deleteScheduledJobApi,
  execSandboxCommandApi,
  fetchChannelBindingsApi,
  fetchInfraDiagnosticsApi,
  fetchSandboxSessionsApi,
  fetchScheduledJobsApi,
  migratePostgresSchemaApi,
  runScheduledJobNowApi,
  saveChannelBindingApi,
  saveScheduledJobApi,
  testChannelOutboundApi,
  tickSchedulerNowApi,
  toggleSchedulerDaemonApi,
  type ChannelBindingItem,
  type ChannelOutboundReadiness,
  type InfrastructureDiagnosticsResponse,
  type SandboxSessionItem,
  type ScheduledJobItem,
  type SchedulerDaemonStatus,
} from '../../services/api/brainServer';
import { hubStore } from '../../services/hubStore';
import { notify } from '../../shared/common/Toast';

export const BrainInfraRuntimePanel: React.FC = () => {
  const [diag, setDiag] = useState<InfrastructureDiagnosticsResponse | null>(null);
  const [sandboxSessions, setSandboxSessions] = useState<SandboxSessionItem[]>([]);
  const [jobs, setJobs] = useState<ScheduledJobItem[]>([]);
  const [daemon, setDaemon] = useState<SchedulerDaemonStatus | null>(null);
  const [tickingDaemon, setTickingDaemon] = useState<boolean>(false);
  const [bindings, setBindings] = useState<ChannelBindingItem[]>([]);
  const [outboundReadiness, setOutboundReadiness] = useState<ChannelOutboundReadiness | null>(null);
  const [testingBindingId, setTestingBindingId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [probing, setProbing] = useState<boolean>(false);
  const [migratingPg, setMigratingPg] = useState<boolean>(false);
  const [showPgDdl, setShowPgDdl] = useState<boolean>(false);

  // Sandbox quick test
  const [sandboxInput, setSandboxInput] = useState<string>('node -v');
  const [runningSandbox, setRunningSandbox] = useState<boolean>(false);

  // New Scheduled Job form
  const [jobName, setJobName] = useState<string>('');
  const [jobCron, setJobCron] = useState<string>('0 9 * * *');
  const [jobTarget, setJobTarget] = useState<string>('');
  const [savingJob, setSavingJob] = useState<boolean>(false);

  // New Channel Binding form
  const [chanProvider, setChanProvider] = useState<'telegram' | 'discord' | 'slack' | 'whatsapp'>('telegram');
  const [chanLabel, setChanLabel] = useState<string>('');
  const [chanExternalId, setChanExternalId] = useState<string>('');
  const [savingChan, setSavingChan] = useState<boolean>(false);

  const loadAll = useCallback(async (probe = false) => {
    if (probe) setProbing(true);
    else setLoading(true);
    try {
      const [d, sbx, jList, cList] = await Promise.all([
        hubStore.fetch(
          `brain_infra:${probe ? 'probe' : 'fast'}`,
          () => fetchInfraDiagnosticsApi(probe),
          { force: probe, ttlMs: 10_000 }
        ),
        fetchSandboxSessionsApi(),
        fetchScheduledJobsApi(),
        fetchChannelBindingsApi(),
      ]);
      setDiag(d);
      setSandboxSessions(sbx.sessions || []);
      setJobs(jList.jobs || []);
      setDaemon(jList.daemon || d.scheduler_daemon || null);
      setBindings(cList.bindings || []);
      setOutboundReadiness(cList.outbound || d.channel_outbound || null);
    } catch (err: any) {
      notify(err?.message || 'Falha ao carregar diagnósticos de infraestrutura.', 'error');
    } finally {
      setLoading(false);
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    void loadAll(false);
  }, [loadAll]);

  const handleExecSandbox = async () => {
    const parts = sandboxInput.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return;
    setRunningSandbox(true);
    try {
      const [cmd, ...args] = parts;
      const res = await execSandboxCommandApi(cmd, args);
      setSandboxSessions((prev) => [res.session, ...prev].slice(0, 20));
      if (!res.allowed) {
        notify(res.reason || 'Comando bloqueado pela política do Sandbox.', 'warning');
      } else {
        notify(`Sandbox concluído (${res.session.status} · ${res.session.duration_ms} ms).`, 'success');
      }
    } catch (err: any) {
      notify(err?.message || 'Falha ao executar comando no Sandbox.', 'error');
    } finally {
      setRunningSandbox(false);
    }
  };

  const handleAddJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobName.trim() || !jobTarget.trim()) return;
    setSavingJob(true);
    try {
      const res = await saveScheduledJobApi({
        name: jobName.trim(),
        cron_expr: jobCron.trim(),
        target_type: 'agent_prompt',
        target_ref: jobTarget.trim(),
      });
      setJobs((prev) => [res.job, ...prev]);
      setJobName('');
      setJobTarget('');
      notify('Rotina agendada persistida no banco.', 'success');
    } catch (err: any) {
      notify(err?.message || 'Erro ao salvar rotina agendada.', 'error');
    } finally {
      setSavingJob(false);
    }
  };

  const handleRunJobNow = async (id: string) => {
    try {
      const res = await runScheduledJobNowApi(id);
      setJobs((prev) => prev.map((j) => (j.id === id ? res.job : j)));
      notify(`Rotina disparada · Run ${res.runId} registrada.`, 'success');
    } catch (err: any) {
      notify(err?.message || 'Erro ao disparar rotina.', 'error');
    }
  };

  const handleDeleteJob = async (id: string) => {
    try {
      await deleteScheduledJobApi(id);
      setJobs((prev) => prev.filter((j) => j.id !== id));
      notify('Rotina removida.', 'info');
    } catch (err: any) {
      notify(err?.message || 'Erro ao excluir rotina.', 'error');
    }
  };

  const handleAddBinding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chanLabel.trim() || !chanExternalId.trim()) return;
    setSavingChan(true);
    try {
      const res = await saveChannelBindingApi({
        provider: chanProvider,
        label: chanLabel.trim(),
        external_chat_id: chanExternalId.trim(),
        agent_role: 'jarvis_master',
      });
      setBindings((prev) => [res.binding, ...prev]);
      setChanLabel('');
      setChanExternalId('');
      notify(`Vínculo ${chanProvider.toUpperCase()} salvo com isolamento por usuário.`, 'success');
    } catch (err: any) {
      notify(err?.message || 'Erro ao salvar vínculo de canal.', 'error');
    } finally {
      setSavingChan(false);
    }
  };

  const handleDeleteBinding = async (id: string) => {
    try {
      await deleteChannelBindingApi(id);
      setBindings((prev) => prev.filter((b) => b.id !== id));
      notify('Vínculo de canal removido.', 'info');
    } catch (err: any) {
      notify(err?.message || 'Erro ao remover vínculo.', 'error');
    }
  };

  const handleTickScheduler = async () => {
    setTickingDaemon(true);
    try {
      const res = await tickSchedulerNowApi();
      setDaemon(res.status);
      if (res.executed.length > 0) {
        const refreshed = await fetchScheduledJobsApi();
        setJobs(refreshed.jobs || []);
        notify(`${res.executed.length} rotina(s) vencida(s) executada(s) pelo motor 24/7.`, 'success');
      } else {
        notify(`Ciclo #${res.status.tick_count} concluído · nenhuma rotina vencida no momento.`, 'info');
      }
    } catch (err: any) {
      notify(err?.message || 'Erro ao verificar fila do agendador.', 'error');
    } finally {
      setTickingDaemon(false);
    }
  };

  const handleToggleDaemon = async () => {
    const nextEnabled = !(daemon?.running ?? true);
    try {
      const res = await toggleSchedulerDaemonApi(nextEnabled);
      setDaemon(res.daemon);
      notify(
        res.daemon.running
          ? 'Motor 24/7 do agendador reativado.'
          : 'Motor 24/7 pausado temporariamente.',
        'info'
      );
    } catch (err: any) {
      notify(err?.message || 'Erro ao alternar motor 24/7.', 'error');
    }
  };

  const handleTestOutbound = async (bindingId: string) => {
    setTestingBindingId(bindingId);
    try {
      const res = await testChannelOutboundApi(bindingId);
      if (res.delivery.status === 'sent') {
        notify(res.delivery.detail, 'success');
      } else if (res.delivery.status === 'skipped_unconfigured') {
        notify(res.delivery.detail, 'warning');
      } else {
        notify(res.delivery.detail, 'error');
      }
    } catch (err: any) {
      notify(err?.message || 'Falha ao testar envio de saída.', 'error');
    } finally {
      setTestingBindingId(null);
    }
  };

  const handleMigratePostgres = async () => {
    setMigratingPg(true);
    try {
      const res = await migratePostgresSchemaApi();
      notify(res.detail, res.ok ? 'success' : 'warning');
      await loadAll(true);
    } catch (err: any) {
      notify(err?.message || 'Falha ao aplicar schema PostgreSQL + pgvector.', 'error');
    } finally {
      setMigratingPg(false);
    }
  };

  return (
    <div data-testid="brain-infra-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Cabeçalho e Ação de Sondagem */}
      <div
        className="glass-panel"
        style={{
          padding: '18px 20px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Infraestrutura Plugável, Sandbox &amp; Ecossistema 24/7
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Zero-setup local por padrão (SQLite WAL + Disco Local Confinado) com caminho ativo para PostgreSQL/pgvector, Redis, S3/MinIO e Docker via variáveis de ambiente.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowPgDdl((v) => !v)}
          >
            <Database size={14} />
            <span>{showPgDdl ? 'Ocultar DDL pgvector' : 'Ver DDL PostgreSQL + pgvector'}</span>
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={probing}
            onClick={() => void loadAll(true)}
          >
            <RefreshCw size={14} className={probing ? 'spin' : undefined} />
            <span>{probing ? 'Sondando...' : 'Sondar Drivers & MCPs'}</span>
          </button>
        </div>
      </div>

      {/* Grade dos 4 Subsistemas Plugáveis */}
      {loading && !diag ? (
        <div className="glass-panel" style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
          Carregando diagnósticos de infraestrutura...
        </div>
      ) : diag ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '14px',
          }}
        >
          <div className="glass-panel" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <Database size={15} color="var(--accent-light)" />
              <span>Motor de Banco de Dados</span>
            </div>
            <div style={{ marginTop: '6px', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {diag.database.engine_label}
            </div>
            <div className="tabular-nums" style={{ marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {diag.database.postgres_configured
                ? `pgvector: ${diag.database.pgvector_ready ? 'ativo' : 'pendente'} · ${diag.database.postgres_reachable === true ? 'conectado' : diag.database.postgres_reachable === false ? 'inacessível' : 'não sondado'}`
                : `busy_timeout ${diag.database.sqlite_busy_timeout_ms} ms · ${diag.database.composite_indexes_count} índices · ${diag.database.recoverable_runs_count} retomável(is)`}
            </div>
            {diag.database.postgres_configured && (
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                style={{ marginTop: '8px' }}
                disabled={migratingPg}
                onClick={() => void handleMigratePostgres()}
              >
                <span>{migratingPg ? 'Aplicando DDL...' : 'Aplicar Schema pgvector'}</span>
              </button>
            )}
          </div>

          <div className="glass-panel" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <Layers size={15} color="var(--accent-light)" />
              <span>Fila Durável / Redis RESP2</span>
            </div>
            <div style={{ marginTop: '6px', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {diag.queue.driver_label}
            </div>
            <div className="tabular-nums" style={{ marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {diag.queue.redis_configured
                ? `Redis: ${diag.queue.redis_reachable === true ? `online (${diag.queue.redis_latency_ms ?? 1} ms)` : diag.queue.redis_reachable === false ? 'fallback SQLite' : 'configurado'} · ${diag.queue.distributed_locks_acquired ?? 0} lock(s)`
                : `${diag.queue.active_lanes} faixa(s) ativa(s) · ${diag.queue.total_executed} job(s) · Redis RESP2 pronto via REDIS_URL`}
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <HardDrive size={15} color="var(--accent-light)" />
              <span>Object Storage (SigV4)</span>
            </div>
            <div style={{ marginTop: '6px', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {diag.storage.mode_label}
            </div>
            <div className="tabular-nums" style={{ marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {diag.storage.bucket
                ? `Bucket: ${diag.storage.bucket} · SigV4: ${diag.storage.sigv4_enabled ? 'ativo' : 'pendente'} · ${diag.storage.remote_synced_count ?? 0} sync(s)`
                : 'Confinado em .jarvis-brain/artifacts · S3/MinIO/GCS SigV4 pronto via .env'}
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <ShieldCheck size={15} color="var(--accent-light)" />
              <span>Sandbox &amp; Container Docker</span>
            </div>
            <div style={{ marginTop: '6px', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {diag.sandbox.driver_label}
            </div>
            <div className="tabular-nums" style={{ marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {diag.sandbox.docker_available === true
                ? `Docker Engine v${diag.sandbox.docker_version || 'ativo'} · imagem ${diag.sandbox.docker_image || 'node:22-alpine'}`
                : diag.sandbox.docker_available === false
                  ? `Host sem daemon Docker · modo local confinado (${diag.sandbox.allowlisted_binaries.length} binários)`
                  : `Allowlist: ${diag.sandbox.allowlisted_binaries.join(', ')} · Docker ${diag.sandbox.docker_image || 'node:22-alpine'} pronto`}
            </div>
          </div>
        </div>
      ) : null}

      {showPgDdl && diag?.pgvector_schema_ddl && (
        <div className="glass-panel" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
            Schema PostgreSQL 16 + pgvector HNSW (ativado automaticamente com DATABASE_URL)
          </div>
          <pre
            style={{
              margin: 0,
              padding: '12px',
              borderRadius: '8px',
              backgroundColor: 'var(--code-bg, var(--bg-input))',
              color: 'var(--code-text, var(--text-primary))',
              fontSize: '0.73rem',
              fontFamily: 'var(--font-mono)',
              maxHeight: '240px',
              overflow: 'auto',
            }}
          >
            {diag.pgvector_schema_ddl}
          </pre>
        </div>
      )}

      {/* Supervisor Real de MCPs + Sandbox Confinado */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px' }}>
        <div className="glass-panel" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            <Activity size={16} color="var(--accent-light)" />
            <span>Supervisor de Runtime MCP</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 4px' }}>Servidor</th>
                  <th style={{ padding: '6px 4px' }}>Transporte</th>
                  <th style={{ padding: '6px 4px' }}>Estado</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Ferramentas</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Reinícios</th>
                </tr>
              </thead>
              <tbody>
                {(diag?.mcp_runtime || []).map((entry) => (
                  <tr key={entry.server_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '8px 4px', fontWeight: 600, color: 'var(--text-primary)' }}>{entry.name}</td>
                    <td style={{ padding: '8px 4px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      {entry.transport} · {entry.protocol_version || 'JSON-RPC 2.0'}
                    </td>
                    <td style={{ padding: '8px 4px', color: entry.runtime_state === 'online' ? 'var(--success-text)' : 'var(--warning-text)' }}>
                      {entry.runtime_state === 'online' ? 'Online' : entry.runtime_state}
                    </td>
                    <td className="tabular-nums" style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--text-secondary)' }}>{entry.tools_count}</td>
                    <td className="tabular-nums" style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--text-secondary)' }}>{entry.restart_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            <Terminal size={16} color="var(--accent-light)" />
            <span>Sandbox Confinado (Teste &amp; Auditoria)</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={sandboxInput}
              onChange={(e) => setSandboxInput(e.target.value)}
              placeholder="Ex.: node -v, pwd ou ls"
              aria-label="Comando para testar no Sandbox"
              style={{
                flex: 1,
                padding: '7px 10px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontFamily: 'var(--font-mono)',
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={runningSandbox}
              onClick={() => void handleExecSandbox()}
            >
              <Play size={13} />
              <span>{runningSandbox ? 'Executando...' : 'Executar'}</span>
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
            {sandboxSessions.length === 0 ? (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Nenhuma execução auditada ainda. Comandos fora da allowlist são bloqueados e registrados.
              </div>
            ) : (
              sandboxSessions.slice(0, 6).map((s) => (
                <div
                  key={s.id}
                  style={{
                    padding: '7px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: 'var(--bg-surface)',
                    fontSize: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <code style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>$ {s.command}</code>
                    <span className="tabular-nums" style={{ color: s.status === 'completed' ? 'var(--success-text)' : 'var(--danger-text)' }}>
                      {s.status} · {s.duration_ms} ms
                    </span>
                  </div>
                  {(s.stdout_excerpt || s.stderr_excerpt) && (
                    <div style={{ marginTop: '4px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '0.71rem', whiteSpace: 'pre-wrap' }}>
                      {(s.stdout_excerpt || s.stderr_excerpt).slice(0, 180)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Agendador Persistente & Gateway de Canais 24/7 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px' }}>
        <div className="glass-panel" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              <CalendarClock size={16} color="var(--accent-light)" />
              <span>Agendador 24/7 ({jobs.length})</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                data-testid="scheduler-tick-btn"
                className="btn btn-secondary btn-xs"
                disabled={tickingDaemon}
                onClick={() => void handleTickScheduler()}
              >
                <RefreshCw size={12} className={tickingDaemon ? 'spin' : undefined} />
                <span>{tickingDaemon ? 'Verificando...' : 'Verificar fila'}</span>
              </button>
              <button
                type="button"
                data-testid="scheduler-toggle-btn"
                className="btn btn-ghost btn-xs"
                onClick={() => void handleToggleDaemon()}
                title={daemon?.running ? 'Pausar motor 24/7' : 'Ativar motor 24/7'}
              >
                {daemon?.running ? <Pause size={12} /> : <Play size={12} />}
                <span>{daemon?.running ? 'Pausar' : 'Ativar'}</span>
              </button>
            </div>
          </div>
          {daemon && (
            <div
              data-testid="scheduler-daemon-status"
              className="tabular-nums"
              style={{
                fontSize: '0.73rem',
                color: daemon.running ? 'var(--success-text)' : 'var(--warning-text)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <span>{daemon.running ? 'Motor 24/7 ativo' : 'Motor 24/7 pausado'}</span>
              <span style={{ color: 'var(--text-muted)' }}>·</span>
              <span style={{ color: 'var(--text-secondary)' }}>
                ciclo a cada {Math.round(daemon.interval_ms / 1000)}s · {daemon.tick_count} verificação(ões) · {daemon.due_executed_count} disparo(s) automático(s)
              </span>
            </div>
          )}
          <form onSubmit={(e) => void handleAddJob(e)} style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: '8px' }}>
            <input
              type="text"
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              placeholder="Nome da rotina (ex.: Resumo diário)"
              aria-label="Nome da rotina agendada"
              style={{ padding: '7px 10px', borderRadius: '8px', fontSize: '0.78rem', backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            />
            <input
              type="text"
              value={jobCron}
              onChange={(e) => setJobCron(e.target.value)}
              placeholder="0 9 * * *"
              aria-label="Expressão cron"
              style={{ padding: '7px 10px', borderRadius: '8px', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            />
            <input
              type="text"
              value={jobTarget}
              onChange={(e) => setJobTarget(e.target.value)}
              placeholder="Prompt ou objetivo da rotina..."
              aria-label="Objetivo da rotina agendada"
              style={{ gridColumn: '1 / -1', padding: '7px 10px', borderRadius: '8px', fontSize: '0.78rem', backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            />
            <button type="submit" className="btn btn-secondary btn-sm" disabled={savingJob} style={{ gridColumn: '1 / -1', justifyContent: 'center' }}>
              <Plus size={13} />
              <span>{savingJob ? 'Salvando...' : 'Adicionar rotina persistente'}</span>
            </button>
          </form>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {jobs.length === 0 ? (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Nenhuma rotina agendada. Todas as rotinas ficam salvas no banco e sobrevivem a reinícios.
              </div>
            ) : (
              jobs.map((job) => (
                <div
                  key={job.id}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                    backgroundColor: 'var(--bg-surface)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{job.name}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {job.cron_expr} · {job.last_status ? `Último: ${job.last_status}` : 'Aguardando disparo'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => void handleRunJobNow(job.id)} title="Executar agora">
                      <Play size={12} />
                    </button>
                    <button type="button" className="btn btn-danger-ghost btn-xs" onClick={() => void handleDeleteJob(job.id)} title="Remover rotina">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              <MessageSquare size={16} color="var(--accent-light)" />
              <span>Gateway de Canais 24/7 ({bindings.length})</span>
            </div>
            {outboundReadiness && (
              <span
                data-testid="channel-outbound-summary"
                style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}
              >
                Saída ativa:{' '}
                {(['telegram', 'discord', 'slack', 'whatsapp'] as const)
                  .filter((p) => outboundReadiness[p]?.configured)
                  .map((p) => p.toUpperCase())
                  .join(', ') || 'configure tokens no .env'}
              </span>
            )}
          </div>
          <form onSubmit={(e) => void handleAddBinding(e)} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px' }}>
            <select
              value={chanProvider}
              onChange={(e) => setChanProvider(e.target.value as any)}
              aria-label="Provedor do canal"
              style={{ padding: '7px 8px', borderRadius: '8px', fontSize: '0.78rem', backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >
              <option value="telegram">Telegram</option>
              <option value="discord">Discord</option>
              <option value="slack">Slack</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
            <input
              type="text"
              value={chanLabel}
              onChange={(e) => setChanLabel(e.target.value)}
              placeholder="Rótulo (ex.: Grupo Operações)"
              aria-label="Rótulo do vínculo de canal"
              style={{ padding: '7px 10px', borderRadius: '8px', fontSize: '0.78rem', backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            />
            <input
              type="text"
              value={chanExternalId}
              onChange={(e) => setChanExternalId(e.target.value)}
              placeholder="ID do Chat / Canal externo"
              aria-label="Identificador externo do chat"
              style={{ gridColumn: '1 / -1', padding: '7px 10px', borderRadius: '8px', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            />
            <button type="submit" className="btn btn-secondary btn-sm" disabled={savingChan} style={{ gridColumn: '1 / -1', justifyContent: 'center' }}>
              <Plus size={13} />
              <span>{savingChan ? 'Vinculando...' : 'Conectar canal com isolamento de conta'}</span>
            </button>
          </form>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {bindings.length === 0 ? (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Nenhum canal conectado. Webhooks em <code>/api/v1/brain/channels/webhook/:provider</code> exigem segredo validado por ambiente e despacham respostas de saída automaticamente.
              </div>
            ) : (
              bindings.map((b) => {
                const outboundOk = outboundReadiness?.[b.provider]?.configured ?? false;
                return (
                  <div
                    key={b.id}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-subtle)',
                      backgroundColor: 'var(--bg-surface)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <CheckCircle2 size={13} color={outboundOk ? 'var(--success-text)' : 'var(--warning-text)'} />
                        <span>{b.provider.toUpperCase()} · {b.label}</span>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                        {b.external_chat_id} · @{b.agent_role} · {outboundOk ? 'Saída ativa' : 'Token saída pendente'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                      <button
                        type="button"
                        data-testid={`channel-test-reply-${b.id}`}
                        className="btn btn-ghost btn-xs"
                        disabled={testingBindingId === b.id}
                        onClick={() => void handleTestOutbound(b.id)}
                        title="Testar envio de resposta de saída"
                      >
                        <Send size={12} />
                        <span>{testingBindingId === b.id ? '...' : 'Testar envio'}</span>
                      </button>
                      <button type="button" className="btn btn-danger-ghost btn-xs" onClick={() => void handleDeleteBinding(b.id)} title="Desconectar canal">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
