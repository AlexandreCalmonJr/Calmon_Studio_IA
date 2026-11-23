/**
 * Analisador Real de Arquitetura do Projeto (Agente de Arquitetura — Vetor).
 *
 * Inspeciona a estrutura real de diretórios e arquivos do repositório de forma segura
 * (confinada ao diretório raiz do projeto), identifica padrões de projeto aplicados,
 * mede distribuição por camadas e gera sugestões concretas alinhadas ao plano
 * de arquitetura poliglota (Node.js/TS Gateway + SQLite WAL/Postgres + Workers Python/Go).
 */

import fs from 'node:fs';
import path from 'node:path';

export interface ArchitectureLayerStat {
  id: string;
  label: string;
  description: string;
  fileCount: number;
  lineCount: number;
  sharePct: number;
  samplePaths: string[];
}

export interface DetectedDesignPattern {
  id: string;
  name: string;
  category: 'frontend' | 'backend' | 'persistence' | 'agents' | 'security';
  confidence: 'alta' | 'media';
  summary: string;
  evidencePaths: string[];
}

export interface ArchitectureSuggestion {
  id: string;
  title: string;
  severity: 'alta' | 'media' | 'baixa';
  layer: 'backend' | 'frontend' | 'modulos_pacotes' | 'poliglota' | 'testes';
  rationale: string;
  actionSteps: string[];
  targetPaths: string[];
}

export interface PolyglotPillarStatus {
  id: string;
  name: string;
  runtime: string;
  status: 'ativo' | 'preparado' | 'planejado';
  detail: string;
}

export interface ArchitectureDirectoryNode {
  path: string;
  fileCount: number;
  extensions: string[];
}

export interface ProjectArchitectureReport {
  analyzedAt: string;
  rootName: string;
  totalFiles: number;
  totalCodeFiles: number;
  totalTestFiles: number;
  totalLines: number;
  largestFiles: Array<{ path: string; lines: number; bytes: number }>;
  layers: ArchitectureLayerStat[];
  directories: ArchitectureDirectoryNode[];
  patterns: DetectedDesignPattern[];
  polyglotPillars: PolyglotPillarStatus[];
  suggestions: ArchitectureSuggestion[];
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.playwright-cli',
  '.jarvis-brain',
  '.aistudio',
  '.vite',
  'coverage',
  '.next',
]);

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.sql',
  '.css',
]);

const MAX_SCAN_FILES = 600;
const MAX_SCAN_DEPTH = 6;
const MAX_LINE_COUNT_FILE_BYTES = 512 * 1024;

interface ScannedFile {
  relPath: string;
  ext: string;
  bytes: number;
  lines: number;
}

function walkWorkspace(rootDir: string): ScannedFile[] {
  const resolvedRoot = path.resolve(rootDir);
  const files: ScannedFile[] = [];

  const visit = (currentDir: string, depth: number) => {
    if (depth > MAX_SCAN_DEPTH || files.length >= MAX_SCAN_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_SCAN_FILES) break;
      if (entry.name.startsWith('.') && entry.name !== '.env.example') {
        if (entry.isDirectory()) continue;
      }
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const nextDir = path.resolve(currentDir, entry.name);
        if (!nextDir.startsWith(resolvedRoot + path.sep)) continue;
        visit(nextDir, depth + 1);
      } else if (entry.isFile()) {
        const fullPath = path.resolve(currentDir, entry.name);
        if (!fullPath.startsWith(resolvedRoot + path.sep)) continue;
        const relPath = path.relative(resolvedRoot, fullPath).split(path.sep).join('/');
        const ext = path.extname(entry.name).toLowerCase();
        let bytes = 0;
        let lines = 0;
        try {
          const stat = fs.statSync(fullPath);
          bytes = stat.size;
          if (CODE_EXTENSIONS.has(ext) && bytes <= MAX_LINE_COUNT_FILE_BYTES) {
            const text = fs.readFileSync(fullPath, 'utf8');
            lines = text ? text.split('\n').length : 0;
          }
        } catch {
          // ignore unreadable file
        }
        files.push({ relPath, ext, bytes, lines });
      }
    }
  };

  visit(resolvedRoot, 0);
  return files;
}

