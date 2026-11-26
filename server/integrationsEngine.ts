import {
  FigmaDesignTokenPack,
  parseFigmaFileKey,
  parseGitHubSkillInput,
  parseSkillMarkdown,
} from '../src/services/integrationsCatalog';

export interface GitHubSkillCandidate {
  name: string;
  path: string;
}

export interface GitHubInspectionResult {
  owner: string;
  repo: string;
  full_name: string;
  description: string;
  default_branch: string;
  stars: number;
  language: string;
  files: Array<{ name: string; path: string; type: string; size?: number }>;
  skill_md_content: string | null;
  has_skill_md: boolean;
  selected_skill_name?: string;
  selected_skill_path?: string;
  available_skills?: GitHubSkillCandidate[];
  readme_excerpt: string;
  synced_live: boolean;
}

function extractSkillNameFromPath(skillPath: string, repoName: string): string {
  const parts = skillPath.split('/').filter(Boolean);
  if (parts.length <= 1) return repoName;
  return parts[parts.length - 2] || repoName;
}

export async function inspectGitHubRepository(
  repoInput: string,
  token?: string,
  explicitSkillName?: string
): Promise<GitHubInspectionResult> {
  const parsed = parseGitHubSkillInput(repoInput, explicitSkillName);
  if (!parsed) {
    throw new Error('Informe um repositório válido (owner/repo, URL do GitHub ou comando npx skills add).');
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'jarvis-ai-hub',
  };
  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const repoRes = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!repoRes.ok) {
      throw new Error(`GitHub respondeu HTTP ${repoRes.status}`);
    }

    const repoJson: any = await repoRes.json();

    let files: Array<{ name: string; path: string; type: string; size?: number }> = [];
    let skillMdContent: string | null = null;
    let selectedSkillName: string | undefined = parsed.skillName;
    let selectedSkillPath: string | undefined;
    let availableSkills: GitHubSkillCandidate[] = [];
    let readmeExcerpt = repoJson.description || '';
    const defaultBranch = String(repoJson.default_branch || 'main');

    try {
      const treeRes = await fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents`,
        { headers }
      );
      if (treeRes.ok) {
        const treeJson: any = await treeRes.json();
        if (Array.isArray(treeJson)) {
          files = treeJson.slice(0, 24).map((entry: any) => ({
            name: String(entry.name || ''),
            path: String(entry.path || ''),
            type: String(entry.type || 'file'),
            size: typeof entry.size === 'number' ? entry.size : undefined,
          }));

          const skillFile = treeJson.find(
            (e: any) => typeof e.name === 'string' && e.name.toLowerCase() === 'skill.md'
          );
          if (skillFile?.download_url && !parsed.skillName) {
            const rawRes = await fetch(skillFile.download_url);
            if (rawRes.ok) {
              skillMdContent = (await rawRes.text()).slice(0, 12000);
              selectedSkillPath = String(skillFile.path || 'SKILL.md');
            }
          }

          const readmeFile = treeJson.find(
            (e: any) => typeof e.name === 'string' && e.name.toLowerCase().startsWith('readme')
          );
          if (readmeFile?.download_url) {
            const rawRes = await fetch(readmeFile.download_url);
            if (rawRes.ok) {
              readmeExcerpt = (await rawRes.text()).slice(0, 1400);
            }
          }
        }
      }
    } catch {
      // Contents lookup is optional
    }

    // Descobre múltiplas skills em subpastas (ex.: skills/rag-blueprint/SKILL.md)
    try {
      const recursiveRes = await fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`,
        { headers }
      );
      if (recursiveRes.ok) {
        const recursiveJson: any = await recursiveRes.json();
        if (Array.isArray(recursiveJson?.tree)) {
          const skillPaths: string[] = recursiveJson.tree
            .filter((node: any) => node?.type === 'blob' && typeof node?.path === 'string' && /(^|\/)skill\.md$/i.test(node.path))
            .map((node: any) => String(node.path));

          const byName = new Map<string, GitHubSkillCandidate>();
          // Prioriza caminhos diretos em `skills/<nome>/SKILL.md` sobre `plugins/...`
          const sortedPaths = [...skillPaths].sort((a, b) => {
            const aDirect = a.startsWith('skills/') ? 0 : 1;
            const bDirect = b.startsWith('skills/') ? 0 : 1;
            if (aDirect !== bDirect) return aDirect - bDirect;
            return a.length - b.length;
          });
          for (const p of sortedPaths) {
            const name = extractSkillNameFromPath(p, parsed.repo);
            const key = name.toLowerCase();
            if (!byName.has(key)) {
              byName.set(key, { name, path: p });
            }
          }
          availableSkills = Array.from(byName.values());

          let targetCandidate: GitHubSkillCandidate | undefined;
          if (parsed.skillName) {
            const needle = parsed.skillName.toLowerCase();
            targetCandidate =
              availableSkills.find((s) => s.name.toLowerCase() === needle) ||
              availableSkills.find((s) => s.path.toLowerCase().includes(`/${needle}/`)) ||
              availableSkills.find((s) => s.name.toLowerCase().includes(needle));
          } else if (!skillMdContent && availableSkills.length === 1) {
            targetCandidate = availableSkills[0];
          }

          if (targetCandidate) {
            const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${encodeURIComponent(defaultBranch)}/${targetCandidate.path}`;
            const rawRes = await fetch(rawUrl);
            if (rawRes.ok) {
              skillMdContent = (await rawRes.text()).slice(0, 12000);
              selectedSkillName = targetCandidate.name;
              selectedSkillPath = targetCandidate.path;
            }
          }
        }
      }
    } catch {
      // Recursive tree lookup is optional
    }

    // Fallback direto quando a tree API não retornou, mas o usuário pediu uma skill específica
    if (parsed.skillName && !skillMdContent) {
      const candidatePaths = [
        `skills/${parsed.skillName}/SKILL.md`,
        `.claude/skills/${parsed.skillName}/SKILL.md`,
        `${parsed.skillName}/SKILL.md`,
      ];
      for (const candidatePath of candidatePaths) {
        try {
          const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${encodeURIComponent(defaultBranch)}/${candidatePath}`;
          const rawRes = await fetch(rawUrl);
          if (rawRes.ok) {
            skillMdContent = (await rawRes.text()).slice(0, 12000);
            selectedSkillName = parsed.skillName;
            selectedSkillPath = candidatePath;
            break;
          }
        } catch {
          // Try next candidate
        }
      }
    }

    return {
      owner: parsed.owner,
      repo: parsed.repo,
      full_name: String(repoJson.full_name || `${parsed.owner}/${parsed.repo}`),
      description: String(repoJson.description || 'Repositório conectado via GitHub API.'),
      default_branch: defaultBranch,
      stars: Number(repoJson.stargazers_count || 0),
      language: String(repoJson.language || 'TypeScript'),
      files,
      skill_md_content: skillMdContent,
      has_skill_md: Boolean(skillMdContent),
      ...(selectedSkillName ? { selected_skill_name: selectedSkillName } : {}),
      ...(selectedSkillPath ? { selected_skill_path: selectedSkillPath } : {}),
      ...(availableSkills.length > 0 ? { available_skills: availableSkills } : {}),
      readme_excerpt: readmeExcerpt,
      synced_live: true,
    };
  } catch (err: any) {
    throw new Error(
      `Não foi possível consultar ${parsed.owner}/${parsed.repo} no GitHub (${err?.message || 'rede indisponível'}).`
    );
  }
}

