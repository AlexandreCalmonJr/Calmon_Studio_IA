/**
 * Prioridade 3 — Registro Unificado de Infraestrutura Plugável do Servidor.
 *
 * Garante que `chatRouter`, `brainRouter`, `DurableRunEngine` e `agentToolLoop`
 * compartilhem exatamente as mesmas instâncias vivas de:
 *  - Repositório Dual (SQLite WAL + PostgreSQL/pgvector)
 *  - Object Storage (Disco Local Confinado + S3/MinIO/GCS SigV4)
 *  - Fila Durável (SQLite + Redis RESP2)
 *  - Sandbox Plugável (Local Confinado + Docker Linux Efêmero)
 *  - Supervisor de Runtime MCP (JSON-RPC 2.0 HTTP + stdio)
 */

import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import { createHubRepositoryAdapter, type HubRepositoryAdapter } from './databaseAdapter.ts';
import { createArtifactStorageAdapter, type ArtifactStorageAdapter } from './storageAdapter.ts';
import { createDurableQueueAdapter, type DurableQueueAdapter } from './queueAdapter.ts';
import { createPluggableSandboxRunner, type PluggableSandboxRunner } from './sandboxRunner.ts';
import { createMcpRuntimeSupervisor, type McpRuntimeSupervisor } from './mcpSupervisor.ts';

export interface HubInfraRegistry {
  dbAdapter: HubRepositoryAdapter;
  storageAdapter: ArtifactStorageAdapter;
  durableQueue: DurableQueueAdapter;
  sandboxRunner: PluggableSandboxRunner;
  mcpSupervisor: McpRuntimeSupervisor;
}

export function createHubInfraRegistry(
  store: LocalSqliteBrainStore,
  env: NodeJS.ProcessEnv = process.env
): HubInfraRegistry {
  return {
    dbAdapter: createHubRepositoryAdapter(store, env),
    storageAdapter: createArtifactStorageAdapter(store.dataDir, env),
    durableQueue: createDurableQueueAdapter(store, env),
    sandboxRunner: createPluggableSandboxRunner(store, store.dataDir, env),
    mcpSupervisor: createMcpRuntimeSupervisor(store),
  };
}
