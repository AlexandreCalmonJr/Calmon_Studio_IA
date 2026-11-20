import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContextualGreeting,
  detectWakeWord,
  enqueueOfflineCommand,
  generateCompanionBridgeScript,
  validatePairingCode,
} from './voiceCompanion.ts';

test('detectWakeWord recognizes dynamic Portuguese and English assistant wake words', () => {
  const res1 = detectWakeWord('Ei Maria, qual o resumo financeiro de hoje?', 'Maria');
  assert.equal(res1.detected, true);
  assert.equal(res1.triggerPhrase, 'Ei Maria');
  assert.equal(res1.command, 'qual o resumo financeiro de hoje?');

  const res2 = detectWakeWord('Olá João! Chama a Kira para verificar este link', 'João');
  assert.equal(res2.detected, true);
  assert.equal(res2.command, 'Chama a Kira para verificar este link');

  const res3 = detectWakeWord('Apenas uma frase comum sem ativação', 'JARVIS');
  assert.equal(res3.detected, false);
  assert.equal(res3.command, 'Apenas uma frase comum sem ativação');
});

test('buildContextualGreeting adapts to time of day and operational alerts', () => {
  const morning = buildContextualGreeting({
    assistantName: 'JARVIS',
    userName: 'Alexandre Calmon',
    hour: 9,
    pendingApprovals: 2,
    openIncidents: 1,
    activeWorkflows: 3,
  });
  assert.match(morning.greeting, /^Bom dia, Alexandre!/);
  assert.match(morning.briefingLine, /2 aprovação\(ões\)/);
  assert.match(morning.briefingLine, /1 alerta\(s\)/);

  const evening = buildContextualGreeting({
    assistantName: 'Maria',
    userName: 'Ana',
    hour: 20,
    pendingApprovals: 0,
    openIncidents: 0,
    activeWorkflows: 0,
  });
  assert.match(evening.greeting, /^Boa noite, Ana! Aqui é Maria/);
  assert.match(evening.briefingLine, /Tudo tranquilo/);
});

test('enqueueOfflineCommand appends trimmed items and ignores blanks', () => {
  const q1 = enqueueOfflineCommand([], '   ', 'voice');
  assert.equal(q1.length, 0);

  const q2 = enqueueOfflineCommand(q1, 'Lembrar de revisar o diff às 18h', 'companion');
  assert.equal(q2.length, 1);
  assert.equal(q2[0].target, 'companion');
  assert.equal(q2[0].text, 'Lembrar de revisar o diff às 18h');
});

test('validatePairingCode and generateCompanionBridgeScript enforce format and embed config', () => {
  assert.equal(validatePairingCode('JRVS-92A4'), true);
  assert.equal(validatePairingCode('invalid-code'), false);

  const script = generateCompanionBridgeScript({
    serverUrl: 'https://jarvis.local:3000/',
    pairingCode: 'JRVS-92A4',
    deviceName: 'Notebook Trabalho',
  });
  assert.match(script, /https:\/\/jarvis\.local:3000/);
  assert.match(script, /JRVS-92A4/);
  assert.match(script, /Notebook Trabalho/);
  assert.match(script, /\/api\/v1\/companion\/heartbeat/);
});
