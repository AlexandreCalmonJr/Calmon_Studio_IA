import type { ModulePackCategory, ModulePackWithState } from './modulePackEngine';
import type { SkillInfo } from '../types';

export type UnifiedStoreSection = 'packs' | 'skills' | 'templates' | 'apps';

export interface UnifiedStoreSummary {
  totalPacks: number;
  installedPacks: number;
  totalSkills: number;
  activeSkills: number;
  totalTemplates: number;
  connectedApps: number;
  totalCatalogItems: number;
}

export type SkillCategoryFilter = 'all' | 'arch' | 'sec' | 'qa' | 'custom';
export type SkillStatusFilter = 'all' | 'active' | 'inactive';

export function isSkillActive(skill: SkillInfo): boolean {
  return Boolean(skill.is_approved) && !skill.is_revoked;
}

export function isCustomSkill(skill: SkillInfo): boolean {
  return (
    skill.origin === 'user_created' ||
    skill.origin === 'imported_ecc' ||
    (skill.id || '').startsWith('user_')
  );
}

export function computeUnifiedStoreSummary(params: {
  packs: ModulePackWithState[];
  skills: SkillInfo[];
  templatesCount: number;
  connectedAppsCount: number;
  totalAppsCount: number;
}): UnifiedStoreSummary {
  const totalPacks = params.packs.length;
  const installedPacks = params.packs.filter((p) => p.installed).length;
  const totalSkills = params.skills.length;
  const activeSkills = params.skills.filter(isSkillActive).length;

  return {
    totalPacks,
    installedPacks,
    totalSkills,
    activeSkills,
    totalTemplates: params.templatesCount,
    connectedApps: params.connectedAppsCount,
    totalCatalogItems: totalPacks + totalSkills + params.templatesCount + params.totalAppsCount,
  };
}

export function classifySkillBucket(skill: SkillInfo): Exclude<SkillCategoryFilter, 'all'> {
  const id = (skill.id || '').toLowerCase();
  const domain = (skill.domain || '').toLowerCase();
  if (isCustomSkill(skill)) return 'custom';
  if (id.includes('sec') || id.includes('audit') || domain.includes('segur') || domain.includes('sec')) {
    return 'sec';
  }
  if (id.includes('qa') || id.includes('test') || domain.includes('qual') || domain.includes('test')) {
    return 'qa';
  }
  return 'arch';
}

export function filterStoreSkills(
  skills: SkillInfo[],
  options: {
    search: string;
    category: SkillCategoryFilter;
    status: SkillStatusFilter;
  }
): SkillInfo[] {
  const q = options.search.trim().toLowerCase();
  return skills.filter((skill) => {
    const active = isSkillActive(skill);
    if (options.status === 'active' && !active) return false;
    if (options.status === 'inactive' && active) return false;
    if (options.category !== 'all' && classifySkillBucket(skill) !== options.category) {
      return false;
    }
    if (!q) return true;
    const haystack = [
      skill.id,
      skill.name,
      skill.description,
      skill.domain || '',
      ...(skill.assigned_agents || []),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function countStoreSkillsByCategory(
  skills: SkillInfo[]
): Record<SkillCategoryFilter, number> {
  const counts: Record<SkillCategoryFilter, number> = {
    all: skills.length,
    arch: 0,
    sec: 0,
    qa: 0,
    custom: 0,
  };
  for (const skill of skills) {
    const bucket = classifySkillBucket(skill);
    counts[bucket] += 1;
  }
  return counts;
}

export type PackStoreFilter = 'all' | 'installed' | 'custom' | ModulePackCategory;

export function countPacksByFilter(
  packs: ModulePackWithState[]
): Record<PackStoreFilter, number> {
  const counts: Record<PackStoreFilter, number> = {
    all: packs.length,
    installed: 0,
    custom: 0,
    engineering: 0,
    development: 0,
    security: 0,
    productivity: 0,
    infrastructure: 0,
  };
  for (const pack of packs) {
    if (pack.installed) counts.installed += 1;
    if (pack.is_custom) counts.custom += 1;
    if (pack.category in counts) {
      counts[pack.category] += 1;
    }
  }
  return counts;
}

export function sanitizeUnifiedStoreSection(raw?: string | null): UnifiedStoreSection {
  if (raw === 'packs' || raw === 'skills' || raw === 'templates' || raw === 'apps') {
    return raw;
  }
  return 'packs';
}
