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
    assert.equal(tables.length, 24);
    assert.ok(tables.some((t) => t.table === 'brain_identity' && t.rows === 1));
    assert.ok(tables.some((t) => t.table === 'brain_profiles' && t.rows === 3));
    assert.ok(tables.some((t) => t.table === 'agent_workspaces' && t.rows === 1));
    assert.ok(tables.some((t) => t.table === 'mcp_servers' && t.rows === 2));
    assert.ok(tables.some((t) => t.table === 'provider_vault_keys'));
    assert.ok(tables.some((t) => t.table === 'installed_packs'));
    assert.ok(tables.some((t) => t.table === 'agent_cores'));
    assert.ok(tables.some((t) => t.table === 'custom_packs'));

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


