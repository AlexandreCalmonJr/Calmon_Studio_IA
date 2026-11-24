import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEFAULT_DOCK_FAVORITES,
  DOCK_FAVORITES_UPDATED_EVENT,
  DOCK_MINIMIZED_UPDATED_EVENT,
  MAX_DOCK_FAVORITES,
  NAV_MODULES_CATALOG,
  SIDEBAR_HIDDEN_UPDATED_EVENT,
  computeDockClearancePx,
  filterLaunchpadModules,
  loadDockFavorites,
  loadDockMinimized,
  loadSidebarHidden,
  resolveDockFavoriteItems,
  resolveVisibleNavModules,
  sanitizeDockFavorites,
  saveDockFavorites,
  saveDockMinimized,
  saveSidebarHidden,
  toggleDockFavorite,
} from './navigationShell';
import { PrimaryRail } from '../shared/navigation/PrimaryRail';
import { AgentDock } from '../shared/navigation/AgentDock';
import { LaunchpadOverlay } from '../shared/navigation/LaunchpadOverlay';

test('sanitizeDockFavorites deduplicates, drops invalid ids, and caps at MAX_DOCK_FAVORITES', () => {
  assert.deepEqual(sanitizeDockFavorites(null), [...DEFAULT_DOCK_FAVORITES]);
  assert.deepEqual(sanitizeDockFavorites('chat'), [...DEFAULT_DOCK_FAVORITES]);
  assert.deepEqual(sanitizeDockFavorites([]), []);

  const cleaned = sanitizeDockFavorites([
    'chat',
    'chat',
    'invalid_module_xyz',
    '',
    42,
    'overview',
    'tasks',
    'workflows',
    'store',
    'agents',
    'settings',
  ]);
  assert.equal(cleaned.length, MAX_DOCK_FAVORITES);
  assert.deepEqual(cleaned, ['chat', 'overview', 'tasks', 'workflows', 'store', 'agents']);
});

test('toggleDockFavorite adds, removes, ignores unknown tabs, and enforces limit', () => {
  const unknown = toggleDockFavorite('nonexistent_tab', ['overview']);
  assert.equal(unknown.added, false);
  assert.equal(unknown.removed, false);
  assert.deepEqual(unknown.favorites, ['overview']);

  const added = toggleDockFavorite('agents', ['overview', 'chat']);
  assert.equal(added.added, true);
  assert.equal(added.removed, false);
  assert.equal(added.limitReached, false);
  assert.deepEqual(added.favorites, ['overview', 'chat', 'agents']);

  const removed = toggleDockFavorite('chat', added.favorites);
  assert.equal(removed.added, false);
  assert.equal(removed.removed, true);
  assert.deepEqual(removed.favorites, ['overview', 'agents']);

  const fullList = ['overview', 'chat', 'tasks', 'workflows', 'store', 'agents'];
  const atLimit = toggleDockFavorite('settings', fullList);
  assert.equal(atLimit.added, false);
  assert.equal(atLimit.limitReached, true);
  assert.deepEqual(atLimit.favorites, fullList);
});

