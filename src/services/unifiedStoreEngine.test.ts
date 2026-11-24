import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  classifySkillBucket,
  computeUnifiedStoreSummary,
  countPacksByFilter,
  countStoreSkillsByCategory,
  filterStoreSkills,
  isCustomSkill,
  isSkillActive,
  sanitizeUnifiedStoreSection,
} from './unifiedStoreEngine';
import {
  DEFAULT_CONNECTED_APP_IDS,
  STORE_APPS,
  STORE_APPS_UPDATED_EVENT,
  countStoreAppsByCategory,
  createCustomStoreApp,
  filterStoreApps,
  loadConnectedAppIds,
  loadCustomStoreApps,
  saveConnectedAppIds,
  saveCustomStoreApps,
} from './storeAppsCatalog';
import { PackStoreView } from '../features/store/PackStoreView';
import { StoreAppIcon } from '../features/store/StoreAppIcon';
import { SkillsCatalogPanel } from '../features/skills/SkillsCatalogPanel';
import { SkillCard } from '../features/skills/SkillCard';
import { SkillsManagerView } from '../features/skills/SkillsManagerView';
import { AgentTemplateStoreGrid } from '../features/agents/AgentTemplateStoreGrid';
import type { SkillInfo } from '../types';
import type { ModulePackWithState } from './modulePackEngine';

const makeSkill = (overrides: Partial<SkillInfo>): SkillInfo => ({
  id: 'skill_default',
  name: 'Habilidade',
  version: '1.0.0',
  origin: 'builtin',
  license: 'MIT',
  description: 'Descrição padrão',
  domain: 'architecture',
  allowed_tools: [],
  required_permissions: [],
  assigned_agents: ['jarvis_master'],
  content_hash: 'abc123',
  is_approved: true,
  is_revoked: false,
  instructions: 'Instruções',
  ...overrides,
});

const SAMPLE_SKILLS: SkillInfo[] = [
  makeSkill({
    id: 'clean_architecture',
    name: 'Arquitetura Limpa',
    description: 'Padrões modulares e separação de camadas.',
    domain: 'Arquitetura',
    is_approved: true,
    is_revoked: false,
    assigned_agents: ['software_architect'],
  }),
  makeSkill({
    id: 'owasp_sec_audit',
    name: 'Auditoria OWASP',
    description: 'Detecção de vulnerabilidades web e API.',
    domain: 'Segurança',
    is_approved: false,
    is_revoked: false,
    assigned_agents: ['sentinel_security'],
  }),
  makeSkill({
    id: 'qa_e2e_checks',
    name: 'Qualidade & Testes E2E',
    description: 'Validação automatizada de fluxos críticos.',
    domain: 'Qualidade',
    is_approved: true,
    is_revoked: false,
    assigned_agents: ['qa_engineer'],
  }),
  makeSkill({
    id: 'user_finance_playbook',
    name: 'Playbook Financeiro',
    description: 'Fluxo criado pelo usuário.',
    domain: 'Negócios',
    origin: 'user_created',
    is_approved: true,
    is_revoked: false,
    assigned_agents: ['jarvis_master'],
  }),
];

const SAMPLE_PACKS: ModulePackWithState[] = [
  {
    id: 'pack_dev',
    name: 'Pacote Engenharia',
    tagline: 'Código e arquitetura',
    description: 'Ferramentas dev',
    category: 'development',
    category_label: 'Desenvolvimento',
    version: '1.0.0',
    tabs: ['coding'],
    tab_labels: { coding: 'IDE & Código' },
    agents: [],
    skills: ['clean_architecture'],
    mcp_presets: [],
    workflows: [],
    study_tracks: [],
    installed: true,
    installed_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'pack_sec',
    name: 'Pacote Segurança',
    tagline: 'Auditoria',
    description: 'Sentinela',
    category: 'security',
    category_label: 'Segurança',
    version: '1.0.0',
    tabs: ['security'],
    tab_labels: { security: 'Segurança' },
    agents: [],
    skills: ['owasp_sec_audit'],
    mcp_presets: [],
    workflows: [],
    study_tracks: [],
    installed: false,
    installed_at: null,
  },
];

test('isSkillActive requires is_approved and not is_revoked', () => {
  assert.equal(isSkillActive(SAMPLE_SKILLS[0]), true);
  assert.equal(isSkillActive(SAMPLE_SKILLS[1]), false);
  assert.equal(isSkillActive(makeSkill({ is_approved: true, is_revoked: true })), false);
});

test('computeUnifiedStoreSummary aggregates counts across all store sections', () => {
  const summary = computeUnifiedStoreSummary({
    packs: SAMPLE_PACKS,
    skills: SAMPLE_SKILLS,
    templatesCount: 8,
    connectedAppsCount: 4,
    totalAppsCount: 15,
  });

  assert.equal(summary.totalPacks, 2);
  assert.equal(summary.installedPacks, 1);
  assert.equal(summary.totalSkills, 4);
  assert.equal(summary.activeSkills, 3);
  assert.equal(summary.totalTemplates, 8);
  assert.equal(summary.connectedApps, 4);
  assert.equal(summary.totalCatalogItems, 2 + 4 + 8 + 15);
});

