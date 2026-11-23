import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Code2,
  Cpu,
  FileText,
  Loader2,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import type { AgentInfo } from '../../types';
import {
  ALLOWED_AUTONOMY_POLICIES,
  ALLOWED_ORCHESTRATION_MODES,
  ALLOWED_PROVIDERS,
  AUTONOMY_POLICY_LABELS,
  KNOWN_MCP_SERVERS,
  ORCHESTRATION_MODE_LABELS,
  buildDefaultAgentCore,
  evaluateAgentCoreReadiness,
  type AgentCoreConfig,
  type AgentCorePatch,
} from '../../services/agentCoreEngine';
import { saveAgentCore, type AgentCoreEnvelope } from '../../services/api/packs';
import { notify } from '../../shared/common/Toast';

interface AgentSchemaModeViewProps {
  agents: AgentInfo[];
  agentCoresByRole: Record<string, AgentCoreEnvelope>;
  onCoreSaved: (role: string, envelope: AgentCoreEnvelope) => void;
  onOpenFullInspector?: (agent: AgentInfo) => void;
}

interface SchemaDraftMap {
  [role: string]: AgentCoreConfig;
}

export const AgentSchemaModeView: React.FC<AgentSchemaModeViewProps> = ({
  agents,
  agentCoresByRole,
  onCoreSaved,
  onOpenFullInspector,
}) => {
  const [drafts, setDrafts] = useState<SchemaDraftMap>({});
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [jsonPreviewMap, setJsonPreviewMap] = useState<Record<string, boolean>>({});
  const [markdownOpenMap, setMarkdownOpenMap] = useState<Record<string, boolean>>({});
  const [filterText, setFilterText] = useState('');

  // Sincroniza rascunhos locais com o backend sem sobrescrever cartões em edição ativa
  useEffect(() => {
    setDrafts((prev) => {
      const next: SchemaDraftMap = { ...prev };
      for (const agent of agents) {
        if (dirtyMap[agent.role] && prev[agent.role]) continue;
        const serverCore = agentCoresByRole[agent.role]?.core;
        next[agent.role] =
          serverCore ||
          buildDefaultAgentCore(agent.role, {
            name: agent.name,
            proper_name: agent.proper_name,
            handle: agent.handle,
            mission: agent.mission,
            preferred_model: agent.preferred_model,
          });
      }
      return next;
    });
  }, [agents, agentCoresByRole, dirtyMap]);

  const filteredAgents = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((ag) => {
      const core = drafts[ag.role];
      return [
        ag.proper_name,
        ag.name,
        ag.handle,
        ag.role,
        core?.workspace_slug,
        core?.primary_model,
        core?.orchestration_mode,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [agents, drafts, filterText]);

  const updateDraftField = <K extends keyof AgentCoreConfig>(
    role: string,
    field: K,
    value: AgentCoreConfig[K]
  ) => {
    setDrafts((prev) => {
      const base = prev[role];
      if (!base) return prev;
      return {
        ...prev,
        [role]: { ...base, [field]: value },
      };
    });
    setDirtyMap((prev) => ({ ...prev, [role]: true }));
  };

  const toggleMcpServer = (role: string, serverId: string) => {
    const current = drafts[role];
    if (!current) return;
    const exists = current.allowed_mcp_servers.includes(serverId);
    const nextList = exists
      ? current.allowed_mcp_servers.filter((id) => id !== serverId)
      : [...current.allowed_mcp_servers, serverId];
    updateDraftField(role, 'allowed_mcp_servers', nextList);
  };

  const handleResetCard = (agent: AgentInfo) => {
    const serverCore =
      agentCoresByRole[agent.role]?.core ||
      buildDefaultAgentCore(agent.role, {
        name: agent.name,
        proper_name: agent.proper_name,
        handle: agent.handle,
        mission: agent.mission,
        preferred_model: agent.preferred_model,
      });
    setDrafts((prev) => ({ ...prev, [agent.role]: serverCore }));
    setDirtyMap((prev) => ({ ...prev, [agent.role]: false }));
  };

  const handleSaveCard = async (agent: AgentInfo) => {
    const draft = drafts[agent.role];
    if (!draft) return;
    setSavingRole(agent.role);
    try {
      const patch: AgentCorePatch = {
        orchestration_mode: draft.orchestration_mode,
        max_steps: draft.max_steps,
        max_delegation_depth: draft.max_delegation_depth,
        primary_provider: draft.primary_provider,
        primary_model: draft.primary_model,
        fallback_provider: draft.fallback_provider,
        fallback_model: draft.fallback_model,
        autonomy_policy: draft.autonomy_policy,
        daily_budget_usd: draft.daily_budget_usd,
        allowed_mcp_servers: draft.allowed_mcp_servers,
        soul_markdown: draft.soul_markdown,
        memory_markdown: draft.memory_markdown,
        cron_schedule: draft.cron_schedule,
        status: draft.status,
      };
      const saved = await saveAgentCore(agent.role, patch);
      setDrafts((prev) => ({ ...prev, [agent.role]: saved.core }));
      setDirtyMap((prev) => ({ ...prev, [agent.role]: false }));
      onCoreSaved(agent.role, saved);
      notify(
        `Schema do núcleo de ${agent.proper_name || agent.name} salvo no SQLite e sincronizado com SOUL.md/MEMORY.md.`,
        'success'
      );
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Não foi possível salvar o schema do núcleo.',
        'error'
      );
    } finally {
      setSavingRole(null);
    }
  };

  return (
    <section className="jarvis-schema-mode-root" aria-label="Modo Schema de Núcleos Individuais">
      <div className="jarvis-schema-toolbar">
        <div>
          <h2 className="jarvis-schema-toolbar-title">
            Modo Schema — Núcleos Individuais Editáveis
          </h2>
          <p className="jarvis-schema-toolbar-sub">
            Configure diretamente o loop de orquestração, modelos primário/fallback, autonomia,
            teto de custo, servidores MCP e arquivos SOUL.md/MEMORY.md de cada agente em cartões
            estruturados.
          </p>
        </div>
        <div className="jarvis-schema-search-wrap">
          <label htmlFor="agent-schema-search" className="sr-only">
            Filtrar agentes no Modo Schema
          </label>
          <input
            id="agent-schema-search"
            type="search"
            className="jarvis-input"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filtrar por agente, @handle, modelo ou loop..."
          />
        </div>
      </div>

      <div className="jarvis-schema-grid">
        {filteredAgents.map((agent) => {
          const core = drafts[agent.role];
          if (!core) return null;
          const readiness = evaluateAgentCoreReadiness(core);
          const isDirty = Boolean(dirtyMap[agent.role]);
          const isSaving = savingRole === agent.role;
          const showJson = Boolean(jsonPreviewMap[agent.role]);
          const showMarkdown = Boolean(markdownOpenMap[agent.role]);
          const displayName = agent.proper_name || agent.name;
          const handle = agent.handle || `@${agent.role}`;

          return (
            <article
              key={agent.role}
              className={`jarvis-schema-card ${isDirty ? 'is-dirty' : ''}`}
              data-schema-agent={agent.role}
            >
              <header className="jarvis-schema-card-head">
                <div className="jarvis-schema-card-id">
                  <div className="jarvis-kicker-text">
                    <span className="mono">{handle}</span>
                    <span aria-hidden="true"> · </span>
                    <span className="mono">{core.workspace_slug}</span>
                    <span aria-hidden="true"> · </span>
                    <span className={core.status === 'active' ? 'jarvis-text-success' : ''}>
                      {core.status === 'active' ? 'Ativo' : 'Pausado'}
                    </span>
                  </div>
                  <h3 className="jarvis-schema-card-title">{displayName}</h3>
                  <p className="jarvis-schema-card-role">{agent.name}</p>
                </div>

                <div className="jarvis-schema-readiness">
                  <span className="jarvis-pack-spec-label">Prontidão</span>
                  <strong className="mono tabular-nums jarvis-schema-pct">
                    {readiness.completenessPct}%
                  </strong>
                </div>
              </header>

              <div className="jarvis-schema-fields-grid">
                <div className="jarvis-schema-field">
                  <label htmlFor={`schema-orch-${agent.role}`}>Loop de Orquestração</label>
                  <select
                    id={`schema-orch-${agent.role}`}
                    className="jarvis-input"
                    value={core.orchestration_mode}
                    onChange={(e) =>
                      updateDraftField(
                        agent.role,
                        'orchestration_mode',
                        e.target.value as AgentCoreConfig['orchestration_mode']
                      )
                    }
                  >
                    {ALLOWED_ORCHESTRATION_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {ORCHESTRATION_MODE_LABELS[mode]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="jarvis-schema-field">
                  <label htmlFor={`schema-autonomy-${agent.role}`}>Política de Autonomia</label>
                  <select
                    id={`schema-autonomy-${agent.role}`}
                    className="jarvis-input"
                    value={core.autonomy_policy}
                    onChange={(e) =>
                      updateDraftField(
                        agent.role,
                        'autonomy_policy',
                        e.target.value as AgentCoreConfig['autonomy_policy']
                      )
                    }
                  >
                    {ALLOWED_AUTONOMY_POLICIES.map((policy) => (
                      <option key={policy} value={policy}>
                        {AUTONOMY_POLICY_LABELS[policy]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="jarvis-schema-field">
                  <label htmlFor={`schema-pprov-${agent.role}`}>Provedor Primário</label>
                  <select
                    id={`schema-pprov-${agent.role}`}
                    className="jarvis-input"
                    value={core.primary_provider}
                    onChange={(e) => updateDraftField(agent.role, 'primary_provider', e.target.value)}
                  >
                    {ALLOWED_PROVIDERS.map((prov) => (
                      <option key={prov} value={prov}>
                        {prov}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="jarvis-schema-field">
                  <label htmlFor={`schema-pmodel-${agent.role}`}>Modelo Primário</label>
                  <input
                    id={`schema-pmodel-${agent.role}`}
                    type="text"
                    className="jarvis-input mono"
                    value={core.primary_model}
                    onChange={(e) => updateDraftField(agent.role, 'primary_model', e.target.value)}
                  />
                </div>

                <div className="jarvis-schema-field">
                  <label htmlFor={`schema-fprov-${agent.role}`}>Provedor Fallback</label>
                  <select
                    id={`schema-fprov-${agent.role}`}
                    className="jarvis-input"
                    value={core.fallback_provider}
                    onChange={(e) =>
                      updateDraftField(agent.role, 'fallback_provider', e.target.value)
                    }
                  >
                    {ALLOWED_PROVIDERS.map((prov) => (
                      <option key={prov} value={prov}>
                        {prov}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="jarvis-schema-field">
                  <label htmlFor={`schema-fmodel-${agent.role}`}>Modelo Fallback</label>
                  <input
                    id={`schema-fmodel-${agent.role}`}
                    type="text"
                    className="jarvis-input mono"
                    value={core.fallback_model}
                    onChange={(e) => updateDraftField(agent.role, 'fallback_model', e.target.value)}
                  />
                </div>

                <div className="jarvis-schema-field">
                  <label htmlFor={`schema-steps-${agent.role}`}>Máx. Passos (1–30)</label>
                  <input
                    id={`schema-steps-${agent.role}`}
                    type="number"
                    min={1}
                    max={30}
                    className="jarvis-input mono tabular-nums"
                    value={core.max_steps}
                    onChange={(e) =>
                      updateDraftField(agent.role, 'max_steps', Number(e.target.value) || 1)
                    }
                  />
                </div>

                <div className="jarvis-schema-field">
                  <label htmlFor={`schema-depth-${agent.role}`}>Prof. Delegação (0–5)</label>
                  <input
                    id={`schema-depth-${agent.role}`}
                    type="number"
                    min={0}
                    max={5}
                    className="jarvis-input mono tabular-nums"
                    value={core.max_delegation_depth}
                    onChange={(e) =>
                      updateDraftField(
                        agent.role,
                        'max_delegation_depth',
                        Math.max(0, Number(e.target.value) || 0)
                      )
                    }
                  />
                </div>

                <div className="jarvis-schema-field">
                  <label htmlFor={`schema-budget-${agent.role}`}>Teto Diário (USD)</label>
                  <input
                    id={`schema-budget-${agent.role}`}
                    type="number"
                    min={0}
                    max={500}
                    step={0.5}
                    className="jarvis-input mono tabular-nums"
                    value={core.daily_budget_usd}
                    onChange={(e) =>
                      updateDraftField(
                        agent.role,
                        'daily_budget_usd',
                        Math.max(0, Number(e.target.value) || 0)
                      )
                    }
                  />
                </div>

                <div className="jarvis-schema-field">
                  <label htmlFor={`schema-status-${agent.role}`}>Status do Núcleo</label>
                  <select
                    id={`schema-status-${agent.role}`}
                    className="jarvis-input"
                    value={core.status}
                    onChange={(e) =>
                      updateDraftField(
                        agent.role,
                        'status',
                        e.target.value === 'paused' ? 'paused' : 'active'
                      )
                    }
                  >
                    <option value="active">Ativo (operacional)</option>
                    <option value="paused">Pausado (standby)</option>
                  </select>
                </div>
              </div>

              <div className="jarvis-schema-mcp-block">
                <span className="jarvis-pack-spec-label">Servidores MCP Autorizados</span>
                <div className="jarvis-schema-mcp-grid">
                  {KNOWN_MCP_SERVERS.map((srv) => {
                    const checked = core.allowed_mcp_servers.includes(srv.id);
                    return (
                      <label key={srv.id} className="jarvis-schema-check-row">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMcpServer(agent.role, srv.id)}
                        />
                        <span>{srv.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="jarvis-schema-disclosure-row">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-expanded={showMarkdown}
                  onClick={() =>
                    setMarkdownOpenMap((prev) => ({ ...prev, [agent.role]: !prev[agent.role] }))
                  }
                >
                  <FileText size={14} />
                  <span>{showMarkdown ? 'Ocultar SOUL & MEMORY' : 'Editar SOUL.md & MEMORY.md'}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-expanded={showJson}
                  onClick={() =>
                    setJsonPreviewMap((prev) => ({ ...prev, [agent.role]: !prev[agent.role] }))
                  }
                >
                  <Code2 size={14} />
                  <span>{showJson ? 'Ocultar JSON' : 'Ver JSON do Schema'}</span>
                </button>
                {onOpenFullInspector && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onOpenFullInspector(agent)}
                  >
                    <SlidersHorizontal size={14} />
                    <span>Inspetor Completo</span>
                  </button>
                )}
              </div>

              {showMarkdown && (
                <div className="jarvis-schema-md-editors">
                  <div className="jarvis-schema-field">
                    <label htmlFor={`schema-soul-${agent.role}`}>SOUL.md (Identidade & Protocolo)</label>
                    <textarea
                      id={`schema-soul-${agent.role}`}
                      rows={4}
                      className="jarvis-input mono"
                      value={core.soul_markdown}
                      onChange={(e) => updateDraftField(agent.role, 'soul_markdown', e.target.value)}
                    />
                  </div>
                  <div className="jarvis-schema-field">
                    <label htmlFor={`schema-memory-${agent.role}`}>MEMORY.md (Memória Isolada)</label>
                    <textarea
                      id={`schema-memory-${agent.role}`}
                      rows={3}
                      className="jarvis-input mono"
                      value={core.memory_markdown}
                      onChange={(e) => updateDraftField(agent.role, 'memory_markdown', e.target.value)}
                    />
                  </div>
                </div>
              )}

              {showJson && (
                <pre className="jarvis-schema-json-pre mono" aria-label={`JSON do schema de ${displayName}`}>
                  {JSON.stringify(
                    {
                      agent_role: core.agent_role,
                      workspace_slug: core.workspace_slug,
                      orchestration_mode: core.orchestration_mode,
                      max_steps: core.max_steps,
                      max_delegation_depth: core.max_delegation_depth,
                      primary: {
                        provider: core.primary_provider,
                        model: core.primary_model,
                      },
                      fallback: {
                        provider: core.fallback_provider,
                        model: core.fallback_model,
                      },
                      autonomy_policy: core.autonomy_policy,
                      daily_budget_usd: core.daily_budget_usd,
                      allowed_mcp_servers: core.allowed_mcp_servers,
                      status: core.status,
                    },
                    null,
                    2
                  )}
                </pre>
              )}

              <footer className="jarvis-schema-card-footer">
                <div className="jarvis-schema-footer-hint">
                  <Cpu size={14} />
                  <span>
                    {isDirty ? 'Alterações pendentes de gravação' : 'Sincronizado com SQLite'}
                  </span>
                </div>

                <div className="jarvis-schema-footer-actions">
                  {isDirty && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={isSaving}
                      onClick={() => handleResetCard(agent)}
                    >
                      <RotateCcw size={14} />
                      <span>Descartar</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className={`btn btn-sm ${isDirty ? 'btn-primary' : 'btn-secondary'}`}
                    disabled={isSaving}
                    aria-label={`Salvar schema de ${displayName} (${handle})`}
                    onClick={() => void handleSaveCard(agent)}
                  >
                    {isSaving ? (
                      <Loader2 size={14} className="spin" />
                    ) : isDirty ? (
                      <Save size={14} />
                    ) : (
                      <Check size={14} />
                    )}
                    <span>{isSaving ? 'Salvando...' : 'Salvar Schema'}</span>
                  </button>
                </div>
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
};
