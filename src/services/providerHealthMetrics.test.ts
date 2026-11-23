import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyProviderHealth,
  extractLatencyFromTestMessage,
  formatRelativeCheckTime,
  summarizeProvidersHealth,
} from './providerHealthMetrics';

test('extractLatencyFromTestMessage parses milliseconds from historical ping messages', () => {
  assert.equal(extractLatencyFromTestMessage('Conexão autenticada com OpenAI em 214 ms (12+ modelos).'), 214);
  assert.equal(extractLatencyFromTestMessage('Falha HTTP 401'), null);
  assert.equal(extractLatencyFromTestMessage(null), null);
});

test('classifyProviderHealth grades excellent, good, slow, error, and untested states accurately', () => {
  const excellent = classifyProviderHealth({
    configured: true,
    status: 'ok',
    latencyMs: 185,
    statusCode: 200,
  });
  assert.equal(excellent.tier, 'excellent');
  assert.equal(excellent.signalBars, 4);
  assert.equal(excellent.latencyMs, 185);
  assert.ok(excellent.latencyPercent > 0 && excellent.latencyPercent < 30);

  const good = classifyProviderHealth({
    configured: true,
    status: 'ok',
    latencyMs: 540,
    statusCode: 200,
  });
  assert.equal(good.tier, 'good');
  assert.equal(good.signalBars, 3);

  const slow = classifyProviderHealth({
    configured: true,
    status: 'ok',
    latencyMs: 1240,
    statusCode: 200,
  });
  assert.equal(slow.tier, 'slow');
  assert.equal(slow.signalBars, 2);

  const err = classifyProviderHealth({
    configured: true,
    status: 'error',
    latencyMs: 179,
    statusCode: 401,
  });
  assert.equal(err.tier, 'error');
  assert.equal(err.signalBars, 1);
  assert.match(err.label, /HTTP 401/);

  const untested = classifyProviderHealth({
    configured: true,
    status: null,
    latencyMs: null,
  });
  assert.equal(untested.tier, 'untested');
  assert.equal(untested.signalBars, 0);
  assert.equal(untested.label, 'Aguardando medição');
});

test('classifyProviderHealth falls back to latency parsed from lastTestMessage when numeric latency is absent', () => {
  const res = classifyProviderHealth({
    configured: true,
    status: 'ok',
    latencyMs: null,
    lastTestMessage: 'Conexão autenticada com Anthropic em 310 ms.',
  });
  assert.equal(res.tier, 'excellent');
  assert.equal(res.latencyMs, 310);
});

test('formatRelativeCheckTime formats seconds, minutes, hours, and missing timestamps', () => {
  const now = Date.parse('2026-11-22T20:00:00.000Z');
  assert.equal(formatRelativeCheckTime(null, now), 'Não medido');
  assert.equal(formatRelativeCheckTime('2026-11-22T19:59:55.000Z', now), 'agora');
  assert.equal(formatRelativeCheckTime('2026-11-22T19:59:20.000Z', now), 'há 40s');
  assert.equal(formatRelativeCheckTime('2026-11-22T19:54:00.000Z', now), 'há 6 min');
  assert.equal(formatRelativeCheckTime('2026-11-22T17:00:00.000Z', now), 'há 3 h');
});

test('summarizeProvidersHealth aggregates average latency and fastest healthy provider', () => {
  const summary = summarizeProvidersHealth([
    {
      id: 'openai',
      name: 'OpenAI (GPT)',
      shortLabel: 'OpenAI',
      model: 'gpt-4o-mini',
      configured: true,
      isDefault: true,
      testedAt: '2026-11-22T19:59:50.000Z',
      health: classifyProviderHealth({ configured: true, status: 'ok', latencyMs: 210, statusCode: 200 }),
    },
    {
      id: 'anthropic',
      name: 'Anthropic (Claude)',
      shortLabel: 'Anthropic',
      model: 'claude-sonnet-4-20250514',
      configured: true,
      isDefault: false,
      testedAt: '2026-11-22T19:59:50.000Z',
      health: classifyProviderHealth({ configured: true, status: 'ok', latencyMs: 490, statusCode: 200 }),
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      shortLabel: 'DeepSeek',
      model: 'deepseek-chat',
      configured: true,
      isDefault: false,
      testedAt: '2026-11-22T19:59:50.000Z',
      health: classifyProviderHealth({ configured: true, status: 'error', latencyMs: 180, statusCode: 401 }),
    },
  ]);

  assert.equal(summary.totalConfigured, 3);
  assert.equal(summary.healthyCount, 2);
  assert.equal(summary.degradedCount, 1);
  assert.equal(summary.untestedCount, 0);
  assert.equal(summary.avgLatencyMs, 350);
  assert.deepEqual(summary.fastestProvider, { shortLabel: 'OpenAI', latencyMs: 210 });
});