test('classifySkillBucket categorizes custom, security, qa, and architecture skills', () => {
  assert.equal(classifySkillBucket(SAMPLE_SKILLS[0]), 'arch');
  assert.equal(classifySkillBucket(SAMPLE_SKILLS[1]), 'sec');
  assert.equal(classifySkillBucket(SAMPLE_SKILLS[2]), 'qa');
  assert.equal(classifySkillBucket(SAMPLE_SKILLS[3]), 'custom');

  // Origins emitted by backend routes (skillsRouter, integrationsRouter, brain import)
  assert.equal(isCustomSkill(makeSkill({ id: 'skill_1', origin: 'user' })), true);
  assert.equal(isCustomSkill(makeSkill({ id: 'skill_2', origin: 'custom' })), true);
  assert.equal(isCustomSkill(makeSkill({ id: 'gh_repo_1', origin: 'github:owner/repo' })), true);
  assert.equal(isCustomSkill(makeSkill({ id: 'ecc_1', origin: 'imported_ecc' })), true);
  assert.equal(isCustomSkill(makeSkill({ id: 'skill_builtin', origin: 'builtin' })), false);
  assert.equal(classifySkillBucket(makeSkill({ id: 'skill_1', origin: 'user', domain: 'finance' })), 'custom');
});

test('filterStoreSkills filters accurately by status, category, and search query', () => {
  const onlyActive = filterStoreSkills(SAMPLE_SKILLS, {
    search: '',
    category: 'all',
    status: 'active',
  });
  assert.equal(onlyActive.length, 3);

  const onlySec = filterStoreSkills(SAMPLE_SKILLS, {
    search: '',
    category: 'sec',
    status: 'all',
  });
  assert.deepEqual(onlySec.map((s) => s.id), ['owasp_sec_audit']);

  const searchMatch = filterStoreSkills(SAMPLE_SKILLS, {
    search: 'playbook',
    category: 'custom',
    status: 'active',
  });
  assert.deepEqual(searchMatch.map((s) => s.id), ['user_finance_playbook']);
});

test('sanitizeUnifiedStoreSection defaults invalid values to packs', () => {
  assert.equal(sanitizeUnifiedStoreSection('skills'), 'skills');
  assert.equal(sanitizeUnifiedStoreSection('apps'), 'apps');
  assert.equal(sanitizeUnifiedStoreSection('unknown'), 'packs');
  assert.equal(sanitizeUnifiedStoreSection(null), 'packs');
});

test('countStoreSkillsByCategory and countPacksByFilter compute exact counts', () => {
  const skillCounts = countStoreSkillsByCategory(SAMPLE_SKILLS);
  assert.deepEqual(skillCounts, {
    all: 4,
    arch: 1,
    sec: 1,
    qa: 1,
    custom: 1,
  });

  const packCounts = countPacksByFilter(SAMPLE_PACKS);
  assert.equal(packCounts.all, 2);
  assert.equal(packCounts.installed, 1);
  assert.equal(packCounts.custom, 0);
  assert.equal(packCounts.development, 1);
  assert.equal(packCounts.security, 1);
});

