/**
 * Tipos e interfaces compartilhados pelo estado do servidor (serverState).
 */
import type { ThreatScanResult, ThreatSeverity } from '../../src/services/sentinelSecurity.ts';

export interface UserAccount {
  username: string;
  display_name: string;
  role: 'admin' | 'developer' | 'auditor';
  is_active: boolean;
  must_change_password: boolean;
  salt: string;
  password_hash: string;
  created_at: string;
}

export interface SessionRecord {
  session_id: string;
  username: string;
  role: 'admin' | 'developer' | 'auditor';
  kind: 'human' | 'service';
  created_at: number;
}

export interface RealTelemetryRecord {
  id: string;
  task_id: string;
  agent_role: string;
  model_name: string;
  provider: string;
  status: string;
  duration_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  feedback_rating?: number;
  created_at: string;
}

export interface AgentServerRecord {
  role: string;
  name: string;
  proper_name: string;
  handle: string;
  category: string;
  mission: string;
  description?: string;
  preferred_model: string;
  routing_policy: 'auto_hybrid' | 'local_only' | 'online_only';
  autonomy_level: 'read_only' | 'ask_approval' | 'autonomous';
  is_read_only: boolean;
  strict_focus: boolean;
  strict_topic: string;
  delegation_targets: string[];
  allowed_tools: string[];
  system_prompt: string;
  mascot: { id: string; color: string; accessory: string; mood: string };
  is_custom?: boolean;
  template_id?: string;
  installed_skills?: string[];
  version: number;
  updated_at: string;
}

export interface StoredChatSession {
  session_id: string;
  title: string;
  first_prompt: string;
  first_intent: string;
  last_activity: string;
  messages: Array<{
    id: number;
    session_id: string;
    project_id?: string | null;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
  }>;
  tasks: Array<Record<string, unknown>>;
}

export interface IdeWorkspaceFileServer {
  path: string;
  language: string;
  content: string;
  protected?: boolean;
  updated_at: string;
}

export interface IdeCheckpointServer {
  id: string;
  file_path: string;
  label: string;
  agent_name: string;
  previous_content: string;
  new_content: string;
  created_at: string;
}

export interface SentinelIncidentServer {
  id: string;
  severity: ThreatSeverity;
  category: ThreatScanResult['category'];
  title: string;
  description: string;
  source: string;
  indicators: string[];
  status: 'open' | 'mitigated' | 'quarantined';
  playbook_applied?: string;
  created_at: string;
}

export interface PushNotificationServerItem {
  id: string;
  channel: 'task_completed' | 'assistant_message' | 'sentinel_alert' | 'approval_required';
  title: string;
  body: string;
  delivered_via: string[];
  created_at: string;
}

export interface CompanionDeviceServer {
  id: string;
  name: string;
  owner: string;
  platform: string;
  status: 'online' | 'standby' | 'offline';
  cpu_percent: number;
  ram_percent: number;
  ram_total_gb: number;
  gpu_name: string;
  vram_gb: number;
  ollama_online: boolean;
  ollama_models: string[];
  vault_locked: boolean;
  last_heartbeat: string;
}

export interface RemoteCommandServer {
  id: string;
  device_id: string;
  device_name: string;
  command: string;
  source: 'mobile_pwa' | 'voice_hud' | 'offline_sync';
  status: 'pending_approval' | 'executed' | 'rejected';
  requires_approval: boolean;
  output?: string;
  created_at: string;
  updated_at: string;
}

export interface MockEndpointRecord {
  id: string;
  name: string;
  method: string;
  path: string;
  status_code: number;
  latency_ms: number;
  response_body: unknown;
  enabled: boolean;
  created_at: string;
}
