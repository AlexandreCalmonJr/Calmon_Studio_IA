/**
 * Cliente API da Fase 8 — Gerenciador Multi-Cérebros, Saúde, Migração .jarvis-pack e Pacote Dual-Mode.
 */
import { apiFetch } from '../sessionTransport';
import { API_BASE } from './client';
import type {
  BrainConnectionProfile,
  BrainDeploymentOptions,
  BrainMode,
  GeneratedServerArtifact,
  JarvisBrainPack,
} from '../brainArchitectureEngine';

export interface BrainInfoResponse {
  brain_id: string;
  name: string;
  version: string;
  schema_version?: string;
  mode: BrainMode;
  database_engine: string;
  storage_path: string;
  db_size_bytes?: number;
  journal_mode?: string;
  backups_count?: number;
  mdns_service: string;
  active_profile_id: string;
  uptime_seconds: number;
  services: {
    database: 'online' | 'offline';
    gemini_cloud: 'configured' | 'standby';
    ollama_local: 'detected' | 'optional';
    redis_queue: 'online' | 'local_scheduler';
  };
  counts: {
    agents: number;
    skills: number;
    workflows: number;
    knowledge: number;
    sessions: number;
    paired_devices: number;
  };
}

export interface BrainSchemaResponse {
  mode: BrainMode;
  schema_version: string;
  storage_path: string;
  journal_mode: string;
  db_size_bytes: number;
  tables: Array<{ table: string; rows: number }>;
}

export interface BrainBackupItem {
  filename: string;
  path: string;
  size_bytes: number;
  created_at: string;
}

export interface BrainProfilesResponse {
  activeProfileId: string;
  profiles: BrainConnectionProfile[];
}

export async function fetchBrainInfoApi(): Promise<BrainInfoResponse> {
  const res = await apiFetch(`${API_BASE}/brain/info`);
  if (!res.ok) throw new Error('Falha ao consultar informações do Cérebro ativo.');
  return res.json();
}

export async function fetchBrainProfilesApi(): Promise<BrainProfilesResponse> {
  const res = await apiFetch(`${API_BASE}/brain/profiles`);
  if (!res.ok) throw new Error('Falha ao listar Cérebros conectados.');
  return res.json();
}

export async function addBrainProfileApi(input: {
  name: string;
  baseUrl: string;
  mode: BrainMode;
  description?: string;
}): Promise<BrainProfilesResponse & { created: BrainConnectionProfile }> {
  const res = await apiFetch(`${API_BASE}/brain/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Não foi possível cadastrar este Cérebro.');
  return data;
}

export async function activateBrainProfileApi(id: string): Promise<BrainProfilesResponse & { active: BrainConnectionProfile }> {
  const res = await apiFetch(`${API_BASE}/brain/profiles/${encodeURIComponent(id)}/activate`, {
    method: 'POST',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Não foi possível alternar o Cérebro ativo.');
  return data;
}

export async function pingBrainProfileApi(id: string): Promise<{
  profile: BrainConnectionProfile;
  profiles: BrainConnectionProfile[];
  detail: string;
}> {
  const res = await apiFetch(`${API_BASE}/brain/profiles/${encodeURIComponent(id)}/ping`, {
    method: 'POST',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Não foi possível testar a conexão com este Cérebro.');
  return data;
}

export async function removeBrainProfileApi(id: string): Promise<BrainProfilesResponse> {
  const res = await apiFetch(`${API_BASE}/brain/profiles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Não foi possível remover este Cérebro.');
  return data;
}

export async function exportBrainPackApi(): Promise<JarvisBrainPack> {
  const res = await apiFetch(`${API_BASE}/brain/export`, {
    method: 'POST',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Falha ao exportar o pacote .jarvis-pack.');
  return data;
}

export async function importBrainPackApi(pack: unknown): Promise<{
  imported: { agents: number; skills: number; workflows: number; knowledge: number };
  message: string;
}> {
  const res = await apiFetch(`${API_BASE}/brain/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pack),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Falha ao importar o pacote .jarvis-pack.');
  return data;
}

export async function fetchBrainSchemaApi(): Promise<BrainSchemaResponse> {
  const res = await apiFetch(`${API_BASE}/brain/schema`);
  if (!res.ok) throw new Error('Falha ao consultar tabelas do banco SQLite.');
  return res.json();
}

export async function createSqliteBackupApi(): Promise<{
  backup: BrainBackupItem;
  backups: BrainBackupItem[];
  message: string;
}> {
  const res = await apiFetch(`${API_BASE}/brain/backup`, {
    method: 'POST',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Falha ao gerar backup SQLite.');
  return data;
}

export async function previewDualModeBundleApi(options: Partial<BrainDeploymentOptions>): Promise<{
  options: BrainDeploymentOptions;
  files: GeneratedServerArtifact[];
  zip_size_bytes: number;
  filename: string;
}> {
  const res = await apiFetch(`${API_BASE}/brain/bundle/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Não foi possível montar a prévia do servidor Dual-Mode.');
  return data;
}

export async function downloadDualModeBundleZipApi(options: Partial<BrainDeploymentOptions>): Promise<void> {
  const res = await apiFetch(`${API_BASE}/brain/bundle.zip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Falha ao baixar o pacote do servidor Dual-Mode.');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] || 'jarvis-brain-server.zip';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
