import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import {
  bindActiveAuthStore,
  learningProgress,
  sessions,
  userProfiles,
  users,
} from './authSessionManager.ts';
import {
  bindQuotaPersistCallback,
  hydrateQuotaBucketsSnapshot,
} from './tokenQuotaManager.ts';
import type { UserAccount } from './types.ts';

export function persistStateNamespace(
  store: LocalSqliteBrainStore | undefined,
  namespace: string,
  value: unknown
): void {
  if (!store) return;
  try {
    store.saveStateNamespace(namespace, value);
  } catch {
    // Non-fatal fallback if database is closed during test teardown
  }
}

export function persistAllUsersAndProfiles(store: LocalSqliteBrainStore | undefined): void {
  if (!store) return;
  for (const [, user] of users.entries()) {
    try {
      store.upsertAuthUser(user);
    } catch {
      // não bloqueia
    }
  }
  persistStateNamespace(store, 'user_profiles', Array.from(userProfiles.entries()));
  persistStateNamespace(store, 'learning_progress', Array.from(learningProgress.entries()));
}

function restoreMapFromNamespace<T>(
  store: LocalSqliteBrainStore,
  namespace: string,
  target: Map<string, T>,
  validateValue?: (val: unknown) => boolean
): void {
  const entries = store.loadStateNamespace<Array<[string, T]>>(namespace);
  if (!Array.isArray(entries)) return;
  target.clear();
  for (const [k, v] of entries) {
    if (k && (validateValue ? validateValue(v) : Boolean(v))) {
      target.set(k, v);
    }
  }
}

function restoreArrayField(
  store: LocalSqliteBrainStore,
  state: Record<string, any>,
  namespace: string,
  field: string,
  requireNonEmpty = false
): void {
  const saved = store.loadStateNamespace<unknown[]>(namespace);
  if (Array.isArray(saved) && (!requireNonEmpty || saved.length > 0)) {
    state[field] = saved;
  }
}

function restoreMergedObjectField(
  store: LocalSqliteBrainStore,
  state: Record<string, any>,
  namespace: string,
  field: string
): void {
  const saved = store.loadStateNamespace<Record<string, unknown>>(namespace);
  if (saved && typeof saved === 'object') {
    state[field] = { ...state[field], ...saved };
  }
}

