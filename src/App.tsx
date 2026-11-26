import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import { AuthGate } from './features/auth/AuthGate';
import { PrimaryRail } from './shared/navigation/PrimaryRail';
import { AgentDock } from './shared/navigation/AgentDock';
import { AppTopBar } from './shared/layout/AppTopBar';
import { VOICE_HUD_STATE_EVENT, VOICE_HUD_TOGGLE_EVENT } from './shared/navigation/AiOrbButton';
import { LaunchpadGlyph } from './shared/navigation/NavIcon';
import { AgentInfo } from './types';
import { fetchAgents } from './api';
import {
  ShieldAlert,
  PanelLeft,
  PanelBottom,
  Mic,
  LayoutDashboard,
  MessageSquare,
  Smartphone,
  ShieldCheck,
} from 'lucide-react';
import { useWakeWordListener } from './hooks/useWakeWordListener';
import { useShellPreferences } from './hooks/useShellPreferences';
import { useSystemPolling } from './hooks/useSystemPolling';
import { subscribeAppEvent } from './shared/state/appBus';
import { getUserProfile, type UserProfileData } from './services/userProfile';
import { ToastContainer } from './shared/common/Toast';
import { ApprovalPromptHost } from './shared/common/ApprovalPromptHost';
import {
  computeDockClearancePx,
  resolveDockFavoriteItems,
  resolveVisibleNavModules,
} from './services/navigationShell';
import { OfflineIndicator } from './shared/pwa/PWAInstallButton';
import { ErrorBanner } from './shared/layout/StateFeedback';
import { pathForTab, tabFromLocation } from './router';
import { API_BASE } from './services/api/client';
import { apiFetch } from './services/sessionTransport';
import {
  AssistantIdentityProvider,
  useAssistantIdentity,
} from './context/AssistantIdentityContext';
import {
  fetchModulePacks,
  installModulePack,
  PACKS_UPDATED_EVENT,
  type ModulePacksPayload,
} from './services/api/packs';
import {
  findPackProvidingTab,
  isTabUnlockedByPacks,
  type ModulePackDefinition,
} from './services/modulePackEngine';

const LaunchpadOverlay = lazy(() =>
  import('./shared/navigation/LaunchpadOverlay').then((m) => ({ default: m.LaunchpadOverlay }))
);
const SetupWizardModal = lazy(() =>
  import('./shared/common/SetupWizardModal').then((m) => ({ default: m.SetupWizardModal }))
);
const InitialPasswordChangeModal = lazy(() =>
  import('./shared/common/InitialPasswordChangeModal').then((m) => ({
    default: m.InitialPasswordChangeModal,
  }))
);
const GuidedTour = lazy(() =>
  import('./shared/common/GuidedTour').then((m) => ({ default: m.GuidedTour }))
);
const CommandPalette = lazy(() =>
  import('./shared/common/CommandPalette').then((m) => ({ default: m.CommandPalette }))
);
const VoiceLiveHudModal = lazy(() =>
  import('./features/companion/VoiceLiveHudModal').then((m) => ({ default: m.VoiceLiveHudModal }))
);
const UserProfileModal = lazy(() =>
  import('./shared/common/UserProfileModal').then((m) => ({ default: m.UserProfileModal }))
);

