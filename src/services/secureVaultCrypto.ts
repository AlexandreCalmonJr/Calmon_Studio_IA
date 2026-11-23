/**
 * Módulo de proteção criptográfica no navegador via Web Crypto API (AES-GCM 256-bit).
 * Garante que nenhuma chave de API seja gravada em texto claro em localStorage ou sessionStorage.
 * As chaves reais residem exclusivamente no cofre criptografado do servidor (SQLite AES-256-GCM)
 * e no Cookie HttpOnly selado (`jarvis_provider_vault`), inacessível ao JavaScript do cliente.
 */

const LEGACY_PLAINTEXT_KEY_PATTERNS = [
  /api[_-]?key/i,
  /openai/i,
  /anthropic/i,
  /deepseek/i,
  /grok/i,
  /openrouter/i,
  /secret[_-]?key/i,
  /vault[_-]?plain/i,
];

const PROTECTED_SESSION_META_KEY = 'jarvis.vault.meta.enc.v1';

let runtimeEphemeralKeyPromise: Promise<CryptoKey> | null = null;

export function isWebCryptoAvailable(): boolean {
  return typeof globalThis !== 'undefined' && Boolean(globalThis.crypto?.subtle);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * Gera uma chave AES-GCM 256-bit não-extraível mantida exclusivamente na memória RAM da aba.
 */
async function getRuntimeSessionCryptoKey(): Promise<CryptoKey> {
  if (!isWebCryptoAvailable()) {
    throw new Error('Web Crypto API indisponível neste ambiente.');
  }
  if (!runtimeEphemeralKeyPromise) {
    runtimeEphemeralKeyPromise = globalThis.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false, // non-extractable
      ['encrypt', 'decrypt']
    );
  }
  return runtimeEphemeralKeyPromise;
}

/**
 * Deriva uma chave AES-GCM 256-bit via PBKDF2-SHA256 (120.000 iterações) para envelopes portáveis.
 */
export async function deriveAesGcmKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  if (!isWebCryptoAvailable()) {
    throw new Error('Web Crypto API indisponível neste ambiente.');
  }
  const encoder = new TextEncoder();
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: 120_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface WebCryptoEncryptedEnvelope {
  version: 'webcrypto-aes-gcm-v1';
  iv: string;
  ciphertext: string;
  salt?: string;
}

export async function encryptWithRuntimeWebCrypto(plaintext: string): Promise<WebCryptoEncryptedEnvelope> {
  const key = await getRuntimeSessionCryptoKey();
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  return {
    version: 'webcrypto-aes-gcm-v1',
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
  };
}

export async function decryptWithRuntimeWebCrypto(
  envelope: WebCryptoEncryptedEnvelope
): Promise<string> {
  if (!envelope || envelope.version !== 'webcrypto-aes-gcm-v1') {
    throw new Error('Envelope Web Crypto inválido.');
  }
  const key = await getRuntimeSessionCryptoKey();
  const iv = base64ToBytes(envelope.iv);
  const cipherBytes = base64ToBytes(envelope.ciphertext);
  const plainBuffer = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    cipherBytes as unknown as BufferSource
  );
  return new TextDecoder().decode(plainBuffer);
}

export async function encryptWithPassphraseWebCrypto(
  plaintext: string,
  passphrase: string
): Promise<WebCryptoEncryptedEnvelope> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesGcmKeyFromPassphrase(passphrase, salt);
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  return {
    version: 'webcrypto-aes-gcm-v1',
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
  };
}

export async function decryptWithPassphraseWebCrypto(
  envelope: WebCryptoEncryptedEnvelope,
  passphrase: string
): Promise<string> {
  if (!envelope || envelope.version !== 'webcrypto-aes-gcm-v1' || !envelope.salt) {
    throw new Error('Envelope Web Crypto com PBKDF2 inválido.');
  }
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const key = await deriveAesGcmKeyFromPassphrase(passphrase, salt);
  const cipherBytes = base64ToBytes(envelope.ciphertext);
  const plainBuffer = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    cipherBytes as unknown as BufferSource
  );
  return new TextDecoder().decode(plainBuffer);
}

/**
 * Remove qualquer resquício legado de chaves de API em texto claro no localStorage/sessionStorage.
 * Retorna o número de entradas limpas.
 */
export function scrubLegacyPlaintextApiKeys(): number {
  let removed = 0;
  if (typeof window === 'undefined') return 0;

  const storages: Storage[] = [];
  try {
    if (window.localStorage) storages.push(window.localStorage);
  } catch {
    // storage bloqueado
  }
  try {
    if (window.sessionStorage) storages.push(window.sessionStorage);
  } catch {
    // storage bloqueado
  }

  for (const store of storages) {
    const keysToDelete: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (!k || k === PROTECTED_SESSION_META_KEY) continue;
      if (LEGACY_PLAINTEXT_KEY_PATTERNS.some((rx) => rx.test(k))) {
        keysToDelete.push(k);
        continue;
      }
      const val = store.getItem(k) || '';
      if (/\b(sk-ant-|sk-proj-|sk-or-v1-|gsk_|xai-)[A-Za-z0-9_-]{8,}/.test(val)) {
        keysToDelete.push(k);
      }
    }
    for (const k of keysToDelete) {
      store.removeItem(k);
      removed += 1;
    }
  }

  return removed;
}

/**
 * Sela metadados não-sensíveis de sessão (ex.: último provedor verificado e timestamp)
 * com AES-GCM 256-bit na sessionStorage (jamais chaves de API em claro).
 */
export async function saveEncryptedSessionVaultMeta(meta: {
  configuredCount: number;
  defaultProvider: string | null;
  syncedAt: string;
}): Promise<boolean> {
  if (typeof window === 'undefined' || !isWebCryptoAvailable()) return false;
  try {
    const sealed = await encryptWithRuntimeWebCrypto(JSON.stringify(meta));
    window.sessionStorage.setItem(PROTECTED_SESSION_META_KEY, JSON.stringify(sealed));
    return true;
  } catch {
    return false;
  }
}
