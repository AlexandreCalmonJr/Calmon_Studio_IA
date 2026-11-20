import React, { useState, useEffect, useCallback } from 'react';
import { Plus, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { fetchAgents } from '../../api';
import { getAccountStorageKey } from '../../services/accountScope';
import { resolveDockAgents, UnifiedDockAgent } from '../../services/agentSync';

export type DockAgent = UnifiedDockAgent;

interface AgentDockProps {
  activeAgentId?: string;
  onSelectAgent: (agentId: string) => void;
  onAddAgent?: () => void;
  onHideDock?: () => void;
}

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

export const AgentDock: React.FC<AgentDockProps> = ({
  activeAgentId,
  onSelectAgent,
  onAddAgent,
  onHideDock,
}) => {
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(getAccountStorageKey('jarvis_agent_dock_expanded')) === 'true';
    } catch {
      return false;
    }
  });

  const [dockAgents, setDockAgents] = useState<DockAgent[]>([]);

  const loadDockAgents = useCallback(async () => {
    try {
      const realAgents = await fetchAgents();
      let pinnedIds: string[] | null = null;
      try {
        const raw = localStorage.getItem(getAccountStorageKey('jarvis_pinned_dock_agents'));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) pinnedIds = parsed.map(String);
        }
      } catch {
        pinnedIds = null;
      }
      setDockAgents(resolveDockAgents(realAgents, pinnedIds, 6));
    } catch {
      // mantém estado atual caso o backend ainda esteja inicializando
    }
  }, []);

  useEffect(() => {
    void loadDockAgents();
    const handleSync = () => {
      void loadDockAgents();
    };
    window.addEventListener('jarvis:dock-updated', handleSync);
    window.addEventListener('jarvis:agents-updated', handleSync);
    return () => {
      window.removeEventListener('jarvis:dock-updated', handleSync);
      window.removeEventListener('jarvis:agents-updated', handleSync);
    };
  }, [loadDockAgents]);

  const toggleExpanded = () => {
    setIsExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(getAccountStorageKey('jarvis_agent_dock_expanded'), String(next));
      } catch {}
      return next;
    });
  };

  return (
    <aside
      className={`jarvis-dock-rail openbot-agent-dock hide-tablet ${isExpanded ? 'is-expanded' : ''}`}
      aria-label="Acesso rápido a especialistas"
    >
      {/* Header do Dock com controle para expandir nomes ou recolher o painel */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isExpanded ? 'space-between' : 'center',
          gap: '4px',
          paddingBottom: '4px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {isExpanded && (
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              color: 'var(--text-muted)',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            Meus Agentes
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <button
            type="button"
            onClick={toggleExpanded}
            className="btn btn-ghost btn-icon-sm"
            title={isExpanded ? 'Modo compacto do dock' : 'Expandir nomes dos agentes'}
            aria-label={isExpanded ? 'Modo compacto do dock' : 'Expandir nomes dos agentes'}
          >
            {isExpanded ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          </button>
          {isExpanded && onHideDock && (
            <button
              type="button"
              onClick={onHideDock}
              className="btn btn-ghost btn-icon-sm"
              title="Ocultar dock de agentes"
              aria-label="Ocultar dock de agentes"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Lista de Agentes Ativos Fixados */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: isExpanded ? 'stretch' : 'center',
          gap: isExpanded ? '4px' : '8px',
          flex: 1,
          overflowY: 'auto',
          overflowX: 'visible',
          padding: '2px 0',
        }}
      >
        {dockAgents.map((agent) => {
          const isActive = activeAgentId === agent.id;
          const isHovered = hoveredAgentId === agent.id;

          if (isExpanded) {
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => onSelectAgent(agent.id)}
                className={`agent-dock-row ${isActive ? 'is-active' : ''}`}
                aria-label={`Conversar com ${agent.properName}`}
              >
                <span
                  style={{
                    width: '30px',
                    height: '30px',
                    borderRadius: '8px',
                    backgroundColor: `${agent.color}20`,
                    color: agent.color,
                    border: `1px solid ${isActive ? agent.color : `${agent.color}40`}`,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {getInitials(agent.properName)}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {agent.properName}
                  </div>
                  <div
                    style={{
                      fontSize: '0.7rem',
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {agent.subtitle}
                  </div>
                </div>
              </button>
            );
          }

          return (
            <div
              key={agent.id}
              style={{ position: 'relative' }}
              onMouseEnter={() => setHoveredAgentId(agent.id)}
              onMouseLeave={() => setHoveredAgentId(null)}
            >
              <button
                type="button"
                onClick={() => onSelectAgent(agent.id)}
                aria-label={`Conversar com ${agent.properName} (${agent.subtitle})`}
                title={`${agent.properName} (${agent.handle}) — ${agent.subtitle}`}
                className={`agent-dock-bubble ${isActive ? 'is-active' : ''}`}
                style={{
                  backgroundColor: `${agent.color}20`,
                  color: agent.color,
                  borderColor: isActive ? agent.color : `${agent.color}40`,
                }}
              >
                {getInitials(agent.properName)}
              </button>

              {isHovered && (
                <div
                  style={{
                    position: 'fixed',
                    right: '66px',
                    transform: 'translateY(-36px)',
                    backgroundColor: 'var(--bg-elevated)',
                    color: 'var(--text-primary)',
                    padding: '7px 11px',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '0.78rem',
                    whiteSpace: 'nowrap',
                    boxShadow: 'var(--shadow-lg)',
                    border: '1px solid var(--border-color)',
                    pointerEvents: 'none',
                    zIndex: 120,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {agent.properName}{' '}
                    <span style={{ color: 'var(--accent-light)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                      {agent.handle}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{agent.subtitle}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onAddAgent}
        aria-label="Gerenciar especialistas fixados"
        className="agent-dock-add-btn"
        title="Adicionar ou gerenciar especialistas"
      >
        <Plus size={15} />
        {isExpanded && <span>Gerenciar agentes</span>}
      </button>
    </aside>
  );
};
