import React, { useState, useEffect, useMemo } from 'react';
import { Bot, Pin, Play, Plus, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { AgentInfo, getAgentLabel, getModelLabel } from '../../types';
import { fetchAgents, updateAgentConfig } from '../../api';
import { notify } from '../../shared/common/Toast';
import { AgentActionsModal } from './AgentActionsModal';
import { AgentCreatorModal } from './AgentCreatorModal';
import { AgentPlayground } from './AgentPlayground';
import { AgentRouteModal } from './AgentRouteModal';
import { PageHeader } from '../../shared/layout/PageHeader';
import { MascotAvatar } from '../../shared/common/MascotAvatar';
import { useAssistantIdentity } from '../../context/AssistantIdentityContext';
import { getAccountStorageKey } from '../../services/accountScope';

type AgentCategory = 'all' | 'studies' | 'creative' | 'security' | 'business' | 'dev';

export const AgentCenterView: React.FC = () => {
  const { assistantName, experienceMode } = useAssistantIdentity();
  const isSimpleMode = experienceMode === 'simple';
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<AgentCategory>('all');

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentInfo | null>(null);
  const [selectedPlaygroundAgent, setSelectedPlaygroundAgent] = useState<AgentInfo | null>(null);
  const [selectedActionsAgent, setSelectedActionsAgent] = useState<AgentInfo | null>(null);
  const [selectedRouteAgent, setSelectedRouteAgent] = useState<AgentInfo | null>(null);

  const handleResetAgentToHybrid = async (role: string) => {
    try {
      await updateAgentConfig(role, {
        preferred_model: 'gemini-4-hydrogen',
        routing_policy: 'auto_hybrid',
        change_summary: 'Restaurado para Modo Híbrido padrão',
      });
      notify(`Especialista '${getAgentLabel(role)}' restaurado para o Modo Híbrido.`, 'success');
      await loadAgents();
    } catch (err: any) {
      notify(`Erro ao restaurar especialista: ${err.message}`, 'error');
    }
  };

  const loadAgents = async () => {
    setLoading(true);
    try {
      const data = await fetchAgents();
      setAgents(data);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Falha ao carregar o catálogo de agentes.');
    } finally {
      setLoading(false);
    }
  };

  const [pinnedDockRoles, setPinnedDockRoles] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(getAccountStorageKey('jarvis_pinned_dock_agents'));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(String);
      }
    } catch {}
    return [];
  });

  const handleTogglePinDock = (agent: AgentInfo) => {
    const displayName = agent.proper_name || agent.name;
    const currentlyPinned = pinnedDockRoles.includes(agent.role);
    let next: string[];
    if (currentlyPinned) {
      next = pinnedDockRoles.filter((r) => r !== agent.role);
      notify(`${displayName} removido do Dock lateral.`, 'info');
    } else {
      if (pinnedDockRoles.length >= 8) {
        notify('O Dock lateral suporta até 8 agentes fixados simultaneamente.', 'warning');
        return;
      }
      next = [...pinnedDockRoles, agent.role];
      notify(`${displayName} fixado no Dock lateral!`, 'success');
    }
    setPinnedDockRoles(next);
    try {
      localStorage.setItem(getAccountStorageKey('jarvis_pinned_dock_agents'), JSON.stringify(next));
      window.dispatchEvent(new CustomEvent('jarvis:dock-updated'));
    } catch {}
  };

  useEffect(() => {
    void loadAgents();
    const onAgentsUpdated = () => {
      void loadAgents();
    };
    const onDockUpdated = () => {
      try {
        const raw = localStorage.getItem(getAccountStorageKey('jarvis_pinned_dock_agents'));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setPinnedDockRoles(parsed.map(String));
        }
      } catch {}
    };
    window.addEventListener('jarvis:agents-updated', onAgentsUpdated);
    window.addEventListener('jarvis:dock-updated', onDockUpdated);
    return () => {
      window.removeEventListener('jarvis:agents-updated', onAgentsUpdated);
      window.removeEventListener('jarvis:dock-updated', onDockUpdated);
    };
  }, []);

  const filteredAgents = useMemo(() => {
    return agents.filter((ag) => {
      const q = search.toLowerCase().trim();
      const matchSearch =
        !q ||
        (ag.proper_name || '').toLowerCase().includes(q) ||
        (ag.handle || '').toLowerCase().includes(q) ||
        ag.name.toLowerCase().includes(q) ||
        ag.role.toLowerCase().includes(q) ||
        getAgentLabel(ag.role).toLowerCase().includes(q) ||
        ag.mission.toLowerCase().includes(q);

      if (!matchSearch) return false;
      if (categoryFilter === 'all') return true;
      return (ag.category || 'dev') === categoryFilter;
    });
  }, [agents, search, categoryFilter]);

  const openCreateModal = () => {
    setEditingAgent(null);
    setCreatorOpen(true);
  };

  const openEditModal = (agent: AgentInfo) => {
    setEditingAgent(agent);
    setCreatorOpen(true);
  };

  return (
    <div className="jarvis-page-shell">
      <PageHeader
        icon={<Bot size={18} />}
        title={isSimpleMode ? `Equipe de ${assistantName}` : 'Central de Agentes & Estúdio de Mascotes'}
        subtitle={
          isSimpleMode
            ? `Crie especialistas com nome próprio e mascote, e chame qualquer um na conversa (ex.: "chama a Clara" ou "@newton").`
            : 'Gerencie nomes próprios, mascotes, foco estrito, roteamento Local/Online, delegação e histórico com rollback em 1 clique.'
        }
        meta={[
          `${agents.length} especialista(s) ativos`,
          filteredAgents.length !== agents.length ? `${filteredAgents.length} exibido(s)` : 'Invocação por nome ativa',
        ]}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={loadAgents}
              disabled={loading}
              className="btn btn-secondary btn-sm"
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              <span>{loading ? 'Atualizando…' : 'Atualizar'}</span>
            </button>
            <button type="button" onClick={openCreateModal} className="btn btn-primary btn-sm">
              <Plus size={14} />
              <span>Criar especialista</span>
            </button>
          </div>
        }
      />

      {loadError && (
        <div role="alert" className="jarvis-error-banner" style={{ justifyContent: 'space-between' }}>
          <span>Não foi possível carregar os agentes: {loadError}</span>
          <button type="button" onClick={loadAgents} className="btn btn-ghost btn-xs">
            Tentar novamente
          </button>
        </div>
      )}

      {/* Barra Unificada de Busca e Categorias */}
      <div className="jarvis-filter-bar">
        <div className="jarvis-search-box" style={{ flex: '1 1 240px', maxWidth: '380px' }}>
          <Search size={14} />
          <input
            type="text"
            placeholder="Buscar por nome próprio (Kira, Clara, Newton...), @handle ou missão..."
            aria-label="Filtrar especialistas"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="jarvis-search-box__input"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="btn btn-ghost btn-icon-sm"
              aria-label="Limpar busca"
              style={{ width: '22px', height: '22px', padding: 0 }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="jarvis-segmented" role="tablist" aria-label="Categorias de agentes" style={{ flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: `Todos (${agents.length})` },
            { id: 'studies', label: 'Estudos & Pesquisa' },
            { id: 'creative', label: 'Criativo & Docs' },
            { id: 'security', label: 'Segurança' },
            { id: 'business', label: 'Finanças' },
            { id: 'dev', label: 'Engenharia' },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={categoryFilter === cat.id}
              onClick={() => setCategoryFilter(cat.id as AgentCategory)}
              className={`jarvis-segmented-btn ${categoryFilter === cat.id ? 'is-active' : ''}`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {filteredAgents.length === 0 && !loading && !loadError && (
        <div role="status" className="jarvis-empty-state">
          <Bot size={22} color="var(--text-muted)" />
          <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
            {agents.length === 0
              ? 'Nenhum especialista encontrado.'
              : 'Nenhum especialista corresponde aos filtros selecionados.'}
          </p>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setCategoryFilter('all');
            }}
            className="btn btn-secondary btn-xs"
          >
            Limpar filtros
          </button>
        </div>
      )}

      {/* Grid de Especialistas com Mascotes */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))',
          gap: '14px',
        }}
      >
        {filteredAgents.map((agent) => {
          const isOnlineModel =
            agent.routing_policy === 'online_only' ||
            (agent.preferred_model || '').toLowerCase().startsWith('gemini-');
          const modeLabel =
            agent.routing_policy === 'local_only'
              ? 'LOCAL · Ollama'
              : isOnlineModel
                ? 'ONLINE · Gemini'
                : 'HÍBRIDO · Local/Gemini';
          const modelDisplay = getModelLabel(agent.preferred_model);
          const properName = agent.proper_name || getAgentLabel(agent.role);
          const handleLabel = agent.handle || `@${agent.role.split('_')[0]}`;

          return (
            <article
              key={agent.role}
              className="jarvis-settings-card"
              style={{
                justifyContent: 'space-between',
                gap: '14px',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                  <MascotAvatar
                    mascot={agent.mascot}
                    role={agent.role}
                    name={properName}
                    size={46}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
                      <h3
                        style={{
                          fontSize: '1rem',
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                          margin: 0,
                        }}
                      >
                        {properName}
                      </h3>
                      <span
                        style={{
                          fontSize: '0.74rem',
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--accent-light)',
                          fontWeight: 600,
                        }}
                      >
                        {handleLabel}
                      </span>
                      {agent.is_custom && (
                        <span
                          style={{
                            fontSize: '0.64rem',
                            fontFamily: 'var(--font-mono)',
                            textTransform: 'uppercase',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--accent-soft)',
                            border: '1px solid var(--border-accent)',
                            color: 'var(--accent-light)',
                          }}
                        >
                          Personalizado
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: '0.78rem',
                        color: 'var(--text-secondary)',
                        marginTop: '2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {agent.name || getAgentLabel(agent.role)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTogglePinDock(agent)}
                    className={`btn btn-icon-sm ${pinnedDockRoles.includes(agent.role) ? 'btn-primary' : 'btn-ghost'}`}
                    title={
                      pinnedDockRoles.includes(agent.role)
                        ? `Desafixar ${properName} do Dock lateral`
                        : `Fixar ${properName} no Dock lateral`
                    }
                    aria-label={
                      pinnedDockRoles.includes(agent.role)
                        ? `Desafixar ${properName} do Dock lateral`
                        : `Fixar ${properName} no Dock lateral`
                    }
                  >
                    <Pin size={13} />
                  </button>
                </div>

                <p
                  style={{
                    fontSize: '0.82rem',
                    color: 'var(--text-secondary)',
                    margin: 0,
                    lineHeight: 1.5,
                  }}
                >
                  {agent.mission}
                </p>
              </div>

              <div
                style={{
                  paddingTop: '12px',
                  borderTop: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  fontSize: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Motor</span>
                  <span
                    style={{
                      color: isOnlineModel ? '#38bdf8' : '#4ade80',
                      fontWeight: 600,
                    }}
                  >
                    {modeLabel}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Modelo</span>
                  <span
                    style={{
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.73rem',
                      textAlign: 'right',
                    }}
                  >
                    {modelDisplay}
                  </span>
                </div>

                <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '2px' }}>
                  <span>{agent.strict_focus ? 'Foco estrito' : 'Escopo flexível'}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{agent.is_read_only ? 'Somente leitura' : 'Pode propor ações'}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="jarvis-tabular" style={{ fontFamily: 'var(--font-mono)' }}>
                    v{agent.version || 1}
                  </span>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px',
                  paddingTop: '2px',
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => openEditModal(agent)}
                >
                  <SlidersHorizontal size={13} />
                  <span>Editar & Mascote</span>
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setSelectedPlaygroundAgent(agent)}
                >
                  <Play size={13} />
                  <span>Testar agora</span>
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {creatorOpen && (
        <AgentCreatorModal
          isOpen={creatorOpen}
          editingAgent={editingAgent}
          allAgents={agents}
          onClose={() => {
            setCreatorOpen(false);
            setEditingAgent(null);
          }}
          onSaved={loadAgents}
        />
      )}

      {selectedActionsAgent && (
        <AgentActionsModal
          isOpen={true}
          agent={selectedActionsAgent}
          onClose={() => setSelectedActionsAgent(null)}
          onOpenConfig={() => openEditModal(selectedActionsAgent)}
          onOpenPlayground={() => setSelectedPlaygroundAgent(selectedActionsAgent)}
          onResetToHybridDefault={() => handleResetAgentToHybrid(selectedActionsAgent.role)}
        />
      )}

      {selectedPlaygroundAgent && (
        <AgentPlayground
          isOpen={true}
          agent={selectedPlaygroundAgent}
          onClose={() => setSelectedPlaygroundAgent(null)}
        />
      )}

      {selectedRouteAgent && (
        <AgentRouteModal
          isOpen={true}
          agent={selectedRouteAgent}
          onClose={() => setSelectedRouteAgent(null)}
          onSaved={loadAgents}
        />
      )}
    </div>
  );
};