test('navigationShell storage helpers safely fall back in SSR and persist + dispatch events in browser', () => {
  assert.deepEqual(loadDockFavorites(), [...DEFAULT_DOCK_FAVORITES]);
  assert.equal(loadSidebarHidden(), false);
  assert.equal(loadDockMinimized(), false);

  const storageMap = new Map<string, string>();
  const events: Array<{ type: string; detail: unknown }> = [];
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const prevStorageDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storageMap.set(key, String(value));
      },
      removeItem: (key: string) => {
        storageMap.delete(key);
      },
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      dispatchEvent: (ev: Event) => {
        events.push({ type: ev.type, detail: (ev as CustomEvent).detail });
        return true;
      },
    },
  });

  try {
    const saved = saveDockFavorites(['chat', 'chat', 'coding', 'bogus']);
    assert.deepEqual(saved, ['chat', 'coding']);
    assert.deepEqual(loadDockFavorites(), ['chat', 'coding']);

    // Empty favorites list persists instead of reverting to defaults
    assert.deepEqual(saveDockFavorites([]), []);
    assert.deepEqual(loadDockFavorites(), []);

    // Corrupted JSON recovers cleanly
    storageMap.set('jarvis_dock_favorites_v1:anonymous', '{corrupted');
    assert.deepEqual(loadDockFavorites(), [...DEFAULT_DOCK_FAVORITES]);

    assert.equal(saveSidebarHidden(true), true);
    assert.equal(loadSidebarHidden(), true);
    assert.equal(saveSidebarHidden(false), false);
    assert.equal(loadSidebarHidden(), false);

    assert.equal(saveDockMinimized(true), true);
    assert.equal(loadDockMinimized(), true);

    assert.equal(events.some((e) => e.type === DOCK_FAVORITES_UPDATED_EVENT), true);
    assert.equal(events.some((e) => e.type === SIDEBAR_HIDDEN_UPDATED_EVENT), true);
    assert.equal(events.some((e) => e.type === DOCK_MINIMIZED_UPDATED_EVENT), true);
  } finally {
    if (prevWindowDesc) {
      Object.defineProperty(globalThis, 'window', prevWindowDesc);
    } else {
      delete (globalThis as any).window;
    }
    if (prevStorageDesc) {
      Object.defineProperty(globalThis, 'localStorage', prevStorageDesc);
    } else {
      delete (globalThis as any).localStorage;
    }
  }
});

test('resolveVisibleNavModules & resolveDockFavoriteItems respect simple mode, permissions, and installed packs', () => {
  const simple = resolveVisibleNavModules({
    isSimpleMode: true,
    canManagePacks: false,
    includeLaunchpadOnly: true,
  });
  assert.ok(simple.some((m) => m.id === 'chat'));
  assert.ok(simple.some((m) => m.id === 'store'));
  assert.ok(!simple.some((m) => m.id === 'coding'));
  assert.ok(!simple.some((m) => m.id === 'pack_studio'));

  const restricted = resolveVisibleNavModules({
    isSimpleMode: false,
    canManagePacks: false,
    installedPackIds: ['creative_productivity'],
    canAccessTab: (tab) => tab !== 'server_logs' && tab !== 'advisor',
    includeLaunchpadOnly: true,
  });
  assert.ok(restricted.some((m) => m.id === 'overview'));
  assert.ok(restricted.some((m) => m.id === 'skills'));
  assert.ok(!restricted.some((m) => m.id === 'coding'));
  assert.ok(!restricted.some((m) => m.id === 'server_logs'));
  assert.ok(!restricted.some((m) => m.id === 'advisor'));

  const favsSimple = resolveDockFavoriteItems(['overview', 'coding', 'chat', 'store'], {
    isSimpleMode: true,
  });
  assert.deepEqual(
    favsSimple.map((f) => f.id),
    ['overview', 'chat', 'store']
  );
});

test('filterLaunchpadModules matches by label, description, section, and id', () => {
  const matches = filterLaunchpadModules(NAV_MODULES_CATALOG, 'owasp');
  assert.ok(matches.some((m) => m.id === 'security'));

  const all = filterLaunchpadModules(NAV_MODULES_CATALOG, '   ');
  assert.equal(all.length, NAV_MODULES_CATALOG.length);
});

test('computeDockClearancePx adjusts clearance for visible, minimized, hidden, escape pill, and mobile states', () => {
  assert.equal(computeDockClearancePx({ showDock: true, isMinimized: false }), '90px');
  assert.equal(computeDockClearancePx({ showDock: true, isMinimized: true }), '40px');
  assert.equal(computeDockClearancePx({ showDock: false, isMinimized: false }), '0px');
  assert.equal(computeDockClearancePx({ showDock: false, isMinimized: false, showEscapePill: true }), '44px');
  assert.equal(computeDockClearancePx({ showDock: true, isMinimized: false, isMobile: true }), '0px');
  assert.equal(computeDockClearancePx({ showDock: false, isMinimized: false, showEscapePill: true, isMobile: true }), '0px');
});

