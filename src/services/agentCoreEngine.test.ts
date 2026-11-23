import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefaultAgentCore,
  deriveAgentWorkspaceSlug,
  evaluateAgentCoreReadiness,
  isValidAgentRoleSlug,
  normalizeAgentRoleSlug,
  sanitizeAgentCorePatch,
} from './agentCoreEngine';

test('buildDefaultAgentCore creates a complete Systems Architect core preset', () => {
  const core = buildDefaultAgentCore('architect');
  assert.equal(core.agent_role, 'architect');
  assert.equal(core.workspace_slug, 'agent_architect');
  assert.equal(core.orchestration_mode, 'plan_critique_blueprint');
  assert.equal(core.max_steps, 12);
  assert.equal(core.pack_id, 'engineering_architecture');
  assert.ok(core.soul_markdown.includes('Arquiteto de Sistemas'));
  assert.ok(core.allowed_mcp_servers.includes('mcp_git_inspector'));

  const readiness = evaluateAgentCoreReadiness(core);
  assert.equal(readiness.completenessPct, 100);
  assert.equal(readiness.hasSoul, true);
  assert.equal(readiness.hasFallback, true);
});

test('sanitizeAgentCorePatch clamps loop bounds, budget, and rejects invalid enums', () => {
  const base = buildDefaultAgentCore('custom_worker', {
    proper_name: 'Worker',
    mission: 'Executar análises rápidas.',
  });

  const updated = sanitizeAgentCorePatch(base, {
    orchestration_mode: 'invalid_mode' as any,
    autonomy_policy: 'invalid_policy' as any,
    max_steps: 999,
    max_delegation_depth: -4,
    daily_budget_usd: 1200,
    primary_provider: 'unknown_provider',
    primary_model: 'gemini-2.5-pro',
    allowed_mcp_servers: ['mcp_local_workspace', 'mcp_local_workspace', '  MCP_GIT_INSPECTOR  '],
    soul_markdown: '# SOUL Customizado\nFoco total em performance.',
    status: 'paused',
  });

  assert.equal(updated.orchestration_mode, base.orchestration_mode);
  assert.equal(updated.autonomy_policy, base.autonomy_policy);
  assert.equal(updated.max_steps, 30);
  assert.equal(updated.max_delegation_depth, 0);
  assert.equal(updated.daily_budget_usd, 500);
  assert.equal(updated.primary_provider, base.primary_provider);
  assert.equal(updated.primary_model, 'gemini-2.5-pro');
  assert.deepEqual(updated.allowed_mcp_servers, ['mcp_local_workspace', 'mcp_git_inspector']);
  assert.equal(updated.status, 'paused');
});

test('role slug normalization and validation reject path traversal', () => {
  assert.equal(normalizeAgentRoleSlug('Arquiteto Sênior!'), 'arquiteto_senior');
  assert.equal(deriveAgentWorkspaceSlug('Arquiteto Sênior!'), 'agent_arquiteto_senior');
  assert.equal(isValidAgentRoleSlug('architect'), true);
  assert.equal(isValidAgentRoleSlug('../etc/passwd'), false);
  assert.equal(isValidAgentRoleSlug('a'), false);
});
