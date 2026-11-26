import { TaskStateResponse, ChatSessionItem } from '../../types';
import { API_BASE, handleApiResponse } from './client';
import { apiFetch } from '../sessionTransport';

export async function sendChatMessage(
  prompt: string,
  projectId?: string,
  sessionId?: string,
  model?: string
): Promise<TaskStateResponse> {
  const res = await apiFetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, project_id: projectId, session_id: sessionId, model }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: 'Erro desconhecido' }));
    throw new Error(errorData.detail || 'Erro ao processar mensagem');
  }
  return res.json();
}

export interface AgentRunRecord {
  id: string;
  session_id: string;
  user_id: string;
  agent_role: string;
  agent_name: string;
  prompt: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'interrupted';
  model_used: string;
  execution_mode: string;
  current_step_index: number;
  total_steps: number;
  final_summary: string;
  checkpoint_json: string;
  error_message: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface AgentRunStepRecord {
  id: string;
  run_id: string;
  step_index: number;
  kind: 'plan' | 'memory' | 'skill' | 'mcp' | 'sandbox' | 'model' | 'artifact' | 'response';
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  duration_ms: number;
  input_summary: string;
  output_summary: string;
  checkpoint_payload_json: string;
  started_at: string;
  finished_at: string | null;
}

export interface RunArtifactRecord {
  id: string;
  run_id: string;
  session_id: string;
  user_id: string;
  title: string;
  kind: string;
  mime_type: string;
  storage_driver: string;
  storage_key: string;
  size_bytes: number;
  sha256: string;
  preview_text: string;
  created_at: string;
}

export interface AgentRunDetailResponse {
  run: AgentRunRecord;
  steps: AgentRunStepRecord[];
  artifacts: RunArtifactRecord[];
}

export interface StreamRunEventPayload {
  type: 'run_started' | 'run_step' | 'run_artifact' | 'run_completed';
  run_id?: string;
  run?: AgentRunRecord;
  step?: AgentRunStepRecord;
  artifact?: RunArtifactRecord;
}

export async function fetchAgentRuns(sessionId?: string, limit = 20): Promise<{
  runs: AgentRunRecord[];
  recoverable_count: number;
}> {
  const qs = new URLSearchParams();
  if (sessionId) qs.set('session_id', sessionId);
  qs.set('limit', String(limit));
  const res = await apiFetch(`${API_BASE}/chat/runs?${qs.toString()}`);
  return handleApiResponse(res, 'Falha ao listar execuções do agente.');
}

export async function fetchAgentRunDetail(runId: string): Promise<AgentRunDetailResponse> {
  const res = await apiFetch(`${API_BASE}/chat/runs/${encodeURIComponent(runId)}`);
  return handleApiResponse(res, 'Falha ao carregar detalhes da execução.');
}

export async function resumeAgentRun(runId: string, fromStepIndex?: number): Promise<AgentRunDetailResponse> {
  const res = await apiFetch(`${API_BASE}/chat/runs/${encodeURIComponent(runId)}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      typeof fromStepIndex === 'number' ? { from_step_index: fromStepIndex } : {}
    ),
  });
  return handleApiResponse(res, 'Falha ao retomar execução do checkpoint.');
}

export function getRunArtifactDownloadUrl(runId: string, artifactId: string): string {
  return `${API_BASE}/chat/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}/download`;
}

export interface AgentRunStatsResponse {
  total_runs: number;
  completed_runs: number;
  failed_runs: number;
  recoverable_runs: number;
  sandbox_steps: number;
  mcp_steps: number;
  artifacts_count: number;
  avg_step_ms: number;
  sandbox_driver: string;
  storage_driver: string;
  queue_driver: string;
}

export async function fetchAgentRunStatsApi(): Promise<AgentRunStatsResponse> {
  const res = await apiFetch(`${API_BASE}/chat/runs/stats`);
  return handleApiResponse<AgentRunStatsResponse>(res, 'Falha ao carregar métricas de execução.');
}

export async function executeRunSandboxStepApi(
  runId: string,
  command: string,
  args: string[]
): Promise<{
  allowed: boolean;
  reason?: string;
  session: any;
  step: AgentRunStepRecord;
  detail: AgentRunDetailResponse;
}> {
  const res = await apiFetch(`${API_BASE}/chat/runs/${encodeURIComponent(runId)}/sandbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, args }),
  });
  return handleApiResponse(res, 'Falha ao executar comando no Sandbox vinculado à execução.');
}

