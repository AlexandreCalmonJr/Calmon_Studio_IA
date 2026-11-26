import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Cpu,
  Download,
  FileCode2,
  FolderOpen,
  History,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Terminal,
  X,
} from 'lucide-react';
import {
  executeRunSandboxStepApi,
  fetchAgentRunStatsApi,
  getRunArtifactDownloadUrl,
  type AgentRunDetailResponse,
  type AgentRunRecord,
  type AgentRunStatsResponse,
} from '../../services/api/chat';
import { execSandboxCommandApi, type SandboxSessionItem } from '../../services/api/brainServer';
import { notify } from '../../shared/common/Toast';

type WorkspaceTab = 'steps' | 'files' | 'context';

const QUICK_SANDBOX_COMMANDS = [
  { label: 'node -v', cmd: 'node -v' },
  { label: 'python3', cmd: 'python3 --version' },
  { label: 'ls -la', cmd: 'ls -la' },
  { label: 'pwd', cmd: 'pwd' },
  { label: 'git status', cmd: 'git status --short' },
];

interface AgentRunWorkspacePanelProps {
  runs: AgentRunRecord[];
  activeDetail: AgentRunDetailResponse | null;
  loading?: boolean;
  resuming?: boolean;
  onSelectRun: (runId: string) => void;
  onResumeCheckpoint: (runId: string, fromStepIndex?: number) => void;
  onRunDetailUpdated?: (detail: AgentRunDetailResponse) => void;
  onRefresh: () => void;
  onClose: () => void;
}

const STATUS_META: Record<
  AgentRunRecord['status'],
  { label: string; color: string }
> = {
  queued: { label: 'Na fila', color: 'var(--info-text)' },
  running: { label: 'Em execução', color: 'var(--accent-light)' },
  paused: { label: 'Pausado', color: 'var(--warning-text)' },
  completed: { label: 'Concluído', color: 'var(--success-text)' },
  failed: { label: 'Falhou', color: 'var(--danger-text)' },
  interrupted: { label: 'Interrompido · Retomável', color: 'var(--warning-text)' },
};

const STEP_KIND_LABEL: Record<string, string> = {
  plan: 'Planejamento',
  memory: 'Memória & Contexto',
  skill: 'Habilidade',
  mcp: 'Ferramenta MCP',
  sandbox: 'Sandbox',
  model: 'Inferência',
  artifact: 'Artefato',
  response: 'Entrega',
};

