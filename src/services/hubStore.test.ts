import test from 'node:test';
import assert from 'node:assert/strict';
import { HubDomainStore } from './hubStore';

test('HubDomainStore caches responses within TTL, deduplicates in-flight requests, and invalidates cleanly', async () => {
  const store = new HubDomainStore();
  let calls = 0;

  const fetcher = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 15));
    return { count: calls };
  };

  // Deduplicação em voo: 2 chamadas simultâneas executam fetcher apenas 1 vez
  const [a, b] = await Promise.all([
    store.fetch('brain_info', fetcher, { ttlMs: 5_000 }),
    store.fetch('brain_info', fetcher, { ttlMs: 5_000 }),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(a, { count: 1 });
  assert.deepEqual(b, { count: 1 });

  // Cache quente dentro do TTL não chama fetcher novamente
  const c = await store.fetch('brain_info', fetcher, { ttlMs: 5_000 });
  assert.equal(calls, 1);
  assert.deepEqual(c, { count: 1 });

  // Invalidação limpa entrada e força novo fetch
  store.invalidate('brain_info');
  assert.equal(store.getEntry('brain_info').data, null);

  const d = await store.fetch('brain_info', fetcher, { ttlMs: 5_000 });
  assert.equal(calls, 2);
  assert.deepEqual(d, { count: 2 });

  // Invalidação por prefixo com ":" limpa subchaves
  store.setData('brain_infra:fast', { ok: true });
  store.setData('brain_infra:probe', { ok: true });
  store.invalidate('brain_infra');
  assert.equal(store.getEntry('brain_infra:fast').data, null);
  assert.equal(store.getEntry('brain_infra:probe').data, null);
});
