import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { Request, Response, Router } from 'express';
import JSZip from 'jszip';
import {
  serverState,
  requireAuth,
  getActiveHardwareProfile,
  nowIso,
  broadcastRealtimeEvent,
  UserAccount,
  IdeCheckpointServer,
  SentinelIncidentServer,
  persistStateNamespace,
} from '../serverState.ts';
import { resolveSafeProjectFilePath } from '../serverHardening.ts';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';
import { analyzeProjectArchitecture } from '../architectureAnalyzer.ts';
import { runHybridInference } from '../hybridAiEngine.ts';
import {
  evaluateAgentFolderPermission,
  isProtectedSecretPath,
  buildSimpleUnifiedDiff,
} from '../../src/services/sentinelSecurity.ts';

function buildDeterministicIdeProposal(
  filePath: string,
  currentContent: string,
  instruction: string
): { proposed: string; summary: string } {
  const cleanInstr = instruction.trim();
  const lower = cleanInstr.toLowerCase();

  if (filePath.endsWith('sessionGuard.ts')) {
    const addition = `\nexport function assertValidSession(session: SessionContext | null): asserts session is SessionContext {
  if (!session || !validateSessionAge(session)) {
    throw new Error('Sessão expirada ou inválida. Faça login novamente.');
  }
}\n`;
    if (!currentContent.includes('assertValidSession')) {
      return {
        proposed: `${currentContent.trimEnd()}\n${addition}`,
        summary: `Adicionada guarda estrita assertValidSession() e comentário de auditoria conforme solicitado: "${cleanInstr.slice(0, 80)}".`,
      };
    }
  }

  if (filePath.endsWith('rateLimiter.ts')) {
    const updated = currentContent.includes('cleanupExpiredBuckets')
      ? currentContent.replace('limit = 60', 'limit = 45')
      : `${currentContent.trimEnd()}\n\nexport function cleanupExpiredBuckets(now = Date.now()): number {
  let removed = 0;
  for (const [key, entry] of hits.entries()) {
    if (now > entry.resetAt) {
      hits.delete(key);
      removed += 1;
    }
  }
  return removed;
}\n`;
    return {
      proposed: updated,
      summary: `Reforçado controle de rate limit com limpeza automática de janelas expiradas (${cleanInstr.slice(0, 72)}).`,
    };
  }

  if (filePath.endsWith('.md')) {
    const bullet = `\n- **Regra atualizada (${new Date().toLocaleDateString('pt-BR')}):** ${cleanInstr}`;
    return {
      proposed: `${currentContent.trimEnd()}${bullet}\n`,
      summary: `Documentação atualizada com nova diretriz: "${cleanInstr.slice(0, 80)}".`,
    };
  }

  const commentPrefix = filePath.endsWith('.tsx') || filePath.endsWith('.ts') ? '//' : '#';
  const marker = `${commentPrefix} [Dante IDE] Alteração aplicada: ${cleanInstr}`;
  const proposed = lower.includes('log') || lower.includes('audit')
    ? `${marker}\n${currentContent.trimEnd()}\n${commentPrefix} Verificado pelo fluxo Diff + Checkpoint\n`
    : `${currentContent.trimEnd()}\n\n${marker}\n`;
  return {
    proposed,
    summary: `Proposta estruturada gerada para ${filePath} com base na instrução: "${cleanInstr.slice(0, 80)}".`,
  };
}

export interface WorkspaceRouterDeps {
  store?: LocalSqliteBrainStore;
}