export const AgentRunWorkspacePanel: React.FC<AgentRunWorkspacePanelProps> = ({
  runs,
  activeDetail,
  loading = false,
  resuming = false,
  onSelectRun,
  onResumeCheckpoint,
  onRunDetailUpdated,
  onRefresh,
  onClose,
}) => {
  const [tab, setTab] = useState<WorkspaceTab>('steps');
  const [selectedStepIdx, setSelectedStepIdx] = useState<number | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [sandboxCmd, setSandboxCmd] = useState<string>('node -v');
  const [sandboxRunning, setSandboxRunning] = useState<boolean>(false);
  const [sandboxOutput, setSandboxOutput] = useState<SandboxSessionItem | null>(null);
  const [stats, setStats] = useState<AgentRunStatsResponse | null>(null);

  const run = activeDetail?.run || null;
  const steps = activeDetail?.steps || [];
  const artifacts = activeDetail?.artifacts || [];

  const reloadStats = () => {
    fetchAgentRunStatsApi()
      .then((data) => setStats(data))
      .catch(() => {});
  };

  useEffect(() => {
    reloadStats();
  }, [run?.id, steps.length]);

  const inspectedStep = useMemo(() => {
    if (steps.length === 0) return null;
    if (selectedStepIdx !== null) {
      return steps.find((s) => s.step_index === selectedStepIdx) || steps[steps.length - 1];
    }
    return steps[steps.length - 1];
  }, [steps, selectedStepIdx]);

  const inspectedPos = useMemo(() => {
    if (!inspectedStep || steps.length === 0) return -1;
    return steps.findIndex((s) => s.id === inspectedStep.id);
  }, [steps, inspectedStep]);

  const inspectedPayload = useMemo(() => {
    if (!inspectedStep?.checkpoint_payload_json) return null;
    try {
      const parsed = JSON.parse(inspectedStep.checkpoint_payload_json);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }, [inspectedStep]);

  const inspectedArtifact = useMemo(() => {
    if (artifacts.length === 0) return null;
    if (selectedArtifactId) {
      return artifacts.find((a) => a.id === selectedArtifactId) || artifacts[0];
    }
    return artifacts[0];
  }, [artifacts, selectedArtifactId]);

  const totalDurationMs = useMemo(
    () => steps.reduce((acc, s) => acc + (s.duration_ms || 0), 0),
    [steps]
  );

  const handleRunSandbox = async (overrideCmd?: string) => {
    const raw = (overrideCmd ?? sandboxCmd).trim();
    if (overrideCmd) setSandboxCmd(overrideCmd);
    const tokens = raw.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return;
    setSandboxRunning(true);
    try {
      const [command, ...args] = tokens;
      if (run?.id) {
        const res = await executeRunSandboxStepApi(run.id, command, args);
        setSandboxOutput(res.session);
        if (res.detail && onRunDetailUpdated) {
          onRunDetailUpdated(res.detail);
          setSelectedStepIdx(res.step.step_index);
        }
        reloadStats();
        if (!res.allowed) {
          notify(res.reason || 'Comando bloqueado pela allowlist do Sandbox.', 'warning');
        } else {
          notify(`Comando "${raw}" gravado como passo #${res.step.step_index + 1} na linha do tempo.`, 'success');
        }
      } else {
        const res = await execSandboxCommandApi(command, args, { run_id: null });
        setSandboxOutput(res.session);
        if (!res.allowed) {
          notify(res.reason || 'Comando bloqueado pela allowlist do Sandbox.', 'warning');
        }
      }
    } catch (err: any) {
      notify(err?.message || 'Erro ao executar comando no Sandbox.', 'error');
    } finally {
      setSandboxRunning(false);
    }
  };

  const statusMeta = run ? STATUS_META[run.status] || STATUS_META.completed : null;

  return (
    <aside
      data-testid="chat-live-workspace-panel"
      aria-label="Workspace ao vivo do agente"
      style={{
        width: 'min(420px, 42vw)',
        minWidth: '320px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--workspace-panel-bg, var(--bg-secondary))',
        borderLeft: '1px solid var(--workspace-panel-border, var(--border-color))',
        flexShrink: 0,
        minHeight: 0,
      }}
    >
      {/* Cabeçalho enxuto do Workspace Vivo */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.84rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            <History size={15} color="var(--accent-light)" />
            <span>Workspace do Agente</span>
          </div>
          <div
            style={{
              marginTop: '2px',
              fontSize: '0.72rem',
              color: statusMeta?.color || 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {run ? (
              <>
                {run.status === 'running' ? (
                  <Loader2 size={11} className="spin" />
                ) : run.status === 'completed' ? (
                  <CheckCircle2 size={11} />
                ) : (
                  <AlertTriangle size={11} />
                )}
                <span>{statusMeta?.label}</span>
                <span aria-hidden="true">·</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {steps.length} etapa{steps.length === 1 ? '' : 's'} · {totalDurationMs} ms
                </span>
              </>
            ) : (
              <span>Nenhuma execução selecionada</span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            type="button"
            className="btn btn-ghost btn-icon-sm"
            onClick={onRefresh}
            title="Atualizar linha do tempo"
            aria-label="Atualizar linha do tempo"
          >
            <RefreshCw size={13} className={loading ? 'spin' : undefined} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon-sm"
            onClick={onClose}
            title="Fechar Workspace do Agente"
            aria-label="Fechar Workspace do Agente"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Faixa compacta de observabilidade durável */}
      {stats && (
        <div
          data-testid="workspace-observability-strip"
          className="tabular-nums"
          style={{
            padding: '7px 14px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            fontSize: '0.71rem',
            color: 'var(--text-muted)',
            backgroundColor: 'var(--bg-tertiary)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <Activity size={12} color="var(--accent-light)" />
            <span>
              {stats.total_runs} exec. · {stats.sandbox_steps + stats.mcp_steps} ferr. · {stats.artifacts_count} arq.
            </span>
          </span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {stats.avg_step_ms} ms/etapa
          </span>
        </div>
      )}

      {/* Seletor de execuções da sessão (Replay histórico) */}
      {runs.length > 0 && (
        <div
          style={{
            padding: '8px 14px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <select
            aria-label="Selecionar execução para replay"
            value={run?.id || ''}
            onChange={(e) => {
              setSelectedStepIdx(null);
              setSelectedArtifactId(null);
              onSelectRun(e.target.value);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: '0.76rem',
              padding: '5px 8px',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-input)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
            }}
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.agent_name} · {r.prompt.slice(0, 42)}{r.prompt.length > 42 ? '…' : ''} ({r.status})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Abas do Painel Lateral (3 abas limpas) */}
      <div
        role="tablist"
        aria-label="Seções do workspace do agente"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '4px',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {(
          [
            { id: 'steps', label: `Passos (${steps.length})` },
            { id: 'files', label: `Arquivos (${artifacts.length})` },
            { id: 'context', label: 'Sandbox & Info' },
          ] as const
        ).map((item) => {
          const isActive = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(item.id)}
              style={{
                padding: '6px 8px',
                borderRadius: '8px',
                fontSize: '0.74rem',
                fontWeight: isActive ? 600 : 500,
                border: isActive ? '1px solid var(--border-accent)' : '1px solid transparent',
                backgroundColor: isActive ? 'var(--workspace-step-active-bg, var(--accent-soft))' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Corpo rolável com respiro inferior dinâmico do Dock */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 14px calc(18px + var(--jarvis-dock-clearance, 0px))',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          minHeight: 0,
        }}
      >
        {!run && !loading ? (
          <div
            style={{
              padding: '28px 14px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '0.8rem',
              lineHeight: 1.5,
            }}
          >
            <Clock size={22} style={{ margin: '0 auto 8px', opacity: 0.65 }} />
            <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Linha do tempo durável pronta
            </div>
            Envie uma mensagem no chat para acompanhar passos, checkpoints, artefatos salvos e replay em tempo real.
          </div>
        ) : tab === 'steps' ? (
          <>
            {/* Controle de Replay Passo a Passo */}
            {steps.length > 1 && inspectedPos >= 0 && (
              <div
                data-testid="workspace-replay-scrubber"
                style={{
                  padding: '8px 10px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <span className="tabular-nums" style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Replay · Etapa {inspectedPos + 1} de {steps.length}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      type="button"
                      data-testid="workspace-replay-prev"
                      className="btn btn-ghost btn-xs"
                      disabled={inspectedPos <= 0}
                      onClick={() => setSelectedStepIdx(steps[inspectedPos - 1].step_index)}
                      aria-label="Etapa anterior no replay"
                    >
                      <ChevronLeft size={13} />
                      <span>Anterior</span>
                    </button>
                    <button
                      type="button"
                      data-testid="workspace-replay-next"
                      className="btn btn-ghost btn-xs"
                      disabled={inspectedPos >= steps.length - 1}
                      onClick={() => setSelectedStepIdx(steps[inspectedPos + 1].step_index)}
                      aria-label="Próxima etapa no replay"
                    >
                      <span>Próximo</span>
                      <ChevronRight size={13} />
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    height: '4px',
                    borderRadius: '999px',
                    backgroundColor: 'var(--border-subtle)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.round(((inspectedPos + 1) / steps.length) * 100)}%`,
                      height: '100%',
                      backgroundColor: 'var(--accent-primary)',
                      transition: 'width 160ms ease',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Lista de Passos / Checkpoints */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {steps.map((step) => {
                const isSelected = inspectedStep?.id === step.id;
                return (
                  <button
                    key={step.id}
                    type="button"
                    data-testid={`workspace-step-${step.step_index}`}
                    onClick={() => setSelectedStepIdx(step.step_index)}
                    style={{
                      textAlign: 'left',
                      width: '100%',
                      padding: '9px 10px',
                      borderRadius: '10px',
                      border: isSelected
                        ? '1px solid var(--border-accent)'
                        : '1px solid var(--border-subtle)',
                      backgroundColor: isSelected
                        ? 'var(--workspace-step-active-bg, var(--accent-soft))'
                        : 'var(--workspace-step-bg, var(--bg-tertiary))',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '3px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        #{step.step_index + 1} · {step.title}
                      </span>
                      <span
                        className="tabular-nums"
                        style={{
                          fontSize: '0.7rem',
                          color: 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                          flexShrink: 0,
                        }}
                      >
                        {step.duration_ms} ms
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: '0.72rem',
                        color: 'var(--text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span>{STEP_KIND_LABEL[step.kind] || step.kind}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {step.output_summary || step.input_summary || step.status}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Inspetor do Checkpoint selecionado + Botão Retomar */}
            {inspectedStep && run && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                  }}
                >
                  <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Replay do Checkpoint #{inspectedStep.step_index + 1}
                  </span>
                  <button
                    type="button"
                    data-testid="workspace-resume-checkpoint-btn"
                    className="btn btn-secondary btn-xs"
                    disabled={resuming}
                    onClick={() => onResumeCheckpoint(run.id, inspectedStep.step_index)}
                  >
                    {resuming ? <Loader2 size={12} className="spin" /> : <RotateCcw size={12} />}
                    <span>{resuming ? 'Executando retomada...' : 'Retomar deste checkpoint'}</span>
                  </button>
                </div>

                {inspectedStep.input_summary && (
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Entrada:</strong> {inspectedStep.input_summary}
                  </div>
                )}
                {inspectedStep.output_summary && (
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Resultado:</strong> {inspectedStep.output_summary}
                  </div>
                )}
                {(inspectedStep.kind === 'sandbox' || inspectedStep.kind === 'mcp') && inspectedPayload && (
                  <pre
                    data-testid="workspace-tool-output"
                    style={{
                      margin: 0,
                      padding: '8px 10px',
                      borderRadius: '8px',
                      fontSize: '0.71rem',
                      lineHeight: 1.45,
                      fontFamily: 'var(--font-mono)',
                      backgroundColor: 'var(--code-bg, var(--bg-input))',
                      color:
                        inspectedStep.status === 'completed'
                          ? 'var(--code-text, var(--text-primary))'
                          : 'var(--danger-text)',
                      maxHeight: '150px',
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {inspectedStep.kind === 'sandbox'
                      ? `[${String(inspectedPayload.driver || 'sandbox')} · exit ${inspectedPayload.exit_code ?? 'bloqueado'}]\n${String(
                          inspectedPayload.stdout_excerpt ||
                            inspectedPayload.stderr_excerpt ||
                            inspectedStep.output_summary ||
                            '(sem saída)'
                        )}`
                      : `[MCP · ${String(inspectedPayload.server_name || 'servidor')} → ${String(
                          inspectedPayload.tool_name || 'tool'
                        )}]\n${String(
                          inspectedPayload.output_excerpt ||
                            inspectedPayload.error ||
                            inspectedStep.output_summary ||
                            '(sem saída)'
                        )}`}
                  </pre>
                )}
                {run.final_summary && (
                  <div
                    data-testid="workspace-final-summary"
                    style={{
                      marginTop: '2px',
                      paddingTop: '8px',
                      borderTop: '1px solid var(--border-subtle)',
                      fontSize: '0.73rem',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.45,
                    }}
                  >
                    <strong style={{ color: 'var(--text-primary)' }}>Síntese atual ({run.model_used || 'auto'}):</strong>{' '}
                    {run.final_summary.slice(0, 320)}
                  </div>
                )}
              </div>
            )}
          </>
        ) : tab === 'files' ? (
          artifacts.length === 0 ? (
            <div
              style={{
                padding: '24px 12px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '0.78rem',
              }}
            >
              <FolderOpen size={20} style={{ margin: '0 auto 8px', opacity: 0.65 }} />
              Nenhum arquivo ou bloco de código salvo nesta execução ainda.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {artifacts.map((art) => {
                const isSelected = inspectedArtifact?.id === art.id;
                return (
                  <button
                    key={art.id}
                    type="button"
                    onClick={() => setSelectedArtifactId(art.id)}
                    style={{
                      textAlign: 'left',
                      padding: '9px 10px',
                      borderRadius: '10px',
                      border: isSelected ? '1px solid var(--border-accent)' : '1px solid var(--border-subtle)',
                      backgroundColor: isSelected
                        ? 'var(--workspace-step-active-bg, var(--accent-soft))'
                        : 'var(--workspace-step-bg, var(--bg-tertiary))',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        <FileCode2 size={13} color="var(--accent-light)" />
                        {art.title}
                      </span>
                      <span className="tabular-nums" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {art.size_bytes} B
                      </span>
                    </div>
                    <div style={{ marginTop: '3px', fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {art.storage_driver} · sha256:{art.sha256.slice(0, 12)}
                    </div>
                  </button>
                );
              })}

              {inspectedArtifact && run && (
                <div
                  style={{
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-surface)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      padding: '8px 10px',
                      borderBottom: '1px solid var(--border-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '6px',
                    }}
                  >
                    <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Prévia · {inspectedArtifact.title}
                    </span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => {
                          void navigator.clipboard?.writeText(inspectedArtifact.preview_text || '');
                          notify('Conteúdo copiado para a área de transferência.', 'success');
                        }}
                      >
                        <Copy size={12} />
                        <span>Copiar</span>
                      </button>
                      <a
                        className="btn btn-secondary btn-xs"
                        href={getRunArtifactDownloadUrl(run.id, inspectedArtifact.id)}
                        download
                      >
                        <Download size={12} />
                        <span>Baixar</span>
                      </a>
                    </div>
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: '10px',
                      maxHeight: '260px',
                      overflow: 'auto',
                      fontSize: '0.72rem',
                      lineHeight: 1.45,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--code-text, var(--text-primary))',
                      backgroundColor: 'var(--code-bg, var(--bg-input))',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {inspectedArtifact.preview_text || '(Prévia vazia)'}
                  </pre>
                </div>
              )}
            </div>
          )
        ) : (
          /* Aba Contexto & Sandbox Confinado */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {run && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--workspace-step-bg, var(--bg-tertiary))',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  <Cpu size={13} color="var(--accent-light)" />
                  <span>Metadados da Execução</span>
                </div>
                <div>Modelo: <strong style={{ color: 'var(--text-primary)' }}>{run.model_used || 'auto'}</strong></div>
                <div>Especialista: <strong style={{ color: 'var(--text-primary)' }}>{run.agent_name}</strong> ({run.agent_role})</div>
                <div>Modo: <strong style={{ color: 'var(--text-primary)' }}>{run.execution_mode}</strong></div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  Run ID: {run.id}
                </div>
              </div>
            )}

            {/* Sandbox Confinado ao vivo dentro do Chat */}
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-surface)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Terminal size={13} color="var(--accent-light)" />
                  <span>Sandbox Confinado (Allowlist)</span>
                </span>
                <span style={{ fontSize: '0.68rem', fontWeight: 500, color: 'var(--text-muted)' }}>
                  {stats?.sandbox_driver === 'docker_ephemeral' ? 'Docker Efêmero' : 'Local Confinado'}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                {QUICK_SANDBOX_COMMANDS.map((q) => (
                  <button
                    key={q.cmd}
                    type="button"
                    className="btn btn-ghost btn-xs"
                    disabled={sandboxRunning}
                    onClick={() => void handleRunSandbox(q.cmd)}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.69rem',
                      padding: '3px 7px',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  value={sandboxCmd}
                  onChange={(e) => setSandboxCmd(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRunSandbox();
                  }}
                  placeholder="Ex.: node -v ou ls"
                  aria-label="Comando do Sandbox confinado"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: '6px 8px',
                    borderRadius: '8px',
                    fontSize: '0.75rem',
                    fontFamily: 'var(--font-mono)',
                    backgroundColor: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                  }}
                />
                <button
                  type="button"
                  data-testid="workspace-sandbox-run-btn"
                  className="btn btn-primary btn-xs"
                  disabled={sandboxRunning}
                  onClick={() => void handleRunSandbox()}
                >
                  <Play size={12} />
                  <span>{sandboxRunning ? '...' : 'Rodar'}</span>
                </button>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                Dica: no chat, use <code style={{ fontFamily: 'var(--font-mono)' }}>/sandbox node -v</code> ou{' '}
                <code style={{ fontFamily: 'var(--font-mono)' }}>/mcp ferramenta</code> para acionar ferramentas ao vivo na linha do tempo.
              </div>
              {sandboxOutput && (
                <pre
                  data-testid="workspace-sandbox-terminal-output"
                  style={{
                    margin: 0,
                    padding: '8px 10px',
                    borderRadius: '8px',
                    fontSize: '0.71rem',
                    fontFamily: 'var(--font-mono)',
                    backgroundColor: 'var(--code-bg, var(--bg-input))',
                    color: sandboxOutput.status === 'completed' ? 'var(--code-text, var(--text-primary))' : 'var(--danger-text)',
                    maxHeight: '160px',
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {`$ ${sandboxOutput.command} (${sandboxOutput.driver} · ${sandboxOutput.status} · ${sandboxOutput.duration_ms} ms)\n${sandboxOutput.stdout_excerpt || sandboxOutput.stderr_excerpt || '(sem saída)'}`}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
