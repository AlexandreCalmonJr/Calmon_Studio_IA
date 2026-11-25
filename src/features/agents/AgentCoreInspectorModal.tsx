import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Cpu, FileText, ShieldCheck, Save, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  ALLOWED_AUTONOMY_POLICIES,
  ALLOWED_ORCHESTRATION_MODES,
  ALLOWED_PROVIDERS,
  AUTONOMY_POLICY_LABELS,
  KNOWN_MCP_SERVERS,
  ORCHESTRATION_MODE_LABELS,
  type AgentAutonomyPolicy,
  type AgentCoreConfig,
  type AgentCoreReadiness,
  type AgentOrchestrationMode,
} from '../../services/agentCoreEngine';
import { fetchAgentCore, saveAgentCore } from '../../services/api/packs';

interface AgentCoreInspectorModalProps {
  isOpen: boolean;
  agentRole: string;
  agentName: string;
  agentHandle?: string;
  onClose: () => void;
  onSaved?: (core: AgentCoreConfig, readiness: AgentCoreReadiness) => void;
}

type CoreTabId = 'orchestration' | 'memory' | 'guardrails';

const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Google Gemini (Servidor)',
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  deepseek: 'DeepSeek',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  ollama: 'Ollama (Local)',
};

export const AgentCoreInspectorModal: React.FC<AgentCoreInspectorModalProps> = ({
  isOpen,
  agentRole,
  agentName,
  agentHandle,
  onClose,
  onSaved,
}) => {
  const [activeTab, setActiveTab] = useState<CoreTabId>('orchestration');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [core, setCore] = useState<AgentCoreConfig | null>(null);
  const [readiness, setReadiness] = useState<AgentCoreReadiness | null>(null);

  useEffect(() => {
    if (!isOpen || !agentRole) return;
    let active = true;
    setLoading(true);
    setError(null);
    setSavedNotice(null);

    fetchAgentCore(agentRole)
      .then((res) => {
        if (!active) return;
        setCore(res.core);
        setReadiness(res.readiness);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Não foi possível carregar o núcleo do agente.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, agentRole]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggleMcpServer = (serverId: string) => {
    if (!core) return;
    const exists = core.allowed_mcp_servers.includes(serverId);
    const next = exists
      ? core.allowed_mcp_servers.filter((id) => id !== serverId)
      : [...core.allowed_mcp_servers, serverId];
    setCore({ ...core, allowed_mcp_servers: next });
    setSavedNotice(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!core) return;
    setSaving(true);
    setError(null);
    setSavedNotice(null);
    try {
      const result = await saveAgentCore(agentRole, {
        orchestration_mode: core.orchestration_mode,
        max_steps: core.max_steps,
        max_delegation_depth: core.max_delegation_depth,
        primary_provider: core.primary_provider,
        primary_model: core.primary_model,
        fallback_provider: core.fallback_provider,
        fallback_model: core.fallback_model,
        autonomy_policy: core.autonomy_policy,
        daily_budget_usd: core.daily_budget_usd,
        allowed_mcp_servers: core.allowed_mcp_servers,
        soul_markdown: core.soul_markdown,
        memory_markdown: core.memory_markdown,
        cron_schedule: core.cron_schedule,
        status: core.status,
      });
      setCore(result.core);
      setReadiness(result.readiness);
      setSavedNotice('Núcleo salvo no SQLite e sincronizado com o workspace do agente.');
      onSaved?.(result.core, result.readiness);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar núcleo individual.');
    } finally {
      setSaving(false);
    }
  };

  const modalNode = (
    <div
      className="jarvis-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-core-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="jarvis-modal-sheet jarvis-core-modal">
        <header className="jarvis-core-modal-header">
          <div>
            <p className="jarvis-kicker-text">
              <span>Núcleo Individual</span>
              <span aria-hidden="true"> · </span>
              <span className="mono">{core?.workspace_slug || `agent_${agentRole}`}</span>
              {readiness && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="tabular-nums">Prontidão {readiness.completenessPct}%</span>
                </>
              )}
            </p>
            <h2 id="agent-core-modal-title" className="jarvis-core-modal-title">
              {agentName}
              {agentHandle ? (
                <span className="mono jarvis-core-handle"> {agentHandle}</span>
              ) : null}
            </h2>
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-icon-sm"
            onClick={onClose}
            aria-label="Fechar inspetor de núcleo"
          >
            <X size={16} />
          </button>
        </header>

        <nav className="jarvis-core-tabs" role="tablist" aria-label="Seções do núcleo do agente">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'orchestration'}
            className={`jarvis-core-tab ${activeTab === 'orchestration' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('orchestration')}
          >
            <Cpu size={14} />
            <span>Orquestração & Modelo</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'memory'}
            className={`jarvis-core-tab ${activeTab === 'memory' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('memory')}
          >
            <FileText size={14} />
            <span>SOUL.md & Memória</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'guardrails'}
            className={`jarvis-core-tab ${activeTab === 'guardrails' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('guardrails')}
          >
            <ShieldCheck size={14} />
            <span>MCP & Limites</span>
          </button>
        </nav>

        <form onSubmit={handleSave} className="jarvis-core-modal-body">
          {loading ? (
            <div className="jarvis-core-loading">
              <Loader2 size={18} className="spin" />
              <span>Carregando núcleo isolado do agente...</span>
            </div>
          ) : error && !core ? (
            <div className="jarvis-inline-alert is-error" role="alert">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          ) : core ? (
            <>
              {error && (
                <div className="jarvis-inline-alert is-error" role="alert">
                  <AlertCircle size={15} />
                  <span>{error}</span>
                </div>
              )}

              {savedNotice && (
                <div className="jarvis-inline-alert is-success" role="status">
                  <CheckCircle2 size={15} />
                  <span>{savedNotice}</span>
                </div>
              )}

              {activeTab === 'orchestration' && (
                <div className="jarvis-core-section">
                  <div className="jarvis-core-grid-2">
                    <label className="jarvis-field">
                      <span className="jarvis-field-label">Loop de Orquestração</span>
                      <select
                        className="jarvis-input"
                        value={core.orchestration_mode}
                        onChange={(e) => {
                          setCore({
                            ...core,
                            orchestration_mode: e.target.value as AgentOrchestrationMode,
                          });
                          setSavedNotice(null);
                        }}
                      >
                        {ALLOWED_ORCHESTRATION_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {ORCHESTRATION_MODE_LABELS[mode]}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="jarvis-field">
                      <span className="jarvis-field-label">Estado do Núcleo</span>
                      <select
                        className="jarvis-input"
                        value={core.status}
                        onChange={(e) => {
                          setCore({
                            ...core,
                            status: e.target.value === 'paused' ? 'paused' : 'active',
                          });
                          setSavedNotice(null);
                        }}
                      >
                        <option value="active">Ativo (aceita tarefas e delegações)</option>
                        <option value="paused">Pausado (somente inspeção)</option>
                      </select>
                    </label>
                  </div>

                  <div className="jarvis-core-divider" />

                  <div className="jarvis-core-grid-2">
                    <label className="jarvis-field">
                      <span className="jarvis-field-label">Provedor Primário</span>
                      <select
                        className="jarvis-input"
                        value={core.primary_provider}
                        onChange={(e) => {
                          setCore({ ...core, primary_provider: e.target.value });
                          setSavedNotice(null);
                        }}
                      >
                        {ALLOWED_PROVIDERS.map((prov) => (
                          <option key={prov} value={prov}>
                            {PROVIDER_LABELS[prov] || prov}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="jarvis-field">
                      <span className="jarvis-field-label">Modelo Primário</span>
                      <input
                        type="text"
                        className="jarvis-input mono"
                        value={core.primary_model}
                        onChange={(e) => {
                          setCore({ ...core, primary_model: e.target.value });
                          setSavedNotice(null);
                        }}
                        placeholder="ex.: gemini-2.5-pro"
                      />
                    </label>
                  </div>

                  <div className="jarvis-core-grid-2">
                    <label className="jarvis-field">
                      <span className="jarvis-field-label">Provedor de Fallback</span>
                      <select
                        className="jarvis-input"
                        value={core.fallback_provider}
                        onChange={(e) => {
                          setCore({ ...core, fallback_provider: e.target.value });
                          setSavedNotice(null);
                        }}
                      >
                        {ALLOWED_PROVIDERS.map((prov) => (
                          <option key={prov} value={prov}>
                            {PROVIDER_LABELS[prov] || prov}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="jarvis-field">
                      <span className="jarvis-field-label">Modelo de Fallback</span>
                      <input
                        type="text"
                        className="jarvis-input mono"
                        value={core.fallback_model}
                        onChange={(e) => {
                          setCore({ ...core, fallback_model: e.target.value });
                          setSavedNotice(null);
                        }}
                        placeholder="ex.: gpt-4.1-mini"
                      />
                    </label>
                  </div>

                  <p className="jarvis-field-hint">
                    O provedor de fallback é acionado automaticamente se o modelo primário falhar ou ficar indisponível.
                  </p>
                </div>
              )}

              {activeTab === 'memory' && (
                <div className="jarvis-core-section">
                  <label className="jarvis-field">
                    <span className="jarvis-field-label">
                      SOUL.md — Constituição e Protocolo de Raciocínio
                    </span>
                    <textarea
                      className="jarvis-textarea mono"
                      rows={8}
                      value={core.soul_markdown}
                      onChange={(e) => {
                        setCore({ ...core, soul_markdown: e.target.value });
                        setSavedNotice(null);
                      }}
                    />
                  </label>

                  <label className="jarvis-field">
                    <span className="jarvis-field-label">
                      MEMORY.md — Memória Persistente Isolada do Agente
                    </span>
                    <textarea
                      className="jarvis-textarea mono"
                      rows={6}
                      value={core.memory_markdown}
                      onChange={(e) => {
                        setCore({ ...core, memory_markdown: e.target.value });
                        setSavedNotice(null);
                      }}
                    />
                  </label>

                  <p className="jarvis-field-hint">
                    Sincronizado em disco no workspace isolado <code className="mono">{core.workspace_slug}/SOUL.md</code> e{' '}
                    <code className="mono">{core.workspace_slug}/MEMORY.md</code>.
                  </p>
                </div>
              )}

              {activeTab === 'guardrails' && (
                <div className="jarvis-core-section">
                  <div className="jarvis-core-grid-3">
                    <label className="jarvis-field">
                      <span className="jarvis-field-label">Máximo de Passos</span>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        className="jarvis-input tabular-nums mono"
                        value={core.max_steps}
                        onChange={(e) => {
                          setCore({ ...core, max_steps: Number(e.target.value) || 1 });
                          setSavedNotice(null);
                        }}
                      />
                    </label>

                    <label className="jarvis-field">
                      <span className="jarvis-field-label">Profundidade Delegação</span>
                      <input
                        type="number"
                        min={0}
                        max={5}
                        className="jarvis-input tabular-nums mono"
                        value={core.max_delegation_depth}
                        onChange={(e) => {
                          setCore({ ...core, max_delegation_depth: Number(e.target.value) || 0 });
                          setSavedNotice(null);
                        }}
                      />
                    </label>

                    <label className="jarvis-field">
                      <span className="jarvis-field-label">Teto Diário (USD)</span>
                      <input
                        type="number"
                        min={0}
                        max={500}
                        step="0.5"
                        className="jarvis-input tabular-nums mono"
                        value={core.daily_budget_usd}
                        onChange={(e) => {
                          setCore({ ...core, daily_budget_usd: Number(e.target.value) || 0 });
                          setSavedNotice(null);
                        }}
                      />
                    </label>
                  </div>

                  <div className="jarvis-core-grid-2">
                    <label className="jarvis-field">
                      <span className="jarvis-field-label">Política de Autonomia</span>
                      <select
                        className="jarvis-input"
                        value={core.autonomy_policy}
                        onChange={(e) => {
                          setCore({
                            ...core,
                            autonomy_policy: e.target.value as AgentAutonomyPolicy,
                          });
                          setSavedNotice(null);
                        }}
                      >
                        {ALLOWED_AUTONOMY_POLICIES.map((pol) => (
                          <option key={pol} value={pol}>
                            {AUTONOMY_POLICY_LABELS[pol]}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="jarvis-field">
                      <span className="jarvis-field-label">Agendamento Cron (opcional)</span>
                      <input
                        type="text"
                        className="jarvis-input mono"
                        value={core.cron_schedule || ''}
                        onChange={(e) => {
                          setCore({ ...core, cron_schedule: e.target.value || null });
                          setSavedNotice(null);
                        }}
                        placeholder="ex.: 0 9 * * 1-5"
                      />
                    </label>
                  </div>

                  <div className="jarvis-core-divider" />

                  <fieldset className="jarvis-mcp-fieldset">
                    <legend className="jarvis-field-label">
                      Servidores MCP Permitidos para este Núcleo
                    </legend>
                    <div className="jarvis-mcp-list">
                      {KNOWN_MCP_SERVERS.map((server) => {
                        const checked = core.allowed_mcp_servers.includes(server.id);
                        return (
                          <label key={server.id} className="jarvis-mcp-option">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleMcpServer(server.id)}
                            />
                            <span className="jarvis-mcp-option-text">
                              <strong>{server.label}</strong>
                              <span className="jarvis-mcp-scope">
                                {server.id} · {server.scope}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                </div>
              )}

              <footer className="jarvis-core-modal-footer">
                <span className="jarvis-footer-meta">
                  Atualizado em{' '}
                  <span className="mono tabular-nums">
                    {new Date(core.updated_at).toLocaleString('pt-BR')}
                  </span>
                </span>
                <div className="jarvis-core-footer-actions">
                  <button type="button" className="btn btn-secondary" onClick={onClose}>
                    Fechar
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                    <span>{saving ? 'Salvando...' : 'Salvar núcleo'}</span>
                  </button>
                </div>
              </footer>
            </>
          ) : null}
        </form>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalNode, document.body) : modalNode;
};
