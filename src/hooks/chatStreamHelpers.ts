import type { TaskStateResponse } from '../types';
import type { CanvasArtifact } from '../features/chat/ArtifactCanvas';

/**
 * Consolida os metadados finais da tarefa após a conclusão do stream SSE.
 */
export function buildCompletedTaskData(
  done: any,
  metaInfo: any,
  finalText: string
): TaskStateResponse {
  const sourceList = Array.isArray(done?.sources) ? done.sources : [];
  return {
    ...metaInfo,
    final_summary: finalText,
    is_completed: done?.is_completed,
    approval_required: done?.approval_required,
    approval_id: done?.approval_id,
    execution_mode: done?.execution_mode || metaInfo?.execution_mode,
    provider: done?.provider || metaInfo?.provider,
    model_used: done?.model_used || metaInfo?.model_used,
    requested_model: done?.requested_model || metaInfo?.requested_model,
    model_source: done?.model_source || metaInfo?.model_source,
    fallback_occurred:
      typeof done?.fallback_occurred === 'boolean'
        ? done.fallback_occurred
        : metaInfo?.fallback_occurred,
    skills_used: Array.isArray(done?.skills_used)
      ? done.skills_used
      : Array.isArray(metaInfo?.skills_used)
        ? metaInfo.skills_used
        : [],
    latency_ms: done?.latency_ms ?? metaInfo?.latency_ms,
    reasoning: done?.reasoning || metaInfo?.reasoning,
    routing_note: done?.routing_note || metaInfo?.routing_note,
    sources: sourceList,
    agent_meta: done?.agent_meta || metaInfo?.agent_meta,
    selected_agents: done?.selected_agents || metaInfo?.selected_agents || [],
    plan_steps: done?.plan_steps || metaInfo?.plan_steps || [],
    classified_intent: done?.classified_intent || metaInfo?.classified_intent,
    agent_outputs: done?.agent_outputs || metaInfo?.agent_outputs,
    orchestration_mode: done?.orchestration_mode || metaInfo?.orchestration_mode,
    artifact_payload: done?.artifact_payload || null,
    media_assets: Array.isArray(done?.media_assets)
      ? done.media_assets
      : Array.isArray(metaInfo?.media_assets)
        ? metaInfo.media_assets
        : undefined,
  };
}

/**
 * Extrai artefatos estruturados, código, projetos do workspace ou diffs de uma resposta finalizada.
 */
export function detectStreamArtifacts(
  done: any,
  finalText: string
): { artifact: CanvasArtifact | null; projectsNeedRefresh: boolean } {
  if (done?.artifact_payload) {
    return {
      artifact: {
        title: done.artifact_payload.title || 'Artefato Gerado',
        structuredArtifact: done.artifact_payload,
        studioMode: true,
      },
      projectsNeedRefresh: false,
    };
  }

  try {
    const trimmedFinal = finalText.trim();
    let jsonStr = '';
    if (trimmedFinal.startsWith('{') && trimmedFinal.endsWith('}')) {
      jsonStr = trimmedFinal;
    } else {
      const m = trimmedFinal.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (m) jsonStr = m[1];
    }
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      if (parsed.artifact_payload && parsed.artifact_payload.code) {
        return {
          artifact: {
            title: parsed.artifact_payload.title || 'Artefato de Código',
            content: parsed.artifact_payload.code,
            htmlContent: parsed.artifact_payload.language === 'html' ? parsed.artifact_payload.code : undefined,
            mode: parsed.active_agent_mode,
            planStatus: parsed.ui_layout_instructions?.plan_status,
          },
          projectsNeedRefresh: false,
        };
      }
    }
  } catch {
    // Ignora JSON inválido no corpo livre
  }

  const prjMatch = finalText.match(/workspace[\\/]([a-zA-Z0-9_-]+)/i);
  const diffMatch = finalText.match(/```diff\n([\s\S]*?)\n```/);
  if (prjMatch || diffMatch) {
    return {
      artifact: {
        title: prjMatch ? `Projeto: ${prjMatch[1]}` : 'Diff de Alterações',
        projectId: prjMatch ? prjMatch[1] : undefined,
        diffContent: diffMatch ? diffMatch[1] : undefined,
        content: finalText,
      },
      projectsNeedRefresh: true,
    };
  }

  return { artifact: null, projectsNeedRefresh: false };
}
