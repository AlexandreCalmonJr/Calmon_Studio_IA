import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalSqliteBrainStore } from './sqliteBrainStore.ts';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('LocalSqliteBrainStore bootstraps WAL SQLite database on disk with all 12 core tables and persists across reopen', () => {
  const tempDir = makeTempDir('jarvis-brain-sqlite-');
  try {
    const store1 = createLocalSqliteBrainStore({
      dataDir: tempDir,
      brainName: 'Cérebro Teste Local',
      assistantName: 'JARVIS',
    });

    const health = store1.getDatabaseHealth();
    assert.equal(health.ok, true);
    assert.equal(health.journalMode, 'wal');
    assert.ok(health.dbSizeBytes > 0);
    assert.equal(fs.existsSync(store1.dbPath), true);

    const tables = store1.getTableStats();
    assert.equal(tables.length, 36); // 30 anteriores + 6 tabelas v3 (agent_runs, agent_run_steps, run_artifacts, sandbox_sessions, scheduled_jobs, channel_bindings)
    assert.ok(tables.some((t) => t.table === 'brain_identity' && t.rows === 1));
    assert.ok(tables.some((t) => t.table === 'brain_profiles' && t.rows === 3));
    assert.ok(tables.some((t) => t.table === 'agent_workspaces' && t.rows === 1));
    assert.ok(tables.some((t) => t.table === 'mcp_servers' && t.rows === 2));
    assert.ok(tables.some((t) => t.table === 'provider_vault_keys'));
    assert.ok(tables.some((t) => t.table === 'installed_packs'));
    assert.ok(tables.some((t) => t.table === 'agent_cores'));
    assert.ok(tables.some((t) => t.table === 'custom_packs'));
    assert.ok(tables.some((t) => t.table === 'app_state_snapshots'));
    assert.ok(tables.some((t) => t.table === 'app_tasks'));
    assert.ok(tables.some((t) => t.table === 'coding_session_messages'));
    assert.ok(tables.some((t) => t.table === 'agent_conversation_history'));
    assert.ok(tables.some((t) => t.table === 'auth_users'));
    assert.ok(tables.some((t) => t.table === 'auth_sessions'));

    const added = store1.addBrainProfile({
      name: 'Docker Escritório',
      baseUrl: 'http://192.168.1.88:3000',
      mode: 'docker_postgres',
      description: 'Container com pgvector',
    });
    assert.equal(added.profiles.length, 4);
    store1.setActiveBrainProfile(added.created.id);
    store1.close();

    // Reabre o mesmo arquivo SQLite do disco para provar persistência real
    const store2 = createLocalSqliteBrainStore({ dataDir: tempDir });
    const reopened = store2.listBrainProfiles();
    assert.equal(reopened.profiles.length, 4);
    assert.equal(reopened.activeProfileId, added.created.id);
    assert.equal(store2.getIdentity().name, 'Cérebro Teste Local');
    store2.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('LocalSqliteBrainStore syncs workspace models, exports .jarvis-pack, imports transactionally, and creates valid SQLite backups', () => {
  const dirA = makeTempDir('jarvis-brain-a-');
  const dirB = makeTempDir('jarvis-brain-b-');
  try {
    const storeA = createLocalSqliteBrainStore({ dataDir: dirA, brainName: 'Cérebro Origem' });
    storeA.syncWorkspaceSnapshot({
      agents: [
        {
          role: 'iris_excel',
          name: 'Iris Planilhas',
          handle: '@iris',
          description: 'Gera planilhas Excel reais.',
          system_prompt: 'Crie planilhas organizadas.',
          installed_skills: ['Excel Avançado'],
          is_custom: true,
        },
      ],
      skills: [
        {
          id: 'skill_excel_adv',
          name: 'Excel Avançado',
          domain: 'planilhas',
          description: 'Fórmulas e gráficos.',
          assigned_agents: ['iris_excel'],
        },
      ],
      workflows: [
        {
          id: 'wf_fechamento',
          title: 'Fechamento Mensal',
          description: 'Consolida despesas.',
          schedule_cron: '0 9 1 * *',
          schedule_enabled: true,
          nodes: [{ id: 'n1', label: 'Coletar' }],
          edges: [],
        },
      ],
      knowledge: [
        {
          name: 'guia-financeiro.md',
          category: 'financas',
          content: '# Guia\nSempre categorizar gastos fixos e variáveis.',
        },
      ],
    });

    const pack = storeA.exportJarvisPack();
    assert.equal(pack.format, 'jarvis-brain-pack');
    assert.equal(pack.agents.length, 1);
    assert.equal(pack.skills.length, 1);
    assert.deepEqual(pack.skills[0].assigned_agents, ['iris_excel']);
    assert.equal(pack.workflows.length, 1);
    assert.equal(pack.knowledge.length, 1);

    // Backup real SQLite (VACUUM INTO) e validação do cabeçalho binário "SQLite format 3"
    const backup = storeA.createSqliteBackup();
    assert.ok(backup.size_bytes > 4096);
    const header = fs.readFileSync(backup.path).subarray(0, 15).toString('utf8');
    assert.equal(header, 'SQLite format 3');
    assert.equal(storeA.listBackups().length, 1);
    storeA.close();

    // Importa o pacote .jarvis-pack em um segundo banco SQLite totalmente limpo
    const storeB = createLocalSqliteBrainStore({ dataDir: dirB, brainName: 'Cérebro Destino' });
    const importedRes = storeB.importJarvisPack(pack);
    assert.deepEqual(importedRes.imported, {
      agents: 1,
      skills: 1,
      workflows: 1,
      knowledge: 1,
    });
    const exportedB = storeB.exportJarvisPack();
    assert.equal(exportedB.agents[0].role, 'iris_excel');
    assert.equal(exportedB.knowledge[0].name, 'guia-financeiro.md');
    storeB.close();
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

test('LocalSqliteBrainStore persists installed_packs and agent_cores across reopen and writes SOUL.md/MEMORY.md', () => {
  const tempDir = makeTempDir('jarvis-packs-cores-');
  try {
    const store1 = createLocalSqliteBrainStore({ dataDir: tempDir });
    const initialPacks = store1.listInstalledPacks('admin');
    assert.ok(initialPacks.some((p) => p.pack_id === 'creative_productivity'));

    store1.installPackRecord('admin', 'engineering_architecture', '1.2.0');
    const afterInstall = store1.listInstalledPacks('admin');
    assert.ok(afterInstall.some((p) => p.pack_id === 'engineering_architecture'));

    const updatedCore = store1.upsertAgentCore('admin', 'architect', {
      orchestration_mode: 'plan_critique_blueprint',
      max_steps: 14,
      daily_budget_usd: 18,
      soul_markdown: '# SOUL — Atlas Custom\nFoco absoluto em ADRs e C4.',
    });
    assert.equal(updatedCore.max_steps, 14);
    assert.equal(updatedCore.daily_budget_usd, 18);

    const soulFilePath = path.join(tempDir, 'workspaces', 'agent_architect', 'SOUL.md');
    assert.equal(fs.existsSync(soulFilePath), true);
    assert.ok(fs.readFileSync(soulFilePath, 'utf8').includes('Atlas Custom'));

    // Desinstalar todos os pacotes não deve re-semear o padrão ao reabrir
    store1.uninstallPackRecord('admin', 'creative_productivity');
    store1.uninstallPackRecord('admin', 'engineering_architecture');
    assert.equal(store1.listInstalledPacks('admin').length, 0);
    store1.close();

    const store2 = createLocalSqliteBrainStore({ dataDir: tempDir });
    assert.equal(store2.listInstalledPacks('admin').length, 0);
    const reloadedCore = store2.getAgentCore('admin', 'architect');
    assert.equal(reloadedCore.max_steps, 14);
    assert.equal(reloadedCore.orchestration_mode, 'plan_critique_blueprint');
    assert.ok(reloadedCore.soul_markdown.includes('Atlas Custom'));
    store2.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('LocalSqliteBrainStore persists custom_packs created in Dev/Admin Pack Studio across reopen', () => {
  const tempDir = makeTempDir('jarvis-custom-packs-');
  try {
    const store1 = createLocalSqliteBrainStore({ dataDir: tempDir });
    const saved = store1.upsertCustomPack('admin', {
      id: 'dados_analytics_pro',
      name: 'Pacote Dados & Analytics',
      tagline: 'SQL, BI e agentes de análise.',
      category: 'engineering',
      tabs: ['backend_studio', 'executive_report'],
      agents: [
        {
          role: 'data_analyst_custom',
          name: 'Analista de Dados & BI',
          proper_name: 'Lumen',
          handle: '@lumen',
          mission: 'Analisar métricas, KPIs e modelagem SQL.',
          preferred_model: 'gemini-2.5-flash',
        },
      ],
    });
    assert.equal(saved.id, 'dados_analytics_pro');
    assert.equal(saved.is_custom, true);
    store1.close();

    const store2 = createLocalSqliteBrainStore({ dataDir: tempDir });
    const listed = store2.listCustomPacks();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, 'Pacote Dados & Analytics');
    assert.deepEqual(listed[0].tabs, ['backend_studio', 'executive_report']);
    assert.equal(listed[0].agents[0].handle, '@lumen');

    assert.equal(store2.deleteCustomPack('admin', 'dados_analytics_pro'), true);
    assert.equal(store2.listCustomPacks().length, 0);
    store2.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('LocalSqliteBrainStore persists chat_sessions and chat_messages relationally and migrates legacy snapshots', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-chat-rel-'));
  try {
    const store1 = createLocalSqliteBrainStore({ dataDir: tempDir });
    store1.saveStateNamespace('chat_sessions', [
      [
        'sess_legacy_1',
        {
          session_id: 'sess_legacy_1',
          title: 'Conversa Legada',
          first_intent: 'standard',
          last_activity: '2026-11-25T10:00:00.000Z',
          messages: [
            { id: 1, role: 'user', content: 'Oi legado', created_at: '2026-11-25T10:00:00.000Z' },
            { id: 2, role: 'assistant', content: 'Resposta legada', created_at: '2026-11-25T10:00:01.000Z' },
          ],
        },
      ],
    ]);

    const migrated = store1.migrateLegacyChatSessionsSnapshotIfNeeded();
    assert.equal(migrated, 1);

    store1.upsertChatSessionRecord({ id: 'sess_rel_2', title: 'Nova Sessão SQLite', mode: 'standard' });
    store1.appendChatMessageRecord({
      id: 'msg_rel_u1',
      session_id: 'sess_rel_2',
      role: 'user',
      content: 'Olá banco relacional',
    });
    store1.close();

    const store2 = createLocalSqliteBrainStore({ dataDir: tempDir });
    const sessions = store2.listChatSessionsRelational();
    assert.equal(sessions.length, 2);
    const msgsLegacy = store2.getChatSessionMessagesRelational('sess_legacy_1');
    assert.equal(msgsLegacy.length, 2);
    assert.equal(msgsLegacy[0].content, 'Oi legado');
    const msgsRel = store2.getChatSessionMessagesRelational('sess_rel_2');
    assert.equal(msgsRel.length, 1);
    assert.equal(msgsRel[0].content, 'Olá banco relacional');

    assert.equal(store2.deleteChatSessionRecord('sess_legacy_1'), true);
    assert.equal(store2.getChatSessionMessagesRelational('sess_legacy_1').length, 0);
    store2.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('LocalSqliteBrainStore persiste auth_users e auth_sessions no SQLite (Fase 2)', () => {
  const tempDir = makeTempDir('jarvis-auth-sqlite-');
  try {
    const store1 = createLocalSqliteBrainStore({ dataDir: tempDir });

    // Upsert de usuário
    store1.upsertAuthUser({
      username: 'alice',
      display_name: 'Alice Silva',
      role: 'developer',
      is_active: true,
      must_change_password: false,
      salt: 'abc123salt',
      password_hash: 'fakehash',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    store1.upsertAuthUser({
      username: 'bob',
      display_name: 'Bob Costa',
      role: 'admin',
      is_active: true,
      must_change_password: false,
      salt: 'def456salt',
      password_hash: 'fakehash2',
      created_at: '2026-01-02T00:00:00.000Z',
    });

    // Upsert de sessão
    store1.upsertAuthSession({
      session_id: 'sess_alice_001',
      username: 'alice',
      role: 'developer',
      kind: 'human',
      created_at: Date.now(),
    });

    // Verificar getAuthUser
    const alice = store1.getAuthUser('alice');
    assert.ok(alice);
    assert.equal(alice.display_name, 'Alice Silva');
    assert.equal(alice.role, 'developer');

    // Verificar listAuthUsers
    const all = store1.listAuthUsers();
    assert.equal(all.length, 2);

    // Verificar getAuthSession (válida)
    const sess = store1.getAuthSession('sess_alice_001');
    assert.ok(sess);
    assert.equal(sess.username, 'alice');

    // Sessão expirada não deve ser retornada
    store1.upsertAuthSession({
      session_id: 'sess_expired',
      username: 'alice',
      role: 'developer',
      kind: 'human',
      created_at: Date.now() - 90_000_000, // 25h atrás
    });
    // A sessão expirada não deve ser retornada (expires_at já passou)
    // Nota: upsertAuthSession calcula expires_at = created_at + 86400000
    // Para uma sessão criada 25h atrás, expires_at < now, então getAuthSession retorna null
    const expiredSess = store1.getAuthSession('sess_expired');
    assert.equal(expiredSess, null);

    // purgeExpiredAuthSessions remove sessões expiradas
    const purged = store1.purgeExpiredAuthSessions();
    assert.ok(purged >= 1);

    // Reabrir o banco e verificar persistência
    store1.close();
    const store2 = createLocalSqliteBrainStore({ dataDir: tempDir });
    const aliceReopened = store2.getAuthUser('alice');
    assert.ok(aliceReopened);
    assert.equal(aliceReopened.display_name, 'Alice Silva');

    // deleteAuthUser também deleta sessões em cascata
    store2.deleteAuthUser('alice');
    assert.equal(store2.getAuthUser('alice'), null);
    assert.equal(store2.getAuthSession('sess_alice_001'), null);

    store2.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('LocalSqliteBrainStore auto-recovers when SQLite database file is corrupted by quarantining into backups/', () => {
  const tempDir = makeTempDir('jarvis-corrupt-recovery-');
  try {
    const dbPath = path.join(tempDir, 'brain.db');
    fs.writeFileSync(dbPath, Buffer.from('NOT_A_VALID_SQLITE_DATABASE_HEADER_00000000'));
    fs.writeFileSync(`${dbPath}-wal`, Buffer.from('CORRUPTED_WAL_BYTES'));

    const recovered = createLocalSqliteBrainStore({ dataDir: tempDir, brainName: 'Cérebro Recuperado' });
    const health = recovered.getDatabaseHealth();
    assert.equal(health.ok, true);
    assert.equal(recovered.getIdentity().name, 'Cérebro Recuperado');

    const backupEntries = fs.readdirSync(recovered.backupsDir);
    assert.ok(backupEntries.some((name) => name.startsWith('corrupted-db-') && name.endsWith('brain.db')));
    recovered.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('LocalSqliteBrainStore persists active auth_sessions, durable agent_runs/steps/artifacts, crash recovery, scheduled_jobs, and channel_bindings across reopen', () => {
  const tempDir = makeTempDir('jarvis-v3-durable-');
  try {
    const store1 = createLocalSqliteBrainStore({ dataDir: tempDir });
    store1.upsertAuthUser({
      username: 'admin',
      display_name: 'Admin Local',
      role: 'admin',
      is_active: true,
      must_change_password: false,
      salt: 'salt123',
      password_hash: 'hash123',
      created_at: new Date().toISOString(),
    });
    store1.upsertAuthSession({
      session_id: 'sess_persist_restart',
      username: 'admin',
      role: 'admin',
      kind: 'human',
      created_at: Date.now(),
    });

    const run = store1.createAgentRun({
      session_id: 'chat_sess_01',
      user_id: 'admin',
      agent_role: 'architect',
      agent_name: 'Atlas',
      prompt: 'Analisar arquitetura',
      status: 'running',
      model_used: 'gemini-2.5-flash',
    });
    store1.appendAgentRunStep({
      run_id: run.id,
      step_index: 1,
      kind: 'plan',
      title: 'Planejamento inicial',
      status: 'completed',
      duration_ms: 42,
      input_summary: 'Prompt recebido',
      output_summary: 'Plano em 3 etapas',
    });
    store1.recordRunArtifact({
      run_id: run.id,
      session_id: 'chat_sess_01',
      user_id: 'admin',
      title: 'arquitetura.md',
      kind: 'markdown',
      mime_type: 'text/markdown',
      storage_driver: 'local_confined',
      storage_key: 'admin/run/arquitetura.md',
      size_bytes: 128,
      sha256: 'abc123',
      preview_text: '# Arquitetura',
    });

    store1.upsertScheduledJob({
      user_id: 'admin',
      name: 'Digest Matinal',
      cron_expr: '0 9 * * *',
      target_type: 'agent_prompt',
      target_ref: 'Resumir tarefas pendentes',
      next_run_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    store1.upsertChannelBinding({
      user_id: 'admin',
      provider: 'telegram',
      label: 'Grupo Ops',
      external_chat_id: 'tg_991122',
      agent_role: 'jarvis_master',
      workspace_slug: 'default',
    });
    store1.close();

    // Reabre simulando reinício do servidor
    const store2 = createLocalSqliteBrainStore({ dataDir: tempDir });
    const activeSessions = store2.listActiveAuthSessions();
    assert.equal(activeSessions.length, 1);
    assert.equal(activeSessions[0].session_id, 'sess_persist_restart');

    const recoveredCount = store2.recoverInterruptedAgentRuns();
    assert.equal(recoveredCount, 1);
    const reloadedRun = store2.getAgentRun(run.id, 'admin');
    assert.ok(reloadedRun);
    assert.equal(reloadedRun.status, 'interrupted');
    assert.equal(store2.getAgentRun(run.id, 'other_user'), null);
    assert.equal(store2.listAgentRunSteps(run.id).length, 1);
    assert.equal(store2.listRunArtifacts(run.id, 'admin').length, 1);
    assert.equal(store2.listScheduledJobs('admin').length, 1);
    assert.equal(store2.listScheduledJobs('other_user').length, 0);
    assert.equal(store2.listChannelBindings('admin').length, 1);
    assert.equal(store2.findChannelBinding('telegram', 'tg_991122')?.user_id, 'admin');
    store2.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

