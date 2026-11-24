import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isQuotaExceededError,
  clampMessagesForPersistence,
  pruneOldestLocalSessions,
  saveSessionMessagesLocally,
  saveLocalSessionsCatalog,
  getLocalSessionsCatalog,
  MAX_PERSISTED_MESSAGES_PER_SESSION,
  MAX_PERSISTED_CATALOG_ITEMS,
  STORAGE_CATALOG_KEY,
  LocalSessionMeta,
} from '../features/chat/ChatHistoryDrawer';
import { ChatMessage } from '../types';
import { getAccountStorageKey } from './accountScope';

function setupMockLocalStorage() {
  const store = new Map<string, string>();
  const mock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    get size() {
      return store.size;
    },
    get length() {
      return store.size;
    },
    key: (idx: number) => Array.from(store.keys())[idx] ?? null,
  };
  (globalThis as any).localStorage = mock;
  return { store, mock };
}

test('clampMessagesForPersistence clamps to latest messages ceiling', () => {
  assert.deepEqual(clampMessagesForPersistence([]), []);
  assert.deepEqual(clampMessagesForPersistence(null as any), []);

  const smallList: ChatMessage[] = [
    { sender: 'user', text: 'Msg 1', timestamp: '10:00' },
    { sender: 'jarvis', text: 'Msg 2', timestamp: '10:01' },
  ];
  assert.equal(clampMessagesForPersistence(smallList).length, 2);

  // 150 mensagens geradas
  const largeList: ChatMessage[] = Array.from({ length: 150 }, (_, i) => ({
    sender: i % 2 === 0 ? 'user' : 'jarvis',
    text: `Mensagem ${i + 1}`,
    timestamp: '10:00',
  }));

  const clamped = clampMessagesForPersistence(largeList, MAX_PERSISTED_MESSAGES_PER_SESSION);
  assert.equal(clamped.length, MAX_PERSISTED_MESSAGES_PER_SESSION);
  assert.equal(clamped[0].text, 'Mensagem 51');
  assert.equal(clamped[clamped.length - 1].text, 'Mensagem 150');
});

test('isQuotaExceededError detects browser quota exceeded variations and ignores others', () => {
  const quotaErr = new Error('Quota exceeded');
  quotaErr.name = 'QuotaExceededError';
  assert.equal(isQuotaExceededError(quotaErr), true);

  const firefoxErr = new Error('NS_ERROR_DOM_QUOTA_REACHED');
  firefoxErr.name = 'NS_ERROR_DOM_QUOTA_REACHED';
  assert.equal(isQuotaExceededError(firefoxErr), true);

  const code22Err = new Error('Storage is full');
  (code22Err as any).code = 22;
  assert.equal(isQuotaExceededError(code22Err), true);

  const code1014Err = new Error('Storage quota exceeded');
  (code1014Err as any).code = 1014;
  assert.equal(isQuotaExceededError(code1014Err), true);

  const messageMatchErr = new Error('Persistent storage full: quota exceeded');
  assert.equal(isQuotaExceededError(messageMatchErr), true);

  // Falsos positivos rejeitados
  assert.equal(isQuotaExceededError(new TypeError('Cannot read property')), false);
  assert.equal(isQuotaExceededError(new Error('Network error')), false);
  assert.equal(isQuotaExceededError(null), false);
  assert.equal(isQuotaExceededError(undefined), false);
});

