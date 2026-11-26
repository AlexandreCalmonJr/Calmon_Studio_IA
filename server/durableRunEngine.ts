/**
 * Fase 2 — Motor de Execução Durável (Checkpoints, Replay e Retomada).
 *
 * Persiste cada execução de agente (`agent_runs`), seus passos granulares
 * (`agent_run_steps`) e artefatos produzidos (`run_artifacts` via ArtifactStorageAdapter),
 * emitindo eventos idempotentes em tempo real para o Painel Lateral Vivo do Chat.
 */

import type { LocalSqliteBrainStore } from './brain/sqliteBrainStore.ts';
import type {
  AgentRunModel,
  AgentRunStepModel,
  AgentStepKind,
  AgentStepStatus,
  RunArtifactModel,
} from './brain/models.ts';
import type { ArtifactStorageAdapter } from './infra/storageAdapter.ts';

export interface RunRealtimeEmitter {
  emit(eventType: string, payload: Record<string, unknown>): void;
}

export interface AgentRunDetail {
  run: AgentRunModel;
  steps: AgentRunStepModel[];
  artifacts: RunArtifactModel[];
}

export class DurableRunEngine {
  private readonly store: LocalSqliteBrainStore;
  private readonly storage: ArtifactStorageAdapter;
  private readonly emitter?: RunRealtimeEmitter;

  constructor(opts: {
    store: LocalSqliteBrainStore;
    storage: ArtifactStorageAdapter;
    emitter?: RunRealtimeEmitter;
  }) {
    this.store = opts.store;
    this.storage = opts.storage;
    this.emitter = opts.emitter;
  }

  public startRun(input: {
    id?: string;
    sessionId: string;
    userId: string;
    agentRole: string;
    agentName: string;
    prompt: string;
    modelUsed?: string;
    executionMode?: string;
    checkpoint?: Record<string, unknown>;
  }): AgentRunModel {
    const run = this.store.createAgentRun({
      id: input.id,
      session_id: input.sessionId,
      user_id: input.userId,
      agent_role: input.agentRole,
      agent_name: input.agentName,
      prompt: input.prompt,
      status: 'running',
      model_used: input.modelUsed || '',
      execution_mode: input.executionMode || 'hybrid',
      checkpoint: input.checkpoint || { stage: 'started' },
    });
    this.emitter?.emit('run:started', { run });
    return run;
  }

  public recordStep(input: {
    runId: string;
    stepIndex: number;
    kind: AgentStepKind;
    title: string;
    status?: AgentStepStatus;
    durationMs?: number;
    inputSummary?: string;
    outputSummary?: string;
    checkpointPayload?: Record<string, unknown>;
  }): AgentRunStepModel {
    const step = this.store.appendAgentRunStep({
      run_id: input.runId,
      step_index: input.stepIndex,
      kind: input.kind,
      title: input.title,
      status: input.status || 'completed',
      duration_ms: input.durationMs ?? 0,
      input_summary: input.inputSummary || '',
      output_summary: input.outputSummary || '',
      checkpoint_payload: input.checkpointPayload || {},
    });
    this.emitter?.emit('run:step', { run_id: input.runId, step });
    return step;
  }

  public async saveArtifact(input: {
    runId: string;
    sessionId: string;
    userId: string;
    title: string;
    kind: string;
    filename: string;
    content: string;
    mimeType: string;
  }): Promise<RunArtifactModel> {
    const receipt = await this.storage.putObject({
      userId: input.userId,
      runId: input.runId,
      filename: input.filename,
      content: input.content,
      mimeType: input.mimeType,
    });
    const artifact = this.store.recordRunArtifact({
      run_id: input.runId,
      session_id: input.sessionId,
      user_id: input.userId,
      title: input.title,
      kind: input.kind,
      mime_type: receipt.mimeType,
      storage_driver: receipt.driver,
      storage_key: receipt.storageKey,
      size_bytes: receipt.sizeBytes,
      sha256: receipt.sha256,
      preview_text: input.content.slice(0, 12000),
    });
    this.emitter?.emit('run:artifact', { run_id: input.runId, artifact });
    return artifact;
  }

