import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVersionCheckReport,
  compareSemver,
  evaluateSyncFreshness,
  formatAgentSemver,
  isLegacyAgentModel,
  reconcileLocalPacksWithServerMetadata,
  resolvePackageCacheStatusMeta,
  TARGET_AGENT_RUNTIME_VERSION,
} from './packageVersionEngine';
import { MODULE_PACK_CATALOG, sanitizeCustomPackInput } from './modulePackEngine';

test('compareSemver orders semantic versions accurately including multi-digit segments', () => {
  assert.ok(compareSemver('1.2.0', '1.1.0') > 0);
  assert.ok(compareSemver('1.10.0', '1.2.0') > 0);
  assert.equal(compareSemver('v1.2.0', '1.2.0'), 0);
  assert.ok(compareSemver('1.0.9', '1.1.0') < 0);
  assert.equal(compareSemver('2.0.0-beta.1', '2.0.0'), 0);
});

test('isLegacyAgentModel identifies deprecated Gemini models and keeps Gemini 4 active', () => {
  assert.equal(isLegacyAgentModel('gemini-2.5-flash'), true);
  assert.equal(isLegacyAgentModel('gemini-2.5-pro'), true);
  assert.equal(isLegacyAgentModel('gemini-4-hydrogen'), false);
  assert.equal(isLegacyAgentModel('qwen2.5-coder:7b'), false);
});

test('buildVersionCheckReport flags outdated official packs, custom packs, and agents', () => {
  const customPack = sanitizeCustomPackInput(
    {
      id: 'analytics_pro',
      name: 'Analytics Pro',
      version: '1.3.0',
      tabs: ['backend_studio'],
      agents: [
        {
          proper_name: 'Lumen',
          name: 'Analista BI',
          handle: '@lumen',
          role: 'analytics_lumen',
          preferred_model: 'gemini-4-hydrogen',
        },
      ],
    },
    'admin'
  );

  const report = buildVersionCheckReport({
    catalog: [...MODULE_PACK_CATALOG, customPack],
    installedRecords: [
      { pack_id: 'creative_productivity', version: '1.1.0', installed_at: '2026-11-20T00:00:00.000Z' },
      { pack_id: 'analytics_pro', version: '1.0.0', installed_at: '2026-11-20T00:00:00.000Z' },
      { pack_id: 'security_soc', version: '1.2.0', installed_at: '2026-11-22T00:00:00.000Z' },
    ],
    agents: [
      {
        role: 'creative_director',
        name: 'Diretora Criativa',
        proper_name: 'Maya',
        handle: '@maya',
        template_id: 'pack:creative_productivity',
        preferred_model: 'gemini-2.5-flash',
        installed_skills: ['Planilhas & Relatórios'],
        version: 1,
      },
      {
        role: 'jarvis_master',
        name: 'Orquestrador Mestre',
        proper_name: 'JARVIS',
        handle: '@jarvis',
        preferred_model: 'gemini-4-hydrogen',
        installed_skills: ['Orquestração'],
        version: TARGET_AGENT_RUNTIME_VERSION,
      },
    ],
    checkedAt: '2026-11-25T00:00:00.000Z',
  });

  assert.equal(report.summary.outdated_packages, 2);
  assert.equal(report.summary.outdated_agents, 1);
  assert.equal(report.summary.total_updates_available, 3);
  assert.equal(report.summary.installed_packages, 3);

  const creative = report.packages.find((p) => p.pack_id === 'creative_productivity');
  assert.equal(creative?.has_update, true);
  assert.equal(creative?.installed_version, '1.1.0');
  assert.equal(creative?.latest_version, '1.2.0');

  const customItem = report.packages.find((p) => p.pack_id === 'analytics_pro');
  assert.equal(customItem?.has_update, true);
  assert.equal(customItem?.installed_version, '1.0.0');
  assert.equal(customItem?.latest_version, '1.3.0');

  const upToDatePack = report.packages.find((p) => p.pack_id === 'security_soc');
  assert.equal(upToDatePack?.has_update, false);

  const maya = report.agents.find((a) => a.role === 'creative_director');
  assert.equal(maya?.has_update, true);
  assert.equal(maya?.current_version, formatAgentSemver(1));
  assert.equal(maya?.latest_version, formatAgentSemver(TARGET_AGENT_RUNTIME_VERSION));
  assert.equal(maya?.recommended_model, 'gemini-4-hydrogen');

  const master = report.agents.find((a) => a.role === 'jarvis_master');
  assert.equal(master?.has_update, false);
});