test('pruneOldestLocalSessions preserves active session and removes oldest from storage and catalog', () => {
  const { store } = setupMockLocalStorage();

  const sessions: LocalSessionMeta[] = [
    { id: 's1', title: 'Sessao 1 (Mais antiga)', createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:00Z', messageCount: 10 },
    { id: 's2', title: 'Sessao 2 (Intermediaria)', createdAt: '2026-02-01T10:00:00Z', updatedAt: '2026-02-01T10:00:00Z', messageCount: 15 },
    { id: 's3', title: 'Sessao 3 (Recente)', createdAt: '2026-03-01T10:00:00Z', updatedAt: '2026-03-01T10:00:00Z', messageCount: 20 },
  ];

  // Configura dados no storage
  saveLocalSessionsCatalog(sessions);
  store.set(getAccountStorageKey('jarvis_session_messages_s1'), JSON.stringify([{ text: 's1' }]));
  store.set(getAccountStorageKey('jarvis_session_messages_s2'), JSON.stringify([{ text: 's2' }]));
  store.set(getAccountStorageKey('jarvis_session_messages_s3'), JSON.stringify([{ text: 's3' }]));

  // Purgar 1 sessão mantendo s1 ativa se passada
  const prunedCount = pruneOldestLocalSessions('s3', 1);
  assert.equal(prunedCount, 1);

  // s1 (a mais antiga) deve ter sido removida do storage
  assert.equal(store.has(getAccountStorageKey('jarvis_session_messages_s1')), false);
  assert.equal(store.has(getAccountStorageKey('jarvis_session_messages_s2')), true);
  assert.equal(store.has(getAccountStorageKey('jarvis_session_messages_s3')), true);

  // O catálogo deve agora conter apenas s2 e s3
  const catalogAfter = getLocalSessionsCatalog();
  assert.equal(catalogAfter.length, 2);
  assert.equal(catalogAfter.some((s) => s.id === 's1'), false);
  assert.equal(catalogAfter.some((s) => s.id === 's3'), true);
});

test('saveSessionMessagesLocally handles QuotaExceededError with defensive session purge and message reduction', () => {
  const { store, mock } = setupMockLocalStorage();

  // Cria 3 sessões existentes
  const existingSessions: LocalSessionMeta[] = [
    { id: 'old-1', title: 'Antiga 1', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', messageCount: 5 },
    { id: 'old-2', title: 'Antiga 2', createdAt: '2025-02-01T00:00:00Z', updatedAt: '2025-02-01T00:00:00Z', messageCount: 5 },
  ];
  saveLocalSessionsCatalog(existingSessions);
  store.set(getAccountStorageKey('jarvis_session_messages_old-1'), JSON.stringify([{ text: 'velha 1' }]));
  store.set(getAccountStorageKey('jarvis_session_messages_old-2'), JSON.stringify([{ text: 'velha 2' }]));

  // Simula erro de Quota na primeira tentativa, mas sucesso após purga
  let failCount = 1;
  const originalSetItem = mock.setItem;
  mock.setItem = (key: string, value: string) => {
    if (key.includes('active-session') && failCount > 0) {
      failCount--;
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    }
    originalSetItem(key, value);
  };

  const messagesToSave: ChatMessage[] = Array.from({ length: 80 }, (_, i) => ({
    sender: 'user',
    text: `Mensagem atual ${i}`,
    timestamp: '12:00',
  }));

  const result = saveSessionMessagesLocally('active-session', messagesToSave);
  assert.equal(result, true);

  // Deve ter purgado as sessões antigas
  assert.equal(store.has(getAccountStorageKey('jarvis_session_messages_old-1')), false);
  assert.equal(store.has(getAccountStorageKey('jarvis_session_messages_active-session')), true);
});

test('saveLocalSessionsCatalog clamps catalog items and handles QuotaExceededError gracefully', () => {
  const { mock } = setupMockLocalStorage();

  const largeCatalog: LocalSessionMeta[] = Array.from({ length: 80 }, (_, i) => ({
    id: `sess-${i}`,
    title: `Sessao ${i}`,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    messageCount: 2,
  }));

  saveLocalSessionsCatalog(largeCatalog);
  const loaded = getLocalSessionsCatalog();
  assert.equal(loaded.length, MAX_PERSISTED_CATALOG_ITEMS);

  // Simula falha de quota e recupera com catálogo reduzido
  let quotaHit = false;
  const originalSetItem = mock.setItem;
  mock.setItem = (key: string, value: string) => {
    if (key.includes(STORAGE_CATALOG_KEY) && !quotaHit) {
      quotaHit = true;
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    }
    originalSetItem(key, value);
  };

  saveLocalSessionsCatalog(largeCatalog);
  const minimal = getLocalSessionsCatalog();
  assert.equal(minimal.length, 20);
});

test('saveLocalSessionsCatalog removes message keys for dropped sessions beyond ceiling', () => {
  const { store } = setupMockLocalStorage();

  const sessions: LocalSessionMeta[] = Array.from({ length: 65 }, (_, i) => ({
    id: `sess-drop-${i}`,
    title: `Sessao Drop ${i}`,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    messageCount: 1,
  }));

  // Popula mensagens para todas as 65 sessões
  sessions.forEach((s) => {
    store.set(getAccountStorageKey(`jarvis_session_messages_${s.id}`), JSON.stringify([{ text: s.id }]));
  });

  saveLocalSessionsCatalog(sessions);

  // Sessões dentro do teto (0 a 59) mantêm mensagens
  assert.equal(store.has(getAccountStorageKey('jarvis_session_messages_sess-drop-0')), true);
  assert.equal(store.has(getAccountStorageKey('jarvis_session_messages_sess-drop-59')), true);

  // Sessões cortadas (60 a 64) têm suas mensagens removidas para liberar quota
  assert.equal(store.has(getAccountStorageKey('jarvis_session_messages_sess-drop-60')), false);
  assert.equal(store.has(getAccountStorageKey('jarvis_session_messages_sess-drop-64')), false);
});

test('pruneOldestLocalSessions purges orphaned storage keys when catalog is empty or has only active session', () => {
  const { store } = setupMockLocalStorage();

  // Simula chaves órfãs no localStorage sem catálogo registrado
  store.set(getAccountStorageKey('jarvis_session_messages_orphan-1'), '[]');
  store.set(getAccountStorageKey('jarvis_session_messages_orphan-2'), '[]');
  store.set(getAccountStorageKey('jarvis_session_messages_active-keep'), '[]');

  const pruned = pruneOldestLocalSessions('active-keep', 2);
  assert.equal(pruned, 2);
  assert.equal(store.has(getAccountStorageKey('jarvis_session_messages_active-keep')), true);
});

test('saveSessionMessagesLocally engages Level 4 emergency compaction when all prior levels fail quota', () => {
  const { store, mock } = setupMockLocalStorage();

  // Bloqueia tentativas normais (100, 50, 15 mensagens) e só aceita quando compacto (<= 8 msgs e sem taskData)
  mock.setItem = (key: string, value: string) => {
    if (key.includes('active-session')) {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.length > 8) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
    }
    store.set(key, value);
  };

  const hugeMessages: ChatMessage[] = Array.from({ length: 40 }, (_, i) => ({
    sender: 'user',
    text: `Mensagem ${i}: `.repeat(100),
    taskData: { task_id: `t-${i}`, session_id: 'active-session', user_prompt: 'prompt', plan_steps: [], selected_agents: [], policy_verified: true, policy_violations: [], approval_required: false, is_completed: true } as any,
    timestamp: '15:00',
  }));

  const saved = saveSessionMessagesLocally('active-session', hugeMessages);
  assert.equal(saved, true);

  const raw = store.get(getAccountStorageKey('jarvis_session_messages_active-session'));
  assert.ok(raw);
  const parsed = JSON.parse(raw!);
  assert.equal(parsed.length, 8);
  // taskData deve ter sido removido na compactação extrema para caber na quota
  assert.equal(parsed[0].taskData, undefined);
});

test('saveSessionMessagesLocally returns false on unexpected non-quota storage failure', () => {
  const { mock } = setupMockLocalStorage();
  mock.setItem = () => {
    throw new TypeError('SecurityError: The operation is insecure');
  };

  const res = saveSessionMessagesLocally('test-sec', [{ sender: 'user', text: 'ola', timestamp: '10:00' }]);
  assert.equal(res, false);
});
