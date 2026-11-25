import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORE_ALWAYS_VISIBLE_TABS,
  MODULE_PACK_CATALOG,
  findPackProvidingTab,
  getModulePackById,
  getUnlockedTabsForPacks,
  isTabUnlockedByPacks,
  summarizeInstalledPacks,
} from './modulePackEngine';

test('MODULE_PACK_CATALOG has 5 distinct packs with no overlapping tabs', () => {
  assert.equal(MODULE_PACK_CATALOG.length, 5);
  const seenTabs = new Set<string>();
  for (const pack of MODULE_PACK_CATALOG) {
    assert.ok(pack.agents.length >= 1, `Pack ${pack.id} must bundle at least one agent`);
    assert.ok(pack.study_tracks.length >= 1, `Pack ${pack.id} must include study tracks`);
    for (const tab of pack.tabs) {
      assert.equal(seenTabs.has(tab), false, `Tab ${tab} should belong to a single pack`);
      seenTabs.add(tab);
    }
  }
});

test('engineering_architecture pack bundles Vetor (architect) and unlocks engineering tabs', () => {
  const engPack = getModulePackById('engineering_architecture');
  assert.ok(engPack);
  assert.ok(engPack.agents.some((a) => a.role === 'architect' && a.proper_name === 'Vetor'));
  assert.equal(isTabUnlockedByPacks('backend_studio', []), false);
  assert.equal(isTabUnlockedByPacks('backend_studio', ['engineering_architecture']), true);
  assert.equal(findPackProvidingTab('coding')?.id, 'fullstack_dev');
});

test('core tabs are always unlocked even with zero packs installed', () => {
  const unlocked = getUnlockedTabsForPacks([]);
  for (const coreTab of CORE_ALWAYS_VISIBLE_TABS) {
    assert.equal(unlocked.includes(coreTab), true);
    assert.equal(isTabUnlockedByPacks(coreTab, []), true);
  }
});

test('summarizeInstalledPacks aggregates modules, agents, and study tracks accurately', () => {
  const summary = summarizeInstalledPacks(['engineering_architecture', 'fullstack_dev']);
  assert.equal(summary.totalPacks, 5);
  assert.equal(summary.installedCount, 2);
  assert.equal(summary.unlockedModulesCount, 8);
  assert.equal(summary.bundledAgentsCount, 4);
  assert.equal(summary.studyTracksCount, 4);
});

test('sanitizeCustomPackInput builds valid custom pack and merges into catalog', async () => {
  const mod = await import('./modulePackEngine');
  const custom = mod.sanitizeCustomPackInput(
    {
      name: 'Pacote Dados & Analytics',
      category: 'engineering',
      tabs: ['design', 'executive_report', 'invalid_tab_xyz'],
      agents: [
        {
          proper_name: 'Clara Dados',
          name: 'Engenheira de Dados',
          handle: 'dados',
          mission: 'Criar pipelines analíticos e métricas confiáveis.',
        },
      ],
      skills: ['SQL Analítico', 'Modelagem Dimensional'],
      study_tracks: [
        {
          title: 'Trilha de Engenharia de Dados',
          summary: 'Fundamentos de ETL, SQLite e Postgres.',
        },
      ],
    },
    'admin'
  );

  assert.equal(custom.id, 'pacote_dados_analytics');
  assert.equal(custom.is_custom, true);
  assert.deepEqual(custom.tabs, ['design', 'executive_report']);
  assert.equal(custom.agents[0].handle, '@dados');
  assert.equal(custom.study_tracks.length, 1);

  const merged = mod.mergeCatalogWithCustomPacks([custom]);
  assert.equal(merged.length, 6);
  assert.equal(mod.isTabUnlockedByPacks('usage', ['pacote_dados_analytics'], [custom]), true);
});

