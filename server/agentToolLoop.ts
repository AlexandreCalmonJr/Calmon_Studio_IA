/**
 * Prioridade 3 — Loop Autônomo de Ferramentas (Sandbox + MCP) no Chat.
 *
 * Permite que agentes no Chat executem ações reais e auditáveis durante o turno:
 *  1. Comandos explícitos `/sandbox <cmd> [args]` ou intenções diagnósticas seguras
 *     executados via `PluggableSandboxRunner` (Local Confinado ou Docker Efêmero).
 *  2. Chamadas explícitas `/mcp <ferramenta> [json]` ou invocação direcionada a
 *     ferramentas de servidores MCP **aprovados** via `McpRuntimeSupervisor` (JSON-RPC 2.0).
 *  3. Cada execução gera um passo durável (`kind: 'sandbox' | 'mcp'`) no `DurableRunEngine`,
 *     emite eventos em tempo real para o Painel Lateral Vivo e injeta a evidência real
 *     no contexto de síntese do modelo.
 */

import type { LocalSqliteBrainStore } from './brain/sqliteBrainStore.ts';
import type { AgentRunStepModel, McpServerModel, RunArtifactModel } from './brain/models.ts';
import type { DurableRunEngine } from './durableRunEngine.ts';
import type { PluggableSandboxRunner } from './infra/sandboxRunner.ts';
import type { McpRuntimeSupervisor } from './infra/mcpSupervisor.ts';

export type PlannedToolAction =
  | {
      kind: 'sandbox';
      command: string;
      args: string[];
      reason: string;
    }
  | {
      kind: 'mcp';
      serverId: string;
      serverName: string;
      toolName: string;
      args: Record<string, unknown>;
      reason: string;
    };

export interface ToolLoopExecutionResult {
  executedCount: number;
  steps: AgentRunStepModel[];
  artifact: RunArtifactModel | null;
  evidencePromptBlock: string;
  summaryLines: string[];
}

export interface RunObservabilityStats {
  total_runs: number;
  completed_runs: number;
  failed_runs: number;
  recoverable_runs: number;
  sandbox_steps: number;
  mcp_steps: number;
  artifacts_count: number;
  avg_step_ms: number;
}

const MAX_ACTIONS_PER_TURN = 3;

function tokenizeSimpleArgs(raw: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(raw)) !== null) {
    const val = m[1] ?? m[2] ?? m[3] ?? '';
    if (val) tokens.push(val);
    if (tokens.length >= 16) break;
  }
  return tokens;
}

/**
 * Planeja ações reais de Sandbox e MCP a partir do prompt do usuário.
 * Função pura e determinística, facilmente testável.
 */
