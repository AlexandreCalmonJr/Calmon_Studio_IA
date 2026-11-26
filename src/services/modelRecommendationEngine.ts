export type AgentRecommendationCategory = 'voice' | 'coding' | 'reasoning' | 'orchestration';

export interface AgentModelRecommendation {
  category: AgentRecommendationCategory;
  title: string;
  description: string;
  agentRoles: string[];
  recommendedModel: string;
  reason: string;
}

const NON_CHAT_MODEL_RE =
  /\b(embed|rerank|guard|safety|gliner|nvclip|detector|parse|proteina|whisper|transcribe|tts|dall-e|imagen|flux|moderation)\b/i;

export function isChatCapableModelId(modelId: string): boolean {
  const clean = String(modelId || '').trim();
  if (!clean) return false;
  return !NON_CHAT_MODEL_RE.test(clean);
}

function pickBestModel(
  candidates: string[],
  patterns: RegExp[],
  fallbackPool: string[]
): string {
  for (const re of patterns) {
    const match = candidates.find((m) => re.test(m));
    if (match) return match;
  }
  return fallbackPool[0] || candidates[0] || '';
}

/**
 * Analisa os modelos descobertos de uma chave de API e sugere o melhor
 * modelo para cada perfil de agente (Voz, Código, Raciocínio e Orquestração).
 */
export function buildAgentModelRecommendations(
  discoveredModels: string[]
): AgentModelRecommendation[] {
  const chatModels = Array.from(
    new Set(discoveredModels.map((m) => String(m || '').trim()).filter(isChatCapableModelId))
  );
  if (chatModels.length === 0) return [];

  const voiceModel = pickBestModel(
    chatModels,
    [
      /bolt/i,
      /flash/i,
      /mini(?!max)/i,
      /haiku/i,
      /nano(?!.*reasoning)/i,
      /\b(3b|4b|7b|8b)\b/i,
      /instant|turbo/i,
    ],
    chatModels
  );

  const codingModel = pickBestModel(
    chatModels,
    [
      /laguna/i,
      /coder|codestral|devstral|starcoder/i,
      /deepseek-chat|deepseek\/deepseek-v/i,
      /kimi/i,
      /sonnet/i,
      /gpt-4o(?!-mini)|gpt-4\.1/i,
      /qwen.*coder/i,
    ],
    chatModels
  );

  const reasoningModel = pickBestModel(
    chatModels,
    [
      /reasoning|reasoner/i,
      /\b(r1|o1|o3|o4)\b/i,
      /thinking/i,
      /opus/i,
      /ultra|550b|405b|120b|70b/i,
      /large/i,
    ],
    chatModels
  );

  const orchestrationModel = pickBestModel(
    chatModels,
    [
      /ultra|550b/i,
      /gpt-4o|gpt-4\.1/i,
      /sonnet/i,
      /minimax.*flash/i,
      /large|pro\b/i,
      /llama-3\.3|llama-3\.1.*70b/i,
    ],
    chatModels
  );

  return [
    {
      category: 'voice',
      title: 'Voz & Respostas Rápidas',
      description: 'Assistente de Voz, Tutor de Inglês e comandos de baixa latência',
      agentRoles: ['english_tutor'],
      recommendedModel: voiceModel,
      reason: 'Modelo leve/rápido ideal para interação falada em tempo real.',
    },
    {
      category: 'coding',
      title: 'Código & Engenharia',
      description: 'Arquiteto, Frontend, Backend, QA, Code Reviewer e DevOps',
      agentRoles: [
        'software_architect',
        'frontend_mobile_developer',
        'backend_developer',
        'qa_engineer',
        'code_reviewer',
        'devops_engineer',
      ],
      recommendedModel: codingModel,
      reason: 'Especializado em geração, análise e refatoração de código.',
    },
    {
      category: 'reasoning',
      title: 'Raciocínio, Segurança & Análise',
      description: 'Sentinela, Cibersegurança, Matemática e Pesquisador Web',
      agentRoles: [
        'sentinel_security',
        'cybersecurity_engineer',
        'math_tutor',
        'research_analyst',
      ],
      recommendedModel: reasoningModel,
      reason: 'Maior capacidade de raciocínio lógico e auditoria técnica.',
    },
    {
      category: 'orchestration',
      title: 'Orquestração & Documentos',
      description: 'Maestro, Apresentações, PDFs, Finanças, Fluxos e Design',
      agentRoles: [
        'jarvis_master',
        'presentation_creator',
        'document_specialist',
        'finance_business',
        'flow_architect',
        'ux_ui_designer',
      ],
      recommendedModel: orchestrationModel,
      reason: 'Equilíbrio entre qualidade textual e planejamento multi-agente.',
    },
  ];
}