function classifyLayer(relPath: string): string {
  if (/\.test\.[tj]sx?$/.test(relPath) || relPath.startsWith('tests/')) return 'tests';
  if (relPath.startsWith('src/features/')) return 'frontend_features';
  if (relPath.startsWith('src/shared/') || relPath.startsWith('src/context/') || relPath.startsWith('src/hooks/')) {
    return 'frontend_shared';
  }
  if (relPath.startsWith('src/services/')) return 'domain_services';
  if (relPath.startsWith('server/') || relPath === 'server.ts') return 'backend_brain';
  if (relPath.endsWith('.md') || relPath.endsWith('.json') || relPath.endsWith('.yml') || relPath.endsWith('.yaml')) {
    return 'docs_config';
  }
  return 'frontend_core';
}

export function analyzeProjectArchitecture(rootDir: string): ProjectArchitectureReport {
  const resolvedRoot = path.resolve(rootDir);
  const scanned = walkWorkspace(resolvedRoot);
  const relSet = new Set(scanned.map((f) => f.relPath));

  const codeFiles = scanned.filter((f) => CODE_EXTENSIONS.has(f.ext));
  const testFiles = scanned.filter((f) => /\.test\.[tj]sx?$/.test(f.relPath));
  const totalLines = codeFiles.reduce((acc, f) => acc + f.lines, 0);

  const layerMeta: Record<string, { label: string; description: string }> = {
    frontend_features: {
      label: 'Features de Interface (SPA)',
      description: 'Módulos funcionais por domínio em src/features/* (Loja, Agentes, Chat, Estúdios).',
    },
    frontend_shared: {
      label: 'Navegação & Componentes Compartilhados',
      description: 'Shell, PrimaryRail, modais reutilizáveis, contextos e hooks globais.',
    },
    domain_services: {
      label: 'Motores Puros & Serviços de Domínio',
      description: 'Regras desacopladas (Pack Engine, Agent Core Engine, Health Metrics, API clients).',
    },
    backend_brain: {
      label: 'Servidor Express & Cérebro SQLite',
      description: 'API REST/WS, persistência SQLite WAL, cofres AES-256 e workspaces isolados.',
    },
    tests: {
      label: 'Testes Automatizados (node:test)',
      description: 'Testes determinísticos para lógica de domínio e persistência em disco.',
    },
    docs_config: {
      label: 'Documentação & Configuração',
      description: 'Manifestos, guias arquiteturais (ARCHITECTURE.md), Docker e build.',
    },
    frontend_core: {
      label: 'Núcleo da Aplicação & Estilos',
      description: 'Ponto de entrada React, roteador History API e design system Obsidian Studio.',
    },
  };

  const layerBuckets = new Map<string, ScannedFile[]>();
  for (const file of scanned) {
    const key = classifyLayer(file.relPath);
    const bucket = layerBuckets.get(key) || [];
    bucket.push(file);
    layerBuckets.set(key, bucket);
  }

  const layers: ArchitectureLayerStat[] = Object.keys(layerMeta)
    .map((id) => {
      const bucket = layerBuckets.get(id) || [];
      const lineCount = bucket.reduce((acc, f) => acc + f.lines, 0);
      return {
        id,
        label: layerMeta[id].label,
        description: layerMeta[id].description,
        fileCount: bucket.length,
        lineCount,
        sharePct: scanned.length > 0 ? Math.round((bucket.length / scanned.length) * 100) : 0,
        samplePaths: bucket.slice(0, 4).map((f) => f.relPath),
      };
    })
    .filter((l) => l.fileCount > 0)
    .sort((a, b) => b.fileCount - a.fileCount);

  // Diretórios de 2 níveis mais relevantes
  const dirMap = new Map<string, { count: number; exts: Set<string> }>();
  for (const file of scanned) {
    const parts = file.relPath.split('/');
    const dirKey = parts.length <= 1 ? '(raiz)' : parts.slice(0, Math.min(2, parts.length - 1)).join('/');
    const entry = dirMap.get(dirKey) || { count: 0, exts: new Set<string>() };
    entry.count += 1;
    if (file.ext) entry.exts.add(file.ext);
    dirMap.set(dirKey, entry);
  }

  const directories: ArchitectureDirectoryNode[] = Array.from(dirMap.entries())
    .map(([dirPath, info]) => ({
      path: dirPath,
      fileCount: info.count,
      extensions: Array.from(info.exts).slice(0, 5),
    }))
    .sort((a, b) => b.fileCount - a.fileCount)
    .slice(0, 14);

  const largestFiles = [...codeFiles]
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 8)
    .map((f) => ({ path: f.relPath, lines: f.lines, bytes: f.bytes }));

  // Detecção real de padrões de projeto
  const patterns: DetectedDesignPattern[] = [];

  const featureDirs = new Set(
    scanned
      .filter((f) => f.relPath.startsWith('src/features/'))
      .map((f) => f.relPath.split('/')[2])
      .filter(Boolean)
  );
  if (featureDirs.size >= 3) {
    patterns.push({
      id: 'feature_sliced_ui',
      name: 'Feature-Sliced Frontend Architecture',
      category: 'frontend',
      confidence: 'alta',
      summary: `Interface particionada em ${featureDirs.size} domínios independentes carregados sob demanda (lazy routes).`,
      evidencePaths: Array.from(featureDirs)
        .slice(0, 5)
        .map((d) => `src/features/${d}/`),
    });
  }

  const engineFiles = scanned.filter((f) => /Engine\.ts$/.test(f.relPath) && !f.relPath.includes('.test.'));
  if (engineFiles.length > 0) {
    patterns.push({
      id: 'pure_domain_engines',
      name: 'Domain Engine Decoupling (Lógica Pura)',
      category: 'frontend',
      confidence: 'alta',
      summary: `${engineFiles.length} motores TypeScript puros desacoplam regras de negócio da camada de componentes React.`,
      evidencePaths: engineFiles.slice(0, 5).map((f) => f.relPath),
    });
  }

  if (relSet.has('src/services/modulePackEngine.ts')) {
    patterns.push({
      id: 'modular_pack_plugin',
      name: 'Modular Capability Pack System (Plugin-Like)',
      category: 'agents',
      confidence: 'alta',
      summary: 'Módulos da sidebar, agentes especialistas, skills e trilhas de estudo são empacotados e instalados sob demanda.',
      evidencePaths: ['src/services/modulePackEngine.ts', 'src/features/store/PackStoreView.tsx'],
    });
  }

  if (relSet.has('src/services/agentCoreEngine.ts')) {
    patterns.push({
      id: 'isolated_agent_core',
      name: 'Isolated Agent Core Schema (SOUL / MEMORY / MCP)',
      category: 'agents',
      confidence: 'alta',
      summary: 'Cada agente mantém núcleo próprio com loop de orquestração, provedor/fallback, orçamento diário e arquivos Markdown isolados.',
      evidencePaths: ['src/services/agentCoreEngine.ts', 'src/features/agents/AgentCoreInspectorModal.tsx'],
    });
  }

  if (relSet.has('server/brain/sqliteBrainStore.ts')) {
    patterns.push({
      id: 'local_first_sqlite_repo',
      name: 'Repository Pattern + Local-First SQLite WAL',
      category: 'persistence',
      confidence: 'alta',
      summary: 'Camada de persistência centralizada com WAL, queries parametrizadas, FTS5 e backups consistentes via VACUUM INTO.',
      evidencePaths: ['server/brain/sqliteBrainStore.ts', 'server/brain/models.ts', 'server/brain/workspaceMemoryStore.ts'],
    });
  }

  if (relSet.has('server/providerEngine.ts')) {
    patterns.push({
      id: 'server_side_secret_proxy',
      name: 'Server-Side Credential Vault & API Proxy',
      category: 'security',
      confidence: 'alta',
      summary: 'Chaves de provedores externos ficam cifradas no servidor com AES-256-GCM e jamais são expostas em texto claro ao cliente.',
      evidencePaths: ['server/providerEngine.ts', 'server/hybridAiEngine.ts'],
    });
  }

  // Pilares da Arquitetura Poliglota
  const hasPython = scanned.some((f) => f.ext === '.py');
  const hasGo = scanned.some((f) => f.ext === '.go');
  const hasDocker = scanned.some((f) => /dockerfile|docker-compose/i.test(f.relPath));

  const polyglotPillars: PolyglotPillarStatus[] = [
    {
      id: 'ts_gateway',
      name: 'Gateway & Orquestrador Web (Node.js + TypeScript)',
      runtime: 'Node.js 22 + Express + React 19',
      status: 'ativo',
      detail: `${codeFiles.length} arquivos de código ativos com roteamento SPA, API REST /api/v1/* e núcleos individuais.`,
    },
    {
      id: 'sqlite_wal_brain',
      name: 'Cérebro Local-First (SQLite WAL + FTS5 + Vetores)',
      runtime: 'node:sqlite WAL',
      status: relSet.has('server/brain/sqliteBrainStore.ts') ? 'ativo' : 'planejado',
      detail: 'Persistência transacional para pacotes, núcleos de agentes, cofres cifrados e workspaces isolados.',
    },
    {
      id: 'postgres_cloud_adapter',
      name: 'Adaptador Nuvem Multi-Tenant (Postgres / Supabase)',
      runtime: 'PostgreSQL + pgvector',
      status: hasDocker ? 'preparado' : 'planejado',
      detail: 'Contratos com PKs TEXT e timestamps ISO-8601 prontos para espelhar `installed_packs`, `custom_packs` e `agent_cores` na nuvem.',
    },
    {
      id: 'polyglot_workers',
      name: 'Workers Especializados (Python IA / Go Runtime)',
      runtime: 'Python 3.11 / Go 1.22',
      status: hasPython || hasGo ? 'ativo' : 'preparado',
      detail:
        hasPython || hasGo
          ? 'Arquivos de runtime auxiliar detectados no workspace para pipelines pesados.'
          : 'Fronteira de contrato pronta via MCP/HTTP para acoplar workers Python (RAG/embeddings) ou Go (agentes concorrentes).',
    },
  ];

  // Sugestões concretas baseadas em evidência real do código
  const suggestions: ArchitectureSuggestion[] = [];

  const serverFile = codeFiles.find((f) => f.relPath === 'server.ts');
  if (serverFile && serverFile.lines > 1200) {
    suggestions.push({
      id: 'split_server_routers',
      title: `Modularizar server.ts (${serverFile.lines.toLocaleString('pt-BR')} linhas) em Express Routers por pacote`,
      severity: 'alta',
      layer: 'backend',
      rationale:
        'O arquivo server.ts concentra autenticação, agentes, pacotes, chat, provedores e fluxos em um único módulo, elevando o acoplamento e dificultando deploy independente.',
      actionSteps: [
        'Extrair rotas para `server/routes/packs.ts`, `server/routes/agents.ts`, `server/routes/auth.ts` e `server/routes/providers.ts`.',
        'Vincular cada router a um manifesto de pacote para carregar apenas rotas dos pacotes ativos.',
        'Compartilhar middlewares (`requireAuth`, `requireAdminOrDeveloper`) em `server/middleware/auth.ts`.',
      ],
      targetPaths: ['server.ts'],
    });
  }

  const cssFile = codeFiles.find((f) => f.relPath === 'src/index.css');
  if (cssFile && cssFile.lines > 1500) {
    suggestions.push({
      id: 'split_css_layers',
      title: `Particionar src/index.css (${cssFile.lines.toLocaleString('pt-BR')} linhas) em tokens, componentes e módulos`,
      severity: 'media',
      layer: 'frontend',
      rationale:
        'Uma folha global única dificulta manutenção e aumenta risco de efeitos colaterais entre telas.',
      actionSteps: [
        'Separar `:root` tokens em `src/styles/tokens.css` e primitivos (`.btn`, `.jarvis-input`, modais) em `src/styles/primitives.css`.',
        'Co-localizar folhas específicas de pacotes (ex.: Loja, Agente de Arquitetura) sob `src/styles/modules/`.',
      ],
      targetPaths: ['src/index.css'],
    });
  }

  suggestions.push({
    id: 'pack_runtime_manifest',
    title: 'Alinhar manifesto de pacotes com Lazy Bundles + Permissões MCP por Agente',
    severity: 'media',
    layer: 'modulos_pacotes',
    rationale:
      'Hoje os pacotes já controlam sidebar, agentes e trilhas de estudo; o próximo salto é cada pacote declarar também seu conjunto de rotas de backend e contratos de schema.',
    actionSteps: [
      'Usar o Estúdio de Pacotes (Dev/Admin) para versionar pacotes customizados em `custom_packs` com exportação JSON.',
      'Permitir que o executor de chat leia diretamente `agent_cores` (`orchestration_mode`, `SOUL.md`, `daily_budget_usd`) a cada invocação.',
    ],
    targetPaths: ['src/services/modulePackEngine.ts', 'src/services/agentCoreEngine.ts'],
  });

  suggestions.push({
    id: 'polyglot_storage_interface',
    title: 'Introduzir interface `BrainRepository` para alternar SQLite Local ↔ Postgres/Supabase',
    severity: 'media',
    layer: 'poliglota',
    rationale:
      'Seguindo o plano poliglota, isolar a assinatura de repositório permite rodar 100% offline em SQLite WAL e sincronizar com Supabase/Cloud SQL em produção sem alterar a API.',
    actionSteps: [
      'Extrair a interface TypeScript `BrainRepository` a partir de `LocalSqliteBrainStore`.',
      'Implementar adaptador Postgres reutilizando exatamente os mesmos contratos de `installed_packs`, `custom_packs` e `agent_cores`.',
    ],
    targetPaths: ['server/brain/sqliteBrainStore.ts', 'server/brain/models.ts'],
  });

  const engineWithoutTest = engineFiles.filter(
    (eng) => !relSet.has(eng.relPath.replace(/\.ts$/, '.test.ts'))
  );
  if (engineWithoutTest.length > 0) {
    suggestions.push({
      id: 'increase_engine_test_coverage',
      title: `Expandir testes unitários nos motores de domínio (${engineWithoutTest.length} sem arquivo .test.ts)`,
      severity: 'baixa',
      layer: 'testes',
      rationale:
        'Motores puros sem testes unitários podem sofrer regressões silenciosas durante evoluções rápidas de pacotes.',
      actionSteps: [
        'Criar testes determinísticos `node:test` para os motores prioritários sem cobertura.',
        'Executar a suíte completa antes de publicar novos pacotes no Estúdio Dev/Admin.',
      ],
      targetPaths: engineWithoutTest.slice(0, 5).map((f) => f.relPath),
    });
  }

  return {
    analyzedAt: new Date().toISOString(),
    rootName: path.basename(resolvedRoot),
    totalFiles: scanned.length,
    totalCodeFiles: codeFiles.length,
    totalTestFiles: testFiles.length,
    totalLines,
    largestFiles,
    layers,
    directories,
    patterns,
    polyglotPillars,
    suggestions,
  };
}