export function planAutonomousToolActions(
  prompt: string,
  approvedMcpServers: McpServerModel[]
): PlannedToolAction[] {
  const text = String(prompt || '').trim();
  if (!text) return [];

  const actions: PlannedToolAction[] = [];

  const lines = text.split(/\r?\n/);

  // 1. Diretivas explícitas `/sandbox <cmd> [args]` (linha a linha)
  for (const rawLine of lines) {
    if (actions.length >= MAX_ACTIONS_PER_TURN) break;
    const line = rawLine.trim();
    if (!/^\/sandbox\s+/i.test(line)) continue;
    const rawCmd = line.replace(/^\/sandbox\s+/i, '').trim();
    const tokens = tokenizeSimpleArgs(rawCmd);
    if (tokens.length > 0) {
      actions.push({
        kind: 'sandbox',
        command: tokens[0],
        args: tokens.slice(1),
        reason: 'Comando solicitado explicitamente via /sandbox',
      });
    }
  }

  // 2. Diretivas explícitas `/mcp <toolName> [jsonArgs]` (linha a linha)
  for (const rawLine of lines) {
    if (actions.length >= MAX_ACTIONS_PER_TURN) break;
    const line = rawLine.trim();
    const match = line.match(/^\/mcp\s+([a-zA-Z0-9._:/-]+)(?:\s+(.+))?$/i);
    if (!match) continue;
    const rawToolRef = match[1].trim();
    const rawJson = (match[2] || '').trim();
    let parsedArgs: Record<string, unknown> = {};
    if (rawJson.startsWith('{')) {
      try {
        const obj = JSON.parse(rawJson);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          parsedArgs = obj as Record<string, unknown>;
        }
      } catch {
        parsedArgs = { query: rawJson };
      }
    } else if (rawJson) {
      parsedArgs = { query: rawJson };
    }

    const [maybeServer, maybeTool] = rawToolRef.includes(':')
      ? rawToolRef.split(':', 2)
      : ['', rawToolRef];

    const matchedServer = approvedMcpServers.find((srv) => {
      if (!srv.is_approved) return false;
      if (maybeServer) {
        return srv.id === maybeServer || srv.name.toLowerCase() === maybeServer.toLowerCase();
      }
      return (srv.tools || []).some((t) => t.name === maybeTool);
    });

    if (matchedServer) {
      actions.push({
        kind: 'mcp',
        serverId: matchedServer.id,
        serverName: matchedServer.name,
        toolName: maybeTool,
        args: parsedArgs,
        reason: `Invocação explícita via /mcp (${matchedServer.name})`,
      });
    }
  }

  // 3. Intenções naturais seguras de inspeção no Sandbox (somente se nenhuma diretiva explícita foi passada)
  if (actions.length === 0) {
    const lower = text.toLowerCase();
    const wantsSandbox =
      /\bsandbox\b/.test(lower) ||
      /\b(rode|executa|execute|rodar|verificar|checar|conferir)\b.*\b(node|python|git status|arquivos do workspace|diret[oó]rio)\b/.test(
        lower
      );

    if (wantsSandbox) {
      if (/\bnode\b/.test(lower) && /\b(vers[aã]o|version|-v)\b/.test(lower)) {
        actions.push({
          kind: 'sandbox',
          command: 'node',
          args: ['-v'],
          reason: 'Verificação automática da versão do Node.js no Sandbox',
        });
      }
      if (/\bpython\b/.test(lower) && /\b(vers[aã]o|version|--version)\b/.test(lower) && actions.length < MAX_ACTIONS_PER_TURN) {
        actions.push({
          kind: 'sandbox',
          command: 'python3',
          args: ['--version'],
          reason: 'Verificação automática da versão do Python no Sandbox',
        });
      }
      if (/\bgit\s+status\b/.test(lower) && actions.length < MAX_ACTIONS_PER_TURN) {
        actions.push({
          kind: 'sandbox',
          command: 'git',
          args: ['status', '--short'],
          reason: 'Inspeção somente-leitura do estado Git no Sandbox',
        });
      }
      if (
        /\b(listar|liste|ver|mostrar)\b.*\b(arquivos|workspace|pasta|diret[oó]rio)\b/.test(lower) &&
        actions.length < MAX_ACTIONS_PER_TURN
      ) {
        actions.push({
          kind: 'sandbox',
          command: 'ls',
          args: ['-la'],
          reason: 'Listagem segura do workspace isolado no Sandbox',
        });
      }
    }
  }

  return actions.slice(0, MAX_ACTIONS_PER_TURN);
}

/**
 * Executa o loop autônomo de ferramentas (Sandbox + MCP), registrando cada etapa durável,
 * emitindo eventos em tempo real e salvando log como artefato quando houver saída relevante.
 */
