/**
 * Fase 8 — Modelos de Dados e DDL SQLite WAL do Servidor "Cérebro" (modo local_sqlite).
 *
 * Define o contrato tipado das tabelas unificadas (compatíveis com SQLite local e PostgreSQL Docker)
 * para sustentar Hub Web, Desktop e App Mobile Android em uma estrutura Node.js/TypeScript.
 */

import type { BrainMode } from '../../src/services/brainArchitectureEngine.ts';

export interface BrainIdentityModel {
  id: string;
  name: string;
  mode: BrainMode;
  schema_version: string;
  database_engine: string;
  assistant_name: string;
  mdns_service: string;
  created_at: string;
  updated_at: string;
}

export interface BrainProfileModel {
  id: string;
  name: string;
  base_url: string;
  mode: BrainMode;
  database_engine: string;
  description: string;
  is_default: number;
  is_local_current: number;
  is_active: number;
  status: 'online' | 'offline' | 'checking';
  latency_ms: number | null;
  last_checked_at: string | null;
  capabilities_json: string;
  version: string;
  created_at: string;
  updated_at: string;
}

export interface PairedDeviceModel {
  id: string;
  name: string;
  platform: 'android' | 'desktop' | 'web';
  model: string;
  os_version: string;
  status: 'online' | 'offline';
  token_hint: string;
  paired_at: string;
  last_seen: string;
  revoked_at: string | null;
}

export interface AgentModel {
  role: string;
  name: string;
  handle: string;
  description: string;
  system_prompt: string;
  preferred_model: string;
  autonomy_level: string;
  is_custom: number;
  installed_skills_json: string;
  version: number;
  updated_at: string;
}

export interface SkillModel {
  id: string;
  name: string;
  origin: string;
  domain: string;
  description: string;
  instructions: string;
  is_approved: number;
  updated_at: string;
}

export interface WorkflowModel {
  id: string;
  title: string;
  description: string;
  schedule_cron: string | null;
  schedule_enabled: number;
  nodes_json: string;
  edges_json: string;
  updated_at: string;
}

export interface KnowledgeDocumentModel {
  name: string;
  category: string;
  file_type: string;
  content: string;
  chunks: number;
  size_bytes: number;
  indexed_at: string;
}

export interface AuditLogModel {
  id: string;
  action: string;
  actor: string;
  resource: string;
  detail: string;
  created_at: string;
}

export interface BrainBackupRecord {
  filename: string;
  path: string;
  size_bytes: number;
  created_at: string;
}

export interface SqliteTableStats {
  table: string;
  rows: number;
}

export const BRAIN_SCHEMA_VERSION = '1.0.0';

export const SQLITE_SCHEMA_DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS brain_identity (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'local_sqlite',
  schema_version TEXT NOT NULL DEFAULT '${BRAIN_SCHEMA_VERSION}',
  database_engine TEXT NOT NULL DEFAULT 'SQLite WAL (node:sqlite)',
  assistant_name TEXT NOT NULL DEFAULT 'JARVIS',
  mdns_service TEXT NOT NULL DEFAULT '_jarvis-brain._tcp.local',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brain_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'local_sqlite',
  database_engine TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  is_local_current INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'offline',
  latency_ms INTEGER,
  last_checked_at TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  version TEXT NOT NULL DEFAULT '3.8.0',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paired_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  model TEXT NOT NULL DEFAULT 'Android',
  os_version TEXT NOT NULL DEFAULT 'Android 15',
  status TEXT NOT NULL DEFAULT 'online',
  token_hint TEXT NOT NULL,
  paired_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS agents (
  role TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  preferred_model TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
  autonomy_level TEXT NOT NULL DEFAULT 'confirm',
  is_custom INTEGER NOT NULL DEFAULT 0,
  installed_skills_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'system',
  domain TEXT NOT NULL DEFAULT 'geral',
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  is_approved INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_skills (
  agent_role TEXT NOT NULL REFERENCES agents(role) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL,
  PRIMARY KEY (agent_role, skill_id)
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'admin',
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'standard',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  agent_role TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  name TEXT PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'geral',
  file_type TEXT NOT NULL DEFAULT 'md',
  content TEXT NOT NULL,
  chunks INTEGER NOT NULL DEFAULT 1,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  indexed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  schedule_cron TEXT,
  schedule_enabled INTEGER NOT NULL DEFAULT 0,
  nodes_json TEXT NOT NULL DEFAULT '[]',
  edges_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'completed',
  output_summary TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  resource TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
`;

export const CORE_SQLITE_TABLES = [
  'brain_identity',
  'brain_profiles',
  'paired_devices',
  'agents',
  'skills',
  'agent_skills',
  'chat_sessions',
  'chat_messages',
  'knowledge_documents',
  'workflows',
  'workflow_runs',
  'audit_logs',
] as const;
