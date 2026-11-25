/**
 * Motor puro de verificação de versões e cálculo de atualizações
 * para Pacotes Modulares e Agentes do JARVIS AI Hub.
 *
 * Mantido sem dependências de I/O ou React para permitir testes unitários
 * determinísticos via `node:test` e reutilização entre backend e frontend.
 */

import type { ModulePackDefinition } from './modulePackEngine';

export interface PackRegistryReleaseMeta {
  latest_version: string;
  changelog: string;
  artifact_size_kb: number;
  checksum_sha256: string;
  cache_status: 'cached_local' | 'mirror_ready';
  released_at: string;
}

export interface PackageUpdateItem {
  pack_id: string;
  name: string;
  category_label: string;
  is_custom: boolean;
  installed: boolean;
  installed_version: string | null;
  latest_version: string;
  has_update: boolean;
  changelog: string;
  artifact_size_kb: number;
  checksum_sha256: string;
  cache_status: 'cached_local' | 'mirror_ready';
  installed_at: string | null;
  released_at: string;
}

export interface AgentUpdateItem {
  role: string;
  name: string;
  proper_name: string;
  handle: string;
  pack_id: string | null;
  current_version: string;
  current_version_num: number;
  latest_version: string;
  latest_version_num: number;
  has_update: boolean;
  reason: string;
  preferred_model: string;
  recommended_model: string;
  skills_count: number;
  cache_status: 'cached_local' | 'mirror_ready';
}

export interface VersionCheckSummary {
  total_packages: number;
  installed_packages: number;
  outdated_packages: number;
  total_agents: number;
  outdated_agents: number;
  total_updates_available: number;
  hub_current_version: string;
  hub_latest_version: string;
  hub_has_update: boolean;
  registry_mode: 'local_artifact_cache';
  checked_at: string;
}

export interface VersionCheckReport {
  summary: VersionCheckSummary;
  packages: PackageUpdateItem[];
  agents: AgentUpdateItem[];
}

export interface InstalledPackVersionRecord {
  pack_id: string;
  version: string;
  installed_at: string;
}

export interface AgentVersionInspectInput {
  role: string;
  name: string;
  proper_name?: string;
  handle?: string;
  template_id?: string;
  preferred_model: string;
  installed_skills?: string[];
  version?: number;
}

export const HUB_CURRENT_VERSION = '3.0.1';
export const HUB_LATEST_VERSION = '3.1.0';
export const TARGET_AGENT_RUNTIME_VERSION = 2;
export const RECOMMENDED_AGENT_MODEL = 'gemini-4-hydrogen';

const LEGACY_AGENT_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
]);

/**
 * Manifesto determinístico de releases mais recentes disponíveis no cache local de artefatos
 * para os pacotes oficiais do Hub.
 */
export const OFFICIAL_PACK_REGISTRY_RELEASES: Record<string, PackRegistryReleaseMeta> = {
  creative_productivity: {
    latest_version: '1.2.0',
    changelog:
      'Atualiza a agente Maya para gemini-4-hydrogen, otimiza templates de planilhas e pré-carrega presets MCP no cache local.',
    artifact_size_kb: 420,
    checksum_sha256: 'sha256:8f4c1a9e2b704d3fa6c8e1d9b2f5a7c0',
    cache_status: 'cached_local',
    released_at: '2026-11-20T12:00:00.000Z',
  },
  engineering_architecture: {
    latest_version: '1.3.0',
    changelog:
      'Atualiza Vetor e Lia para gemini-4-hydrogen e inclui contratos de cache de artefatos C4/ADR.',
    artifact_size_kb: 510,
    checksum_sha256: 'sha256:3a9d7e1c4b820f6da5e2c1b9f4a8d3e7',
    cache_status: 'cached_local',
    released_at: '2026-11-21T15:30:00.000Z',
  },
  fullstack_dev: {
    latest_version: '1.4.0',
    changelog:
      'Migra Dante e Nina para gemini-4-hydrogen e acelera templates IDE com cache local de dependências.',
    artifact_size_kb: 640,
    checksum_sha256: 'sha256:c7e2b5a19d403f8eb1a6d4c2f9e0a5b8',
    cache_status: 'cached_local',
    released_at: '2026-11-22T09:45:00.000Z',
  },
  security_soc: {
    latest_version: '1.2.0',
    changelog:
      'Adiciona verificação SHA-256 de artefatos e auditoria reforçada de atualizações no Sentinela.',
    artifact_size_kb: 380,
    checksum_sha256: 'sha256:5d1f8a3c6e942b7fa0c3e5d1b8a4f2c9',
    cache_status: 'cached_local',
    released_at: '2026-11-22T18:10:00.000Z',
  },
  voice_mobile_local: {
    latest_version: '1.1.0',
    changelog:
      'Otimiza sincronização SQLite WAL, suporte ao proxy local de pacotes Python/Go e pareamento LAN.',
    artifact_size_kb: 470,
    checksum_sha256: 'sha256:2b6e9c4a1f835d0ec7a2b4f6d9e1c3a5',
    cache_status: 'cached_local',
    released_at: '2026-11-23T11:20:00.000Z',
  },
};

