import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  getNextQuickTheme,
  loadThemePreferences,
  saveAndApplyThemePreferences,
  THEME_CHANGED_EVENT,
  type ThemeMode,
} from '../services/themeEngine';
import {
  DOCK_FAVORITES_UPDATED_EVENT,
  DOCK_MINIMIZED_UPDATED_EVENT,
  loadDockFavorites,
  loadDockMinimized,
  loadSidebarHidden,
  saveDockFavorites,
  saveDockMinimized,
  saveSidebarHidden,
  shouldAutoMinimizeDockForTab,
  SIDEBAR_HIDDEN_UPDATED_EVENT,
  toggleDockFavorite,
} from '../services/navigationShell';
import { getAccountStorageKey } from '../services/accountScope';
import { notify } from '../shared/common/Toast';

interface UseShellPreferencesOptions {
  activeTab: string;
  setMobileNavOpen: Dispatch<SetStateAction<boolean>>;
}

function readAccountBoolPref(key: string, fallback: boolean): boolean {
  try {
    const val = localStorage.getItem(getAccountStorageKey(key));
    return val !== null ? val !== 'false' : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Gerencia preferências visuais do shell (tema, barra lateral, dock e favoritos)
 * sincronizadas entre abas e eventos globais da aplicação.
 */
export function useShellPreferences({ activeTab, setMobileNavOpen }: UseShellPreferencesOptions) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemePreferences().themeMode);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('jarvis_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [isSidebarHidden, setIsSidebarHidden] = useState<boolean>(() => loadSidebarHidden());
  const sidebarHiddenRef = useRef(isSidebarHidden);
  const [isDockMinimized, setIsDockMinimized] = useState<boolean>(() => loadDockMinimized());
  const [dockFavorites, setDockFavorites] = useState<string[]>(() => loadDockFavorites());
  const [dockTabOverride, setDockTabOverride] = useState<{ tab: string; minimized: boolean } | null>(null);
  const [showDynamicIsland, setShowDynamicIsland] = useState<boolean>(() =>
    readAccountBoolPref('jarvis_pref_dynamic_island', true)
  );
  const [showAgentDock, setShowAgentDock] = useState<boolean>(() =>
    readAccountBoolPref('jarvis_pref_agent_dock', true)
  );

  useEffect(() => {
    sidebarHiddenRef.current = isSidebarHidden;
  }, [isSidebarHidden]);

  useEffect(() => {
    const syncTheme = () => setThemeMode(loadThemePreferences().themeMode);
    window.addEventListener(THEME_CHANGED_EVENT, syncTheme);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, syncTheme);
  }, []);

  useEffect(() => {
    const syncPreferences = () => {
      try {
        setShowDynamicIsland(readAccountBoolPref('jarvis_pref_dynamic_island', true));
        setShowAgentDock(readAccountBoolPref('jarvis_pref_agent_dock', true));
        setIsSidebarHidden(loadSidebarHidden());
        setIsDockMinimized(loadDockMinimized());
        setDockFavorites(loadDockFavorites());
      } catch {
        // Ignora erro de storage indisponível
      }
    };

    const syncFavorites = () => setDockFavorites(loadDockFavorites());
    const syncSidebarHidden = () => setIsSidebarHidden(loadSidebarHidden());
    const syncDockMinimized = () => setIsDockMinimized(loadDockMinimized());

    window.addEventListener('jarvis_ui_preferences_changed', syncPreferences);
    window.addEventListener('storage', syncPreferences);
    window.addEventListener(DOCK_FAVORITES_UPDATED_EVENT, syncFavorites);
    window.addEventListener(SIDEBAR_HIDDEN_UPDATED_EVENT, syncSidebarHidden);
    window.addEventListener(DOCK_MINIMIZED_UPDATED_EVENT, syncDockMinimized);
    return () => {
      window.removeEventListener('jarvis_ui_preferences_changed', syncPreferences);
      window.removeEventListener('storage', syncPreferences);
      window.removeEventListener(DOCK_FAVORITES_UPDATED_EVENT, syncFavorites);
      window.removeEventListener(SIDEBAR_HIDDEN_UPDATED_EVENT, syncSidebarHidden);
      window.removeEventListener(DOCK_MINIMIZED_UPDATED_EVENT, syncDockMinimized);
    };
  }, []);

  const handleCycleTheme = () => {
    const next = getNextQuickTheme(themeMode);
    saveAndApplyThemePreferences({ themeMode: next });
    setThemeMode(next);
  };

  const themeQuickLabel =
    themeMode === 'friendly_light'
      ? 'Tema: Claro Amigável (clique para Escuro)'
      : themeMode === 'auto'
        ? 'Tema: Automático do Sistema (clique para Claro)'
        : 'Tema: Escuro Studio (clique para Automático)';

  const handleToggleSidebar = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      setMobileNavOpen((prev) => !prev);
      return;
    }
    if (sidebarHiddenRef.current) {
      saveSidebarHidden(false);
      setIsSidebarHidden(false);
      return;
    }
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('jarvis_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  const handleToggleSidebarHidden = () => {
    const next = !sidebarHiddenRef.current;
    saveSidebarHidden(next);
    setIsSidebarHidden(next);
  };

  const handleToggleAgentDock = () => {
    setShowAgentDock((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(getAccountStorageKey('jarvis_pref_agent_dock'), String(next));
        window.dispatchEvent(new Event('jarvis_ui_preferences_changed'));
      } catch {}
      return next;
    });
  };

  const effectiveDockMinimized =
    dockTabOverride && dockTabOverride.tab === activeTab
      ? dockTabOverride.minimized
      : isDockMinimized || shouldAutoMinimizeDockForTab(activeTab);

  const handleToggleDockMinimized = () => {
    const next = !effectiveDockMinimized;
    setDockTabOverride({ tab: activeTab, minimized: next });
    if (!shouldAutoMinimizeDockForTab(activeTab)) {
      setIsDockMinimized(next);
      saveDockMinimized(next);
    }
  };

  const handleToggleDockFavorite = (tabId: string) => {
    setDockFavorites((prev) => {
      const res = toggleDockFavorite(tabId, prev);
      if (res.limitReached) {
        notify('Limite de 6 favoritos no Dock atingido. Remova um ícone fixado antes de adicionar outro.', 'info');
        return prev;
      }
      const saved = saveDockFavorites(res.favorites);
      if (res.added) notify('Módulo fixado nos Favoritos do Dock.', 'success');
      else if (res.removed) notify('Módulo removido dos Favoritos do Dock.', 'info');
      return saved;
    });
  };

  return {
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
  };
}
