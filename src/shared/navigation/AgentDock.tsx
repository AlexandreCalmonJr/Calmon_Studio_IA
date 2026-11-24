import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronUp,
  EyeOff,
  PanelLeft,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { fetchAgents, deleteAgent } from '../../api';
import { AgentInfo } from '../../types';
import { resolveDockAgents, UnifiedDockAgent } from '../../services/agentSync';
import {
  MAX_DOCK_AGENTS,
  type NavigationModuleItem,
} from '../../services/navigationShell';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { notify } from '../common/Toast';
import { LaunchpadGlyph, NavIcon } from './NavIcon';

export type DockAgent = UnifiedDockAgent;

interface AgentDockProps {
  activeAgentId?: string;
  onSelectAgent: (agentId: string) => void;
  onAddAgent?: () => void;
  onHideDock?: () => void;
  activeTab?: string;
  onNavigate?: (tabId: string) => void;
  favoriteItems?: NavigationModuleItem[];
  pendingApprovalsCount?: number;
  isLaunchpadOpen?: boolean;
  onToggleLaunchpad?: () => void;
  isSidebarHidden?: boolean;
  onToggleSidebarHidden?: () => void;
  isMinimized?: boolean;
  onToggleMinimized?: () => void;
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
  activeTab,
  onNavigate,
  favoriteItems = [],
  pendingApprovalsCount = 0,
  isLaunchpadOpen = false,
  onToggleLaunchpad,
  isSidebarHidden = false,
  onToggleSidebarHidden,
  isMinimized = false,
  onToggleMinimized,
}) => {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [stackOpen, setStackOpen] = useState(false);
  const [installedAgents, setInstalledAgents] = useState<AgentInfo[]>([]);
  const [pendingUninstall, setPendingUninstall] = useState<DockAgent | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [dockAreaWidth, setDockAreaWidth] = useState<number>(960);
  const dockLayerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = dockLayerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const w = node.getBoundingClientRect().width;
      if (w > 0) setDockAreaWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [isMinimized]);

  const loadDockAgents = useCallback(async () => {
    try {
      const realAgents = await fetchAgents();
      if (Array.isArray(realAgents)) {
        setInstalledAgents(realAgents);
      }
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

  useEffect(() => {
    if (!stackOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (dockLayerRef.current && !dockLayerRef.current.contains(e.target as Node)) {
        setStackOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setStackOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [stackOpen]);

  const allDockAgents = useMemo(
    () => resolveDockAgents(installedAgents, ''),
    [installedAgents]
  );

  const filteredStackAgents = useMemo(
    () => resolveDockAgents(installedAgents, searchTerm),
    [installedAgents, searchTerm]
  );

  const maxAgentsForWidth =
    dockAreaWidth <= 560 ? 3 : dockAreaWidth <= 720 ? 4 : MAX_DOCK_AGENTS;

  const visibleDockAgents = useMemo(
    () => allDockAgents.slice(0, maxAgentsForWidth),
    [allDockAgents, maxAgentsForWidth]
  );

  const handleConfirmUninstall = async () => {
    if (!pendingUninstall) return;
    setUninstalling(true);
    try {
      await deleteAgent(pendingUninstall.role);
      notify(`${pendingUninstall.properName} foi desinstalado da sua equipe.`, 'info');
      setPendingUninstall(null);
      await loadDockAgents();
      window.dispatchEvent(new CustomEvent('jarvis:agents-updated'));
    } catch (err: any) {
      notify(err?.message || 'Não foi possível desinstalar este agente.', 'error');
    } finally {
      setUninstalling(false);
    }
  };

  const renderTooltip = (key: string, title: string, subtitle?: string) => {
    if (hoveredKey !== key || stackOpen) return null;
    return (
      <div className="jarvis-macos-dock-tooltip" role="tooltip">
        <div className="jarvis-macos-dock-tooltip__title">{title}</div>
        {subtitle && (
          <div className="jarvis-macos-dock-tooltip__sub">{subtitle}</div>
        )}
      </div>
    );
  };

  return (
    <>
      <aside
        ref={dockLayerRef}
        className={`jarvis-macos-dock-layer openbot-agent-dock ${isMinimized ? 'is-minimized' : ''}`}
        aria-label="Dock macOS de favoritos e agentes"
      >
        {isMinimized ? (
          <div className="jarvis-macos-dock-mini">
            {onToggleLaunchpad && (
              <button
                type="button"
                onClick={onToggleLaunchpad}
                className="jarvis-macos-dock-mini__btn"
                title="Abrir Launchpad de Módulos (Ctrl+Shift+L)"
                aria-label="Abrir Launchpad de Módulos"
              >
                <LaunchpadGlyph size={14} />
                <span>Launchpad</span>
              </button>
            )}

            {onToggleMinimized && (
              <button
                type="button"
                onClick={onToggleMinimized}
                className="jarvis-macos-dock-mini__btn"
                title="Expandir Dock macOS"
                aria-label="Expandir Dock macOS"
              >
                <ChevronUp size={14} />
                <span>Mostrar Dock</span>
                {allDockAgents.length > 0 && (
                  <span className="jarvis-macos-dock-mini__dots" aria-hidden="true">
                    {allDockAgents.slice(0, 3).map((ag) => (
                      <span key={ag.id} style={{ backgroundColor: ag.color }} />
                    ))}
                  </span>
                )}
              </button>
            )}
          </div>
        ) : (
          <div className="jarvis-macos-dock-anchor">
            {/* Popover Stack de Todos os Agentes Instalados */}
            {stackOpen && (
              <div
                className="jarvis-macos-dock-stack"
                role="dialog"
                aria-label="Meus agentes instalados"
              >
                <div className="jarvis-macos-dock-stack__header">
                  <div>
                    <div className="jarvis-macos-dock-stack__title">
                      Meus Agentes ({installedAgents.length})
                    </div>
                    <div className="jarvis-macos-dock-stack__sub">
                      Clique para conversar ou gerencie sua equipe
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {onAddAgent && (
                      <button
                        type="button"
                        onClick={() => {
                          setStackOpen(false);
                          onAddAgent();
                        }}
                        className="btn btn-secondary btn-xs"
                        title="Gerenciar agentes e habilidades"
                      >
                        <Settings2 size={12} />
                        <span>Gerenciar</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setStackOpen(false)}
                      className="btn btn-ghost btn-icon-sm"
                      aria-label="Fechar lista de agentes"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {installedAgents.length > 3 && (
                  <div className="jarvis-search-box" style={{ margin: '0 2px' }}>
                    <Search size={13} />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Filtrar agentes..."
                      aria-label="Filtrar agentes instalados no dock"
                      className="jarvis-search-box__input"
                      style={{ fontSize: '0.78rem', padding: '5px 0' }}
                    />
                    {searchTerm && (
                      <button
                        type="button"
                        onClick={() => setSearchTerm('')}
                        className="btn btn-ghost btn-icon-sm"
                        aria-label="Limpar filtro do dock"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                )}

                <div className="jarvis-macos-dock-stack__list">
                  {filteredStackAgents.length === 0 ? (
                    <div
                      style={{
                        padding: '18px 10px',
                        textAlign: 'center',
                        fontSize: '0.78rem',
                        color: 'var(--text-muted)',
                      }}
                    >
                      Nenhum agente encontrado.
                    </div>
                  ) : (
                    filteredStackAgents.map((agent) => {
                      const isActive = activeAgentId === agent.id;
                      return (
                        <div
                          key={agent.id}
                          className={`agent-dock-row ${isActive ? 'is-active' : ''}`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setStackOpen(false);
                              onSelectAgent(agent.id);
                            }}
                            aria-label={`Conversar com ${agent.properName}`}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              flex: 1,
                              minWidth: 0,
                              background: 'transparent',
                              border: 'none',
                              padding: 0,
                              textAlign: 'left',
                              cursor: 'pointer',
                              color: 'inherit',
                            }}
                          >
                            <span
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '10px',
                                backgroundColor: `${agent.color}22`,
                                color: agent.color,
                                border: `1px solid ${isActive ? agent.color : `${agent.color}48`}`,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {getInitials(agent.properName)}
                            </span>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div
                                style={{
                                  fontSize: '0.82rem',
                                  fontWeight: 600,
                                  color: 'var(--text-primary)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {agent.properName}{' '}
                                <span
                                  style={{
                                    color: 'var(--accent-light)',
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '0.72rem',
                                    fontWeight: 500,
                                  }}
                                >
                                  {agent.handle}
                                </span>
                              </div>
                              <div
                                style={{
                                  fontSize: '0.72rem',
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

                          {agent.canUninstall && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingUninstall(agent);
                              }}
                              className="btn btn-danger-ghost btn-icon-sm"
                              title={`Desinstalar ${agent.properName}`}
                              aria-label={`Desinstalar ${agent.properName}`}
                              style={{ width: '26px', height: '26px', flexShrink: 0 }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {onHideDock && (
                  <div className="jarvis-macos-dock-stack__footer">
                    <button
                      type="button"
                      onClick={() => {
                        setStackOpen(false);
                        onHideDock();
                      }}
                      className="btn btn-ghost btn-xs btn-block"
                    >
                      <EyeOff size={12} />
                      <span>Ocultar Dock completamente</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Pílula Principal do Dock macOS */}
            <nav className="jarvis-macos-dock" aria-label="Navegação rápida e agentes">
              {/* 1. Launchpad + Favoritos */}
              {onToggleLaunchpad && (
                <div
                  className="jarvis-macos-dock-item"
                  onMouseEnter={() => setHoveredKey('launchpad')}
                  onMouseLeave={() => setHoveredKey(null)}
                >
                  {renderTooltip('launchpad', 'Launchpad', 'Todos os módulos (Ctrl+Shift+L)')}
                  <button
                    type="button"
                    onClick={() => {
                      setHoveredKey(null);
                      onToggleLaunchpad();
                    }}
                    onFocus={() => setHoveredKey('launchpad')}
                    onBlur={() => setHoveredKey(null)}
                    aria-label="Abrir Launchpad de Módulos"
                    aria-pressed={isLaunchpadOpen}
                    className={`jarvis-macos-dock-tile jarvis-macos-dock-tile--launchpad ${isLaunchpadOpen ? 'is-active' : ''}`}
                  >
                    <LaunchpadGlyph size={20} />
                  </button>
                  <span
                    className={`jarvis-macos-dock-dot ${isLaunchpadOpen ? 'is-visible' : ''}`}
                    style={{ backgroundColor: 'var(--accent-color)' }}
                    aria-hidden="true"
                  />
                </div>
              )}

              {favoriteItems.map((item) => {
                const isActive = activeTab === item.id;
                const badge =
                  item.id === 'approvals' && pendingApprovalsCount > 0
                    ? pendingApprovalsCount
                    : undefined;
                const key = `fav_${item.id}`;
                return (
                  <div
                    key={item.id}
                    className="jarvis-macos-dock-item"
                    onMouseEnter={() => setHoveredKey(key)}
                    onMouseLeave={() => setHoveredKey(null)}
                  >
                    {renderTooltip(key, item.label, item.groupTitle)}
                    <button
                      type="button"
                      onClick={() => {
                        setHoveredKey(null);
                        onNavigate?.(item.id);
                      }}
                      onFocus={() => setHoveredKey(key)}
                      onBlur={() => setHoveredKey(null)}
                      aria-label={item.label}
                      aria-current={isActive ? 'page' : undefined}
                      className={`jarvis-macos-dock-tile ${isActive ? 'is-active' : ''}`}
                      style={{
                        backgroundColor: `${item.color}1e`,
                        borderColor: isActive ? item.color : `${item.color}42`,
                        color: item.color,
                      }}
                    >
                      <NavIcon iconKey={item.iconKey} size={19} color={item.color} />
                      {badge !== undefined && (
                        <span className="jarvis-macos-dock-badge tabular-nums">
                          {badge}
                        </span>
                      )}
                    </button>
                    <span
                      className={`jarvis-macos-dock-dot ${isActive ? 'is-visible' : ''}`}
                      style={{ backgroundColor: item.color }}
                      aria-hidden="true"
                    />
                  </div>
                );
              })}

              {/* Divisor vertical estilo macOS | */}
              {(onToggleLaunchpad || favoriteItems.length > 0) && (
                <div className="jarvis-macos-dock-divider" aria-hidden="true" />
              )}

              {/* 2. Agentes Instalados */}
              {visibleDockAgents.map((agent, idx) => {
                const isActive = activeAgentId === agent.id;
                const key = `agent_${agent.id}`;
                return (
                  <div
                    key={agent.id}
                    className={`jarvis-macos-dock-item ${idx >= 4 ? 'jarvis-macos-dock-item--extra' : ''}`}
                    onMouseEnter={() => setHoveredKey(key)}
                    onMouseLeave={() => setHoveredKey(null)}
                  >
                    {renderTooltip(
                      key,
                      `${agent.properName} ${agent.handle}`,
                      agent.subtitle
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setHoveredKey(null);
                        onSelectAgent(agent.id);
                      }}
                      onFocus={() => setHoveredKey(key)}
                      onBlur={() => setHoveredKey(null)}
                      aria-label={`Conversar com ${agent.properName} (${agent.subtitle})`}
                      aria-pressed={isActive}
                      className={`jarvis-macos-dock-tile jarvis-macos-dock-tile--agent ${isActive ? 'is-active' : ''}`}
                      style={{
                        backgroundColor: `${agent.color}22`,
                        color: agent.color,
                        borderColor: isActive ? agent.color : `${agent.color}48`,
                      }}
                    >
                      {getInitials(agent.properName)}
                    </button>
                    <span
                      className={`jarvis-macos-dock-dot ${isActive ? 'is-visible' : ''}`}
                      style={{ backgroundColor: agent.color }}
                      aria-hidden="true"
                    />
                  </div>
                );
              })}

              {/* Stack / Ver Todos os Agentes ou Botão + */}
              <div
                className="jarvis-macos-dock-item"
                onMouseEnter={() => setHoveredKey('agents_stack')}
                onMouseLeave={() => setHoveredKey(null)}
              >
                {renderTooltip(
                  'agents_stack',
                  installedAgents.length > 0
                    ? `Equipe de Agentes (${installedAgents.length})`
                    : 'Gerenciar Agentes',
                  installedAgents.length > 0
                    ? 'Ver todos, buscar ou desinstalar'
                    : 'Instalar novos especialistas'
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (installedAgents.length === 0 && onAddAgent) {
                      onAddAgent();
                    } else {
                      setStackOpen((prev) => !prev);
                    }
                  }}
                  onFocus={() => setHoveredKey('agents_stack')}
                  onBlur={() => setHoveredKey(null)}
                  aria-label={
                    installedAgents.length > 0
                      ? `Ver todos os ${installedAgents.length} agentes instalados`
                      : 'Gerenciar agentes e habilidades'
                  }
                  aria-expanded={installedAgents.length > 0 ? stackOpen : undefined}
                  className={`jarvis-macos-dock-tile jarvis-macos-dock-tile--neutral ${stackOpen ? 'is-active' : ''}`}
                >
                  {installedAgents.length > 0 ? <Bot size={18} /> : <Plus size={18} />}
                  {allDockAgents.length > visibleDockAgents.length && (
                    <span className="jarvis-macos-dock-badge jarvis-macos-dock-badge--neutral tabular-nums">
                      +{allDockAgents.length - visibleDockAgents.length}
                    </span>
                  )}
                </button>
                <span
                  className={`jarvis-macos-dock-dot ${stackOpen ? 'is-visible' : ''}`}
                  style={{ backgroundColor: 'var(--accent-color)' }}
                  aria-hidden="true"
                />
              </div>

              {/* Divisor + Controles de Layout (Sidebar & Minimizar) */}
              {(onToggleSidebarHidden || onToggleMinimized) && (
                <div className="jarvis-macos-dock-divider" aria-hidden="true" />
              )}

              {onToggleSidebarHidden && (
                <div
                  className="jarvis-macos-dock-item"
                  onMouseEnter={() => setHoveredKey('sidebar_toggle')}
                  onMouseLeave={() => setHoveredKey(null)}
                >
                  {renderTooltip(
                    'sidebar_toggle',
                    isSidebarHidden ? 'Mostrar Barra Lateral' : 'Ocultar Barra Lateral',
                    isSidebarHidden ? 'Voltar ao modo híbrido' : 'Ativar modo Dock Puro'
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setHoveredKey(null);
                      onToggleSidebarHidden();
                    }}
                    onFocus={() => setHoveredKey('sidebar_toggle')}
                    onBlur={() => setHoveredKey(null)}
                    aria-label={
                      isSidebarHidden
                        ? 'Mostrar barra lateral'
                        : 'Ocultar barra lateral'
                    }
                    aria-pressed={!isSidebarHidden}
                    className={`jarvis-macos-dock-tile jarvis-macos-dock-tile--neutral ${!isSidebarHidden ? 'is-active' : ''}`}
                  >
                    <PanelLeft size={17} />
                  </button>
                  <span
                    className={`jarvis-macos-dock-dot ${!isSidebarHidden ? 'is-visible' : ''}`}
                    style={{ backgroundColor: 'var(--accent-light)' }}
                    aria-hidden="true"
                  />
                </div>
              )}

              {onToggleMinimized && (
                <div
                  className="jarvis-macos-dock-item"
                  onMouseEnter={() => setHoveredKey('dock_minimize')}
                  onMouseLeave={() => setHoveredKey(null)}
                >
                  {renderTooltip(
                    'dock_minimize',
                    'Recolher Dock',
                    'Minimiza para pílula discreta'
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setHoveredKey(null);
                      setStackOpen(false);
                      onToggleMinimized();
                    }}
                    onFocus={() => setHoveredKey('dock_minimize')}
                    onBlur={() => setHoveredKey(null)}
                    aria-label="Recolher Dock macOS"
                    className="jarvis-macos-dock-tile jarvis-macos-dock-tile--mini"
                  >
                    <ChevronDown size={16} />
                  </button>
                  <span className="jarvis-macos-dock-dot" aria-hidden="true" />
                </div>
              )}
            </nav>
          </div>
        )}
      </aside>

      <ConfirmDialog
        isOpen={Boolean(pendingUninstall)}
        title={`Desinstalar ${pendingUninstall?.properName || 'agente'}?`}
        description={
          <>
            O agente{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              {pendingUninstall?.properName}
            </strong>{' '}
            será removido da sua equipe e do Dock. Você pode reinstalá-lo a qualquer momento na Biblioteca de Agentes Prontos.
          </>
        }
        confirmLabel="Desinstalar"
        cancelLabel="Manter"
        tone="danger"
        isLoading={uninstalling}
        onConfirm={handleConfirmUninstall}
        onCancel={() => setPendingUninstall(null)}
      />
    </>
  );
};