test('reconcileLocalPacksWithServerMetadata compares local installed versions against server metadata and computes badge state', () => {
  const serverReport = buildVersionCheckReport({
    catalog: MODULE_PACK_CATALOG,
    installedRecords: [
      { pack_id: 'creative_productivity', version: '1.1.0', installed_at: '2026-11-20T00:00:00.000Z' },
    ],
    agents: [
      {
        role: 'local_infra',
        name: 'Especialista Infra',
        proper_name: 'Orion',
        handle: '@orion',
        preferred_model: 'gemini-2.5-flash',
        installed_skills: ['Tuning'],
        version: 1,
      },
    ],
  });

  // Scenario A: local pack is still at v1.1.0 vs server latest v1.2.0 -> triggers badge
  const localOutdated = reconcileLocalPacksWithServerMetadata({
    localPacks: [
      {
        id: 'creative_productivity',
        name: 'Produtividade & Estúdio Criativo',
        category_label: 'Produtividade & Criativo',
        version: '1.1.0',
        installed: true,
        installed_version: '1.1.0',
        installed_at: '2026-11-20T00:00:00.000Z',
      },
    ],
    serverReport,
    serverBrainVersion: '3.9.0-polyglot',
  });

  assert.equal(localOutdated.badgeState.hasUpdates, true);
  assert.equal(localOutdated.badgeState.outdatedPackagesCount, 1);
  assert.equal(localOutdated.badgeState.outdatedAgentsCount, 1);
  assert.equal(localOutdated.badgeState.totalUpdatesAvailable, 2);
  assert.deepEqual(localOutdated.badgeState.outdatedPackIds, ['creative_productivity']);
  assert.equal(localOutdated.badgeState.serverVersion, '3.9.0-polyglot');

  // Scenario B: local pack updated to v1.2.0 -> pack drift clears immediately
  const localUpdated = reconcileLocalPacksWithServerMetadata({
    localPacks: [
      {
        id: 'creative_productivity',
        name: 'Produtividade & Estúdio Criativo',
        category_label: 'Produtividade & Criativo',
        version: '1.1.0',
        installed: true,
        installed_version: '1.2.0',
        installed_at: '2026-11-25T00:00:00.000Z',
      },
    ],
    serverReport,
    serverBrainVersion: '3.9.0-polyglot',
  });

  assert.equal(localUpdated.badgeState.outdatedPackagesCount, 0);
  assert.equal(localUpdated.badgeState.outdatedAgentsCount, 1);
  assert.equal(localUpdated.badgeState.totalUpdatesAvailable, 1);
});

test('evaluateSyncFreshness classifies never, fresh, aging, and stale sync timestamps without fetching', () => {
  const baseMs = Date.parse('2026-11-25T14:00:00.000Z');

  const never = evaluateSyncFreshness(null, baseMs);
  assert.equal(never.level, 'never');
  assert.equal(never.isStale, true);

  const fresh = evaluateSyncFreshness('2026-11-25T13:59:35.000Z', baseMs);
  assert.equal(fresh.level, 'fresh');
  assert.equal(fresh.isStale, false);
  assert.equal(fresh.relativeLabel, 'agora mesmo');

  const aging = evaluateSyncFreshness('2026-11-25T13:56:30.000Z', baseMs);
  assert.equal(aging.level, 'aging');
  assert.equal(aging.isStale, false);
  assert.equal(aging.relativeLabel, 'há 3 min');

  const stale = evaluateSyncFreshness('2026-11-25T13:50:00.000Z', baseMs);
  assert.equal(stale.level, 'stale');
  assert.equal(stale.isStale, true);
  assert.equal(stale.relativeLabel, 'há 10 min');
  assert.equal(stale.statusLabel, 'Metadados desatualizados');
});

test('resolvePackageCacheStatusMeta distinguishes local-ready artifacts from remote download dependencies', () => {
  const cached = resolvePackageCacheStatusMeta('cached_local', false, false);
  assert.equal(cached.readyForImmediateDeploy, true);
  assert.equal(cached.code, 'local_ready');

  const remoteAvailable = resolvePackageCacheStatusMeta('mirror_ready', false, false);
  assert.equal(remoteAvailable.readyForImmediateDeploy, false);
  assert.equal(remoteAvailable.code, 'remote_required');

  const remoteUpdate = resolvePackageCacheStatusMeta('mirror_ready', true, true);
  assert.equal(remoteUpdate.readyForImmediateDeploy, false);
  assert.equal(remoteUpdate.code, 'remote_required');

  const installedCurrent = resolvePackageCacheStatusMeta('mirror_ready', true, false);
  assert.equal(installedCurrent.readyForImmediateDeploy, true);
  assert.equal(installedCurrent.code, 'local_ready');
});