export async function streamChatMessage(
  prompt: string,
  projectId?: string,
  sessionId?: string,
  onChunk?: (token: string) => void,
  onMeta?: (meta: any) => void,
  onDone?: (done: any) => void,
  onError?: (err: string, code?: string) => void,
  onStatus?: (status: any) => void,
  signal?: AbortSignal,
  model?: string,
  options?: { enableWebSearch?: boolean; assistantName?: string; onRunEvent?: (ev: StreamRunEventPayload) => void }
): Promise<void> {
  const res = await apiFetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      project_id: projectId,
      session_id: sessionId,
      model,
      enable_web_search: options?.enableWebSearch,
      assistant_name: options?.assistantName,
    }),
    signal,
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: 'Erro no streaming' }));
    throw new Error(errorData.detail || 'Erro ao processar mensagem em streaming');
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Streaming não suportado pelo navegador.');

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const dataStr = trimmed.slice(6);
      try {
        const payload = JSON.parse(dataStr);
        if (payload.type === 'meta' && onMeta) onMeta(payload);
        else if (payload.type === 'token' && onChunk) onChunk(payload.chunk);
        else if (payload.type === 'done' && onDone) onDone(payload);
        else if (payload.type === 'status' && onStatus) onStatus(payload);
        else if (payload.type === 'error' && onError) onError(payload.error, payload.code);
        else if (
          (payload.type === 'run_started' ||
            payload.type === 'run_step' ||
            payload.type === 'run_artifact' ||
            payload.type === 'run_completed') &&
          options?.onRunEvent
        ) {
          options.onRunEvent(payload as StreamRunEventPayload);
        }
      } catch (e) {
        console.warn('Erro ao processar chunk SSE:', e);
      }
    }
  }
}

export async function fetchTasks(): Promise<any[]> {
  const res = await apiFetch(`${API_BASE}/tasks`);
  return handleApiResponse<any[]>(res, 'Falha ao carregar tarefas.');
}

export async function fetchChatSessions(): Promise<ChatSessionItem[]> {
  const res = await apiFetch(`${API_BASE}/chat/sessions`);
  return handleApiResponse<ChatSessionItem[]>(res, 'Falha ao carregar sessões de conversa.');
}

export interface ChatSessionDetails {
  session_id: string;
  tasks: any[];
  messages: Array<{
    id?: number;
    session_id: string;
    project_id?: string | null;
    role: string;
    content: string;
    tool_calls?: any[];
    created_at?: string;
  }>;
}

export async function fetchChatSessionDetails(sessionId: string): Promise<ChatSessionDetails> {
  const res = await apiFetch(`${API_BASE}/chat/sessions/${encodeURIComponent(sessionId)}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: 'Falha ao carregar a conversa.' }));
    throw new Error(errorData.detail || 'Falha ao carregar a conversa.');
  }
  const data = await res.json();
  return {
    session_id: data.session_id || sessionId,
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    messages: Array.isArray(data.messages) ? data.messages : [],
  };
}

export async function fetchChatSessionTasks(sessionId: string): Promise<any[]> {
  const res = await apiFetch(`${API_BASE}/chat/sessions/${encodeURIComponent(sessionId)}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: 'Falha ao carregar a conversa.' }));
    throw new Error(errorData.detail || 'Falha ao carregar a conversa.');
  }
  const data = await res.json();
  return data.tasks || [];
}

export async function deleteChatSession(sessionId: string): Promise<any> {
  const res = await apiFetch(`${API_BASE}/chat/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  return handleApiResponse<any>(res, 'Falha ao excluir a conversa.');
}

export async function searchChatHistory(query: string): Promise<any[]> {
  const res = await apiFetch(`${API_BASE}/chat/search?query=${encodeURIComponent(query)}`);
  return handleApiResponse<any[]>(res, 'Falha ao pesquisar o histórico de conversas.');
}

export async function exportChatSessionMarkdown(sessionId: string): Promise<string> {
  const res = await apiFetch(`${API_BASE}/chat/sessions/${sessionId}/export`);
  if (!res.ok) throw new Error('Falha ao exportar sessão');
  return res.text();
}

export async function deleteTask(taskId: string): Promise<boolean> {
  const res = await apiFetch(`${API_BASE}/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: 'Falha ao excluir tarefa.' }));
    throw new Error(errorData.detail || 'Falha ao excluir tarefa.');
  }
  const data = await res.json();
  return !!data.deleted;
}

export async function purgeTasks(daysRetention: number = 30): Promise<{ purged_count: number; retention_days: number }> {
  const res = await apiFetch(`${API_BASE}/tasks/purge?days_retention=${daysRetention}`, { method: 'POST' });
  return handleApiResponse<{ purged_count: number; retention_days: number }>(res, 'Falha ao limpar tarefas antigas.');
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const formData = new FormData();
  formData.append('file', blob, 'microphone.webm');

  const res = await apiFetch(`${API_BASE}/voice/transcribe`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Falha na transcrição' }));
    throw new Error(err.detail || 'Falha ao transcrever áudio');
  }

  const data = await res.json();
  return data.text || '';
}