export function hydrateStateFromSqlite(
  store: LocalSqliteBrainStore,
  state: Record<string, any>,
  onLog: (level: 'INFO' | 'WARNING' | 'ERROR', source: string, message: string) => void
): void {
  bindActiveAuthStore(store);

  const sqliteUsers = store.listAuthUsers();
  if (sqliteUsers.length > 0) {
    for (const u of sqliteUsers) {
      users.set(u.username, u);
    }
  } else {
    const savedUsers = store.loadStateNamespace<Array<[string, UserAccount]>>('users');
    if (Array.isArray(savedUsers) && savedUsers.length > 0) {
      store.migrateUsersSnapshotIfNeeded(savedUsers);
      for (const [k, u] of savedUsers) {
        if (k && u?.username) users.set(k, u);
      }
    }
  }

  for (const [, u] of users.entries()) {
    try {
      store.upsertAuthUser(u);
    } catch {
      // não bloqueia
    }
  }

  try {
    store.purgeExpiredAuthSessions();
    const activeSessions = store.listActiveAuthSessions();
    for (const s of activeSessions) {
      sessions.set(s.session_id, s);
    }
  } catch {
    // não bloqueia
  }

  try {
    const recovered = store.recoverInterruptedAgentRuns();
    if (recovered > 0) {
      onLog(
        'WARNING',
        'durable_runs',
        `${recovered} execução(ões) de agente interrompida(s) marcada(s) como recuperável(is) no boot.`
      );
    }
  } catch {
    // não bloqueia
  }

  const savedProfiles = store.loadStateNamespace<Array<[string, Record<string, any>]>>('user_profiles');
  if (Array.isArray(savedProfiles)) {
    for (const [k, p] of savedProfiles) {
      if (k && p) userProfiles.set(k, p);
    }
  }

  const savedLearning = store.loadStateNamespace<
    Array<[string, { completed_modules: string[]; updated_at: string }]>
  >('learning_progress');
  if (Array.isArray(savedLearning)) {
    for (const [k, l] of savedLearning) {
      if (k && l) learningProgress.set(k, l);
    }
  }

  store.migrateLegacyChatSessionsSnapshotIfNeeded();
  const savedTasks = store.listTaskRecords(250);
  if (savedTasks.length > 0) {
    state.tasksList = savedTasks;
  }

  const relationalSessions = store.listChatSessionsRelational(120);
  if (relationalSessions.length > 0) {
    state.chatSessions.clear();
    for (const row of relationalSessions) {
      const dbMsgs = store.getChatSessionMessagesRelational(row.id, 250);
      const firstUser = dbMsgs.find((m) => m.role === 'user')?.content || '';
      const sessionTasks = savedTasks.filter((t) => String(t.session_id || '') === row.id);
      state.chatSessions.set(row.id, {
        session_id: row.id,
        title: row.title,
        first_prompt: firstUser,
        first_intent: row.mode || 'standard',
        last_activity: row.updated_at || row.created_at,
        messages: dbMsgs.map((m, idx) => ({
          id: idx + 1,
          session_id: row.id,
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
          created_at: m.created_at,
        })),
        tasks: sessionTasks,
      });
    }
  }

  const arrayMappings: Array<[string, string, boolean?]> = [
    ['skills_list', 'skillsList', true],
    ['knowledge_docs', 'knowledgeDocs'],
    ['brain_memories', 'brainMemories'],
    ['saved_workflows', 'savedWorkflows'],
    ['workflow_runs', 'workflowRuns'],
    ['workspace_projects', 'workspaceProjects'],
    ['ide_files', 'ideFiles'],
    ['ide_checkpoints', 'ideCheckpoints'],
    ['approvals', 'approvals'],
    ['permissions_matrix', 'permissionsMatrix', true],
    ['sentinel_incidents', 'sentinelIncidents'],
    ['telemetry_records', 'telemetryRecords'],
    ['integration_connectors', 'integrationConnectors', true],
    ['context_sets', 'contextSets'],
    ['mock_endpoints', 'mockEndpoints'],
    ['agents_list', 'agentsList', true],
    ['agent_routes', 'agentRoutes'],
  ];
  for (const [namespace, field, nonEmpty] of arrayMappings) {
    restoreArrayField(store, state, namespace, field, Boolean(nonEmpty));
  }

  restoreMapFromNamespace(store, 'project_memories', state.projectMemories, Array.isArray);
  restoreMapFromNamespace(store, 'agent_memories', state.agentMemories, Array.isArray);
  restoreMapFromNamespace(store, 'agent_versions', state.agentVersions, Array.isArray);

  restoreMergedObjectField(store, state, 'push_bridge_config', 'pushBridgeConfig');
  restoreMergedObjectField(store, state, 'webhooks_config', 'webhooksConfig');
  restoreMergedObjectField(store, state, 'performance_mode', 'performanceModeState');

  const savedQuotas = store.loadStateNamespace<Record<string, any>>('token_quota_buckets');
  hydrateQuotaBucketsSnapshot(savedQuotas);
  bindQuotaPersistCallback((snap) => persistStateNamespace(store, 'token_quota_buckets', snap));

  const savedSecurityFlags = store.loadStateNamespace<Record<string, unknown>>('security_flags');
  if (savedSecurityFlags) {
    for (const key of [
      'networkIsolated',
      'killSwitchActive',
      'vaultLocked',
      'piiShieldEnabled',
      'onboardingCompleted',
      'brainAutoDistill',
    ]) {
      if (typeof savedSecurityFlags[key] === 'boolean') {
        state[key] = savedSecurityFlags[key];
      }
    }
    if (Array.isArray(savedSecurityFlags.quarantinedAgents)) {
      state.quarantinedAgents = savedSecurityFlags.quarantinedAgents;
    }
  }
}