// Code splitting: cada tela é carregada sob demanda
const Overview = lazy(() =>
  import('./features/overview/Overview').then((m) => ({ default: m.Overview }))
);
const ChatMaster = lazy(() =>
  import('./features/chat/ChatMaster').then((m) => ({ default: m.ChatMaster }))
);
const ApprovalCenter = lazy(() =>
  import('./features/approvals/ApprovalCenter').then((m) => ({ default: m.ApprovalCenter }))
);
const ProjectWorkspaceView = lazy(() =>
  import('./features/workspace/ProjectWorkspaceView').then((m) => ({ default: m.ProjectWorkspaceView }))
);
const AgentCenterView = lazy(() =>
  import('./features/agents/AgentCenterView').then((m) => ({ default: m.AgentCenterView }))
);
const TaskManagerView = lazy(() =>
  import('./features/tasks/TaskManagerView').then((m) => ({ default: m.TaskManagerView }))
);
const ModelManagerView = lazy(() =>
  import('./features/models/ModelManagerView').then((m) => ({ default: m.ModelManagerView }))
);
const SkillsManagerView = lazy(() =>
  import('./features/skills/SkillsManagerView').then((m) => ({ default: m.SkillsManagerView }))
);
const PackStoreView = lazy(() =>
  import('./features/store/PackStoreView').then((m) => ({ default: m.PackStoreView }))
);
const PackStudioAdminView = lazy(() =>
  import('./features/store/PackStudioAdminView').then((m) => ({ default: m.PackStudioAdminView }))
);
const ArchitectureAgentView = lazy(() =>
  import('./features/architecture/ArchitectureAgentView').then((m) => ({
    default: m.ArchitectureAgentView,
  }))
);
const SecurityCenterView = lazy(() =>
  import('./features/security/SecurityCenterView').then((m) => ({ default: m.SecurityCenterView }))
);
const ServerLogsView = lazy(() =>
  import('./features/logs/ServerLogsView').then((m) => ({ default: m.ServerLogsView }))
);
const HardwareAdvisorView = lazy(() =>
  import('./features/hardware/HardwareAdvisorView').then((m) => ({ default: m.HardwareAdvisorView }))
);
const KnowledgeVaultView = lazy(() =>
  import('./features/knowledge/KnowledgeVaultView').then((m) => ({ default: m.KnowledgeVaultView }))
);
const BackendStudioView = lazy(() =>
  import('./features/studios/BackendStudioView').then((m) => ({ default: m.BackendStudioView }))
);
const QualityStudioView = lazy(() =>
  import('./features/studios/QualityStudioView').then((m) => ({ default: m.QualityStudioView }))
);
const DesignStudioView = lazy(() =>
  import('./features/studios/DesignStudioView').then((m) => ({ default: m.DesignStudioView }))
);
const ExecutiveReportView = lazy(() =>
  import('./features/executive/ExecutiveReportView').then((m) => ({ default: m.ExecutiveReportView }))
);
const CodingAgentView = lazy(() =>
  import('./features/coding/CodingAgentView').then((m) => ({ default: m.CodingAgentView }))
);
const LearningCenterView = lazy(() =>
  import('./features/learning/LearningCenterView').then((m) => ({ default: m.LearningCenterView }))
);
const AgentOfficeView = lazy(() =>
  import('./features/office/AgentOfficeView').then((m) => ({ default: m.AgentOfficeView }))
);
const SettingsView = lazy(() =>
  import('./features/settings/SettingsView').then((m) => ({ default: m.SettingsView }))
);
const WorkflowCanvasView = lazy(() =>
  import('./features/workflows/WorkflowCanvasView').then((m) => ({ default: m.WorkflowCanvasView }))
);
const UsageAnalyticsView = lazy(() =>
  import('./features/usage/UsageAnalyticsView').then((m) => ({ default: m.UsageAnalyticsView }))
);
const CompanionHubView = lazy(() =>
  import('./features/companion/CompanionHubView').then((m) => ({ default: m.CompanionHubView }))
);
const CreativeMediaStudioView = lazy(() =>
  import('./features/studio/CreativeMediaStudioView').then((m) => ({
    default: m.CreativeMediaStudioView,
  }))
);
const AppBuilderView = lazy(() =>
  import('./features/studio/AppBuilderView').then((m) => ({
    default: m.AppBuilderView,
  }))
);
const GitHubImporterView = lazy(() =>
  import('./features/github/GitHubImporterView').then((m) => ({
    default: m.GitHubImporterView,
  }))
);
const AndroidMobileHubView = lazy(() =>
  import('./features/mobile/AndroidMobileHubView').then((m) => ({
    default: m.AndroidMobileHubView,
  }))
);
const BrainServerHubView = lazy(() =>
  import('./features/brain/BrainServerHubView').then((m) => ({
    default: m.BrainServerHubView,
  }))
);

/**
 * Telas que ocupam toda a área útil com layout e cabeçalho internos próprios.
 */
const FULLSCREEN_TABS = new Set(['chat', 'workflows', 'settings', 'learning', 'skills', 'store']);
const NO_HEADER_TABS = new Set(['chat', 'workflows']);

const TAB_LABELS: Record<string, { section: string; title: string }> = {
  overview: { section: 'Principal', title: 'Visão Geral' },
  chat: { section: 'Principal', title: 'Chat e Conversas' },
  tasks: { section: 'Produtividade', title: 'Tarefas' },
  workflows: { section: 'Produtividade', title: 'Monitor de Fluxo de Tarefas' },
  workspace: { section: 'Principal', title: 'Projetos & Biblioteca' },
  coding: { section: 'Engenharia', title: 'IDE & Código' },
  agents: { section: 'Inteligência', title: 'Central de Agentes' },
  architecture: { section: 'Engenharia', title: 'Agente de Arquitetura' },
  models: { section: 'Inteligência', title: 'Central de Modelos & Hardware' },
  knowledge: { section: 'Inteligência', title: 'Habilidades & Conhecimentos' },
  skills: { section: 'Inteligência', title: 'Habilidades & Conhecimentos' },
  store: { section: 'Loja Unificada', title: 'Loja de Pacotes, Núcleos & Habilidades' },
  pack_studio: { section: 'Admin & Dev', title: 'Estúdio de Pacotes' },
  approvals: { section: 'Governança', title: 'Central de Aprovações' },
  usage: { section: 'Governança', title: 'Uso & Custos' },
  security: { section: 'Governança', title: 'Segurança & Auditoria' },
  backend_studio: { section: 'Estúdios', title: 'Backend Studio' },
  quality: { section: 'Estúdios', title: 'Qualidade & QA' },
  design: { section: 'Estúdios', title: 'Design Studio' },
  office: { section: 'Principal', title: 'Escritório Isométrico' },
  executive_report: { section: 'Governança', title: 'Relatório Executivo ROI' },
  advisor: { section: 'Inteligência', title: 'Diagnóstico de Hardware' },
  server_logs: { section: 'Sistema', title: 'Logs do Servidor' },
  learning: { section: 'Suporte', title: 'Central de Ajuda' },
  settings: { section: 'Sistema', title: 'Configurações' },
  companion: { section: 'Ecossistema', title: 'Voz, PWA & Companion' },
  creative_studio: { section: 'Principal', title: 'Estúdio Criativo' },
  app_builder: { section: 'Principal', title: 'Construtor de Apps' },
  github_import: { section: 'Engenharia', title: 'Importar do GitHub' },
  android_app: { section: 'Ecossistema', title: 'App Mobile Android' },
  brain_server: { section: 'Ecossistema', title: 'Cérebros & Servidor' },
  not_found: { section: 'JARVIS', title: 'Página não encontrada' },
};

const ViewFallback: React.FC = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '56px 16px',
      color: 'var(--text-secondary)',
      fontSize: '0.86rem',
    }}
  >
    Carregando módulo...
  </div>
);

class ModuleErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '24px' }}>
          <ErrorBanner
            message={`Não foi possível renderizar este módulo (${this.state.error.message}).`}
            onRetry={() => this.setState({ error: null })}
          />
        </div>
      );
    }
    return this.props.children;
  }
}

const NotFoundView: React.FC<{ onGoHome: () => void }> = ({ onGoHome }) => (
  <section
    role="status"
    aria-labelledby="not-found-title"
    style={{
      minHeight: '60vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '12px',
      textAlign: 'center',
      color: 'var(--text-secondary)',
    }}
  >
    <div style={{ fontSize: '3rem', color: 'var(--accent-light)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
      404
    </div>
    <h1 id="not-found-title" style={{ color: 'var(--text-primary)', fontSize: '1.35rem' }}>
      Página não encontrada
    </h1>
    <p style={{ maxWidth: '420px', fontSize: '0.9rem' }}>
      Este endereço não corresponde a uma página disponível no Calmon Studio.
    </p>
    <button type="button" className="btn btn-primary" onClick={onGoHome}>
      Ir para a Visão Geral
    </button>
  </section>
);

const DashboardApp: React.FC = () => {
  const { assistantName, experienceMode, setExperienceMode, profile: identityProfile, updateIdentityProfile } = useAssistantIdentity();
  const isSimpleMode = experienceMode === 'simple';
  const [authPermissions, setAuthPermissions] = useState<string[]>([]);
  const [authRole, setAuthRole] = useState<string | null>(null);
  const [authKind, setAuthKind] = useState<string | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [authMustChangePassword, setAuthMustChangePassword] = useState(false);
  const [guidedTourOpen, setGuidedTourOpen] = useState(false);
  const [learningContextTab, setLearningContextTab] = useState('overview');

  const hasPermission = (permission: string) =>
    authPermissions.includes('*') || authPermissions.includes(permission);

  const canAccessTab = (tab: string) => {
    if (tab === 'not_found') return true;
    if (tab === 'advisor' || tab === 'server_logs') return authKind === 'human' && authRole === 'admin';
    const required: Record<string, string> = {
      chat: 'chat:read',
      overview: 'system:read',
      approvals: 'approvals:read',
      design: 'studios:read',
      office: 'agents:read',
      workspace: 'workspace:read',
      models: 'models:read',
      coding: 'coding:read',
      agents: 'agents:read',
      knowledge: 'knowledge:read',
      tasks: 'tasks:read',
      backend_studio: 'studios:read',
      quality: 'studios:read',
      skills: 'skills:read',
      security: 'security:read',
      executive_report: 'studios:read',
      learning: 'profile:read',
      settings: 'profile:read',
      workflows: 'studios:read',
      usage: 'system:read',
      store: 'skills:read',
    };
    return !required[tab] || hasPermission(required[tab]);
  };

  const [activeTab, setActiveTab] = useState<string>(() =>
    tabFromLocation(window.location.pathname, window.location.search)
  );
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showVoiceHud, setShowVoiceHud] = useState(false);
  const [pendingVoiceCommand, setPendingVoiceCommand] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfileData>(getUserProfile);
  const [launchpadOpen, setLaunchpadOpen] = useState(false);
  const [installedAgents, setInstalledAgents] = useState<AgentInfo[]>([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const {
    themeMode,
    themeQuickLabel,
    handleCycleTheme,
    isSidebarCollapsed,
    isSidebarHidden,
    dockFavorites,
    showDynamicIsland,
    showAgentDock,
    effectiveDockMinimized,
    handleToggleSidebar,
    handleToggleSidebarHidden,
    handleToggleAgentDock,
    handleToggleDockMinimized,
    handleToggleDockFavorite,
  } = useShellPreferences({ activeTab, setMobileNavOpen });

  const wakeWord = useWakeWordListener({
    assistantName,
    paused: showVoiceHud,
    onWakeDetected: ({ command }) => {
      setPendingVoiceCommand(command || null);
      setShowVoiceHud(true);
    },
  });

  useEffect(() => {
    const handleToggle = () => {
      setPendingVoiceCommand(null);
      setShowVoiceHud((prev) => !prev);
    };
    window.addEventListener(VOICE_HUD_TOGGLE_EVENT, handleToggle);
    return () => window.removeEventListener(VOICE_HUD_TOGGLE_EVENT, handleToggle);
  }, []);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(VOICE_HUD_STATE_EVENT, {
        detail: { active: showVoiceHud || wakeWord.enabled },
      })
    );
  }, [showVoiceHud, wakeWord.enabled]);

  useEffect(() => {
    setUserProfile(identityProfile);
  }, [identityProfile]);
  const [attachedProjectId, setAttachedProjectId] = useState<string | null>(null);
  const [targetChatSessionId, setTargetChatSessionId] = useState<string | null>(null);
  const [pendingChatPrompt, setPendingChatPrompt] = useState<string | null>(null);
  const {
    health,
    approvals,
    healthLoading,
    approvalsLoading,
    healthError,
    approvalsError,
    systemResources,
    loadData,
  } = useSystemPolling();
  const [installedPackIds, setInstalledPackIds] = useState<string[] | null>(null);
  const [customPacks, setCustomPacks] = useState<ModulePackDefinition[]>([]);
  const [installingRequiredPack, setInstallingRequiredPack] = useState(false);

  const canManagePacks = authRole === 'admin' || authRole === 'developer';

  useEffect(() => {
    if (!authLoaded) return;
    let active = true;
    fetchModulePacks()
      .then((res) => {
        if (active) {
          setInstalledPackIds(res.installed_pack_ids);
          setCustomPacks(res.custom_packs || []);
        }
      })
      .catch(() => {
        if (active) setInstalledPackIds(null);
      });

    const onPacksUpdated = (e: Event) => {
      const detail = (e as CustomEvent<ModulePacksPayload>).detail;
      if (detail?.installed_pack_ids) {
        setInstalledPackIds(detail.installed_pack_ids);
      }
      if (detail?.custom_packs) {
        setCustomPacks(detail.custom_packs);
      }
    };
    window.addEventListener(PACKS_UPDATED_EVENT, onPacksUpdated);
    return () => {
      active = false;
      window.removeEventListener(PACKS_UPDATED_EVENT, onPacksUpdated);
    };
  }, [authLoaded]);

  useEffect(() => {
    if (!authLoaded) return;
    let active = true;
    const syncAgents = () => {
      fetchAgents()
        .then((list) => {
          if (active && Array.isArray(list)) setInstalledAgents(list);
        })
        .catch(() => {});
    };
    syncAgents();
    const unsubAgents = subscribeAppEvent('jarvis:agents-updated', syncAgents);
    window.addEventListener('jarvis:dock-updated', syncAgents);
    window.addEventListener(PACKS_UPDATED_EVENT, syncAgents);
    return () => {
      active = false;
      unsubAgents();
      window.removeEventListener('jarvis:dock-updated', syncAgents);
      window.removeEventListener(PACKS_UPDATED_EVENT, syncAgents);
    };
  }, [authLoaded]);

  const [chatLoaded, setChatLoaded] = useState(
    () => tabFromLocation(window.location.pathname, window.location.search) === 'chat'
  );

  useEffect(() => {
    let cancelled = false;
    apiFetch(`${API_BASE}/auth/me`, { credentials: 'include' })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((principal) => {
        if (cancelled) return;
        setAuthPermissions(Array.isArray(principal?.permissions) ? principal.permissions : []);
        setAuthRole(typeof principal?.role === 'string' ? principal.role : null);
        setAuthKind(typeof principal?.kind === 'string' ? principal.kind : null);
        setAuthMustChangePassword(principal?.must_change_password === true);
        setAuthLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setAuthPermissions([]);
          setAuthRole(null);
          setAuthKind(null);
          setAuthMustChangePassword(false);
          setAuthLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authLoaded || authKind !== 'human' || authRole !== 'admin') return;
    let cancelled = false;
    apiFetch(`${API_BASE}/system/onboarding`, { credentials: 'include' })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((status) => {
        if (!cancelled) setShowSetupWizard(status?.completed !== true);
      })
      .catch(() => {
        if (!cancelled) setShowSetupWizard(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoaded, authKind, authRole]);

  const navigate = (tab: string) => {
    if (tab === 'learning' && activeTab !== 'learning') setLearningContextTab(activeTab);
    const path = pathForTab(tab);
    if (path === '/404') return;
    setActiveTab(tab);
    setMobileNavOpen(false);
    setLaunchpadOpen(false);
    if (tab === 'chat') setChatLoaded(true);
    if (window.location.pathname !== path) {
      window.history.pushState({ tab }, '', path);
    }
  };

  const handleStartChatFromOverview = (prompt?: string) => {
    if (prompt && prompt.trim()) {
      setTargetChatSessionId('new_' + Date.now());
      setPendingChatPrompt(prompt.trim());
    }
    navigate('chat');
  };

  useEffect(() => {
    const initialTab = tabFromLocation(window.location.pathname, window.location.search);
    const initialPath = pathForTab(initialTab);
    if (initialTab !== 'not_found' && window.location.pathname !== initialPath) {
      window.history.replaceState({ tab: initialTab }, '', initialPath);
    }

    const handlePopState = () => {
      const tab = tabFromLocation(window.location.pathname, window.location.search);
      setActiveTab(tab);
      if (tab === 'chat') setChatLoaded(true);
    };

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setShowCommandPalette(false);
        setLaunchpadOpen((prev) => !prev);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        handleToggleSidebar();
      }
    };

    const handleToggleLaunchpadEvent = () => {
      setLaunchpadOpen((prev) => !prev);
    };

    const handleToggleSidebarHiddenEvent = () => {
      handleToggleSidebarHidden();
    };

    const handleOpenAndroidPairing = () => {
      navigate('android_app');
    };

    const handleOpenBrainManager = () => {
      navigate('brain_server');
    };

    const unsubAndroidPairing = subscribeAppEvent('jarvis:open-android-pairing', handleOpenAndroidPairing);
    const unsubAgentChat = subscribeAppEvent('jarvis:open-agent-chat', (detail) => {
      if (detail?.agentId) {
        setTargetChatSessionId(`agent_${detail.agentId}`);
        navigate('chat');
      }
    });

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('jarvis:open-brain-manager', handleOpenBrainManager);
    window.addEventListener('jarvis:toggle-launchpad', handleToggleLaunchpadEvent);
    window.addEventListener('jarvis:toggle-sidebar-hidden', handleToggleSidebarHiddenEvent);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleGlobalKeyDown);
      unsubAndroidPairing();
      window.removeEventListener('jarvis:open-brain-manager', handleOpenBrainManager);
      unsubAgentChat();
      window.removeEventListener('jarvis:toggle-launchpad', handleToggleLaunchpadEvent);
      window.removeEventListener('jarvis:toggle-sidebar-hidden', handleToggleSidebarHiddenEvent);
    };
  }, []);

  const pendingApprovalsCount = approvals.filter((a) => a.status === 'pending').length;
  const activeMeta = TAB_LABELS[activeTab] || { section: 'JARVIS', title: 'Workspace' };
  const isFullscreenTab = FULLSCREEN_TABS.has(activeTab);
  const showEscapePill = isSidebarHidden && !showAgentDock && NO_HEADER_TABS.has(activeTab);
  const dockClearance = computeDockClearancePx({
    showDock: showAgentDock,
    isMinimized: effectiveDockMinimized,
    showEscapePill,
  });

  const launchpadModules = useMemo(
    () =>
      resolveVisibleNavModules({
        isSimpleMode,
        installedPackIds,
        customPacks,
        canManagePacks,
        canAccessTab,
        includeLaunchpadOnly: true,
      }),
    [isSimpleMode, installedPackIds, customPacks, canManagePacks, authPermissions, authRole, authKind]
  );

  const dockFavoriteItems = useMemo(
    () =>
      resolveDockFavoriteItems(dockFavorites, {
        isSimpleMode,
        installedPackIds,
        customPacks,
        canManagePacks,
        canAccessTab,
      }),
    [dockFavorites, isSimpleMode, installedPackIds, customPacks, canManagePacks, authPermissions, authRole, authKind]
  );

  return (
    <div
      className="jarvis-app-root"
      style={
        {
          display: 'flex',
          height: '100dvh',
          width: '100%',
          minWidth: 0,
          overflow: 'hidden',
          backgroundColor: 'var(--bg-primary)',
          backgroundImage: 'var(--app-canvas-gradient)',
          fontFamily: 'var(--font-sans)',
          position: 'relative',
          '--jarvis-dock-clearance': dockClearance,
        } as React.CSSProperties
      }
    >
      {/* Backdrop móvel quando a gaveta estiver aberta */}
      {mobileNavOpen && (
        <div
          role="presentation"
          onClick={() => setMobileNavOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(5, 7, 12, 0.68)',
            backdropFilter: 'blur(2px)',
            zIndex: 90,
          }}
        />
      )}

      {/* Sidebar Flutuante macOS (256px expandida / 74px compacta / ocultável / gaveta no mobile) */}
      <PrimaryRail
        activeTab={activeTab}
        onNavigate={navigate}
        collapsed={isSidebarCollapsed}
        hidden={isSidebarHidden}
        mobileOpen={mobileNavOpen}
        onToggleCollapse={handleToggleSidebar}
        onToggleHidden={handleToggleSidebarHidden}
        pendingApprovalsCount={pendingApprovalsCount}
        installedPackIds={installedPackIds}
        customPacks={customPacks}
        canManagePacks={canManagePacks}
        canAccessTab={canAccessTab}
        assistantName={assistantName}
        experienceMode={experienceMode}
        onToggleExperienceMode={() => void setExperienceMode(isSimpleMode ? 'engineering' : 'simple')}
        onOpenSettings={() => navigate('settings')}
        onOpenHelp={() => navigate('learning')}
        onOpenProfile={() => setShowProfileModal(true)}
      />

      {/* Área Central */}
      <div
        className="jarvis-main-stage"
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          height: '100dvh',
          overflow: 'hidden',
          backgroundColor: 'var(--bg-primary)',
          position: 'relative',
        }}
      >
        {/* Top Bar Global (Contrato SaaS limpo, sem sobreposição) */}
        {!NO_HEADER_TABS.has(activeTab) && (
          <AppTopBar
            isSidebarHidden={isSidebarHidden}
            onToggleSidebar={handleToggleSidebar}
            isSimpleMode={isSimpleMode}
            launchpadOpen={launchpadOpen}
            onToggleLaunchpad={() => setLaunchpadOpen((prev) => !prev)}
            activeMeta={activeMeta}
            showDynamicIsland={showDynamicIsland}
            systemResources={systemResources}
            onOpenVoiceHud={() => setShowVoiceHud(true)}
            onOpenCommandPalette={() => setShowCommandPalette(true)}
            pendingApprovalsCount={pendingApprovalsCount}
            onNavigate={navigate}
            onNewChat={() => {
              setTargetChatSessionId('new_' + Date.now());
              navigate('chat');
            }}
            showAgentDock={showAgentDock}
            onToggleAgentDock={handleToggleAgentDock}
            themeMode={themeMode}
            themeQuickLabel={themeQuickLabel}
            onCycleTheme={handleCycleTheme}
            avatarText={
              userProfile.avatarIcon ||
              (userProfile.displayName ? userProfile.displayName.charAt(0).toUpperCase() : 'A')
            }
            onOpenProfileModal={() => setShowProfileModal(true)}
          />
        )}

        {/* Viewport Principal das Telas */}
        <main
          style={{
            flex: 1,
            overflowY: isFullscreenTab ? 'hidden' : 'auto',
            minWidth: 0,
            minHeight: 0,
            padding: isFullscreenTab
              ? '0'
              : activeTab === 'coding'
                ? 'clamp(12px, 1.8vw, 20px) clamp(12px, 1.8vw, 20px) calc(14px + var(--jarvis-dock-clearance, 0px))'
                : 'var(--page-padding-y) var(--page-padding-x) calc(var(--page-padding-y) + var(--jarvis-dock-clearance, 0px))',
            backgroundColor: 'var(--bg-primary)',
            backgroundImage: 'var(--app-canvas-gradient)',
          }}
        >
          {!authLoaded ? (
            <ViewFallback />
          ) : !canAccessTab(activeTab) ? (
            <section
              role="alert"
              style={{
                minHeight: '55vh',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '12px',
                textAlign: 'center',
                color: 'var(--text-secondary)',
              }}
            >
              <ShieldAlert size={30} color="var(--accent-light)" />
              <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.15rem' }}>
                Acesso não disponível
              </h2>
              <p style={{ maxWidth: '440px', margin: 0, fontSize: '0.88rem' }}>
                O seu perfil não possui a permissão necessária para abrir este módulo. Se precisar
                de acesso, contate o administrador da plataforma.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate(hasPermission('system:read') ? 'overview' : 'chat')}
              >
                Voltar
              </button>
            </section>
          ) : activeTab === 'not_found' ? (
            <NotFoundView onGoHome={() => navigate('overview')} />
          ) : installedPackIds && !isTabUnlockedByPacks(activeTab, installedPackIds, customPacks) ? (
            (() => {
              const requiredPack = findPackProvidingTab(activeTab, customPacks);
              return (
                <section className="jarvis-locked-module-card" aria-label="Módulo modular não instalado">
                  <p className="jarvis-kicker-text">
                    <span>Módulo sob demanda</span>
                    {requiredPack && (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span>{requiredPack.category_label}</span>
                      </>
                    )}
                  </p>
                  <h2 className="jarvis-locked-module-title">
                    {requiredPack
                      ? `Instale o pacote "${requiredPack.name}" para liberar este módulo`
                      : 'Este módulo faz parte de um pacote opcional'}
                  </h2>
                  <p className="jarvis-locked-module-desc">
                    {requiredPack
                      ? requiredPack.description
                      : 'Abra a Loja de Pacotes para ativar este conjunto de módulos, agentes especialistas e trilhas de estudo.'}
                  </p>
                  <div className="jarvis-locked-module-actions">
                    {requiredPack && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={installingRequiredPack}
                        onClick={async () => {
                          setInstallingRequiredPack(true);
                          try {
                            const updated = await installModulePack(requiredPack.id);
                            setInstalledPackIds(updated.installed_pack_ids);
                            if (updated.custom_packs) setCustomPacks(updated.custom_packs);
                          } finally {
                            setInstallingRequiredPack(false);
                          }
                        }}
                      >
                        {installingRequiredPack
                          ? 'Instalando pacote...'
                          : `Instalar ${requiredPack.name}`}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => navigate('store')}
                    >
                      Abrir Loja de Pacotes
                    </button>
                  </div>
                </section>
              );
            })()
          ) : (
            activeTab !== 'chat' && (
            <div
              className="jarvis-view-enter"
              key={`view-${activeTab}`}
              style={
                isFullscreenTab
                  ? { width: '100%', height: '100%', minHeight: 0 }
                  : activeTab === 'coding'
                    ? { width: '100%', maxWidth: '1380px', height: '100%', margin: '0 auto', minHeight: 0 }
                    : { width: '100%', maxWidth: '1380px', margin: '0 auto' }
              }
            >
              <ModuleErrorBoundary key={activeTab}>
                <Suspense fallback={<ViewFallback />}>
                  {activeTab === 'overview' && (
                    <Overview
                      health={health}
                      approvals={approvals}
                      healthLoading={healthLoading}
                      approvalsLoading={approvalsLoading}
                      healthError={healthError}
                      approvalsError={approvalsError}
                      onStartChat={handleStartChatFromOverview}
                      onNavigate={navigate}
                    />
                  )}
                  {activeTab === 'coding' && <CodingAgentView />}
                  {activeTab === 'workflows' && <WorkflowCanvasView />}
                  {activeTab === 'usage' && <UsageAnalyticsView />}
                  {activeTab === 'store' && (
                    <PackStoreView
                      onNavigate={navigate}
                      canManagePacks={canManagePacks}
                      onOpenAgentChat={(agentRole) => {
                        setTargetChatSessionId(`agent_${agentRole}`);
                        navigate('chat');
                      }}
                    />
                  )}
                  {activeTab === 'pack_studio' &&
                    (canManagePacks ? (
                      <PackStudioAdminView onNavigate={navigate} />
                    ) : (
                      <section className="jarvis-locked-module-card" aria-label="Acesso restrito">
                        <h2 className="jarvis-locked-module-title">
                          Acesso restrito a administradores e desenvolvedores
                        </h2>
                        <p className="jarvis-locked-module-desc">
                          O Estúdio de Pacotes permite criar e publicar novos pacotes na Loja.
                          Solicite permissão de desenvolvedor ou administrador para acessar.
                        </p>
                        <div className="jarvis-locked-module-actions">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => navigate('store')}
                          >
                            Voltar para a Loja de Pacotes
                          </button>
                        </div>
                      </section>
                    ))}
                  {activeTab === 'architecture' && (
                    <ArchitectureAgentView
                      onAskArchitect={handleStartChatFromOverview}
                      onNavigate={navigate}
                    />
                  )}
                  {activeTab === 'skills' && (
                    <SkillsManagerView
                      initialTab="skills"
                      onOpenGitHubImport={() => navigate('github_import')}
                    />
                  )}
                  {activeTab === 'approvals' && (
                    <ApprovalCenter
                      approvals={approvals}
                      onRefresh={loadData}
                      loading={approvalsLoading}
                      error={approvalsError}
                    />
                  )}
                  {activeTab === 'workspace' && (
                    <ProjectWorkspaceView
                      onSelectForChat={(id) => {
                        setAttachedProjectId(id);
                        navigate('chat');
                      }}
                    />
                  )}
                  {activeTab === 'office' && (
                    <AgentOfficeView
                      onSelectForChat={() => {
                        navigate('chat');
                      }}
                    />
                  )}
                  {activeTab === 'agents' && (
                    <AgentCenterView
                      onOpenGitHubImport={() => navigate('github_import')}
                      onOpenPackStore={() => navigate('store')}
                      onOpenArchitecture={() => navigate('architecture')}
                    />
                  )}
                  {activeTab === 'tasks' && <TaskManagerView />}
                  {activeTab === 'backend_studio' && <BackendStudioView />}
                  {activeTab === 'quality' && <QualityStudioView />}
                  {activeTab === 'design' && <DesignStudioView />}
                  {activeTab === 'executive_report' && <ExecutiveReportView />}
                  {activeTab === 'models' && <ModelManagerView />}
                  {activeTab === 'knowledge' && <KnowledgeVaultView />}
                  {activeTab === 'security' && <SecurityCenterView onRefresh={loadData} />}
                  {activeTab === 'advisor' && <HardwareAdvisorView />}
                  {activeTab === 'server_logs' && <ServerLogsView />}
                  {activeTab === 'learning' && (
                    <LearningCenterView
                      activeTab={learningContextTab}
                      onNavigate={navigate}
                      onStartTour={() => setGuidedTourOpen(true)}
                      onOpenProfile={() => setShowProfileModal(true)}
                    />
                  )}
                  {activeTab === 'settings' && (
                    <SettingsView
                      onNavigate={navigate}
                      onOpenVoiceHud={() => setShowVoiceHud(true)}
                      onRefreshSecurity={loadData}
                      onAskArchitect={handleStartChatFromOverview}
                      canManagePacks={canManagePacks}
                    />
                  )}
                  {activeTab === 'companion' && (
                    <CompanionHubView
                      onOpenVoiceHud={() => setShowVoiceHud(true)}
                      onNavigate={navigate}
                    />
                  )}
                  {activeTab === 'creative_studio' && <CreativeMediaStudioView />}
                  {activeTab === 'app_builder' && <AppBuilderView />}
                  {activeTab === 'github_import' && <GitHubImporterView onNavigate={navigate} />}
                  {activeTab === 'android_app' && <AndroidMobileHubView />}
                  {activeTab === 'brain_server' && (
                    <BrainServerHubView onNavigate={navigate} canManagePacks={canManagePacks} />
                  )}
                </Suspense>
              </ModuleErrorBoundary>
            </div>
            )
          )}
          {/* ChatMaster persistente fora do container key={activeTab} para não desmontar nem abortar streaming ao trocar de aba */}
          {chatLoaded && (
            <div
              style={{
                display: activeTab === 'chat' && authLoaded && canAccessTab(activeTab) ? 'block' : 'none',
                width: '100%',
                height: '100%',
                minHeight: 0,
              }}
            >
              <ModuleErrorBoundary key="chat-persistent-boundary">
                <Suspense fallback={<ViewFallback />}>
                  <ChatMaster
                    attachedProjectId={attachedProjectId}
                    onDetachProject={() => setAttachedProjectId(null)}
                    targetSessionId={targetChatSessionId}
                    initialPrompt={pendingChatPrompt}
                    onInitialPromptConsumed={() => setPendingChatPrompt(null)}
                  />
                </Suspense>
              </ModuleErrorBoundary>
            </div>
          )}
        </main>

        {/* Dock Flutuante Inferior Estilo macOS (Favoritos | Agentes Instalados | Controles) */}
        {showAgentDock && (
          <AgentDock
            activeAgentId={
              activeTab === 'chat' && targetChatSessionId?.startsWith('agent_')
                ? targetChatSessionId.slice(6)
                : undefined
            }
            onSelectAgent={(agentId) => {
              setTargetChatSessionId('agent_' + agentId);
              navigate('chat');
            }}
            onAddAgent={() => navigate('agents')}
            onHideDock={handleToggleAgentDock}
            activeTab={activeTab}
            onNavigate={navigate}
            favoriteItems={dockFavoriteItems}
            pendingApprovalsCount={pendingApprovalsCount}
            isLaunchpadOpen={launchpadOpen}
            onToggleLaunchpad={() => setLaunchpadOpen((prev) => !prev)}
            isSidebarHidden={isSidebarHidden}
            onToggleSidebarHidden={handleToggleSidebarHidden}
            isMinimized={effectiveDockMinimized}
            onToggleMinimized={handleToggleDockMinimized}
          />
        )}

        {/* Válvula de escape centralizada caso barra lateral e Dock estejam ocultos em tela sem cabeçalho */}
        {showEscapePill && (
          <div className="jarvis-macos-dock-layer hide-mobile" aria-label="Restaurar navegação">
            <div className="jarvis-macos-dock-mini">
              <button
                type="button"
                onClick={handleToggleSidebarHidden}
                className="jarvis-macos-dock-mini__btn"
                title="Mostrar barra lateral (Ctrl+B)"
                aria-label="Mostrar barra lateral"
              >
                <PanelLeft size={13} />
                <span>Barra</span>
              </button>
              <button
                type="button"
                onClick={handleToggleAgentDock}
                className="jarvis-macos-dock-mini__btn"
                title="Mostrar Dock macOS"
                aria-label="Mostrar Dock macOS"
              >
                <PanelBottom size={13} />
                <span>Dock</span>
              </button>
              <button
                type="button"
                onClick={() => setLaunchpadOpen(true)}
                className="jarvis-macos-dock-mini__btn"
                title="Abrir Launchpad (Ctrl+Shift+L)"
                aria-label="Abrir Launchpad"
              >
                <LaunchpadGlyph size={13} />
                <span>Launchpad</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Launchpad macOS (Grade de Módulos) */}
      {launchpadOpen && (
        <Suspense fallback={null}>
          <LaunchpadOverlay
            isOpen={launchpadOpen}
            onClose={() => setLaunchpadOpen(false)}
            activeTab={activeTab}
            onNavigate={navigate}
            modules={launchpadModules}
            favoriteIds={dockFavorites}
            onToggleFavorite={handleToggleDockFavorite}
            pendingApprovalsCount={pendingApprovalsCount}
            isSidebarHidden={isSidebarHidden}
            onToggleSidebarHidden={handleToggleSidebarHidden}
            isSimpleMode={isSimpleMode}
            onToggleSimpleMode={() => void setExperienceMode(isSimpleMode ? 'engineering' : 'simple')}
            assistantName={assistantName}
            installedAgents={installedAgents}
            onSelectAgent={(agentId) => {
              setTargetChatSessionId('agent_' + agentId);
              navigate('chat');
            }}
          />
        </Suspense>
      )}

      {/* Modais e Overlays Globais */}
      {authLoaded && authMustChangePassword && (
        <Suspense fallback={null}>
          <InitialPasswordChangeModal
            isOpen
            onCompleted={() => {
              setAuthMustChangePassword(false);
              setShowSetupWizard(true);
            }}
          />
        </Suspense>
      )}

      {guidedTourOpen && (
        <Suspense fallback={null}>
          <GuidedTour
            isOpen={guidedTourOpen}
            permissions={authPermissions}
            onNavigate={navigate}
            onClose={() => setGuidedTourOpen(false)}
          />
        </Suspense>
      )}

      {showSetupWizard &&
        authLoaded &&
        !authMustChangePassword &&
        authKind === 'human' &&
        authRole === 'admin' && (
          <Suspense fallback={null}>
            <SetupWizardModal
              isOpen
              onClose={() => setShowSetupWizard(false)}
              onCompleted={loadData}
            />
          </Suspense>
        )}

      {showProfileModal && (
        <Suspense fallback={null}>
          <UserProfileModal
            isOpen={showProfileModal}
            onClose={() => setShowProfileModal(false)}
            onNavigate={navigate}
            onOpenSetupWizard={
              authKind === 'human' && authRole === 'admin'
                ? () => {
                    setShowProfileModal(false);
                    setShowSetupWizard(true);
                  }
                : undefined
            }
            onProfileUpdated={(updated) => {
              setUserProfile(updated);
              void updateIdentityProfile(updated);
            }}
          />
        </Suspense>
      )}

      {showCommandPalette && (
        <Suspense fallback={null}>
          <CommandPalette
            isOpen={showCommandPalette}
            permissions={authPermissions}
            role={authRole || undefined}
            principalKind={authKind || undefined}
            permissionsLoaded={authLoaded}
            onClose={() => setShowCommandPalette(false)}
            onNavigate={(tab) => {
              navigate(tab);
              setShowCommandPalette(false);
            }}
            onOpenProfile={() => setShowProfileModal(true)}
          />
        </Suspense>
      )}

      {showVoiceHud && (
        <Suspense fallback={null}>
          <VoiceLiveHudModal
            isOpen={showVoiceHud}
            onClose={() => {
              setShowVoiceHud(false);
              setPendingVoiceCommand(null);
            }}
            autoListenOnOpen
            initialCommand={pendingVoiceCommand}
            onInitialCommandConsumed={() => setPendingVoiceCommand(null)}
            wakeWordEnabled={wakeWord.enabled}
            onToggleWakeWord={wakeWord.toggle}
            onOpenChat={(prompt) => {
              setShowVoiceHud(false);
              setPendingVoiceCommand(null);
              if (prompt) setPendingChatPrompt(prompt);
              navigate('chat');
            }}
            onNavigate={(tab) => navigate(tab)}
          />
        </Suspense>
      )}

      {/* Navegação Inferior Mobile PWA (visível apenas abaixo de 768px) */}
      <nav className="jarvis-mobile-bottom-nav" aria-label="Navegação mobile rápida">
        <button
          type="button"
          onClick={() => navigate('overview')}
          className={`jarvis-mobile-bottom-nav__btn ${activeTab === 'overview' ? 'is-active' : ''}`}
        >
          <LayoutDashboard size={17} />
          <span>Início</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('chat')}
          className={`jarvis-mobile-bottom-nav__btn ${activeTab === 'chat' ? 'is-active' : ''}`}
        >
          <MessageSquare size={17} />
          <span>Chat</span>
        </button>
        <button
          type="button"
          onClick={() => setShowVoiceHud(true)}
          className="jarvis-mobile-bottom-nav__btn jarvis-mobile-bottom-nav__voice"
          aria-label={`Falar com ${assistantName}`}
        >
          <Mic size={18} />
          <span>Voz</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('companion')}
          className={`jarvis-mobile-bottom-nav__btn ${activeTab === 'companion' ? 'is-active' : ''}`}
        >
          <Smartphone size={17} />
          <span>PC/PWA</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('security')}
          className={`jarvis-mobile-bottom-nav__btn ${activeTab === 'security' ? 'is-active' : ''}`}
        >
          <ShieldCheck size={17} />
          <span>Sentinela</span>
        </button>
      </nav>

      <OfflineIndicator />
      <ApprovalPromptHost />
      <ToastContainer />
    </div>
  );
};

export const App: React.FC = () => (
  <AuthGate>
    <AssistantIdentityProvider>
      <DashboardApp />
    </AssistantIdentityProvider>
  </AuthGate>
);

export default App;