test('storeAppsCatalog filters apps, counts categories, creates custom connectors, and safely falls back in SSR', () => {
  const counts = countStoreAppsByCategory(STORE_APPS);
  assert.equal(counts.all, 15);
  assert.equal(counts.productivity, 6);
  assert.equal(counts.documents, 4);
  assert.equal(counts.development, 3);
  assert.equal(counts.ai, 2);

  const filteredMcp = filterStoreApps(STORE_APPS, { query: 'mcp', category: 'all' });
  assert.deepEqual(filteredMcp.map((a) => a.id), ['context7', 'huggingface']);

  const filteredDocs = filterStoreApps(STORE_APPS, { query: 'documentação', category: 'all' });
  assert.deepEqual(filteredDocs.map((a) => a.id), ['context7']);

  const filteredDev = filterStoreApps(STORE_APPS, { query: '', category: 'development' });
  assert.deepEqual(filteredDev.map((a) => a.id), ['github', 'vercel', 'canva']);

  const customApp = createCustomStoreApp({
    name: 'Notion MCP',
    connectionType: 'mcp',
    endpoint: 'npx -y @notionhq/mcp',
  });
  assert.equal(customApp.isCustom, true);
  assert.equal(customApp.category, 'ai');
  assert.equal(customApp.iconType, 'mcp');
  assert.ok(customApp.id.startsWith('custom_notion_mcp_'));

  const defaults = loadConnectedAppIds();
  assert.equal(defaults.length, 7);

  // Verify deduplication and event broadcast when window + localStorage exist
  const events: Array<{ type: string; detail: unknown }> = [];
  const storageMap = new Map<string, string>();
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
    // Unique IDs even when called in the same millisecond
    const firstRapid = createCustomStoreApp({ name: 'Notion', connectionType: 'mcp', endpoint: 'npx a' });
    const secondRapid = createCustomStoreApp({ name: 'Notion', connectionType: 'mcp', endpoint: 'npx b' });
    assert.notEqual(firstRapid.id, secondRapid.id);

    const savedIds = saveConnectedAppIds(['github', 'github', 'vercel', '', null as any]);
    assert.deepEqual(savedIds, ['github', 'vercel']);
    assert.deepEqual(loadConnectedAppIds(), ['github', 'vercel']);

    // Empty array persists (does not reset to defaults)
    assert.deepEqual(saveConnectedAppIds([]), []);
    assert.deepEqual(loadConnectedAppIds(), []);

    const savedCustom = saveCustomStoreApps([customApp]);
    assert.equal(savedCustom.length, 1);
    assert.equal(loadCustomStoreApps().length, 1);
    assert.equal(events.length, 3);
    assert.equal(events[0].type, STORE_APPS_UPDATED_EVENT);

    // Malformed JSON and corrupted entries recover cleanly without throwing
    storageMap.set('jarvis_connected_apps:anonymous', '{not-json');
    assert.deepEqual(loadConnectedAppIds(), [...DEFAULT_CONNECTED_APP_IDS]);

    storageMap.set('jarvis_connected_apps:anonymous', JSON.stringify([null, '', 'slack', 'slack']));
    assert.deepEqual(loadConnectedAppIds(), ['slack']);

    storageMap.set(
      'jarvis_custom_store_apps:anonymous',
      JSON.stringify([
        null,
        { id: '', name: 'Empty ID' },
        { id: 'corrupt_1', name: 'Partial App' },
      ])
    );
    const recoveredCustom = loadCustomStoreApps();
    assert.equal(recoveredCustom.length, 1);
    assert.equal(recoveredCustom[0].category, 'development');
    assert.deepEqual(filterStoreApps(recoveredCustom, { query: 'nonexistent' }), []);
    assert.equal(countStoreAppsByCategory(recoveredCustom).all, 1);
    assert.equal(countStoreAppsByCategory(recoveredCustom).development, 1);

    storageMap.set('jarvis_custom_store_apps:anonymous', 'not-json');
    assert.deepEqual(loadCustomStoreApps(), []);
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

test('Unified Store UI components render cleanly via SSR across all sections without nested main landmarks', () => {
  for (const section of ['packs', 'apps', 'templates', 'skills'] as const) {
    const html = renderToStaticMarkup(
      React.createElement(PackStoreView, {
        onNavigate: () => {},
        canManagePacks: true,
        initialSection: section,
      })
    );
    assert.ok(html.includes('jarvis-store-layout'), `section ${section} must render split-pane layout`);
    assert.ok(html.includes('aria-current="page"'), `section ${section} must mark active nav item`);
    assert.ok(!html.includes('<main'), `section ${section} must not render nested <main>`);
  }

  const skillsHtml = renderToStaticMarkup(React.createElement(SkillsCatalogPanel, { variant: 'store' }));
  assert.ok(skillsHtml.includes('jarvis-store-segmented'));

  const cardHtml = renderToStaticMarkup(
    React.createElement(SkillCard, {
      skill: makeSkill({ id: 'skill_custom', name: 'Minha Skill', origin: 'user' }),
      onToggle: () => {},
      onEditAgents: () => {},
      onDelete: () => {},
      canManageSkills: true,
      isAdmin: false,
    })
  );
  assert.ok(cardHtml.includes('Custom'), 'origin=user skill should show Custom label');
  assert.ok(cardHtml.includes('Excluir habilidade Minha Skill'), 'developer should be able to delete own origin=user skill');

  const templatesHtml = renderToStaticMarkup(
    React.createElement(AgentTemplateStoreGrid, {
      installedAgents: [],
      onRefreshAgents: () => {},
      variant: 'store',
    })
  );
  assert.ok(templatesHtml.includes('jarvis-store-grid'));

  const managerHtml = renderToStaticMarkup(React.createElement(SkillsManagerView, {}));
  assert.ok(!managerHtml.includes('<main'), 'SkillsManagerView must not render nested <main>');

  for (const iconType of ['telegram', 'whatsapp', 'slack', 'discord', 'github', 'vercel', 'canva', 'context7', 'huggingface', 'mcp', 'webhook', 'custom_tool', 'unknown']) {
    const iconHtml = renderToStaticMarkup(React.createElement(StoreAppIcon, { iconType }));
    assert.ok(iconHtml.length > 0);
  }
});
