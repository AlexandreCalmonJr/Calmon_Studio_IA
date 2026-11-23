import { API_BASE, handleApiResponse } from './client';
import { apiFetch } from '../sessionTransport';
import type {
  AgentCoreConfig,
  AgentCorePatch,
  AgentCoreReadiness,
} from '../agentCoreEngine';
import type {
  CustomPackDraftInput,
  InstalledPackSummary,
  ModulePackDefinition,
  ModulePackWithState,
} from '../modulePackEngine';
import type { ProjectArchitectureReport } from '../../../server/architectureAnalyzer';

export type { ProjectArchitectureReport };

export interface ModulePacksPayload {
  packs: ModulePackWithState[];
  custom_packs?: ModulePackDefinition[];
  installed_pack_ids: string[];
  unlocked_tabs: string[];
  summary: InstalledPackSummary;
  pack_id?: string;
  installed?: boolean;
  provisioned_agents?: string[];
  pack?: ModulePackDefinition;
  deleted_pack_id?: string;
}

export interface AgentCoreEnvelope {
  core: AgentCoreConfig;
  readiness: AgentCoreReadiness;
}

export const PACKS_UPDATED_EVENT = 'jarvis:packs-updated';

function broadcastPacksUpdated(payload: ModulePacksPayload): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ModulePacksPayload>(PACKS_UPDATED_EVENT, { detail: payload }));
}

export async function fetchModulePacks(): Promise<ModulePacksPayload> {
  const res = await apiFetch(`${API_BASE}/packs`);
  return handleApiResponse<ModulePacksPayload>(res, 'Falha ao carregar os pacotes modulares.');
}

export async function installModulePack(packId: string): Promise<ModulePacksPayload> {
  const res = await apiFetch(`${API_BASE}/packs/${encodeURIComponent(packId)}/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await handleApiResponse<ModulePacksPayload>(
    res,
    'Falha ao instalar o pacote modular.'
  );
  broadcastPacksUpdated(data);
  return data;
}

export async function uninstallModulePack(packId: string): Promise<ModulePacksPayload> {
  const res = await apiFetch(`${API_BASE}/packs/${encodeURIComponent(packId)}`, {
    method: 'DELETE',
  });
  const data = await handleApiResponse<ModulePacksPayload>(
    res,
    'Falha ao remover o pacote modular.'
  );
  broadcastPacksUpdated(data);
  return data;
}

export async function fetchAdminCustomPacks(): Promise<{
  custom_packs: ModulePackDefinition[];
  official_pack_ids: string[];
}> {
  const res = await apiFetch(`${API_BASE}/admin/packs`);
  return handleApiResponse<{
    custom_packs: ModulePackDefinition[];
    official_pack_ids: string[];
  }>(res, 'Falha ao carregar pacotes personalizados do Estúdio.');
}

export async function saveAdminCustomPack(
  input: CustomPackDraftInput,
  existingPackId?: string | null
): Promise<ModulePacksPayload> {
  const isUpdate = Boolean(existingPackId);
  const url = isUpdate
    ? `${API_BASE}/admin/packs/${encodeURIComponent(existingPackId!)}`
    : `${API_BASE}/admin/packs`;
  const res = await apiFetch(url, {
    method: isUpdate ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await handleApiResponse<ModulePacksPayload>(
    res,
    'Falha ao salvar pacote personalizado.'
  );
  broadcastPacksUpdated(data);
  return data;
}

export async function deleteAdminCustomPack(packId: string): Promise<ModulePacksPayload> {
  const res = await apiFetch(`${API_BASE}/admin/packs/${encodeURIComponent(packId)}`, {
    method: 'DELETE',
  });
  const data = await handleApiResponse<ModulePacksPayload>(
    res,
    'Falha ao excluir pacote personalizado.'
  );
  broadcastPacksUpdated(data);
  return data;
}

export async function fetchArchitectureAnalysis(): Promise<ProjectArchitectureReport> {
  const res = await apiFetch(`${API_BASE}/architecture/analyze`);
  return handleApiResponse<ProjectArchitectureReport>(
    res,
    'Falha ao executar a análise de arquitetura do projeto.'
  );
}

export async function fetchAllAgentCores(): Promise<AgentCoreEnvelope[]> {
  const res = await apiFetch(`${API_BASE}/agents/cores`);
  const data = await handleApiResponse<{ cores: AgentCoreEnvelope[] }>(
    res,
    'Falha ao carregar os núcleos individuais dos agentes.'
  );
  return data.cores || [];
}

export async function fetchAgentCore(role: string): Promise<AgentCoreEnvelope> {
  const res = await apiFetch(`${API_BASE}/agents/${encodeURIComponent(role)}/core`);
  return handleApiResponse<AgentCoreEnvelope>(
    res,
    'Falha ao carregar o núcleo individual do agente.'
  );
}

export async function saveAgentCore(
  role: string,
  patch: AgentCorePatch
): Promise<AgentCoreEnvelope> {
  const res = await apiFetch(`${API_BASE}/agents/${encodeURIComponent(role)}/core`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return handleApiResponse<AgentCoreEnvelope>(
    res,
    'Falha ao salvar o núcleo individual do agente.'
  );
}
