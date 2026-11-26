export interface HybridSourceItem {
  title: string;
  url: string;
}

export interface AgentMascotMeta {
  id: string;
  color: string;
  accessory: string;
  mood?: string;
}

export interface ChatMediaAsset {
  kind: 'image' | 'video' | 'spreadsheet';
  id: string;
  title: string;
  url: string;
  secondary_url?: string;
  status?: 'running' | 'completed' | 'failed';
  status_url?: string;
  mime_type: string;
  model_used?: string;
}

export interface TaskStateResponse {
  task_id: string;
  session_id: string;
  user_prompt: string;
  project_id?: string;
  classified_intent?: string;
  plan_steps: string[];
  selected_agents: string[];
  policy_verified: boolean;
  policy_violations: string[];
  approval_required: boolean;
  approval_id?: string;
  agent_outputs?: any[];
  final_summary?: string;
  is_completed: boolean;
  error?: string | null;
  execution_mode?: 'LOCAL' | 'ONLINE';
  provider?: 'ollama' | 'gemini' | string;
  model_used?: string;
  requested_model?: string;
  model_source?: string;
  fallback_occurred?: boolean;
  skills_used?: Array<{
    id: string;
    name: string;
    domain?: string;
    allowed_tools?: string[];
  }>;
  latency_ms?: number;
  reasoning?: string;
  routing_note?: string;
  sources?: HybridSourceItem[];
  agent_meta?: {
    role: string;
    name: string;
    proper_name: string;
    handle: string;
    mascot?: AgentMascotMeta;
  };
  orchestration_mode?: string;
  artifact_payload?: {
    id: string;
    kind: 'pptx' | 'pdf' | 'png';
    title: string;
    subtitle: string;
    author: string;
    created_at: string;
    slides?: Array<{
      title: string;
      subtitle?: string;
      bullets: string[];
      speakerNotes?: string;
      accent?: string;
    }>;
    sections?: Array<{
      heading: string;
      body: string;
      highlights?: string[];
    }>;
    svg_markup?: string;
    palette?: string[];
    model_used: string;
  } | null;
  media_assets?: ChatMediaAsset[];
}

export interface ChatSessionItem {
  session_id: string;
  title: string;
  first_prompt?: string;
  task_count: number;
  last_activity: string;
  first_intent?: string;
}

export interface ChatMessage {
  sender: 'user' | 'jarvis';
  text: string;
  taskData?: TaskStateResponse;
  timestamp: string;
  statusMessage?: string;
}

/** Converte identificadores técnicos (snake_case, kebab-case, UPPER_CASE) em texto legível. */
export const humanizeLabel = (value?: string | null): string => {
  const clean = (value || '').trim();
  if (!clean) return '';
  return clean
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};
