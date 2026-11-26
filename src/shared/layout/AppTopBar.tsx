import React from 'react';
import {
  CircleHelp,
  Monitor,
  Moon,
  PanelBottom,
  PanelLeft,
  Plus,
  Search,
  ShieldAlert,
  Sun,
} from 'lucide-react';
import { DynamicIsland } from '../navigation/DynamicIsland';
import { AiOrbButton } from '../navigation/AiOrbButton';
import { LaunchpadGlyph } from '../navigation/NavIcon';
import type { SystemResourceUsage } from '../../services/api/system';
import type { ThemeMode } from '../../services/themeEngine';

export interface AppTopBarProps {
  isSidebarHidden: boolean;
  onToggleSidebar: () => void;
  isSimpleMode: boolean;
  launchpadOpen: boolean;
  onToggleLaunchpad: () => void;
  activeMeta: { section: string; title: string };
  assistantName: string;
  showVoiceHud: boolean;
  wakeWordEnabled: boolean;
  onToggleVoiceHud: () => void;
  showDynamicIsland: boolean;
  systemResources: SystemResourceUsage | null;
  onOpenVoiceHud: () => void;
  onOpenCommandPalette: () => void;
  pendingApprovalsCount: number;
  onNavigate: (tab: any) => void;
  onNewChat: () => void;
  showAgentDock: boolean;
  onToggleAgentDock: () => void;
  themeMode: ThemeMode;
  themeQuickLabel: string;
  onCycleTheme: () => void;
  avatarText: string;
  onOpenProfileModal: () => void;
}

export const AppTopBar: React.FC<AppTopBarProps> = ({
  isSidebarHidden,
  onToggleSidebar,
  isSimpleMode,
  launchpadOpen,
  onToggleLaunchpad,
  activeMeta,
  assistantName,
  showVoiceHud,
  wakeWordEnabled,
  onToggleVoiceHud,
  showDynamicIsland,
  systemResources,
  onOpenVoiceHud,
  onOpenCommandPalette,
  pendingApprovalsCount,
  onNavigate,
  onNewChat,
  showAgentDock,
  onToggleAgentDock,
  themeMode,
  themeQuickLabel,
  onCycleTheme,
  avatarText,
  onOpenProfileModal,
}) => (
  <header className="jarvis-topbar">
    {/* Esquerda: Toggle Sidebar + Launchpad + Breadcrumb Contextual */}
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
      <button
        type="button"
        onClick={onToggleSidebar}
        className={`btn btn-ghost btn-icon ${isSidebarHidden ? 'is-active' : ''}`}
        title={isSidebarHidden ? 'Mostrar barra lateral (Ctrl+B)' : 'Alternar barra lateral (Ctrl+B)'}
        aria-label={isSidebarHidden ? 'Mostrar barra lateral' : 'Alternar barra lateral'}
      >
        <PanelLeft size={16} />
      </button>

      {(!isSimpleMode || isSidebarHidden) && (
        <button
          type="button"
          onClick={onToggleLaunchpad}
          className={`btn btn-ghost btn-icon ${launchpadOpen ? 'is-active' : ''}`}
          title="Abrir Launchpad de Módulos (Ctrl+Shift+L)"
          aria-label="Abrir Launchpad de Módulos"
          aria-pressed={launchpadOpen}
        >
          <LaunchpadGlyph size={16} />
        </button>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '0.84rem',
          minWidth: 0,
        }}
      >
        <span className="hide-mobile jarvis-topbar-hide-narrow" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {activeMeta.section}
        </span>
        <span className="hide-mobile jarvis-topbar-hide-narrow" style={{ color: 'var(--border-hover)' }}>
          /
        </span>
        <span
          style={{
            color: 'var(--text-primary)',
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {activeMeta.title}
        </span>
      </div>
    </div>

    {/* Centro: Orb de IA animado com a letra C */}
    <AiOrbButton
      assistantName={assistantName}
      active={showVoiceHud || wakeWordEnabled}
      centered
      onClick={onToggleVoiceHud}
    />

    {/* Direita: Telemetria Inline (DynamicIsland), Comando Ctrl+K, Ação Principal, Perfil */}
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
      {showDynamicIsland && !isSimpleMode && (
        <div className="hide-mobile jarvis-topbar-hide-tablet">
          <DynamicIsland
            variant="inline"
            activeAgentName="Calmon Studio"
            systemStatus={{
              cpu: systemResources?.cpu_percent ?? null,
              memory: systemResources?.ram_percent ?? null,
            }}
            onOpenVoice={onOpenVoiceHud}
          />
        </div>
      )}

      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="btn btn-secondary btn-sm"
        title="Paleta de Comandos (Ctrl+K)"
        aria-label="Abrir busca rápida e comandos (Ctrl+K)"
      >
        <Search size={13} />
        <span className="hide-mobile jarvis-topbar-hide-narrow">Buscar...</span>
        <kbd
          className="hide-mobile jarvis-topbar-hide-tablet"
          style={{
            marginLeft: '4px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            padding: '1px 5px',
            borderRadius: '4px',
            fontSize: '0.68rem',
            color: 'var(--text-muted)',
          }}
        >
          Ctrl K
        </kbd>
      </button>

      {pendingApprovalsCount > 0 && !isSimpleMode && (
        <button
          type="button"
          onClick={() => onNavigate('approvals')}
          className="btn btn-sm badge-warning tabular-nums"
          title="Aprovações pendentes"
        >
          <ShieldAlert size={13} />
          <span>{pendingApprovalsCount}</span>
        </button>
      )}

      <button
        type="button"
        className="btn btn-primary btn-sm hide-mobile"
        title="Novo chat"
        aria-label="Novo chat"
        onClick={onNewChat}
      >
        <Plus size={14} />
        <span className="jarvis-topbar-hide-narrow">Novo chat</span>
      </button>

      {!isSimpleMode && (
        <button
          type="button"
          className={`btn btn-ghost btn-icon hide-mobile ${showAgentDock ? 'is-active' : ''}`}
          onClick={onToggleAgentDock}
          title={showAgentDock ? 'Ocultar Dock macOS' : 'Mostrar Dock macOS'}
          aria-label={showAgentDock ? 'Ocultar Dock macOS' : 'Mostrar Dock macOS'}
          aria-pressed={showAgentDock}
        >
          <PanelBottom size={16} />
        </button>
      )}

      <button
        type="button"
        className="btn btn-ghost btn-icon"
        onClick={onCycleTheme}
        data-theme-quick-toggle="true"
        title={themeQuickLabel}
        aria-label={themeQuickLabel}
      >
        {themeMode === 'friendly_light' ? (
          <Sun size={16} />
        ) : themeMode === 'auto' ? (
          <Monitor size={16} />
        ) : (
          <Moon size={16} />
        )}
      </button>

      <button
        type="button"
        className="btn btn-ghost btn-icon"
        onClick={() => onNavigate('learning')}
        title="Ajuda contextual e tutoriais"
        aria-label="Abrir ajuda contextual"
      >
        <CircleHelp size={16} />
      </button>

      <button
        type="button"
        onClick={onOpenProfileModal}
        aria-label="Perfil do usuário"
        className="btn btn-secondary btn-icon"
        title="Perfil e Configurações"
      >
        {avatarText}
      </button>
    </div>
  </header>
);
