import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySkillBucket,
  computeUnifiedStoreSummary,
  filterStoreSkills,
  isSkillActive,
  sanitizeUnifiedStoreSection,
} from './unifiedStoreEngine';
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
