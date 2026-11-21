import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContextualGreeting,
  detectWakeWord,
  validatePairingCode,
} from './voiceCompanion';

test('detectWakeWord recognizes PT-BR natural wake phrases with custom assistant names', () => {
  const r1 = detectWakeWord('Ei JARVIS, qual é o meu resumo de hoje?', 'JARVIS');
  assert.equal(r1.detected, true);
  assert.equal(r1.triggerPhrase, 'Ei JARVIS');
  assert.equal(r1.command, 'qual é o meu resumo de hoje?');

  const r2 = detectWakeWord('Oi Luna cria uma planilha de despesas', 'Luna');
  assert.equal(r2.detected, true);
  assert.equal(r2.triggerPhrase, 'Ei Luna');
  assert.equal(r2.command, 'cria uma planilha de despesas');

  const r3 = detectWakeWord('Fala João, verifica meus lembretes', 'João');
  assert.equal(r3.detected, true);
  assert.equal(r3.command, 'verifica meus lembretes');

  const r4 = detectWakeWord('Olá Maria', 'Maria');
  assert.equal(r4.detected, true);
  assert.equal(r4.command, '');
});

test('detectWakeWord detects wake phrase inside ambient speech and direct name call', () => {
  const ambient = detectWakeWord('ah sim ei jarvis abre minha agenda', 'JARVIS');
  assert.equal(ambient.detected, true);
  assert.equal(ambient.command, 'abre minha agenda');

  const direct = detectWakeWord('Atlas, me ajude com uma ideia', 'Atlas');
  assert.equal(direct.detected, true);
  assert.equal(direct.command, 'me ajude com uma ideia');

  const unrelated = detectWakeWord('hoje o tempo está ótimo', 'JARVIS');
  assert.equal(unrelated.detected, false);
  assert.equal(unrelated.command, 'hoje o tempo está ótimo');
});

test('buildContextualGreeting formats salutation by time of day', () => {
  const morning = buildContextualGreeting({
    assistantName: 'Luna',
    userName: 'Maria Silva',
    hour: 9,
    pendingApprovals: 0,
    openIncidents: 0,
    activeWorkflows: 2,
  });
  assert.match(morning.greeting, /^Bom dia, Maria! Aqui é Luna\./);
  assert.match(morning.briefingLine, /2 rotina/);

  const night = buildContextualGreeting({
    assistantName: 'JARVIS',
    userName: 'Carlos',
    hour: 21,
    pendingApprovals: 0,
    openIncidents: 0,
    activeWorkflows: 0,
  });
  assert.match(night.greeting, /^Boa noite, Carlos!/);
});

test('validatePairingCode validates XXXX-XXXX format', () => {
  assert.equal(validatePairingCode('JRVS-2026'), true);
  assert.equal(validatePairingCode('invalid'), false);
});