export function parseSemverTuple(raw: string | null | undefined): [number, number, number] {
  const cleaned = String(raw || '0.0.0')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    .split('+')[0];
  const parts = cleaned.split('.').map((segment) => {
    const parsed = Number.parseInt(segment, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  });
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * Compara duas versões SemVer.
 * Retorna > 0 se `a > b`, < 0 se `a < b` e 0 se equivalentes.
 */
export function compareSemver(a: string | null | undefined, b: string | null | undefined): number {
  const [aMaj, aMin, aPat] = parseSemverTuple(a);
  const [bMaj, bMin, bPat] = parseSemverTuple(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

export function formatAgentSemver(versionNum: number | undefined): string {
  const safe = Number.isFinite(versionNum) && Number(versionNum) > 0 ? Math.floor(Number(versionNum)) : 1;
  return `${safe}.0.0`;
}

export function isLegacyAgentModel(model: string | null | undefined): boolean {
  const normalized = String(model || '').trim().toLowerCase();
  return LEGACY_AGENT_MODELS.has(normalized);
}

export function resolvePackLatestRelease(pack: ModulePackDefinition): PackRegistryReleaseMeta {
  const official = OFFICIAL_PACK_REGISTRY_RELEASES[pack.id];
  if (official && !pack.is_custom) {
    const latest =
      compareSemver(official.latest_version, pack.version) >= 0
        ? official.latest_version
        : pack.version;
    return {
      ...official,
      latest_version: latest,
    };
  }

  return {
    latest_version: pack.version || '1.0.0',
    changelog: `Definição publicada no Estúdio de Pacotes (v${pack.version || '1.0.0'}).`,
    artifact_size_kb: Math.max(96, 120 + pack.agents.length * 48 + pack.study_tracks.length * 32),
    checksum_sha256: `sha256:custom_${pack.id.slice(0, 12)}_${String(pack.version || '1.0.0').replace(/[^a-z0-9]/gi, '')}`,
    cache_status: 'cached_local',
    released_at: new Date().toISOString(),
  };
}

export function extractPackIdFromTemplate(templateId?: string): string | null {
  if (!templateId || !templateId.startsWith('pack:')) return null;
  const id = templateId.slice(5).trim();
  return id || null;
}

/**
 * Calcula o relatório completo de versões e atualizações pendentes para
 * todos os pacotes (oficiais e personalizados) e agentes ativos.
 */
export function buildVersionCheckReport(input: {
  catalog: readonly ModulePackDefinition[];
  installedRecords: readonly InstalledPackVersionRecord[];
  agents: readonly AgentVersionInspectInput[];
  hubCurrentVersion?: string;
  hubLatestVersion?: string;
  checkedAt?: string;
}): VersionCheckReport {
  const checkedAt = input.checkedAt || new Date().toISOString();
  const installedMap = new Map(input.installedRecords.map((r) => [r.pack_id, r]));

  const packages: PackageUpdateItem[] = input.catalog.map((pack) => {
    const installedRec = installedMap.get(pack.id);
    const release = resolvePackLatestRelease(pack);
    const installed = Boolean(installedRec);
    const installedVersion = installedRec ? installedRec.version || '1.0.0' : null;
    const hasUpdate = installed && compareSemver(release.latest_version, installedVersion) > 0;

    return {
      pack_id: pack.id,
      name: pack.name,
      category_label: pack.category_label,
      is_custom: Boolean(pack.is_custom),
      installed,
      installed_version: installedVersion,
      latest_version: release.latest_version,
      has_update: hasUpdate,
      changelog: release.changelog,
      artifact_size_kb: release.artifact_size_kb,
      checksum_sha256: release.checksum_sha256,
      cache_status: release.cache_status,
      installed_at: installedRec?.installed_at || null,
      released_at: release.released_at,
    };
  });

  // Ordena: com update primeiro, depois instalados, depois demais
  packages.sort((a, b) => {
    if (a.has_update !== b.has_update) return a.has_update ? -1 : 1;
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const agents: AgentUpdateItem[] = input.agents.map((ag) => {
    const currentNum =
      Number.isFinite(ag.version) && Number(ag.version) > 0 ? Math.floor(Number(ag.version)) : 1;
    const legacyModel = isLegacyAgentModel(ag.preferred_model);
    const belowTargetRuntime = currentNum < TARGET_AGENT_RUNTIME_VERSION;
    const hasUpdate = belowTargetRuntime || legacyModel;
    const latestNum = hasUpdate
      ? Math.max(TARGET_AGENT_RUNTIME_VERSION, currentNum + (legacyModel && !belowTargetRuntime ? 1 : 0))
      : currentNum;
    const recommendedModel = legacyModel ? RECOMMENDED_AGENT_MODEL : ag.preferred_model;

    let reason = 'Agente sincronizado com o runtime mais recente.';
    if (belowTargetRuntime && legacyModel) {
      reason = `Atualização de runtime (v${currentNum}.0.0 → v${latestNum}.0.0) e migração do modelo ${ag.preferred_model} → ${RECOMMENDED_AGENT_MODEL}.`;
    } else if (legacyModel) {
      reason = `Migração recomendada de modelo legado (${ag.preferred_model} → ${RECOMMENDED_AGENT_MODEL}).`;
    } else if (belowTargetRuntime) {
      reason = `Nova revisão de núcleo, skills e políticas de contexto (v${currentNum}.0.0 → v${latestNum}.0.0).`;
    }

    return {
      role: ag.role,
      name: ag.name,
      proper_name: ag.proper_name || ag.name,
      handle: ag.handle || `@${ag.role}`,
      pack_id: extractPackIdFromTemplate(ag.template_id),
      current_version: formatAgentSemver(currentNum),
      current_version_num: currentNum,
      latest_version: formatAgentSemver(latestNum),
      latest_version_num: latestNum,
      has_update: hasUpdate,
      reason,
      preferred_model: ag.preferred_model,
      recommended_model: recommendedModel,
      skills_count: Array.isArray(ag.installed_skills) ? ag.installed_skills.length : 0,
      cache_status: 'cached_local',
    };
  });

  agents.sort((a, b) => {
    if (a.has_update !== b.has_update) return a.has_update ? -1 : 1;
    return a.proper_name.localeCompare(b.proper_name);
  });

  const outdatedPackages = packages.filter((p) => p.has_update).length;
  const outdatedAgents = agents.filter((a) => a.has_update).length;
  const hubCurrent = input.hubCurrentVersion || HUB_CURRENT_VERSION;
  const hubLatest = input.hubLatestVersion || HUB_LATEST_VERSION;

  return {
    summary: {
      total_packages: packages.length,
      installed_packages: packages.filter((p) => p.installed).length,
      outdated_packages: outdatedPackages,
      total_agents: agents.length,
      outdated_agents: outdatedAgents,
      total_updates_available: outdatedPackages + outdatedAgents,
      hub_current_version: hubCurrent,
      hub_latest_version: hubLatest,
      hub_has_update: compareSemver(hubLatest, hubCurrent) > 0,
      registry_mode: 'local_artifact_cache',
      checked_at: checkedAt,
    },
    packages,
    agents,
  };
}