test('PrimaryRail, AgentDock, and LaunchpadOverlay render cleanly via SSR across states without nested main landmarks', () => {
  const railHtml = renderToStaticMarkup(
    React.createElement(PrimaryRail, {
      activeTab: 'chat',
      onNavigate: () => {},
      collapsed: false,
      hidden: false,
      onToggleCollapse: () => {},
      onToggleHidden: () => {},
      pendingApprovalsCount: 2,
      canAccessTab: (tab) => tab !== 'tasks',
    })
  );
  assert.ok(railHtml.includes('jarvis-sidebar'));
  assert.ok(railHtml.includes('Ocultar barra lateral'));
  assert.ok(!railHtml.includes('>Tarefas<'));
  assert.ok(!railHtml.includes('<main'));

  const hiddenRailHtml = renderToStaticMarkup(
    React.createElement(PrimaryRail, {
      activeTab: 'overview',
      onNavigate: () => {},
      hidden: true,
    })
  );
  assert.ok(hiddenRailHtml.includes('is-hidden'));
  assert.ok(hiddenRailHtml.includes('inert=""') || hiddenRailHtml.includes('inert'));

  const favItems = resolveDockFavoriteItems(DEFAULT_DOCK_FAVORITES);
  const dockHtml = renderToStaticMarkup(
    React.createElement(AgentDock, {
      activeTab: 'chat',
      onNavigate: () => {},
      onSelectAgent: () => {},
      onAddAgent: () => {},
      onHideDock: () => {},
      favoriteItems: favItems,
      isLaunchpadOpen: false,
      onToggleLaunchpad: () => {},
      isSidebarHidden: false,
      onToggleSidebarHidden: () => {},
      isMinimized: false,
      onToggleMinimized: () => {},
    })
  );
  assert.ok(dockHtml.includes('jarvis-macos-dock'));
  assert.ok(dockHtml.includes('jarvis-macos-dock-divider'));
  assert.ok(dockHtml.includes('Abrir Launchpad de Módulos'));
  assert.ok(dockHtml.includes('jarvis-macos-dock-dot is-visible'));
  assert.ok(!dockHtml.includes('<main'));

  const miniDockHtml = renderToStaticMarkup(
    React.createElement(AgentDock, {
      onSelectAgent: () => {},
      onToggleLaunchpad: () => {},
      isMinimized: true,
      onToggleMinimized: () => {},
    })
  );
  assert.ok(miniDockHtml.includes('jarvis-macos-dock-mini'));
  assert.ok(miniDockHtml.includes('Mostrar Dock'));

  const closedLaunchpadHtml = renderToStaticMarkup(
    React.createElement(LaunchpadOverlay, {
      isOpen: false,
      onClose: () => {},
      activeTab: 'overview',
      onNavigate: () => {},
      modules: resolveVisibleNavModules({ includeLaunchpadOnly: true }),
      favoriteIds: [...DEFAULT_DOCK_FAVORITES],
      onToggleFavorite: () => {},
    })
  );
  assert.equal(closedLaunchpadHtml, '');

  const openLaunchpadHtml = renderToStaticMarkup(
    React.createElement(LaunchpadOverlay, {
      isOpen: true,
      onClose: () => {},
      activeTab: 'chat',
      onNavigate: () => {},
      modules: resolveVisibleNavModules({ includeLaunchpadOnly: true }),
      favoriteIds: [...DEFAULT_DOCK_FAVORITES],
      onToggleFavorite: () => {},
      isSidebarHidden: true,
      onToggleSidebarHidden: () => {},
      isSimpleMode: false,
      onToggleSimpleMode: () => {},
      pendingApprovalsCount: 3,
    })
  );
  assert.ok(openLaunchpadHtml.includes('jarvis-launchpad-overlay'));
  assert.ok(openLaunchpadHtml.includes('Mostrar Sidebar'));
  assert.ok(openLaunchpadHtml.includes('Remover Chat e Conversas dos favoritos do Dock'));
  assert.ok(!openLaunchpadHtml.includes('<main'));
});
