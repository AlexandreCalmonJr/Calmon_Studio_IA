import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentInfo } from '../types';
import { ALL_26_AGENTS } from '../data/agentsCatalog';
import {
  resolveDockAgents,
  resolveQuickChatAgents,
  reconcileStoreBlueprints,
  mapBlueprintToCreatePayload,
} from './agentSync';

const sampleAgents: AgentInfo[] = [
  {
    role: 'jarvis_master',
    name: 'Maestro Orquestrador',
    proper_name: 'Maestro',
    handle: '@maestro',
    mission: 'Orquestra especialistas.',
    preferred_model: 'gemini-4-hydrogen',
    is_read_only: false,
    allowed_tools: [],
    mascot: { id: 'maestro_slime', color: '#f97316', accessory: 'headphones', mood: 'idle' },
  },
  {
    role: 'sentinel_security',
    name: 'Sentinela de Segurança',
    proper_name: 'Kira',
    handle: '@kira',
    mission: 'Audita PDFs e segurança.',
    preferred_model: 'llama3.1:8b',
    is_read_only: true,
    allowed_tools: [],
    mascot: { id: 'sentinel_owl', color: '#10b981', accessory: 'shield', mood: 'idle' },
  },
  {
    role: 'software_architect',
    name: 'Arquiteto de Software',
    proper_name: 'Orion',
    handle: '@orion',
    mission: 'Define arquitetura.',
    preferred_model: 'qwen2.5-coder:7b',
    is_read_only: true,
    allowed_tools: [],
    mascot: { id: 'coder_slime', color: '#2dd4bf', accessory: 'visor', mood: 'idle' },
  },
  {
    role: 'advogado_tributario',
    name: 'Advogado Tributário',
    proper_name: 'Lucas',
    handle: '@lucas',
    mission: 'Analisa impostos e contratos.',
    preferred_model: 'gemini-4-hydrogen',
    is_read_only: true,
    is_custom: true,
    allowed_tools: [],
    mascot: { id: 'scholar_fox', color: '#6366f1', accessory: 'glasses', mood: 'idle' },
  },
];

test('resolveDockAgents strips legacy fake IDs and prioritizes real custom agents', () => {
  const dock = resolveDockAgents(sampleAgents, ['qa_tester', 'copy_editor', 'bug_fixer']);
  assert.equal(dock.length, 4);
  assert.equal(dock[0].properName, 'Lucas');
  assert.equal(dock[0].role, 'advogado_tributario');
  assert.ok(!dock.some((d) => d.role === 'qa_tester' || d.role === 'bug_fixer'));
});

test('resolveDockAgents respects valid pinned real roles while surfacing new custom agents', () => {
  const dock = resolveDockAgents(sampleAgents, ['sentinel_security', 'software_architect']);
  assert.deepEqual(
    dock.map((d) => d.role),
    ['advogado_tributario', 'sentinel_security', 'software_architect']
  );
});

test('resolveQuickChatAgents uses agent_<role> session IDs and filters by proper name or handle', () => {
  const all = resolveQuickChatAgents(sampleAgents);
  assert.equal(all[0].id, 'agent_advogado_tributario');
  assert.equal(all[0].properName, 'Lucas');

  const filtered = resolveQuickChatAgents(sampleAgents, '@kira');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'agent_sentinel_security');
});

test('reconcileStoreBlueprints eliminates duplication between catalog blueprints and active team', () => {
  const res = reconcileStoreBlueprints(ALL_26_AGENTS, sampleAgents);
  assert.equal(res.installedCount, 2); // jarvis_master + software_architect
  assert.equal(res.availableCount, ALL_26_AGENTS.length - 2);

  const arch = res.items.find((i) => i.blueprint.role === 'software_architect');
  assert.ok(arch);
  assert.equal(arch.status, 'installed');
  assert.equal(arch.installedAgent?.proper_name, 'Orion');

  const dataSci = res.items.find((i) => i.blueprint.role === 'data_scientist');
  assert.ok(dataSci);
  assert.equal(dataSci.status, 'available');
  const payload = mapBlueprintToCreatePayload(dataSci);
  assert.equal(payload.role, 'data_scientist');
  assert.equal(payload.proper_name, 'Iris');
  assert.equal(payload.handle, '@iris');
});