export async function executeAutonomousToolLoop(params: {
  prompt: string;
  runId: string;
  sessionId: string;
  userId: string;
  startStepIndex: number;
  store: LocalSqliteBrainStore;
  durableRuns: DurableRunEngine;
  sandboxRunner: PluggableSandboxRunner;
  mcpSupervisor: McpRuntimeSupervisor;
  onStep?: (step: AgentRunStepModel) => void;
  onArtifact?: (artifact: RunArtifactModel) => void;
  allowLocalMcpHttp?: boolean;
}): Promise<ToolLoopExecutionResult> {
  const approvedServers = params.store.listMcpServers().filter((s) => s.is_approved);
  const planned = planAutonomousToolActions(params.prompt, approvedServers);

  if (planned.length === 0) {
    return {
      executedCount: 0,
      steps: [],
      artifact: null,
      evidencePromptBlock: '',
      summaryLines: [],
    };
  }

  let cursor = params.startStepIndex;
  const recordedSteps: AgentRunStepModel[] = [];
  const summaryLines: string[] = [];
  const logBlocks: string[] = [];

  for (const action of planned) {
    if (action.kind === 'sandbox') {
      const displayCmd = [action.command, ...action.args].join(' ').trim();
      const execRes = await params.sandboxRunner.execute({
        userId: params.userId,
        runId: params.runId,
        command: action.command,
        args: action.args,
      });
      const sess = execRes.session;
      const outputText = (sess.stdout_excerpt || sess.stderr_excerpt || execRes.reason || '(sem saída)').trim();
      const step = params.durableRuns.recordStep({
        runId: params.runId,
        stepIndex: cursor++,
        kind: 'sandbox',
        title: `Sandbox · ${displayCmd.slice(0, 48)}`,
        status: execRes.allowed && sess.status === 'completed' ? 'completed' : 'failed',
        durationMs: sess.duration_ms,
        inputSummary: `${action.reason} (${sess.driver})`,
        outputSummary: outputText.slice(0, 360),
        checkpointPayload: {
          tool_kind: 'sandbox',
          driver: sess.driver,
          command: displayCmd,
          allowed: execRes.allowed,
          exit_code: sess.exit_code,
          stdout_excerpt: sess.stdout_excerpt.slice(0, 1800),
          stderr_excerpt: sess.stderr_excerpt.slice(0, 900),
          sandbox_session_id: sess.id,
        },
      });
      recordedSteps.push(step);
      params.onStep?.(step);

      summaryLines.push(
        `Sandbox (${sess.driver}) \`${displayCmd}\` → ${sess.status} (exit ${sess.exit_code ?? 'bloqueado'})`
      );
      logBlocks.push(
        `=== SANDBOX [${sess.driver}] $ ${displayCmd} (status=${sess.status}, exit=${sess.exit_code ?? 'n/a'}, ${sess.duration_ms}ms) ===\n${outputText}`
      );
    } else {
      const server = approvedServers.find((s) => s.id === action.serverId && s.is_approved);
      if (!server) continue;
      const started = Date.now();
      try {
        const mcpRes = await params.mcpSupervisor.invokeTool(server, action.toolName, action.args, {
          allowLocalHttp: params.allowLocalMcpHttp,
        });
        const elapsed = Math.max(1, Date.now() - started);
        const step = params.durableRuns.recordStep({
          runId: params.runId,
          stepIndex: cursor++,
          kind: 'mcp',
          title: `MCP · ${server.name} → ${action.toolName}`,
          status: 'completed',
          durationMs: elapsed,
          inputSummary: `${action.reason} · args=${JSON.stringify(action.args).slice(0, 160)}`,
          outputSummary: mcpRes.summary.slice(0, 360),
          checkpointPayload: {
            tool_kind: 'mcp',
            server_id: server.id,
            server_name: server.name,
            transport: server.transport,
            tool_name: action.toolName,
            args: action.args,
            output_excerpt: mcpRes.summary.slice(0, 1800),
          },
        });
        recordedSteps.push(step);
        params.onStep?.(step);

        summaryLines.push(`MCP (${server.name}) \`${action.toolName}\` → concluído (${elapsed} ms)`);
        logBlocks.push(
          `=== MCP [${server.name} · ${server.transport}] ${action.toolName} (${elapsed}ms) ===\n${mcpRes.summary}`
        );
      } catch (err) {
        const elapsed = Math.max(1, Date.now() - started);
        const errMsg = err instanceof Error ? err.message : 'Falha na chamada MCP.';
        const step = params.durableRuns.recordStep({
          runId: params.runId,
          stepIndex: cursor++,
          kind: 'mcp',
          title: `MCP · ${server.name} → ${action.toolName}`,
          status: 'failed',
          durationMs: elapsed,
          inputSummary: action.reason,
          outputSummary: errMsg.slice(0, 320),
          checkpointPayload: {
            tool_kind: 'mcp',
            server_id: server.id,
            server_name: server.name,
            tool_name: action.toolName,
            error: errMsg.slice(0, 500),
          },
        });
        recordedSteps.push(step);
        params.onStep?.(step);

        summaryLines.push(`MCP (${server.name}) \`${action.toolName}\` → falhou: ${errMsg.slice(0, 120)}`);
        logBlocks.push(`=== MCP [${server.name}] ${action.toolName} (ERRO) ===\n${errMsg}`);
      }
    }
  }

  let savedArtifact: RunArtifactModel | null = null;
  if (logBlocks.length > 0) {
    try {
      const fullLog = logBlocks.join('\n\n');
      savedArtifact = await params.durableRuns.saveArtifact({
        runId: params.runId,
        sessionId: params.sessionId,
        userId: params.userId,
        title: `Log de Ferramentas (${recordedSteps.length} ação${recordedSteps.length === 1 ? '' : 'ões'})`,
        kind: 'log',
        filename: 'tool_execution.log',
        content: fullLog,
        mimeType: 'text/plain; charset=utf-8',
      });
      params.onArtifact?.(savedArtifact);
    } catch {
      savedArtifact = null;
    }
  }

  const evidencePromptBlock =
    logBlocks.length > 0
      ? [
          'Evidências reais obtidas durante esta execução (Sandbox / MCP aprovados):',
          logBlocks.join('\n\n').slice(0, 2600),
          'Incorpore estes resultados reais na sua resposta ao usuário de forma clara e precisa.',
        ].join('\n\n')
      : '';

  return {
    executedCount: recordedSteps.length,
    steps: recordedSteps,
    artifact: savedArtifact,
    evidencePromptBlock,
    summaryLines,
  };
}