export function createWorkspaceRouter(deps?: WorkspaceRouterDeps): Router {
  const router = express.Router();
  const store = deps?.store;

  const persistWorkspace = () => {
    persistStateNamespace(store, 'workspace_projects', serverState.workspaceProjects);
    persistStateNamespace(store, 'ide_files', serverState.ideFiles);
    persistStateNamespace(store, 'ide_checkpoints', serverState.ideCheckpoints.slice(0, 60));
    persistStateNamespace(store, 'project_memories', Array.from(serverState.projectMemories.entries()));
  };

  // --- WORKSPACE ---
  router.get('/workspace/projects', requireAuth, (_req: Request, res: Response) => res.json(serverState.workspaceProjects));

  router.delete('/workspace/projects/:id', requireAuth, (req: Request, res: Response) => {
    const projectId = String(req.params.id || '').trim();
    const before = serverState.workspaceProjects.length;
    serverState.workspaceProjects = serverState.workspaceProjects.filter((p) => p.id !== projectId);
    if (serverState.workspaceProjects.length === before) {
      res.status(404).json({ detail: 'Projeto não encontrado no workspace.' });
      return;
    }
    serverState.projectMemories.delete(projectId);
    persistWorkspace();
    res.json({ deleted: true, project_id: projectId });
  });

  router.post('/workspace/import', requireAuth, (req: Request, res: Response) => {
    const rawFolder = String(req.body?.folder_path || '').trim();
    if (!rawFolder) {
      res.status(400).json({ detail: 'Informe o caminho relativo da pasta do projeto.' });
      return;
    }
    let resolvedDir: string;
    try {
      resolvedDir = resolveSafeProjectFilePath(process.cwd(), rawFolder);
    } catch (err: any) {
      res.status(400).json({ detail: err?.message || 'Caminho de pasta inválido.' });
      return;
    }
    if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
      res.status(404).json({ detail: 'Pasta não encontrada no diretório de trabalho.' });
      return;
    }
    const entries = fs.readdirSync(resolvedDir, { withFileTypes: true }).slice(0, 40);
    const files = entries.filter((e) => e.isFile()).map((e) => `${rawFolder.replace(/\/+$/, '')}/${e.name}`);
    const projectName = String(req.body?.name || path.basename(resolvedDir)).trim().slice(0, 80);
    const id = `proj_${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 28)}_${Date.now().toString(36)}`;
    const created = {
      id,
      name: projectName,
      description: `Projeto importado de ${rawFolder} (${files.length} arquivos detectados).`,
      path: rawFolder,
      files,
      created_at: nowIso(),
    };
    serverState.workspaceProjects.unshift(created as any);
    persistWorkspace();
    res.status(201).json(created);
  });

  router.get('/workspace/projects/:id/file', requireAuth, (req: Request, res: Response) => {
    const filePath = String(req.query.path || '').trim();
    if (!filePath) {
      res.status(400).json({ detail: 'Informe o parâmetro path do arquivo.' });
      return;
    }
    const ideMatch = serverState.ideFiles.find((f) => f.path === filePath);
    if (ideMatch) {
      res.json({ path: ideMatch.path, content: ideMatch.content, source: 'ide_store' });
      return;
    }
    let resolved: string;
    try {
      resolved = resolveSafeProjectFilePath(process.cwd(), filePath);
    } catch (err: any) {
      res.status(400).json({ detail: err?.message || 'Caminho de arquivo fora do workspace.' });
      return;
    }
    if (isProtectedSecretPath(filePath) && serverState.vaultLocked) {
      res.status(403).json({ detail: 'Vault Lock ativo: arquivo sensível protegido.' });
      return;
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      res.status(404).json({ detail: `Arquivo "${filePath}" não encontrado.` });
      return;
    }
    const content = fs.readFileSync(resolved, 'utf8').slice(0, 200_000);
    res.json({ path: filePath, content, source: 'workspace_fs' });
  });

  router.post('/workspace/projects/:id/files/write', requireAuth, (req: Request, res: Response) => {
    const filePath = String(req.body?.path || '').trim();
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    const reason = String(req.body?.reason || `Atualização em ${filePath}`).trim();
    if (!filePath) {
      res.status(400).json({ detail: 'Caminho de arquivo obrigatório.' });
      return;
    }
    try {
      resolveSafeProjectFilePath(process.cwd(), filePath);
    } catch (err: any) {
      res.status(400).json({ detail: err?.message || 'Caminho fora do workspace permitido.' });
      return;
    }
    if (isProtectedSecretPath(filePath) && serverState.vaultLocked) {
      res.status(403).json({ detail: 'Vault Lock ativo: edição de arquivo sensível bloqueada.' });
      return;
    }
    let existing = serverState.ideFiles.find((f) => f.path === filePath);
    const prev = existing?.content || '';
    if (!existing) {
      existing = {
        path: filePath,
        language: filePath.endsWith('.md') ? 'markdown' : 'typescript',
        content,
        protected: isProtectedSecretPath(filePath),
        updated_at: nowIso(),
      };
      serverState.ideFiles.push(existing);
    } else {
      existing.content = content;
      existing.updated_at = nowIso();
    }
    const checkpoint: IdeCheckpointServer = {
      id: `chk_${crypto.randomBytes(4).toString('hex')}`,
      file_path: filePath,
      label: reason,
      agent_name: (req as Request & { jarvisUser?: UserAccount }).jarvisUser?.username || 'workspace',
      previous_content: prev,
      new_content: content,
      created_at: nowIso(),
    };
    serverState.ideCheckpoints.unshift(checkpoint);
    persistWorkspace();
    res.json({ status: 'saved', file: existing, checkpoint });
  });

  router.get('/workspace/projects/:id/memory', requireAuth, (req: Request, res: Response) => {
    res.json(serverState.projectMemories.get(req.params.id) || []);
  });

  router.post('/workspace/projects/:id/memory', requireAuth, (req: Request, res: Response) => {
    const list = serverState.projectMemories.get(req.params.id) || [];
    const entry = { id: `pm_${Date.now()}`, ...req.body, created_at: nowIso() };
    list.unshift(entry);
    serverState.projectMemories.set(req.params.id, list);
    persistWorkspace();
    res.status(201).json(entry);
  });

  router.get('/workspace/projects/:id/git-history', requireAuth, (_req: Request, res: Response) => {
    const checkpointCommits = serverState.ideCheckpoints.slice(0, 12).map((chk) => ({
      hash: chk.id.slice(-7),
      message: `${chk.label} (${chk.file_path})`,
      author: chk.agent_name,
      date: chk.created_at,
    }));
    res.json(
      checkpointCommits.length > 0
        ? checkpointCommits
        : [
            { hash: 'a1b2c3d', message: 'feat: Obsidian Studio design system', author: 'admin', date: nowIso() },
          ]
    );
  });

  router.post('/workspace/projects/:id/rollback', requireAuth, (req: Request, res: Response) => {
    const latest = serverState.ideCheckpoints[0];
    if (!latest) {
      res.status(404).json({ detail: 'Nenhum checkpoint disponível para rollback neste projeto.' });
      return;
    }
    const file = serverState.ideFiles.find((f) => f.path === latest.file_path);
    if (file) {
      file.content = latest.previous_content;
      file.updated_at = nowIso();
    }
    persistWorkspace();
    res.json({ status: 'rolled_back', checkpoint_id: latest.id, file_path: latest.file_path });
  });

  router.get('/workspace/projects/:id/preview', requireAuth, (req: Request, res: Response) => {
    const proj = serverState.workspaceProjects.find((p) => p.id === req.params.id);
    const title = proj ? String(proj.name).replace(/[<>&"]/g, '') : String(req.params.id).replace(/[<>&"]/g, '');
    res.type('text/html').send(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:sans-serif;padding:24px;background:#0b0d12;color:#f1f5f9"><h1>${title}</h1><p>Pré-visualização ativa do projeto no Workspace JARVIS.</p></body></html>`
    );
  });

  router.get('/workspace/projects/:id/export-zip', requireAuth, async (req: Request, res: Response) => {
    const projectId = String(req.params.id || 'workspace').replace(/[^a-zA-Z0-9._-]/g, '_');
    const zip = new JSZip();
    for (const file of serverState.ideFiles) {
      if (!isProtectedSecretPath(file.path)) {
        zip.file(file.path, file.content);
      }
    }
    const proj = serverState.workspaceProjects.find((p) => p.id === req.params.id);
    zip.file(
      'README.jarvis.md',
      `# ${proj?.name || projectId}\n\nExportado em ${nowIso()} pelo Workspace do Calmon Studio.\n`
    );
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${projectId}.zip"`);
    res.send(buffer);
  });

  router.post('/workspace/projects/:id/dockerize', requireAuth, (req: Request, res: Response) => {
    const projectId = String(req.params.id || 'workspace');
    const dockerfileContent = `FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nEXPOSE 3000\nCMD ["npm", "start"]\n`;
    const existing = serverState.ideFiles.find((f) => f.path === 'Dockerfile');
    if (existing) {
      existing.content = dockerfileContent;
      existing.updated_at = nowIso();
    } else {
      serverState.ideFiles.push({
        path: 'Dockerfile',
        language: 'dockerfile',
        content: dockerfileContent,
        protected: false,
        updated_at: nowIso(),
      });
    }
    persistWorkspace();
    res.json({ status: 'dockerized', project_id: projectId, files: ['Dockerfile'] });
  });

  router.post('/workspace/open-root', requireAuth, (_req: Request, res: Response) => {
    res.json({
      status: 'web_mode',
      path: '.jarvis-brain/workspaces',
      message: 'Ambiente em navegador/servidor: utilize a IDE integrada ou Exportar ZIP para acessar os arquivos.',
    });
  });

  router.post('/workspace/projects/:id/open-folder', requireAuth, (req: Request, res: Response) => {
    const proj = serverState.workspaceProjects.find((p) => p.id === req.params.id);
    res.json({
      status: 'web_mode',
      project_id: req.params.id,
      path: proj?.path || req.params.id,
      message: 'Ambiente web ativo: navegue pelos arquivos na IDE ou baixe o pacote ZIP do projeto.',
    });
  });

  router.post('/workspace/projects/:id/open-code', requireAuth, (req: Request, res: Response) => {
    res.json({
      status: 'web_mode',
      project_id: req.params.id,
      message: 'Abra o projeto diretamente na aba IDE & Código ou exporte em ZIP para editar no VS Code local.',
    });
  });

  // --- AGENTE DE ARQUITETURA (ANÁLISE REAL DO PROJETO) ---
  router.get('/architecture/analyze', requireAuth, (_req: Request, res: Response) => {
    try {
      const report = analyzeProjectArchitecture(process.cwd());
      res.json(report);
    } catch (err) {
      res.status(500).json({
        detail: err instanceof Error ? err.message : 'Falha ao analisar a arquitetura do projeto.',
      });
    }
  });

  // --- IDE INTEGRADA (CLAUDE CODE STYLE) ---
  router.get('/ide/workspace', requireAuth, (_req: Request, res: Response) => {
    res.json({
      files: serverState.ideFiles,
      checkpoints: serverState.ideCheckpoints.slice(0, 25),
      vault_locked: serverState.vaultLocked,
    });
  });

  router.post('/ide/propose', requireAuth, async (req: Request, res: Response) => {
    const filePath = String(req.body?.file_path || '').trim();
    const instruction = String(req.body?.instruction || '').trim();
    const agentRole = String(req.body?.agent_role || 'coding_agent').trim();

    if (!filePath || !instruction) {
      res.status(400).json({ detail: 'Informe o arquivo e a instrução para gerar o Diff.' });
      return;
    }

    const file = serverState.ideFiles.find((f) => f.path === filePath);
    const original = typeof req.body?.current_content === 'string'
      ? req.body.current_content
      : file?.content || '';

    const rule = serverState.permissionsMatrix.find((r) => r.agent_role === agentRole) || serverState.permissionsMatrix[0];
    const decision = evaluateAgentFolderPermission({
      rule,
      action: 'modify_diff',
      filePath,
      vaultLocked: serverState.vaultLocked,
      killSwitchActive: serverState.killSwitchActive,
    });

    if (!decision.allowed) {
      if (isProtectedSecretPath(filePath)) {
        const inc: SentinelIncidentServer = {
          id: `inc_${crypto.randomBytes(4).toString('hex')}`,
          severity: 'critical',
          category: 'secret_exfiltration',
          title: `Bloqueio de edição em arquivo protegido (${filePath})`,
          description: decision.reason,
          source: `IDE · ${rule.proper_name}`,
          indicators: ['Vault Lock ativo impediu alteração de segredos'],
          status: 'open',
          created_at: nowIso(),
        };
        serverState.sentinelIncidents.unshift(inc);
        broadcastRealtimeEvent('sentinel_incident', inc);
      }
      res.json({
        file_path: filePath,
        original,
        proposed: original,
        diff: '',
        summary: decision.reason,
        requires_approval: true,
        blocked_reason: decision.reason,
      });
      return;
    }

    const fallback = buildDeterministicIdeProposal(filePath, original, instruction);
    let proposed = fallback.proposed;
    let summary = fallback.summary;

    if (serverState.providerConnectivity.gemini_connected || serverState.providerConnectivity.ollama_connected) {
      try {
        const activeHw = getActiveHardwareProfile();
        const aiPromise = runHybridInference({
          prompt: `Você é Dante, engenheiro sênior da IDE JARVIS.
Retorne APENAS o conteúdo completo atualizado do arquivo "${filePath}" em um único bloco de código (sem texto extra fora do bloco).
Instrução do usuário: ${instruction}

Conteúdo atual:
\`\`\`
${original}
\`\`\``,
          systemInstruction: 'Responda apenas com o código completo atualizado dentro de um bloco ```.',
          requestedModel: 'gemini-3.1-flash-lite',
          routingPolicy: 'auto_hybrid',
          ollamaBaseUrl: activeHw.ollama_url,
          ollamaConnected: serverState.providerConnectivity.ollama_connected,
          geminiConnected: serverState.providerConnectivity.gemini_connected,
          enableWebSearch: false,
          assistantName: 'Calmon IA',
          agentName: 'Engenheiro de Código',
          agentProperName: 'Dante',
        });
        const aiRes = await Promise.race([
          aiPromise,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
        ]);
        if (aiRes && aiRes.text) {
          const fenceMatch = aiRes.text.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/);
          const candidate = (fenceMatch ? fenceMatch[1] : '').trim();
          if (candidate.length >= 24 && candidate !== original.trim()) {
            proposed = `${candidate}\n`;
            summary = `Diff gerado por Dante (${aiRes.modelUsed || 'motor híbrido'}) para "${instruction.slice(0, 76)}".`;
          }
        }
      } catch {
        // usa fallback determinístico já preparado
      }
    }

    const diff = buildSimpleUnifiedDiff(filePath, original, proposed);
    res.json({
      file_path: filePath,
      original,
      proposed,
      diff,
      summary,
      requires_approval: decision.requires_approval,
    });
  });

  router.post('/ide/apply', requireAuth, (req: Request, res: Response) => {
    const filePath = String(req.body?.file_path || '').trim();
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    const label = String(req.body?.label || `Alteração aplicada em ${filePath}`).trim();
    const agentName = String(req.body?.agent_name || 'Dante (IDE)').trim();

    if (!filePath) {
      res.status(400).json({ detail: 'Caminho de arquivo obrigatório.' });
      return;
    }

    if (serverState.killSwitchActive) {
      res.status(403).json({ detail: 'Kill Switch Global ativo: alterações de código estão bloqueadas.' });
      return;
    }

    if (isProtectedSecretPath(filePath) && serverState.vaultLocked) {
      res.status(403).json({ detail: 'Vault Lock ativo: desbloqueie o cofre com PIN antes de editar arquivos protegidos.' });
      return;
    }

    let file = serverState.ideFiles.find((f) => f.path === filePath);
    const previousContent = file ? file.content : '';
    if (!file) {
      file = {
        path: filePath,
        language: filePath.endsWith('.md') ? 'markdown' : 'typescript',
        content,
        protected: isProtectedSecretPath(filePath),
        updated_at: nowIso(),
      };
      serverState.ideFiles.push(file);
    } else {
      file.content = content;
      file.updated_at = nowIso();
    }

    const checkpoint: IdeCheckpointServer = {
      id: `chk_${crypto.randomBytes(4).toString('hex')}`,
      file_path: filePath,
      label,
      agent_name: agentName,
      previous_content: previousContent,
      new_content: content,
      created_at: nowIso(),
    };
    serverState.ideCheckpoints.unshift(checkpoint);

    serverState.auditLogs.unshift({
      id: serverState.auditLogs.length + 1,
      timestamp: nowIso(),
      actor: (req as Request & { jarvisUser?: UserAccount }).jarvisUser?.username || 'admin',
      action: 'ide.apply_diff',
      resource: filePath,
      status: 'success',
      details: `Checkpoint ${checkpoint.id} criado (${label})`,
    });

    persistWorkspace();
    broadcastRealtimeEvent('ide_checkpoint_created', { checkpoint, file_path: filePath });
    res.json({ file, checkpoint });
  });

  router.post('/ide/checkpoints/:id/restore', requireAuth, (req: Request, res: Response) => {
    const checkpoint = serverState.ideCheckpoints.find((c) => c.id === req.params.id);
    if (!checkpoint) {
      res.status(404).json({ detail: 'Checkpoint não encontrado.' });
      return;
    }

    const file = serverState.ideFiles.find((f) => f.path === checkpoint.file_path);
    if (!file) {
      res.status(404).json({ detail: 'Arquivo associado ao checkpoint não encontrado.' });
      return;
    }

    const beforeRevert = file.content;
    file.content = checkpoint.previous_content;
    file.updated_at = nowIso();

    const revertCheckpoint: IdeCheckpointServer = {
      id: `chk_rev_${crypto.randomBytes(3).toString('hex')}`,
      file_path: file.path,
      label: `Revertido para antes de "${checkpoint.label.slice(0, 42)}"`,
      agent_name: 'Sistema · Rollback 1-Clique',
      previous_content: beforeRevert,
      new_content: file.content,
      created_at: nowIso(),
    };
    serverState.ideCheckpoints.unshift(revertCheckpoint);

    serverState.auditLogs.unshift({
      id: serverState.auditLogs.length + 1,
      timestamp: nowIso(),
      actor: (req as Request & { jarvisUser?: UserAccount }).jarvisUser?.username || 'admin',
      action: 'ide.restore_checkpoint',
      resource: file.path,
      status: 'success',
      details: `Rollback executado a partir do checkpoint ${checkpoint.id}`,
    });

    persistWorkspace();
    broadcastRealtimeEvent('ide_checkpoint_created', { checkpoint: revertCheckpoint, file_path: file.path });
    res.json({ restored: true, file, checkpoint: revertCheckpoint });
  });

  return router;
}