export function buildImportedSkillFromGitHub(
  inspection: GitHubInspectionResult,
  customMarkdown?: string
) {
  const sourceMd =
    (customMarkdown || '').trim() ||
    inspection.skill_md_content ||
    `---\nname: Contexto ${inspection.repo}\ndescription: ${inspection.description}\ndomain: engineering\n---\n\n# Repositório ${inspection.full_name}\n\nLinguagem principal: ${inspection.language} · Branch padrão: ${inspection.default_branch}\n\n${inspection.readme_excerpt || 'Use os padrões arquiteturais deste repositório ao responder.'}`;

  return parseSkillMarkdown(sourceMd, `GitHub · ${inspection.selected_skill_name || inspection.repo}`);
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export async function syncFigmaDesignTokens(
  fileInput: string,
  token?: string
): Promise<FigmaDesignTokenPack> {
  const fileKey = parseFigmaFileKey(fileInput) || 'JarvisDesignSystem2026';

  if (token && token.trim()) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const res = await fetch(`https://api.figma.com/v1/files/${fileKey}?depth=2`, {
        headers: {
          'X-Figma-Token': token.trim(),
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data: any = await res.json();
        const extractedColors: Array<{ name: string; hex: string }> = [];
        const walkNode = (node: any) => {
          if (!node || extractedColors.length >= 8) return;
          if (Array.isArray(node.fills)) {
            for (const fill of node.fills) {
              if (fill?.type === 'SOLID' && fill.color && extractedColors.length < 8) {
                const hex = rgbToHex(fill.color.r, fill.color.g, fill.color.b);
                if (!extractedColors.some((c) => c.hex === hex)) {
                  extractedColors.push({
                    name: String(node.name || `Token ${extractedColors.length + 1}`).slice(0, 32),
                    hex,
                  });
                }
              }
            }
          }
          if (Array.isArray(node.children)) {
            for (const child of node.children) walkNode(child);
          }
        };
        walkNode(data.document);

        return {
          file_name: String(data.name || `Figma File ${fileKey}`),
          file_key: fileKey,
          colors:
            extractedColors.length > 0
              ? extractedColors
              : [
                  { name: 'Obsidian Canvas', hex: '#0B0D12' },
                  { name: 'JARVIS Orange', hex: '#F97316' },
                ],
          typography: [
            { name: 'Display / Título', fontFamily: 'Plus Jakarta Sans', sizePx: 28 },
            { name: 'Corpo / Leitura', fontFamily: 'DM Sans', sizePx: 15 },
            { name: 'Código / Métricas', fontFamily: 'JetBrains Mono', sizePx: 13 },
          ],
          components_count: Object.keys(data.components || {}).length || 12,
          synced_live: true,
        };
      }
    } catch {
      // Falls back to structured token pack when Figma token is absent or unreachable
    }
  }

  return {
    file_name: `Design System (${fileKey.slice(0, 12)})`,
    file_key: fileKey,
    colors: [
      { name: 'Obsidian Canvas', hex: '#0B0D12' },
      { name: 'Surface Elevated', hex: '#12161F' },
      { name: 'JARVIS Orange', hex: '#F97316' },
      { name: 'Amber Highlight', hex: '#FB923C' },
      { name: 'Emerald Safe', hex: '#10B981' },
    ],
    typography: [
      { name: 'Heading Principal', fontFamily: 'Plus Jakarta Sans', sizePx: 28 },
      { name: 'Corpo Editorial', fontFamily: 'DM Sans', sizePx: 15 },
      { name: 'Tabular / Código', fontFamily: 'JetBrains Mono', sizePx: 13 },
    ],
    components_count: 18,
    synced_live: false,
  };
}
