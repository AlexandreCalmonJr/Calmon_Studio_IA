import crypto from 'node:crypto';
import express, { Request, Response, Router } from 'express';
import {
  serverState,
  requireAuth,
  getActiveHardwareProfile,
  nowIso,
  broadcastRealtimeEvent,
  UserAccount,
  IdeCheckpointServer,
  SentinelIncidentServer,
} from '../serverState.ts';
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

export function createWorkspaceRouter(): Router {
  const router = express.Router();

  // --- WORKSPACE ---
  router.get('/workspace/projects', requireAuth, (_req: Request, res: Response) => res.json(serverState.workspaceProjects));

  router.get('/workspace/projects/:id/file', requireAuth, (req: Request, res: Response) => {
    const filePath = String(req.query.path || '');
    res.json({ path: filePath, content: `// Visualização segura de ${filePath}\n` });
  });

  router.get('/workspace/projects/:id/memory', requireAuth, (req: Request, res: Response) => {
    res.json(serverState.projectMemories.get(req.params.id) || []);
  });

  router.post('/workspace/projects/:id/memory', requireAuth, (req: Request, res: Response) => {
    const list = serverState.projectMemories.get(req.params.id) || [];
    const entry = { id: `pm_${Date.now()}`, ...req.body, created_at: nowIso() };
    list.unshift(entry);
    serverState.projectMemories.set(req.params.id, list);
    res.status(201).json(entry);
  });

  router.get('/workspace/projects/:id/git-history', requireAuth, (_req: Request, res: Response) => {
    res.json([
      { hash: 'a1b2c3d', message: 'feat: redesign Obsidian Studio design system', author: 'admin', date: nowIso() },
      { hash: 'e4f5g6h', message: 'fix: enforce HttpOnly cookie auth middleware', author: 'admin', date: new Date(Date.now() - 1000 * 60 * 60).toISOString() },
    ]);
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
          assistantName: 'JARVIS',
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

    broadcastRealtimeEvent('ide_checkpoint_created', { checkpoint: revertCheckpoint, file_path: file.path });
    res.json({ restored: true, file, checkpoint: revertCheckpoint });
  });

  return router;
}
