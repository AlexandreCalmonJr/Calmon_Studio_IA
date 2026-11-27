import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECOMMENDED_MOBILE_MODELS,
  getPairedHostUrl,
  setPairedHostUrl,
} from '../src/services/localMobileAi.ts';

if (typeof globalThis.localStorage === 'undefined') {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => mem.set(k, String(v)),
    removeItem: (k: string) => mem.delete(k),
    clear: () => mem.clear(),
  };
}

test('localMobileAi: RECOMMENDED_MOBILE_MODELS includes quantized GGUF specs', () => {
  assert.ok(RECOMMENDED_MOBILE_MODELS.length >= 3);
  assert.ok(RECOMMENDED_MOBILE_MODELS.some((m) => m.recommended && m.downloadUrl.endsWith('.gguf')));
});

test('localMobileAi: setPairedHostUrl normalizes trailing slash and persists', () => {
  const saved = setPairedHostUrl('http://192.168.1.55:3000///');
  assert.equal(saved, 'http://192.168.1.55:3000');
  assert.equal(getPairedHostUrl(), 'http://192.168.1.55:3000');
  setPairedHostUrl('');
  assert.equal(getPairedHostUrl(), '');
});