/**
 * Calcula métricas tabulares de observabilidade das execuções duráveis do usuário.
 */
export function computeRunObservabilityStats(
  store: LocalSqliteBrainStore,
  userId: string
): RunObservabilityStats {
  const runs = store.listAgentRuns({ user_id: userId, limit: 100 });
  let completed = 0;
  let failed = 0;
  let sandboxSteps = 0;
  let mcpSteps = 0;
  let artifactsCount = 0;
  let totalStepMs = 0;
  let totalSteps = 0;

  for (const run of runs) {
    if (run.status === 'completed') completed += 1;
    else if (run.status === 'failed') failed += 1;

    const steps = store.listAgentRunSteps(run.id);
    for (const s of steps) {
      totalSteps += 1;
      totalStepMs += Math.max(0, Number(s.duration_ms || 0));
      if (s.kind === 'sandbox') sandboxSteps += 1;
      if (s.kind === 'mcp') mcpSteps += 1;
    }
    artifactsCount += store.listRunArtifacts(run.id, userId).length;
  }

  return {
    total_runs: runs.length,
    completed_runs: completed,
    failed_runs: failed,
    recoverable_runs: store.countRecoverableAgentRuns(userId),
    sandbox_steps: sandboxSteps,
    mcp_steps: mcpSteps,
    artifacts_count: artifactsCount,
    avg_step_ms: totalSteps > 0 ? Math.round(totalStepMs / totalSteps) : 0,
  };
}