  public completeRun(input: {
    runId: string;
    modelUsed?: string;
    executionMode?: string;
    finalSummary: string;
    checkpoint?: Record<string, unknown>;
  }): AgentRunModel | null {
    const updated = this.store.updateAgentRun(input.runId, {
      status: 'completed',
      model_used: input.modelUsed,
      execution_mode: input.executionMode,
      final_summary: input.finalSummary,
      checkpoint: input.checkpoint,
      finished_at: new Date().toISOString(),
    });
    if (updated) {
      this.emitter?.emit('run:completed', { run: updated });
    }
    return updated;
  }

  public failRun(runId: string, errorMessage: string): AgentRunModel | null {
    const updated = this.store.updateAgentRun(runId, {
      status: 'failed',
      error_message: errorMessage,
      finished_at: new Date().toISOString(),
    });
    if (updated) {
      this.emitter?.emit('run:failed', { run: updated });
    }
    return updated;
  }

  public listRuns(userId: string, sessionId?: string, limit = 30): AgentRunModel[] {
    return this.store.listAgentRuns({ user_id: userId, session_id: sessionId, limit });
  }

  public getRunDetail(runId: string, userId: string): AgentRunDetail | null {
    const run = this.store.getAgentRun(runId, userId);
    if (!run) return null;
    return {
      run,
      steps: this.store.listAgentRunSteps(run.id),
      artifacts: this.store.listRunArtifacts(run.id, userId),
    };
  }

