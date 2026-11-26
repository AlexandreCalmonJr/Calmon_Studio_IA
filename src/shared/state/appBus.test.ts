import test from 'node:test';
import assert from 'node:assert/strict';
import { emitAppEvent, subscribeAppEvent } from './appBus.ts';

test('appBus: emite e entrega payloads tipados e suporta unsubscribe limpo', () => {
  const received: string[] = [];
  const off = subscribeAppEvent('jarvis:open-agent-chat', (detail) => {
    received.push(detail.agentId);
  });

  emitAppEvent('jarvis:open-agent-chat', { agentId: 'maestro' });
  emitAppEvent('jarvis:open-agent-chat', { agentId: 'kira' });
  off();
  emitAppEvent('jarvis:open-agent-chat', { agentId: 'clara' });

  assert.deepEqual(received, ['maestro', 'kira']);
});

test('appBus: suporta eventos sem payload e isola erros de listeners', () => {
  let count = 0;
  const offBad = subscribeAppEvent('jarvis:agents-updated', () => {
    throw new Error('listener error');
  });
  const offGood = subscribeAppEvent('jarvis:agents-updated', () => {
    count += 1;
  });

  emitAppEvent('jarvis:agents-updated');
  assert.equal(count, 1);

  offBad();
  offGood();
});
