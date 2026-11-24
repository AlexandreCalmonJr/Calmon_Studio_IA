import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Eye,
  EyeOff,
  Pin,
  Search,
  SlidersHorizontal,
  Store,
  X,
} from 'lucide-react';
import type { AgentInfo } from '../../types';
import { resolveDockAgents } from '../../services/agentSync';
import {
  NAV_GROUPS_META,
  filterLaunchpadModules,
  type NavigationModuleItem,
} from '../../services/navigationShell';
import { LaunchpadGlyph, NavIcon } from './NavIcon';

export interface LaunchpadOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: string;
  onNavigate: (tabId: string) => void;
  modules: NavigationModuleItem[];
  favoriteIds: string[];
  onToggleFavorite: (tabId: string) => void;
  pendingApprovalsCount?: number;
  isSidebarHidden?: boolean;
  onToggleSidebarHidden?: () => void;
  isSimpleMode?: boolean;
  onToggleSimpleMode?: () => void;
  assistantName?: string;
  installedAgents?: AgentInfo[];
  onSelectAgent?: (agentId: string) => void;
}

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

export const LaunchpadOverlay: React.FC<LaunchpadOverlayProps> = ({
  isOpen,
  onClose,
  activeTab,
  onNavigate,
  modules,
  favoriteIds,
  onToggleFavorite,
  pendingApprovalsCount = 0,
  isSidebarHidden = false,
  onToggleSidebarHidden,
  isSimpleMode = false,
  onToggleSimpleMode,
  assistantName = 'JARVIS',
  installedAgents = [],
  onSelectAgent,
}) => {
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    const prevFocus =
      typeof document !== 'undefined'
        ? (document.activeElement as HTMLElement | null)
        : null;

    const timer =
      typeof setTimeout === 'function'
        ? setTimeout(() => searchInputRef.current?.focus(), 40)
        : null;

    const getEffectiveZIndex = (el: HTMLElement): number => {
      let cur: HTMLElement | null = el;
      while (cur && cur !== document.body) {
        const parsed = Number.parseInt(window.getComputedStyle(cur).zIndex || '', 10);
        if (Number.isFinite(parsed)) return parsed;
        cur = cur.parentElement;
      }
      return 0;
    };

    const isTopmostModal = (): boolean => {
      if (typeof document === 'undefined' || !overlayRef.current) return true;
      const modals = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'));
      if (modals.length === 0) return true;
      let topmost: HTMLElement = overlayRef.current;
      let maxZ = getEffectiveZIndex(overlayRef.current);
      for (const modal of modals) {
        const z = getEffectiveZIndex(modal);
        if (z >= maxZ) {
          maxZ = z;
          topmost = modal;
        }
      }
      return topmost === overlayRef.current;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isTopmostModal()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const selector =
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(selector)).filter(
          (el) => el.offsetParent !== null || el === document.activeElement
        );
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === panelRef.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('keydown', handleKeyDown);
      }
      prevFocus?.focus?.();
    };
  }, [isOpen]);

  const filteredModules = useMemo(
    () => filterLaunchpadModules(modules, query),
    [modules, query]
  );

  const groupedSections = useMemo(() => {
    return NAV_GROUPS_META.map((group) => ({
      ...group,
      items: filteredModules.filter((item) => item.groupId === group.id),
    })).filter((g) => g.items.length > 0);
  }, [filteredModules]);

  const matchingAgents = useMemo(() => {
    if (!onSelectAgent || installedAgents.length === 0) return [];
    const resolved = resolveDockAgents(installedAgents, query);
    return query.trim() ? resolved : resolved.slice(0, 8);
  }, [installedAgents, query, onSelectAgent]);

  if (!isOpen) return null;

  const favoriteSet = new Set(favoriteIds);

  return (
    <div
      ref={overlayRef}
      className="jarvis-launchpad-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
      data-testid="jarvis-launchpad-overlay"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="jarvis-launchpad-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Bar do Launchpad */}
        <div className="jarvis-launchpad-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <div className="jarvis-launchpad-brand-badge" aria-hidden="true">
              <LaunchpadGlyph size={20} />
            </div>
            <div style={{ minWidth: 0 }}>
              <h2 id={titleId} className="jarvis-launchpad-title">
                Launchpad · Módulos do {assistantName}
              </h2>
              <p className="jarvis-launchpad-subtitle">
                Abra qualquer workspace ou fixe seus favoritos no Dock inferior
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {onToggleSidebarHidden && (
              <button
                type="button"
                onClick={onToggleSidebarHidden}
                className={`btn btn-sm ${isSidebarHidden ? 'btn-primary' : 'btn-secondary'}`}
                aria-pressed={isSidebarHidden}
                title={
                  isSidebarHidden
                    ? 'Exibir barra lateral flutuante'
                    : 'Ocultar barra lateral (Modo Dock Puro)'
                }
              >
                {isSidebarHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                <span>{isSidebarHidden ? 'Mostrar Sidebar' : 'Modo Dock Puro'}</span>
              </button>
            )}

            {onToggleSimpleMode && (
              <button
                type="button"
                onClick={onToggleSimpleMode}
                className="btn btn-secondary btn-sm"
                title={
                  isSimpleMode
                    ? 'Mudar para Modo Completo (Engenharia)'
                    : 'Mudar para Modo Simples'
                }
              >
                <SlidersHorizontal size={14} color="var(--accent-light)" />
                <span>{isSimpleMode ? 'Modo Simples' : 'Modo Completo'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-icon"
              aria-label="Fechar Launchpad"
              title="Fechar Launchpad (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Busca centralizada estilo macOS */}
        <div className="jarvis-launchpad-search-wrap">
          <div className="jarvis-search-box jarvis-launchpad-search">
            <Search size={16} />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar módulo, estúdio, ferramenta ou agente..."
              aria-label="Buscar módulos no Launchpad"
              className="jarvis-search-box__input"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="btn btn-ghost btn-icon-sm"
                aria-label="Limpar busca do Launchpad"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Grade de Módulos e Agentes */}
        <div className="jarvis-launchpad-scroll">
          {groupedSections.length === 0 && matchingAgents.length === 0 ? (
            <div className="jarvis-empty-state" style={{ margin: '12px 0' }}>
              <Search size={24} color="var(--text-muted)" />
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                Nenhum módulo encontrado para &ldquo;{query}&rdquo;
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Tente buscar por chat, tarefas, código, segurança ou abra a Loja Unificada.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
              {groupedSections.map((group) => (
                <section key={group.id} aria-label={group.title}>
                  <div className="jarvis-launchpad-section-title">
                    <span>{group.title}</span>
                    <span className="jarvis-tabular">{group.items.length}</span>
                  </div>

                  <div className="jarvis-launchpad-grid">
                    {group.items.map((item) => {
                      const isActive = activeTab === item.id;
                      const isPinned = favoriteSet.has(item.id);
                      const displayLabel =
                        isSimpleMode && item.id === 'chat'
                          ? `Conversar com ${assistantName}`
                          : item.label;
                      const badge =
                        item.id === 'approvals' && pendingApprovalsCount > 0
                          ? pendingApprovalsCount
                          : undefined;

                      return (
                        <div
                          key={item.id}
                          className={`jarvis-launchpad-tile ${isActive ? 'is-active' : ''}`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onNavigate(item.id);
                              onClose();
                            }}
                            className="jarvis-launchpad-tile__launch"
                            aria-current={isActive ? 'page' : undefined}
                            title={item.description}
                          >
                            <div
                              className="jarvis-launchpad-tile-icon"
                              style={{
                                backgroundColor: `${item.color}1c`,
                                borderColor: isActive ? item.color : `${item.color}42`,
                                color: item.color,
                              }}
                            >
                              <NavIcon iconKey={item.iconKey} size={24} color={item.color} />
                              {badge !== undefined && (
                                <span className="jarvis-launchpad-badge tabular-nums">
                                  {badge}
                                </span>
                              )}
                            </div>

                            <span className="jarvis-launchpad-tile__label">
                              {displayLabel}
                            </span>

                            {isActive && (
                              <span
                                className="jarvis-launchpad-active-dot"
                                aria-hidden="true"
                                style={{ backgroundColor: item.color }}
                              />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleFavorite(item.id);
                            }}
                            className={`jarvis-launchpad-pin-btn ${isPinned ? 'is-pinned' : ''}`}
                            aria-label={
                              isPinned
                                ? `Remover ${displayLabel} dos favoritos do Dock`
                                : `Fixar ${displayLabel} nos favoritos do Dock`
                            }
                            aria-pressed={isPinned}
                            title={
                              isPinned
                                ? 'Remover do Dock inferior'
                                : 'Fixar nos Favoritos do Dock'
                            }
                          >
                            <Pin
                              size={12}
                              style={{ transform: isPinned ? 'rotate(45deg)' : 'none' }}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}

              {/* Agentes instalados acessíveis rapidamente pelo Launchpad */}
              {matchingAgents.length > 0 && onSelectAgent && (
                <section aria-label="Meus Agentes Instalados">
                  <div className="jarvis-launchpad-section-title">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <Bot size={13} color="var(--accent-light)" />
                      <span>Meus Agentes Instalados</span>
                    </span>
                    <span className="jarvis-tabular">{matchingAgents.length}</span>
                  </div>

                  <div className="jarvis-launchpad-agents-row">
                    {matchingAgents.map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => {
                          onSelectAgent(agent.id);
                          onClose();
                        }}
                        className="jarvis-launchpad-agent-chip"
                        title={`${agent.properName} (${agent.handle}) — ${agent.subtitle}`}
                      >
                        <span
                          className="jarvis-launchpad-agent-avatar"
                          style={{
                            backgroundColor: `${agent.color}22`,
                            borderColor: `${agent.color}55`,
                            color: agent.color,
                          }}
                        >
                          {getInitials(agent.properName)}
                        </span>
                        <span style={{ minWidth: 0, textAlign: 'left' }}>
                          <span className="jarvis-launchpad-agent-name">
                            {agent.properName}
                          </span>
                          <span className="jarvis-launchpad-agent-sub">
                            {agent.handle}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        {/* Rodapé do Launchpad */}
        <div className="jarvis-launchpad-footer">
          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
            Clique em <strong style={{ color: 'var(--text-secondary)' }}>Fixar (📌)</strong> em qualquer ícone para personalizar os Favoritos do Dock ·{' '}
            <kbd className="jarvis-launchpad-kbd">Esc</kbd> para fechar
          </span>
          {!isSimpleMode && (
            <button
              type="button"
              onClick={() => {
                onNavigate('store');
                onClose();
              }}
              className="btn btn-ghost btn-xs"
            >
              <Store size={13} color="var(--accent-light)" />
              <span>Explorar Loja Unificada</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
