import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { emitAppEvent, subscribeAppEvent } from '../state/appBus';
import { AiOrbButton } from './AiOrbButton';
import {
  LayoutDashboard,
  MessageSquare,
  Workflow,
  ListTodo,
  FolderKanban,
  Store,
  HelpCircle,
  Settings,
  MoreHorizontal,
  Pin,
  Check,
  Server,
  Smartphone,
  Users,
  LogOut,
  Building2,
  Code2,
  Bot,
  CheckSquare,
  Palette,
  ChevronRight,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  FileBarChart2,
  Wrench,
  BookOpen,
  SlidersHorizontal,
  Wand2,
  AppWindow,
  GitBranch,
  EyeOff,
} from 'lucide-react';
import {
  type WorkspaceExperienceMode,
} from '../../services/assistantIdentity';
import { isTabUnlockedByPacks, type ModulePackDefinition } from '../../services/modulePackEngine';
import { SIDEBAR_PINNED_STORAGE_KEY } from '../../services/navigationShell';

export interface NavRailItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string; className?: string }>;
  isPinned: boolean;
  badge?: number;
}

interface PrimaryRailProps {
  activeTab: string;
  onNavigate: (tabId: string) => void;
  collapsed?: boolean;
  hidden?: boolean;
  mobileOpen?: boolean;
  onToggleCollapse?: () => void;
  onToggleHidden?: () => void;
  onOpenSettings?: () => void;
  onOpenHelp?: () => void;
  onOpenProfile?: () => void;
  pendingApprovalsCount?: number;
  installedPackIds?: string[] | null;
  customPacks?: ModulePackDefinition[];
  canManagePacks?: boolean;
  canAccessTab?: (tabId: string) => boolean;
  assistantName?: string;
  experienceMode?: WorkspaceExperienceMode;
  onToggleExperienceMode?: () => void;
}

interface NavGroup {
  title: string;
  items: {
    id: string;
    label: string;
    icon: React.ComponentType<{ size?: number; color?: string; className?: string }>;
    badge?: number;
  }[];
}

