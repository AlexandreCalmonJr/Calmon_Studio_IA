import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderPingRecord,
  buildDraftKeyFingerprint,
  formatPingBadgeLabel,
  isDraftPingVerified,
  shouldRunPingBeforeSave,
} from './providerPingValidation.ts';

test('buildDraftKeyFingerprint produces deterministic non-plaintext fingerprint sensitive to key and URL edits', () => {
  const fp1 = buildDraftKeyFingerprint('sk-ant-api03-secret-1111', 'https://api.anthropic.com/');
  const fp2 = buildDraftKeyFingerprint('sk-ant-api03-secret-1111', 'https://api.anthropic.com');
  const fp3 = buildDraftKeyFingerprint('sk-ant-api03-secret-2222', 'https://api.anthropic.com');

  assert.equal(fp1, fp2);
  assert.notEqual(fp1, fp3);
  assert.ok(!fp1.includes('secret'));
});

test('shouldRunPingBeforeSave requires ping until exact draft key passes validation and respects forceSkipPing', () => {
  const baseUrl = 'https://api.openai.com/v1';
  const apiKey = 'sk-proj-test-key-0001';

  // Sem ping anterior -> precisa pingar antes de salvar
  assert.equal(
    shouldRunPingBeforeSave({ validateBeforeSave: true, apiKey, baseUrl, lastPing: null }),
    true
  );

  // Ping bem-sucedido para a mesma chave -> nao precisa duplicar ping
  const validPing: ProviderPingRecord = {
    ok: true,
    statusCode: 200,
    latencyMs: 145,
    endpointHost: 'api.openai.com',
    modelsDetected: ['gpt-4o-mini'],
    message: 'OK',
    fingerprint: buildDraftKeyFingerprint(apiKey, baseUrl),
    testedAt: new Date().toISOString(),
  };

  assert.equal(isDraftPingVerified(validPing, apiKey, baseUrl), true);
  assert.equal(
    shouldRunPingBeforeSave({ validateBeforeSave: true, apiKey, baseUrl, lastPing: validPing }),
    false
  );

  // Se o usuario alterar a chave apos o ping, exige novo ping
  assert.equal(
    shouldRunPingBeforeSave({ validateBeforeSave: true, apiKey: 'sk-proj-edited-key', baseUrl, lastPing: validPing }),
    true
  );

  // Se o usuario clicar em "Salvar mesmo assim" ou desativar o toggle, permite salvar sem bloquear
  assert.equal(
    shouldRunPingBeforeSave({ validateBeforeSave: true, forceSkipPing: true, apiKey, baseUrl, lastPing: null }),
    false
  );
  assert.equal(
    shouldRunPingBeforeSave({ validateBeforeSave: false, apiKey, baseUrl, lastPing: null }),
    false
  );
});

test('formatPingBadgeLabel formats latency and HTTP status concisely', () => {
  assert.equal(
    formatPingBadgeLabel({
      ok: true,
      statusCode: 200,
      latencyMs: 215,
      endpointHost: 'api.deepseek.com',
      modelsDetected: [],
      message: 'OK',
      fingerprint: 'fp_1',
      testedAt: '',
    }),
    'Ping OK · 215 ms'
  );

  assert.equal(
    formatPingBadgeLabel({
      ok: false,
      statusCode: 401,
      latencyMs: 180,
      endpointHost: 'api.openai.com',
      modelsDetected: [],
      message: 'Unauthorized',
      fingerprint: 'fp_2',
      testedAt: '',
    }),
    'Falha · HTTP 401'
  );
});
