import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  VAULT_COOKIE_NAME,
  buildSecureVaultCookieHeader,
  decryptProviderSecret,
  encryptProviderSecret,
  inferExternalProviderFromModel,
  maskApiKey,
  parseCookieHeader,
  sealVaultCookieEnvelope,
  unsealVaultCookieEnvelope,
  validateProviderBaseUrl,
} from './providerEngine.ts';
import { createLocalSqliteBrainStore } from './brain/sqliteBrainStore.ts';
import {
  decryptWithPassphraseWebCrypto,
  decryptWithRuntimeWebCrypto,
  encryptWithPassphraseWebCrypto,
  encryptWithRuntimeWebCrypto,
} from '../src/services/secureVaultCrypto.ts';

test('AES-256-GCM provider secret round-trip and tamper rejection', () => {
  const master = 'test-master-key-with-sufficient-entropy-2026';
  const original = 'sk-ant-api03-example-secret-9876543210';
  const sealed = encryptProviderSecret(original, master);

  assert.ok(sealed.startsWith('v1:'));
  assert.ok(!sealed.includes(original));
  assert.equal(decryptProviderSecret(sealed, master), original);

  // Altera o payload cifrado para validar autenticacao GCM
  const tampered = `${sealed.slice(0, -2)}AA`;
  assert.throws(() => decryptProviderSecret(tampered, master));
});

test('HttpOnly cookie envelope seals, enforces owner isolation, and builds secure cookie flags', () => {
  const master = 'cookie-vault-secret-2026-abcdef';
  const sealed = sealVaultCookieEnvelope(
    {
      ownerUserId: 'admin',
      updatedAt: new Date().toISOString(),
      entries: {
        deepseek: {
          provider: 'deepseek',
          apiKey: 'sk-deepseek-live-0011223344',
          baseUrl: 'https://api.deepseek.com/v1',
          defaultModel: 'deepseek-chat',
          isDefault: true,
        },
      },
    },
    master
  );

  assert.ok(!sealed.includes('sk-deepseek-live'));

  const header = buildSecureVaultCookieHeader(sealed, true);
  assert.match(header, new RegExp(`^${VAULT_COOKIE_NAME}=`));
  assert.ok(header.includes('HttpOnly'));
  assert.ok(header.includes('Secure'));
  assert.ok(header.includes('SameSite=None'));

  const parsedCookies = parseCookieHeader(`${VAULT_COOKIE_NAME}=${encodeURIComponent(sealed)}; other=1`);
  const unsealed = unsealVaultCookieEnvelope(parsedCookies[VAULT_COOKIE_NAME], 'admin', master);
  assert.ok(unsealed);
  assert.equal(unsealed?.entries.deepseek?.apiKey, 'sk-deepseek-live-0011223344');

  // Outro usuario nao consegue abrir o envelope
  const wrongOwner = unsealVaultCookieEnvelope(parsedCookies[VAULT_COOKIE_NAME], 'guest', master);
  assert.equal(wrongOwner, null);
});

test('maskApiKey conceals key body and validateProviderBaseUrl blocks SSRF/HTTP targets', () => {
  const masked = maskApiKey('sk-ant-api03-1234567890abcdef');
  assert.ok(masked.includes('••••'));
  assert.ok(masked.endsWith('cdef'));
  assert.ok(!masked.includes('1234567890'));

  assert.equal(validateProviderBaseUrl('openai').valid, true);
  assert.equal(validateProviderBaseUrl('anthropic').valid, true);
  assert.equal(validateProviderBaseUrl('deepseek').valid, true);

  assert.equal(validateProviderBaseUrl('custom', 'http://api.example.com/v1').valid, false);
  assert.equal(validateProviderBaseUrl('custom', 'https://127.0.0.1/v1').valid, false);
  assert.equal(validateProviderBaseUrl('custom', 'https://169.254.169.254/latest/meta-data').valid, false);
  assert.equal(validateProviderBaseUrl('custom', 'https://metadata.google.internal/computeMetadata').valid, false);
  assert.equal(validateProviderBaseUrl('custom', 'https://192.168.1.10/v1').valid, false);
  assert.equal(validateProviderBaseUrl('custom', 'https://user:pass@api.example.com/v1').valid, false);

  assert.equal(inferExternalProviderFromModel('claude-sonnet-4-20250514'), 'anthropic');
  assert.equal(inferExternalProviderFromModel('gpt-4o-mini'), 'openai');
  assert.equal(inferExternalProviderFromModel('deepseek-chat'), 'deepseek');
  assert.equal(inferExternalProviderFromModel('grok-2-latest'), 'xai');
  assert.equal(inferExternalProviderFromModel('gemini-4-hydrogen'), null);
});

test('SQLite provider_vault_keys persists encrypted secrets with per-user isolation', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-vault-test-'));
  const store = createLocalSqliteBrainStore({ dataDir: tmpDir });
  try {
    const encrypted = encryptProviderSecret('sk-openai-test-99998888');
    store.upsertProviderVaultKey({
      key_id: 'session_openai',
      owner_user_id: 'admin',
      provider: 'openai',
      label: 'OpenAI (GPT)',
      encrypted_api_key: encrypted,
      masked_key: maskApiKey('sk-openai-test-99998888'),
      base_url: 'https://api.openai.com/v1',
      default_model: 'gpt-4o-mini',
      is_active: true,
      is_default: true,
    });

    const adminList = store.listProviderVaultKeys('admin');
    const otherList = store.listProviderVaultKeys('other_user');
    assert.equal(adminList.length, 1);
    assert.equal(otherList.length, 0);
    assert.equal(adminList[0].provider, 'openai');
    assert.equal(adminList[0].is_default, true);
    assert.ok(!JSON.stringify(adminList[0]).includes('sk-openai-test-99998888'));

    assert.equal(store.deleteProviderVaultKey('other_user', 'session_openai'), false);
    assert.equal(store.deleteProviderVaultKey('admin', 'session_openai'), true);
    assert.equal(store.listProviderVaultKeys('admin').length, 0);
  } finally {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Web Crypto API (AES-GCM 256-bit) encrypts/decrypts runtime & PBKDF2 envelopes without plaintext leaks', async () => {
  const payload = JSON.stringify({ configuredCount: 2, defaultProvider: 'anthropic' });
  const env1 = await encryptWithRuntimeWebCrypto(payload);
  assert.equal(env1.version, 'webcrypto-aes-gcm-v1');
  assert.ok(!env1.ciphertext.includes('anthropic'));
  assert.equal(await decryptWithRuntimeWebCrypto(env1), payload);

  const env2 = await encryptWithPassphraseWebCrypto('segredo-local-protegido', 'senha-mestra-forte-2026');
  assert.ok(env2.salt);
  assert.ok(!env2.ciphertext.includes('segredo-local'));
  assert.equal(await decryptWithPassphraseWebCrypto(env2, 'senha-mestra-forte-2026'), 'segredo-local-protegido');
});