export const PrimaryRail: React.FC<PrimaryRailProps> = ({
  activeTab,
  onNavigate,
  collapsed = false,
  hidden = false,
  mobileOpen = false,
  onToggleCollapse,
  onToggleHidden,
  onOpenSettings,
  onOpenHelp,
  onOpenProfile,
  pendingApprovalsCount = 0,
  installedPackIds = null,
  customPacks = [],
  canManagePacks = false,
  canAccessTab,
  assistantName = 'JARVIS',
  experienceMode = 'engineering',
  onToggleExperienceMode,
}) => {
  const isSimpleMode = experienceMode === 'simple';
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [serverMenuOpen, setServerMenuOpen] = useState(false);
  const [activeBrainLabel, setActiveBrainLabel] = useState<string>('Esta Máquina · Local');
  const navRef = useRef<HTMLElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const serverMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return subscribeAppEvent('jarvis:brain-switched', (detail) => {
      if (detail?.name) {
        setActiveBrainLabel(detail.name);
      }
    });
  }, []);

  const DEFAULT_PINNED: Record<string, boolean> = {
    overview: true,
    chat: true,
    tasks: true,
    workflows: true,
    workspace: true,
    coding: true,
    agents: true,
    usage: true,
    approvals: true,
    models: true,
    knowledge: false,
    backend_studio: false,
    quality: false,
    design: false,
    office: true,
    skills: false,
    security: true,
    companion: true,
    creative_studio: true,
    app_builder: true,
    github_import: true,
    android_app: true,
    brain_server: true,
    executive_report: false,
    advisor: false,
    server_logs: false,
  };

  const [pinnedItems, setPinnedItems] = useState<Record<string, boolean>>(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(SIDEBAR_PINNED_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && typeof parsed === 'object') {
            return { ...DEFAULT_PINNED, ...parsed };
          }
        }
      }
    } catch {}
    return DEFAULT_PINNED;
  });

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const inNav = navRef.current?.contains(target) ?? false;
      const inMore = moreMenuRef.current?.contains(target) ?? false;
      const inServer = serverMenuRef.current?.contains(target) ?? false;
      if (!inNav && !inMore && !inServer) {
        setMoreMenuOpen(false);
        setServerMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMoreMenuOpen(false);
        setServerMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  useEffect(() => {
    if (hidden && !mobileOpen) {
      setMoreMenuOpen(false);
      setServerMenuOpen(false);
    }
  }, [hidden, mobileOpen]);

  useEffect(() => {
    if (!collapsed) {
      setMoreMenuOpen(false);
    }
  }, [collapsed]);

  const togglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPinnedItems((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(SIDEBAR_PINNED_STORAGE_KEY, JSON.stringify(next));
        }
      } catch {}
      return next;
    });
  };

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('jarvis_sidebar_expanded_groups');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {}
    return {
      'Engenharia & Ecossistema': false,
      'Estúdios & Governança': false,
    };
  });

  const toggleGroup = (title: string) => {
    setExpandedGroups((prev) => {
      const next = { ...prev, [title]: !prev[title] };
      try {
        localStorage.setItem('jarvis_sidebar_expanded_groups', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const navGroups: (NavGroup & { collapsible?: boolean })[] = [
    {
      title: 'Principal',
      collapsible: false,
      items: [
        { id: 'overview', label: 'Visão Geral', icon: LayoutDashboard },
        { id: 'chat', label: 'Chat e Conversas', icon: MessageSquare },
        { id: 'creative_studio', label: 'Estúdio Criativo', icon: Wand2 },
        { id: 'office', label: 'Escritório Isométrico', icon: Building2 },
        { id: 'tasks', label: 'Tarefas', icon: ListTodo },
        { id: 'workflows', label: 'Monitor de Fluxos', icon: Workflow },
      ],
    },
    {
      title: 'Inteligência & Recursos',
      collapsible: false,
      items: [
        { id: 'agents', label: 'Central de Agentes', icon: Bot },
        { id: 'knowledge', label: 'Habilidades & Conhecimentos', icon: BookOpen },
      ],
    },
    {
      title: 'Engenharia & Ecossistema',
      collapsible: true,
      items: [
        { id: 'workspace', label: 'Projetos', icon: FolderKanban },
        { id: 'coding', label: 'IDE & Código', icon: Code2 },
        { id: 'app_builder', label: 'Construtor de Apps', icon: AppWindow },
        { id: 'github_import', label: 'Importar GitHub', icon: GitBranch },
      ],
    },
    {
      title: 'Estúdios & Governança',
      collapsible: true,
      items: [
        { id: 'approvals', label: 'Aprovações', icon: CheckSquare, badge: pendingApprovalsCount },
        { id: 'backend_studio', label: 'Backend Studio', icon: Wrench },
        { id: 'quality', label: 'Qualidade QA', icon: CheckSquare },
        { id: 'design', label: 'Design Studio', icon: Palette },
        { id: 'executive_report', label: 'Relatório ROI', icon: FileBarChart2 },
      ],
    },
  ];

  const simpleNavGroups: (NavGroup & { collapsible?: boolean })[] = [
    {
      title: 'Meu Espaço',
      collapsible: false,
      items: [
        { id: 'overview', label: 'Visão Geral', icon: LayoutDashboard },
        { id: 'chat', label: `Conversar com ${assistantName}`, icon: MessageSquare },
        { id: 'creative_studio', label: 'Estúdio Criativo', icon: Wand2 },
        { id: 'office', label: 'Escritório Isométrico', icon: Building2 },
        { id: 'tasks', label: 'Tarefas', icon: ListTodo },
        { id: 'workflows', label: 'Monitor de Fluxos', icon: Workflow },
        { id: 'agents', label: 'Central de Agentes', icon: Bot },
        { id: 'knowledge', label: 'Habilidades & Conhecimentos', icon: BookOpen },
      ],
    },
  ];

  const rawNavGroups = isSimpleMode ? simpleNavGroups : navGroups;
  const activeNavGroups = rawNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (canAccessTab && !canAccessTab(item.id)) return false;
        if (installedPackIds && !isTabUnlockedByPacks(item.id, installedPackIds, customPacks)) {
          return false;
        }
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);

  // Auto-expande o grupo caso o usuário navegue diretamente para uma tela dentro dele
  useEffect(() => {
    const ownerGroup = activeNavGroups.find(
      (g) => g.collapsible && g.items.some((item) => item.id === activeTab)
    );
    if (ownerGroup && !expandedGroups[ownerGroup.title]) {
      setExpandedGroups((prev) => ({ ...prev, [ownerGroup.title]: true }));
    }
  }, [activeTab]);

  const allItems = activeNavGroups.flatMap((g) => g.items);
  const compactPinnedItems = isSimpleMode
    ? allItems
    : allItems.filter((item) => pinnedItems[item.id]);

  return (
    <nav
      ref={navRef}
      className={`jarvis-sidebar openbot-primary-rail ${collapsed ? 'is-collapsed' : ''} ${hidden ? 'is-hidden' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}
      aria-label="Navegação Principal"
      aria-hidden={hidden && !mobileOpen ? true : undefined}
      inert={hidden && !mobileOpen ? true : undefined}
    >
      {/* Brand Header */}
      <div
        className="jarvis-sidebar-header"
        style={{
          height: 'var(--topbar-height)',
          padding: collapsed ? '0 12px' : '0 14px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            minWidth: 0,
          }}
        >
          <AiOrbButton assistantName={assistantName} />
          {!collapsed && (
            <button
              type="button"
              onClick={() => onNavigate('overview')}
              aria-label="Ir para Visão Geral"
              className="btn btn-ghost btn-sm btn-start"
              title={`${assistantName} · Calmon Studio`}
              style={{ padding: '4px 6px', height: 'auto', textAlign: 'left', overflow: 'hidden' }}
            >
              <div style={{ textAlign: 'left', overflow: 'hidden' }}>
                <div
                  style={{
                    fontSize: '0.88rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    letterSpacing: '-0.01em',
                    lineHeight: 1.15,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '132px',
                  }}
                >
                  {assistantName}
                </div>
                <div
                  style={{
                    fontSize: '0.68rem',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    lineHeight: 1.2,
                  }}
                >
                  {isSimpleMode ? 'Modo Simples' : 'Calmon Studio · Completo'}
                </div>
              </div>
            </button>
          )}
        </div>

        {!collapsed && (onToggleCollapse || onToggleHidden) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="btn btn-ghost btn-icon-sm"
                title="Recolher barra lateral (Ctrl+B)"
                aria-label="Recolher barra lateral"
              >
                <PanelLeftClose size={15} />
              </button>
            )}
            {onToggleHidden && (
              <button
                type="button"
                onClick={onToggleHidden}
                className="btn btn-ghost btn-icon-sm hide-mobile"
                title="Ocultar barra lateral (Modo Dock Puro)"
                aria-label="Ocultar barra lateral"
              >
                <EyeOff size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Scrollable Navigation */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: collapsed ? '12px 10px' : '12px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: collapsed ? '6px' : '16px',
        }}
      >
        {collapsed ? (
          <>
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="jarvis-sidebar-item"
                title="Expandir barra lateral (Ctrl+B)"
                aria-label="Expandir barra lateral"
              >
                <PanelLeftOpen size={18} />
              </button>
            )}
            {onToggleHidden && (
              <button
                type="button"
                onClick={onToggleHidden}
                className="jarvis-sidebar-item hide-mobile"
                title="Ocultar barra lateral (Modo Dock Puro)"
                aria-label="Ocultar barra lateral"
              >
                <EyeOff size={16} />
              </button>
            )}
            {compactPinnedItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  aria-label={item.label}
                  className={`jarvis-sidebar-item ${isActive ? 'is-active' : ''}`}
                  title={item.label}
                >
                  <Icon size={18} />
                  {item.badge && item.badge > 0 ? (
                    <span
                      style={{
                        position: 'absolute',
                        top: '5px',
                        right: '5px',
                        minWidth: '16px',
                        height: '16px',
                        padding: '0 4px',
                        borderRadius: '999px',
                        backgroundColor: 'var(--warning-color)',
                        color: '#0b0d12',
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}

            {/* Overflow Menu in Collapsed Mode */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setMoreMenuOpen((prev) => !prev)}
                aria-label="Mais módulos"
                className={`jarvis-sidebar-item ${moreMenuOpen ? 'is-active' : ''}`}
                title="Todos os módulos"
              >
                <MoreHorizontal size={18} />
              </button>

              {moreMenuOpen && typeof document !== 'undefined' &&
                createPortal(
                  <div
                    ref={moreMenuRef}
                    style={{
                      position: 'fixed',
                      left: mobileOpen ? '16px' : collapsed ? '92px' : '274px',
                      top: '80px',
                      width: '240px',
                      maxWidth: 'calc(100vw - 32px)',
                      maxHeight: '72vh',
                      overflowY: 'auto',
                      backgroundColor: 'var(--bg-elevated)',
                      borderRadius: 'var(--radius-lg)',
                      border: '1px solid var(--border-color)',
                      padding: '8px',
                      boxShadow: 'var(--shadow-lg)',
                      zIndex: 200,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        color: 'var(--text-muted)',
                        padding: '4px 8px 6px',
                      }}
                    >
                      Módulos do Workspace
                    </div>
                    {allItems.map((item) => {
                      const Icon = item.icon;
                      const isPinned = !!pinnedItems[item.id];
                      const isActive = activeTab === item.id;
                      return (
                        <div
                          key={item.id}
                          onClick={() => {
                            onNavigate(item.id);
                            setMoreMenuOpen(false);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '7px 9px',
                            borderRadius: 'var(--radius-md)',
                            cursor: 'pointer',
                            fontSize: '0.82rem',
                            backgroundColor: isActive ? 'var(--accent-soft)' : 'transparent',
                            color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                            <Icon size={15} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.label}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => togglePin(item.id, e)}
                            className={`btn btn-ghost btn-icon-sm ${isPinned ? 'is-active' : ''}`}
                            title={isPinned ? 'Desafixar do trilho compacto' : 'Fixar no trilho compacto'}
                          >
                            <Pin size={13} style={{ transform: isPinned ? 'rotate(45deg)' : 'none' }} />
                          </button>
                        </div>
                      );
                    })}
                  </div>,
                  document.body
                )}
            </div>
          </>
        ) : (
          activeNavGroups.map((group) => {
            const isCollapsible = !!group.collapsible;
            const isExpanded = !isCollapsible || !!expandedGroups[group.title];
            const groupBadgeTotal = group.items.reduce((acc, item) => acc + (item.badge || 0), 0);

            return (
              <div key={group.title} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {isCollapsible ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.title)}
                    aria-expanded={isExpanded}
                    className="jarvis-sidebar-group-toggle"
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {group.title}
                      </span>
                      {!isExpanded && groupBadgeTotal > 0 && (
                        <span
                          className="tabular-nums"
                          style={{
                            padding: '1px 5px',
                            borderRadius: '5px',
                            backgroundColor: 'var(--warning-soft)',
                            color: 'var(--warning-text)',
                            fontSize: '0.66rem',
                            fontWeight: 700,
                          }}
                        >
                          {groupBadgeTotal}
                        </span>
                      )}
                    </span>
                    {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                ) : (
                  <div
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      padding: '2px 10px 6px',
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {group.title}
                  </div>
                )}

                {isExpanded &&
                  group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onNavigate(item.id)}
                        className={`jarvis-sidebar-item ${isActive ? 'is-active' : ''}`}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        <Icon size={16} />
                        <span
                          style={{
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.label}
                        </span>
                        {item.badge && item.badge > 0 ? (
                          <span
                            className="tabular-nums"
                            style={{
                              padding: '1px 6px',
                              borderRadius: '6px',
                              backgroundColor: 'var(--warning-soft)',
                              color: 'var(--warning-text)',
                              border: '1px solid rgba(245, 158, 11, 0.25)',
                              fontSize: '0.72rem',
                              fontWeight: 600,
                            }}
                          >
                            {item.badge}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>

      {/* Footer Utility Navigation + Mode Switch + Server / Account Popover */}
      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          padding: '10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          flexShrink: 0,
        }}
      >
        {onToggleExperienceMode && (
          <button
            type="button"
            onClick={onToggleExperienceMode}
            className="jarvis-sidebar-item"
            title={isSimpleMode ? 'Mudar para Modo Completo (Engenharia)' : 'Mudar para Modo Simples (Pessoal)'}
            aria-label={isSimpleMode ? 'Alternar para Modo Completo' : 'Alternar para Modo Simples'}
          >
            <SlidersHorizontal size={16} color="var(--accent-light)" />
            {!collapsed && (
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isSimpleMode ? 'Ativar Modo Completo' : 'Usar Modo Simples'}
              </span>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={() => onNavigate('store')}
          className={`jarvis-sidebar-item ${activeTab === 'store' ? 'is-active' : ''}`}
          title="Loja Unificada — Pacotes, Núcleos & Habilidades"
          aria-current={activeTab === 'store' ? 'page' : undefined}
        >
          <Store size={16} />
          {!collapsed && <span>Loja Unificada</span>}
        </button>

        {canManagePacks && (
          <button
            type="button"
            onClick={() => onNavigate('pack_studio')}
            className={`jarvis-sidebar-item ${activeTab === 'pack_studio' ? 'is-active' : ''}`}
            title="Estúdio de Pacotes (Dev & Admin)"
            aria-current={activeTab === 'pack_studio' ? 'page' : undefined}
          >
            <Wrench size={16} />
            {!collapsed && <span>Estúdio de Pacotes</span>}
          </button>
        )}

        <button
          type="button"
          onClick={onOpenHelp || (() => onNavigate('learning'))}
          className={`jarvis-sidebar-item ${activeTab === 'learning' ? 'is-active' : ''}`}
          title="Central de Ajuda & Guias"
        >
          <HelpCircle size={16} />
          {!collapsed && <span>Ajuda & Guias</span>}
        </button>

        <button
          type="button"
          onClick={onOpenSettings || (() => onNavigate('settings'))}
          className={`jarvis-sidebar-item ${activeTab === 'settings' ? 'is-active' : ''}`}
          title="Configurações"
        >
          <Settings size={16} />
          {!collapsed && <span>Configurações</span>}
        </button>

        {/* Server / Account Trigger */}
        <div style={{ position: 'relative', marginTop: '6px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => setServerMenuOpen((prev) => !prev)}
            className={`jarvis-sidebar-item ${serverMenuOpen ? 'is-active' : ''}`}
            title={`Instância ${assistantName} e Conta`}
          >
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '6px',
                background: 'var(--accent-soft)',
                border: '1px solid var(--border-accent)',
                color: 'var(--accent-light)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Server size={13} />
            </div>
            {!collapsed && (
              <>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
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
                    {assistantName} Studio
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    Sessão autenticada
                  </div>
                </div>
                <ChevronRight size={14} color="var(--text-muted)" />
              </>
            )}
          </button>

          {serverMenuOpen && typeof document !== 'undefined' &&
            createPortal(
              <div
                ref={serverMenuRef}
                style={{
                  position: 'fixed',
                  left: mobileOpen ? '16px' : collapsed ? '92px' : '274px',
                  bottom: mobileOpen ? '76px' : '18px',
                  width: '248px',
                  maxWidth: 'calc(100vw - 32px)',
                  backgroundColor: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--border-color)',
                  padding: '8px',
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 200,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', padding: '4px 8px 6px' }}>
                  Instância ativa
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.82rem',
                    color: 'var(--text-primary)',
                    marginBottom: '4px',
                  }}
                >
                  <Check size={15} color="var(--success-color)" />
                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeBrainLabel}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onNavigate('brain_server');
                    setServerMenuOpen(false);
                  }}
                  className="btn btn-ghost btn-sm btn-block btn-start"
                >
                  <Server size={15} color="var(--accent-light)" />
                  <span>Trocar Cérebro / Docker</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    emitAppEvent('jarvis:open-android-pairing');
                    setServerMenuOpen(false);
                  }}
                  className="btn btn-ghost btn-sm btn-block btn-start"
                >
                  <Smartphone size={15} color="var(--accent-light)" />
                  <span>Conectar app Android</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    emitAppEvent('jarvis:open-access-management');
                    setServerMenuOpen(false);
                  }}
                  className="btn btn-ghost btn-sm btn-block btn-start"
                >
                  <Users size={15} color="var(--text-secondary)" />
                  <span>Gerir acessos da equipe</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (onOpenProfile) onOpenProfile();
                    setServerMenuOpen(false);
                  }}
                  className="btn btn-ghost btn-sm btn-block btn-start"
                >
                  <Settings size={15} color="var(--text-secondary)" />
                  <span>Perfil e configurações</span>
                </button>

                <div style={{ height: '1px', background: 'var(--border-color)', margin: '4px 0' }} />

                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('jarvis:logout'));
                    setServerMenuOpen(false);
                  }}
                  className="btn btn-danger-ghost btn-sm btn-block btn-start"
                >
                  <LogOut size={15} />
                  <span>Sair da conta</span>
                </button>
              </div>,
              document.body
            )}
        </div>
      </div>
    </nav>
  );
};