  public async resumeRunFromCheckpoint(
    runId: string,
    userId: string,
    fromStepIndex?: number,
    options?: {
      executeContinuation?: (ctx: {
        run: AgentRunModel;
        resumeFromStep: number;
        priorSteps: AgentRunStepModel[];
      }) => Promise<{
        output: string;
        modelUsed?: string;
        executionMode?: string;
        error?: string;
        artifact?: {
          title: string;
          filename: string;
          kind: string;
          content: string;
          mimeType: string;
        };
      }>;
    }
  ): Promise<AgentRunDetail | null> {
    const existing = this.getRunDetail(runId, userId);
    if (!existing) return null;

    let nextIndex = existing.steps.length;
    const resumeTarget =
      typeof fromStepIndex === 'number' && Number.isFinite(fromStepIndex)
        ? Math.max(0, Math.min(fromStepIndex, Math.max(0, existing.steps.length - 1)))
        : Math.max(0, existing.steps.length - 1);
    const targetStep = existing.steps[resumeTarget];
    const priorSteps = existing.steps.slice(0, resumeTarget + 1);

    const planStep = this.recordStep({
      runId: existing.run.id,
      stepIndex: nextIndex++,
      kind: 'plan',
      title: `Retomado do checkpoint #${resumeTarget + 1}${targetStep ? ` (${targetStep.title})` : ''}`,
      status: 'completed',
      durationMs: 5,
      inputSummary: `Status anterior: ${existing.run.status}`,
      outputSummary: options?.executeContinuation
        ? 'Snapshot restaurado do banco; iniciando re-execução real a partir deste checkpoint.'
        : 'Contexto restaurado a partir do snapshot persistido em banco; pronto para continuidade.',
      checkpointPayload: {
        resumed_from_step: resumeTarget,
        previous_status: existing.run.status,
        resumed_at: new Date().toISOString(),
      },
    });

    if (!options?.executeContinuation) {
      const updated = this.store.updateAgentRun(existing.run.id, {
        status: 'completed',
        error_message: null,
        final_summary:
          existing.run.final_summary ||
          `Execução retomada a partir do checkpoint #${resumeTarget + 1} (${targetStep?.title || 'início'}).`,
        checkpoint: {
          resumed_from_step: resumeTarget,
          last_step_id: planStep.id,
          resumed_at: new Date().toISOString(),
        },
        finished_at: new Date().toISOString(),
      });
      if (updated) {
        this.emitter?.emit('run:completed', { run: updated });
      }
      return this.getRunDetail(existing.run.id, userId);
    }

    // Marca como running durante a re-execução real do agente
    const runningRun = this.store.updateAgentRun(existing.run.id, {
      status: 'running',
      error_message: null,
      checkpoint: {
        resumed_from_step: resumeTarget,
        last_step_id: planStep.id,
        stage: 'continuing_inference',
        resumed_at: new Date().toISOString(),
      },
    });
    if (runningRun) {
      this.emitter?.emit('run:started', { run: runningRun });
    }

    const startedMs = Date.now();
    try {
      const result = await options.executeContinuation({
        run: existing.run,
        resumeFromStep: resumeTarget,
        priorSteps,
      });
      const elapsed = Math.max(1, Date.now() - startedMs);

      if (result.error) {
        this.recordStep({
          runId: existing.run.id,
          stepIndex: nextIndex++,
          kind: 'model',
          title: 'Continuação interrompida (provedor indisponível)',
          status: 'failed',
          durationMs: elapsed,
          inputSummary: `Retomada a partir do passo #${resumeTarget + 1}`,
          outputSummary: result.error.slice(0, 320),
        });
        this.failRun(existing.run.id, result.error.slice(0, 500));
        return this.getRunDetail(existing.run.id, userId);
      }

      const modelStep = this.recordStep({
        runId: existing.run.id,
        stepIndex: nextIndex++,
        kind: 'model',
        title: `Continuação executada (${result.modelUsed || existing.run.model_used || 'auto'})`,
        status: 'completed',
        durationMs: elapsed,
        inputSummary: `Contexto de ${priorSteps.length} passo(s) restaurado(s)`,
        outputSummary: result.output.slice(0, 360),
        checkpointPayload: {
          resumed_from_step: resumeTarget,
          model_used: result.modelUsed || existing.run.model_used,
        },
      });

      if (result.artifact) {
        await this.saveArtifact({
          runId: existing.run.id,
          sessionId: existing.run.session_id,
          userId,
          title: result.artifact.title,
          filename: result.artifact.filename,
          kind: result.artifact.kind,
          content: result.artifact.content,
          mimeType: result.artifact.mimeType,
        });
      }

      const responseStep = this.recordStep({
        runId: existing.run.id,
        stepIndex: nextIndex++,
        kind: 'response',
        title: 'Entrega da retomada persistida',
        status: 'completed',
        durationMs: 2,
        outputSummary: result.output.slice(0, 320),
      });

      const completed = this.store.updateAgentRun(existing.run.id, {
        status: 'completed',
        model_used: result.modelUsed || existing.run.model_used,
        execution_mode: result.executionMode || existing.run.execution_mode,
        error_message: null,
        final_summary: result.output.slice(0, 2000),
        checkpoint: {
          resumed_from_step: resumeTarget,
          model_step_id: modelStep.id,
          last_step_id: responseStep.id,
          resumed_at: new Date().toISOString(),
        },
        finished_at: new Date().toISOString(),
      });
      if (completed) {
        this.emitter?.emit('run:completed', { run: completed });
      }
      return this.getRunDetail(existing.run.id, userId);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erro ao executar continuação do checkpoint.';
      this.recordStep({
        runId: existing.run.id,
        stepIndex: nextIndex++,
        kind: 'model',
        title: 'Falha na continuação do checkpoint',
        status: 'failed',
        durationMs: Math.max(1, Date.now() - startedMs),
        outputSummary: errMsg.slice(0, 320),
      });
      this.failRun(existing.run.id, errMsg.slice(0, 500));
      return this.getRunDetail(existing.run.id, userId);
    }
  }
}
