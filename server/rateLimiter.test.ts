/**
 * Testes do Rate Limiter do servidor (Fase 2)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { serverRateLimit, getClientIp, RATE_LIMITS } from './rateLimiter.ts';

test('serverRateLimit: permite requisições dentro do limite e bloqueia quando excedido', () => {
  const route = `test-route-${Date.now()}`;
  const key = `user-test-${Date.now()}`;
  const limit = 3;
  const windowMs = 60_000;

  const r1 = serverRateLimit(route, key, limit, windowMs);
  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 2);

  const r2 = serverRateLimit(route, key, limit, windowMs);
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 1);

  const r3 = serverRateLimit(route, key, limit, windowMs);
  assert.equal(r3.allowed, true);
  assert.equal(r3.remaining, 0);

  const r4 = serverRateLimit(route, key, limit, windowMs);
  assert.equal(r4.allowed, false);
  assert.equal(r4.remaining, 0);
  assert.ok(r4.retryAfterMs > 0);
});

test('serverRateLimit: chaves diferentes têm contadores independentes', () => {
  const route = `test-route-${Date.now()}-b`;
  const r1 = serverRateLimit(route, 'ip-a', 1, 60_000);
  const r2 = serverRateLimit(route, 'ip-b', 1, 60_000);
  assert.equal(r1.allowed, true);
  assert.equal(r2.allowed, true);
  assert.equal(serverRateLimit(route, 'ip-a', 1, 60_000).allowed, false);
  assert.equal(serverRateLimit(route, 'ip-b', 1, 60_000).allowed, false);
});

test('serverRateLimit: janela expirada reseta o contador', () => {
  const route = `test-route-${Date.now()}-c`;
  const key = `user-${Date.now()}`;
  const r1 = serverRateLimit(route, key, 1, 1); // janela de 1ms
  assert.equal(r1.allowed, true);
  // Aguarda a janela expirar (> 1ms)
  const start = Date.now();
  while (Date.now() - start < 5) { /* spin */ }
  const r2 = serverRateLimit(route, key, 1, 1);
  assert.equal(r2.allowed, true); // janela reiniciou
});

test('RATE_LIMITS: configurações pré-definidas têm valores razoáveis', () => {
  assert.ok(RATE_LIMITS.authLogin.limit <= 20);
  assert.ok(RATE_LIMITS.authLogin.windowMs >= 30_000);
  assert.ok(RATE_LIMITS.chat.limit >= 10);
  assert.ok(RATE_LIMITS.authRegister.windowMs >= 60_000);
});

test('getClientIp: extrai IP do header x-forwarded-for', () => {
  const req = { headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(getClientIp(req), '192.168.1.1');
});

test('getClientIp: usa remoteAddress quando não há x-forwarded-for', () => {
  const req = { headers: {}, socket: { remoteAddress: '::1' } };
  assert.equal(getClientIp(req), '::1');
});
