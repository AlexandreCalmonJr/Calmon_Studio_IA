import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVersionCheckReport,
  compareSemver,
  formatAgentSemver,
  isLegacyAgentModel,
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
