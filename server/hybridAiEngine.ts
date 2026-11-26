import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  NotebookHardwareProfile,
  estimateVramGbFromModelName,
  evaluateVramFit,
} from '../src/services/hardwareAdvisor.ts';
import {
  EXTERNAL_PROVIDERS,
  inferExternalProviderFromModel,
  runExternalProviderChat,
  type ExternalProviderId,
  type ResolvedExternalCredential,
} from './providerEngine.ts';
import type { ChatHistoryTurn } from './agentRuntime.ts';

export interface HybridSource {
  title: string;
  url: string;
}

export interface HybridInferenceRequest {
  prompt: string;
  systemInstruction: string;
  history?: ChatHistoryTurn[];
  requestedModel?: string;
  fallbackModel?: string;
  routingPolicy?: 'auto_hybrid' | 'local_only' | 'online_only';
  ollamaBaseUrl?: string;
  ollamaConnected?: boolean;
  geminiConnected?: boolean;
  enableWebSearch?: boolean;
  assistantName?: string;
  agentName?: string;
  agentProperName?: string;
  strictFocus?: boolean;
  strictTopic?: string;
  externalProvider?: ResolvedExternalCredential | null;
  onToken?: (chunk: string) => void;
}

export interface HybridInferenceResult {
  text: string;
  reasoning: string;
  sources: HybridSource[];
  executionMode: 'LOCAL' | 'ONLINE';
  provider: 'ollama' | 'gemini' | ExternalProviderId | string;
  requestedModel: string;
  modelUsed: string;
  fallbackOccurred: boolean;
  latencyMs: number;
  routingNote?: string;
}

const VALID_GEMINI_MODELS = new Set([
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-4-neon',
  'gemini-4-carbon',
  'gemini-4-argon',
]);

const DEPRECATED_GEMINI_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
]);

function formatReadableApiError(err: unknown, fallbackLabel = 'falha na API'): string {
  let raw = err instanceof Error ? err.message : String(err || fallbackLabel);
  for (let depth = 0; depth < 3; depth++) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{')) break;
    try {
      const parsed = JSON.parse(trimmed) as { error?: { message?: string; code?: number }; message?: string };
      if (parsed?.error?.message) {
        raw = parsed.error.message;
        continue;
      }
      if (parsed?.message) {
        raw = parsed.message;
        continue;
      }
    } catch {
      break;
    }
    break;
  }
  const singleLine = raw.replace(/\s+/g, ' ').trim();
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(singleLine)) {
    return 'cota/limite temporário excedido (429)';
  }
  if (/404|NOT_FOUND|no longer available/i.test(singleLine)) {
    return 'modelo indisponível para esta chave (404)';
  }
  if (/401|403|API_KEY_INVALID|permission/i.test(singleLine)) {
    return 'credencial sem permissão ou inválida';
  }
  return singleLine.slice(0, 140) || fallbackLabel;
}

const GEMINI_4_MODELS = new Set([
  'gemini-4-hydrogen',
  'gemini-4-neon',
  'gemini-4-carbon',
  'gemini-4-argon',
]);

let cachedAiClient: GoogleGenAI | null = null;
let cachedKeySignature = '';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  if (!cachedAiClient || cachedKeySignature !== apiKey) {
    cachedAiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedKeySignature = apiKey;
  }
  return cachedAiClient;
}

export function isGeminiApiConfigured(): boolean {
  return Boolean((process.env.GEMINI_API_KEY || '').trim());
}

export function isGeminiModelId(model?: string): boolean {
  const m = (model || '').toLowerCase().trim();
  return m.startsWith('gemini-') || m === 'online' || m === 'gemini';
}

export function resolveSafeGeminiModel(requested?: string): string {
  const resolved = resolveGeminiModelChoice(requested);
  return resolved.model;
}

export function resolveGeminiModelChoice(requested?: string): {
  model: string;
  remapped: boolean;
  reason?: string;
} {
  const clean = (requested || '').trim().toLowerCase();
  if (!clean || clean === 'auto' || clean === 'auto_hybrid' || clean === 'online' || clean === 'gemini') {
    return { model: 'gemini-4-hydrogen', remapped: false };
  }
  if (VALID_GEMINI_MODELS.has(clean)) {
    return { model: clean, remapped: false };
  }
  if (DEPRECATED_GEMINI_MODELS.has(clean)) {
    return {
      model: 'gemini-4-hydrogen',
      remapped: true,
      reason: `Modelo legado "${requested}" não é mais suportado → direcionado para gemini-4-hydrogen.`,
    };
  }
  // Aceita identificadores completos versionados (ex.: gemini-2.5-flash-preview-12-2025, gemini-3.1-pro-preview)
  if (/^gemini-[0-9]+(?:\.[0-9]+)?-[a-z0-9-]+$/i.test(clean)) {
    return { model: clean, remapped: false };
  }
  return {
    model: 'gemini-4-hydrogen',
    remapped: true,
    reason: `Modelo "${requested}" não reconhecido no catálogo Gemini → direcionado para gemini-4-hydrogen.`,
  };
}

function shouldEnableWebSearch(prompt: string, explicit?: boolean): boolean {
  if (explicit === true) return true;
  if (explicit === false) return false;
  return /\b(pesquis|not[ií]cia|hoje|atual|pre[cç]o|cota[cç][aã]o|google|internet|web|fonte|ver[ií]dic|2025|2026|lan[cç]amento|quem ganhou)\b/i.test(
    prompt
  );
}

export function buildGeminiContents(
  history: ChatHistoryTurn[] | undefined,
  prompt: string
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const turns: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
  if (Array.isArray(history)) {
    for (const h of history) {
      const content = String(h?.content || '').trim();
      if (!content) continue;
      turns.push({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: content }],
      });
    }
  }
  turns.push({
    role: 'user',
    parts: [{ text: prompt }],
  });
  return turns;
}

async function runOllamaChat(
  ollamaBaseUrl: string,
  model: string,
  systemInstruction: string,
  prompt: string,
  history?: ChatHistoryTurn[],
  onToken?: (chunk: string) => void
): Promise<{ text: string; reasoning: string; latencyMs: number }> {
  const start = Date.now();
  const base = ollamaBaseUrl.replace(/\/+$/, '');
  const controller = new AbortController();
  const timeoutMs = Math.max(30_000, Number(process.env.OLLAMA_TIMEOUT_MS || 240_000));
  let timeout = setTimeout(() => controller.abort(), timeoutMs);
  const resetTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(), timeoutMs);
  };
  const messages = [
    { role: 'system', content: systemInstruction },
    ...(Array.isArray(history)
      ? history
          .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && h.content.trim())
          .map((h) => ({ role: h.role, content: h.content }))
      : []),
    { role: 'user', content: prompt },
  ];

  try {
    const useStream = Boolean(onToken);
    const response = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: useStream,
        keep_alive: '15m',
        messages,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama respondeu com status HTTP ${response.status}`);
    }

    if (useStream && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let rawAccumulated = '';
      let reasoningAccumulated = '';
      let inThinkTag = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetTimeout();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as {
              message?: { content?: string; thinking?: string };
              response?: string;
            };
            if (parsed?.message?.thinking) {
              reasoningAccumulated += parsed.message.thinking;
            }
            const piece = String(parsed?.message?.content || parsed?.response || '');
            if (!piece) continue;
            rawAccumulated += piece;
            if (piece.includes('<think>')) inThinkTag = true;
            if (!inThinkTag) {
              onToken?.(piece);
            }
            if (piece.includes('</think>')) inThinkTag = false;
          } catch {
            // ignora linha parcial
          }
        }
      }

      const thinkMatch = rawAccumulated.match(/<think>([\s\S]*?)<\/think>/i);
      const reasoning = (reasoningAccumulated || thinkMatch?.[1] || '').trim();
      const text = rawAccumulated.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      return {
        text: text || 'Resposta vazia retornada pelo nó Ollama local.',
        reasoning,
        latencyMs: Date.now() - start,
      };
    }

    const payload = (await response.json()) as {
      message?: { content?: string; thinking?: string };
      response?: string;
    };
    const rawContent = String(payload?.message?.content || payload?.response || '').trim();
    const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/i);
    const reasoning = (payload?.message?.thinking || thinkMatch?.[1] || '').trim();
    const text = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    return {
      text: text || 'Resposta vazia retornada pelo nó Ollama local.',
      reasoning,
      latencyMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchOllamaLocalModels(ollamaBaseUrl: string): Promise<{
  reachable: boolean;
  latencyMs: number;
  models: Array<{ name: string; size: number; modified_at: string; family?: string; parameter_size?: string }>;
  error?: string;
}> {
  const start = Date.now();
  const base = (ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(`${base}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return {
        reachable: false,
        latencyMs: Date.now() - start,
        models: [],
        error: `HTTP ${res.status}`,
      };
    }
    const json = (await res.json()) as { models?: any[] };
    const models = Array.isArray(json?.models)
      ? json.models.map((m) => ({
          name: String(m.name || m.model || ''),
          size: Number(m.size || 0),
          modified_at: String(m.modified_at || new Date().toISOString()),
          family: String(m.details?.family || 'ollama'),
          parameter_size: String(m.details?.parameter_size || ''),
        }))
      : [];
    return { reachable: true, latencyMs: Date.now() - start, models };
  } catch (err: any) {
    return {
      reachable: false,
      latencyMs: Date.now() - start,
      models: [],
      error: err?.name === 'AbortError' ? 'Timeout ao contactar nó Ollama local' : String(err?.message || 'Offline'),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runGeminiInference(
  model: string,
  systemInstruction: string,
  prompt: string,
  enableWebSearch: boolean,
  history?: ChatHistoryTurn[],
  onToken?: (chunk: string) => void
): Promise<{ text: string; reasoning: string; sources: HybridSource[]; latencyMs: number }> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error(
      'GEMINI_API_KEY não configurada no servidor. Configure a chave no painel Settings > Secrets para ativar o motor Gemini Online.'
    );
  }

  const start = Date.now();
  const useSearch = enableWebSearch;
  const isGemini4 = GEMINI_4_MODELS.has(model);

  const config: Record<string, any> = {
    systemInstruction,
  };

  if (useSearch) {
    config.tools = [{ googleSearch: {} }];
  }

  if (isGemini4) {
    config.thinkingConfig = {
      thinkingLevel: ThinkingLevel.MEDIUM,
      includeThoughts: true,
    };
  }

  const contents = buildGeminiContents(history, prompt);

  if (onToken) {
    const stream = await ai.models.generateContentStream({
      model,
      contents,
      config,
    });

    const thoughtParts: string[] = [];
    const answerParts: string[] = [];
    const sources: HybridSource[] = [];
    const seenUrls = new Set<string>();

    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts || [];
      let emittedFromParts = false;
      for (const part of parts as Array<{ text?: string; thought?: boolean }>) {
        if (!part?.text) continue;
        if (part.thought) {
          thoughtParts.push(part.text);
        } else {
          answerParts.push(part.text);
          onToken(part.text);
          emittedFromParts = true;
        }
      }
      if (!emittedFromParts && chunk.text) {
        answerParts.push(chunk.text);
        onToken(chunk.text);
      }

      const rawChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      for (const gc of rawChunks as Array<{ web?: { uri?: string; title?: string } }>) {
        const uri = gc?.web?.uri;
        if (!uri || seenUrls.has(uri)) continue;
        seenUrls.add(uri);
        sources.push({
          title: gc?.web?.title || uri,
          url: uri,
        });
      }
    }

    const text = answerParts.join('').trim();
    const reasoning =
      thoughtParts.join('').trim() ||
      `Roteamento concluído em ${model}${useSearch ? ' com Google Search Grounding ativo' : ''}.`;

    return {
      text: text || 'O modelo concluiu sem conteúdo textual.',
      reasoning,
      sources,
      latencyMs: Date.now() - start,
    };
  }

  const response = await ai.models.generateContent({
    model,
    contents,
    config,
  });

  const parts = response.candidates?.[0]?.content?.parts || [];
  const thoughtParts: string[] = [];
  const answerParts: string[] = [];

  for (const part of parts as Array<{ text?: string; thought?: boolean }>) {
    if (!part?.text) continue;
    if (part.thought) {
      thoughtParts.push(part.text.trim());
    } else {
      answerParts.push(part.text);
    }
  }

  const text = (answerParts.join('') || response.text || '').trim();
  const reasoning =
    thoughtParts.join('\n\n').trim() ||
    `Roteamento concluído em ${model}${useSearch ? ' com Google Search Grounding ativo' : ''}.`;

  const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sources: HybridSource[] = [];
  const seenUrls = new Set<string>();

  for (const chunk of rawChunks as Array<{ web?: { uri?: string; title?: string } }>) {
    const uri = chunk?.web?.uri;
    if (!uri || seenUrls.has(uri)) continue;
    seenUrls.add(uri);
    sources.push({
      title: chunk?.web?.title || uri,
      url: uri,
    });
  }

  return {
    text: text || 'O modelo concluiu sem conteúdo textual.',
    reasoning,
    sources,
    latencyMs: Date.now() - start,
  };
}

export async function runHybridInference(req: HybridInferenceRequest): Promise<HybridInferenceResult> {
  const assistantName = req.assistantName || 'Calmon IA';
  const agentDisplay = req.agentProperName
    ? `${req.agentProperName} (${req.agentName || 'Especialista'})`
    : req.agentName || assistantName;

  const strictGuard = req.strictFocus
    ? `\nREGRA DE FOCO ESTRITO ATIVADA: Você deve responder exclusivamente sobre o seu domínio (${req.strictTopic || req.agentName || 'sua especialidade'}). Se o pedido fugir totalmente do seu escopo, explique gentilmente qual é o seu foco e sugira chamar o assistente principal ${assistantName}.`
    : '';

  const fullSystemPrompt = `${req.systemInstruction}\nVocê atua dentro do ecossistema ${assistantName} AI Hub como ${agentDisplay}. Responda em português do Brasil claro, objetivo, estruturado em Markdown limpo quando útil e sem expor detalhes técnicos internos desnecessários.${strictGuard}`;

  const policy = req.routingPolicy || 'auto_hybrid';
  const requested = (req.requestedModel || '').trim();
  const effectiveRequestedLabel = requested || 'gemini-4-hydrogen';
  const inferredExternal = inferExternalProviderFromModel(requested);

  const ollamaUrl = req.ollamaBaseUrl || 'http://127.0.0.1:11434';
  const ollamaEnabled = req.ollamaConnected !== false;
  const geminiEnabled = req.geminiConnected !== false && isGeminiApiConfigured();

  // 1. Provedores Externos (Anthropic, OpenAI, DeepSeek, Groq, OpenRouter, xAI, Custom)
  const shouldUseExternal =
    policy !== 'local_only' &&
    Boolean(
      inferredExternal ||
        (req.externalProvider &&
          requested &&
          !isGeminiModelId(requested) &&
          requested === req.externalProvider.model)
    );

  if (shouldUseExternal) {
    if (req.externalProvider && (!inferredExternal || req.externalProvider.provider === inferredExternal)) {
      try {
        const extResult = await runExternalProviderChat({
          credential: req.externalProvider,
          systemInstruction: fullSystemPrompt,
          prompt: req.prompt,
          history: req.history,
          requestedModel: requested || req.externalProvider.model,
        });
        if (req.onToken && extResult.text) {
          req.onToken(extResult.text);
        }
        return {
          text: extResult.text,
          reasoning: extResult.reasoning,
          sources: [],
          executionMode: 'ONLINE',
          provider: extResult.provider,
          requestedModel: effectiveRequestedLabel,
          modelUsed: extResult.modelUsed,
          fallbackOccurred: false,
          latencyMs: extResult.latencyMs,
        };
      } catch (extErr: any) {
        const extReason = formatReadableApiError(extErr, 'falha na API externa');
        if (!geminiEnabled) {
          throw new Error(
            `Falha no modelo externo solicitado (${effectiveRequestedLabel}): ${extReason}. Nenhum fallback online disponível.`
          );
        }
        const fallbackGemini = resolveGeminiModelChoice(req.fallbackModel || 'gemini-4-hydrogen').model;
        const useWeb = shouldEnableWebSearch(req.prompt, req.enableWebSearch);
        const onlineResult = await runGeminiInference(
          fallbackGemini,
          fullSystemPrompt,
          req.prompt,
          useWeb,
          req.history,
          req.onToken
        );
        return {
          text: onlineResult.text,
          reasoning: onlineResult.reasoning,
          sources: onlineResult.sources,
          executionMode: 'ONLINE',
          provider: 'gemini',
          requestedModel: effectiveRequestedLabel,
          modelUsed: fallbackGemini,
          fallbackOccurred: true,
          latencyMs: onlineResult.latencyMs,
          routingNote: `Solicitado: ${effectiveRequestedLabel} (erro: ${extReason}) → Respondido por: ${fallbackGemini} (Gemini Online).`,
        };
      }
    } else if (inferredExternal) {
      const provName = EXTERNAL_PROVIDERS[inferredExternal]?.name || inferredExternal;
      if (!geminiEnabled) {
        throw new Error(
          `Modelo solicitado (${effectiveRequestedLabel}) exige chave configurada para ${provName} na Central de Modelos.`
        );
      }
      const fallbackGemini = resolveGeminiModelChoice(req.fallbackModel || 'gemini-4-hydrogen').model;
      const useWeb = shouldEnableWebSearch(req.prompt, req.enableWebSearch);
      const onlineResult = await runGeminiInference(
        fallbackGemini,
        fullSystemPrompt,
        req.prompt,
        useWeb,
        req.history,
        req.onToken
      );
      return {
        text: onlineResult.text,
        reasoning: onlineResult.reasoning,
        sources: onlineResult.sources,
        executionMode: 'ONLINE',
        provider: 'gemini',
        requestedModel: effectiveRequestedLabel,
        modelUsed: fallbackGemini,
        fallbackOccurred: true,
        latencyMs: onlineResult.latencyMs,
        routingNote: `Solicitado: ${effectiveRequestedLabel} (${provName} sem chave configurada) → Respondido por: ${fallbackGemini} (Gemini Online).`,
      };
    }
  }

  // 2. Modelos Locais (Ollama)
  const autoHybridFallbackToLocal =
    policy === 'auto_hybrid' &&
    !geminiEnabled &&
    ollamaEnabled &&
    (!requested || requested === 'auto' || requested === 'auto_hybrid' || isGeminiModelId(requested));

  const wantsLocal =
    policy === 'local_only' ||
    autoHybridFallbackToLocal ||
    (policy === 'auto_hybrid' &&
      Boolean(requested) &&
      !isGeminiModelId(requested) &&
      requested !== 'auto' &&
      requested !== 'auto_hybrid');

  if (wantsLocal) {
    const localModel =
      requested && !isGeminiModelId(requested) && requested !== 'auto' && requested !== 'auto_hybrid'
        ? requested
        : 'calmon-ia:latest';

    if (ollamaEnabled) {
      try {
        const localResult = await runOllamaChat(
          ollamaUrl,
          localModel,
          fullSystemPrompt,
          req.prompt,
          req.history,
          req.onToken
        );
        return {
          text: localResult.text,
          reasoning: localResult.reasoning || `Processado localmente via Ollama (${localModel}) em ${ollamaUrl}.`,
          sources: [],
          executionMode: 'LOCAL',
          provider: 'ollama',
          requestedModel: localModel,
          modelUsed: localModel,
          fallbackOccurred: false,
          latencyMs: localResult.latencyMs,
        };
      } catch (localErr: any) {
        const errorDetail =
          localErr?.name === 'AbortError'
            ? 'Tempo limite de resposta excedido (inatividade/timeout Ollama)'
            : String(localErr?.message || 'nó local inacessível');
        if (policy === 'local_only' || !geminiEnabled) {
          throw new Error(
            `Não foi possível executar no modelo local (${localModel}) via Ollama em ${ollamaUrl}: ${errorDetail}.`
          );
        }
        const fallbackGemini = resolveGeminiModelChoice(req.fallbackModel || 'gemini-4-hydrogen').model;
        const useWeb = shouldEnableWebSearch(req.prompt, req.enableWebSearch);
        const onlineResult = await runGeminiInference(
          fallbackGemini,
          fullSystemPrompt,
          req.prompt,
          useWeb,
          req.history,
          req.onToken
        );
        return {
          text: onlineResult.text,
          reasoning: onlineResult.reasoning,
          sources: onlineResult.sources,
          executionMode: 'ONLINE',
          provider: 'gemini',
          requestedModel: localModel,
          modelUsed: fallbackGemini,
          fallbackOccurred: true,
          latencyMs: onlineResult.latencyMs,
          routingNote: `Solicitado: ${localModel} (Ollama local em ${ollamaUrl} indisponível: ${errorDetail}) → Respondido por: ${fallbackGemini} (Gemini Online).`,
        };
      }
    }

    if (policy === 'local_only' || !geminiEnabled) {
      throw new Error(
        `O nó Ollama local está desativado na Central de Modelos. Ative-o para utilizar o modelo ${localModel}.`
      );
    }

    const fallbackGemini = resolveGeminiModelChoice(req.fallbackModel || 'gemini-4-hydrogen').model;
    const useWeb = shouldEnableWebSearch(req.prompt, req.enableWebSearch);
    const onlineResult = await runGeminiInference(
      fallbackGemini,
      fullSystemPrompt,
      req.prompt,
      useWeb,
      req.history,
      req.onToken
    );
    return {
      text: onlineResult.text,
      reasoning: onlineResult.reasoning,
      sources: onlineResult.sources,
      executionMode: 'ONLINE',
      provider: 'gemini',
      requestedModel: localModel,
      modelUsed: fallbackGemini,
      fallbackOccurred: true,
      latencyMs: onlineResult.latencyMs,
      routingNote: `Solicitado: ${localModel} (Ollama local desativado) → Respondido por: ${fallbackGemini} (Gemini Online).`,
    };
  }

  // 3. Gemini Online
  if (!geminiEnabled) {
    throw new Error(
      'GEMINI_API_KEY não configurada no servidor. Configure a chave no painel Settings > Secrets ou selecione um modelo local do Ollama.'
    );
  }

  const choice = resolveGeminiModelChoice(requested);
  const useWeb = shouldEnableWebSearch(req.prompt, req.enableWebSearch);

  try {
    const onlineResult = await runGeminiInference(
      choice.model,
      fullSystemPrompt,
      req.prompt,
      useWeb,
      req.history,
      req.onToken
    );
    return {
      text: onlineResult.text,
      reasoning: onlineResult.reasoning,
      sources: onlineResult.sources,
      executionMode: 'ONLINE',
      provider: 'gemini',
      requestedModel: effectiveRequestedLabel,
      modelUsed: choice.model,
      fallbackOccurred: choice.remapped,
      latencyMs: onlineResult.latencyMs,
      routingNote: choice.remapped ? choice.reason : undefined,
    };
  } catch (primaryErr: any) {
    const primaryReason = formatReadableApiError(primaryErr, 'erro na API Gemini');
    const fallbackCandidate = resolveGeminiModelChoice(req.fallbackModel || 'gemini-4-hydrogen').model;
    if (choice.model !== fallbackCandidate) {
      const retryResult = await runGeminiInference(
        fallbackCandidate,
        fullSystemPrompt,
        req.prompt,
        useWeb,
        req.history,
        req.onToken
      );
      return {
        text: retryResult.text,
        reasoning: retryResult.reasoning,
        sources: retryResult.sources,
        executionMode: 'ONLINE',
        provider: 'gemini',
        requestedModel: effectiveRequestedLabel,
        modelUsed: fallbackCandidate,
        fallbackOccurred: true,
        latencyMs: retryResult.latencyMs,
        routingNote: `Solicitado: ${choice.model} (erro: ${primaryReason}) → Respondido por: ${fallbackCandidate} (Gemini Online).`,
      };
    }
    throw primaryErr;
  }
}

export interface CuratedHfModel {
  id: string;
  model_tag: string;
  display_name: string;
  description: string;
  downloads: number;
  likes: number;
  tag: string;
  required_vram_gb: number;
  fit_tier: string;
  fit_label: string;
  fit_reason: string;
}

const FALLBACK_HF_CATALOG = [
  {
    id: 'Qwen/Qwen2.5-Coder-7B-Instruct',
    model_tag: 'qwen2.5-coder:7b',
    display_name: 'Qwen 2.5 Coder 7B',
    description: 'Excelente geração de código e refatoração leve em GPUs de 8 GB.',
    downloads: 915000,
    likes: 3420,
    tag: 'coding',
  },
  {
    id: 'meta-llama/Llama-3.1-8B-Instruct',
    model_tag: 'llama3.1:8b',
    display_name: 'Llama 3.1 8B Instruct',
    description: 'Modelo versátil de baixa latência, ideal para auditoria local e segurança.',
    downloads: 1420000,
    likes: 5890,
    tag: 'security',
  },
  {
    id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
    model_tag: 'deepseek-r1:7b',
    display_name: 'DeepSeek R1 Distill 7B',
    description: 'Raciocínio passo a passo transparente compatível com notebooks de 8 GB VRAM.',
    downloads: 874000,
    likes: 4310,
    tag: 'reasoning',
  },
  {
    id: 'Qwen/Qwen2.5-Coder-14B-Instruct',
    model_tag: 'qwen2.5-coder:14b',
    display_name: 'Qwen 2.5 Coder 14B',
    description: 'Alta precisão arquitetural e engenharia de software (requer 12+ GB VRAM ou 32 GB RAM).',
    downloads: 612000,
    likes: 2650,
    tag: 'coding',
  },
  {
    id: 'meta-llama/Llama-3.2-3B-Instruct',
    model_tag: 'llama3.2:3b',
    display_name: 'Llama 3.2 3B Ultra Leve',
    description: 'Roda fluido até em notebooks sem GPU dedicada para notas, resumos e triagem.',
    downloads: 1180000,
    likes: 3920,
    tag: 'lightweight',
  },
  {
    id: 'Qwen/Qwen2.5-32B-Instruct',
    model_tag: 'qwen2.5:32b',
    display_name: 'Qwen 2.5 32B Instruct',
    description: 'Raciocínio avançado para workstations com 24 GB VRAM; em notebooks comuns prefira Gemini Online.',
    downloads: 430000,
    likes: 1940,
    tag: 'heavy',
  },
];

function enrichHfModel(
  raw: { id: string; model_tag?: string; display_name?: string; description?: string; downloads?: number; likes?: number; tag?: string },
  hardware: NotebookHardwareProfile
): CuratedHfModel {
  const requiredVram = estimateVramGbFromModelName(raw.id);
  const fit = evaluateVramFit(requiredVram, hardware);
  const shortName = raw.display_name || raw.id.split('/').pop() || raw.id;
  return {
    id: raw.id,
    model_tag: raw.model_tag || `hf.co/${raw.id}`,
    display_name: shortName,
    description:
      raw.description ||
      `Modelo aberto do Hugging Face (${raw.tag || 'text-generation'}) · ~${requiredVram.toFixed(1)} GB VRAM estimados.`,
    downloads: Number(raw.downloads || 0),
    likes: Number(raw.likes || 0),
    tag: raw.tag || 'text-generation',
    required_vram_gb: requiredVram,
    fit_tier: fit.tier,
    fit_label: fit.label,
    fit_reason: fit.reason,
  };
}

export function getCuratedHuggingFaceForHardware(hardware: NotebookHardwareProfile): CuratedHfModel[] {
  return FALLBACK_HF_CATALOG.map((item) => enrichHfModel(item, hardware));
}

export async function searchRealHuggingFace(
  query: string,
  limit: number,
  hardware: NotebookHardwareProfile
): Promise<{ live: boolean; items: CuratedHfModel[] }> {
  const safeLimit = Math.min(20, Math.max(1, limit || 10));
  const cleanQuery = query.trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const url = `https://huggingface.co/api/models?search=${encodeURIComponent(
      cleanQuery || 'instruct'
    )}&pipeline_tag=text-generation&sort=downloads&direction=-1&limit=${safeLimit}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'jarvis-ai-hub' },
    });
    if (!res.ok) throw new Error(`HF HTTP ${res.status}`);
    const data = (await res.json()) as any[];
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Sem resultados na API HF');
    }
    const items = data.slice(0, safeLimit).map((m) =>
      enrichHfModel(
        {
          id: String(m.id || m.modelId || ''),
          downloads: Number(m.downloads || 0),
          likes: Number(m.likes || 0),
          tag: String(m.pipeline_tag || 'text-generation'),
        },
        hardware
      )
    );
    return { live: true, items };
  } catch {
    const q = cleanQuery.toLowerCase();
    const filtered = FALLBACK_HF_CATALOG.filter(
      (m) =>
        !q ||
        m.id.toLowerCase().includes(q) ||
        m.display_name.toLowerCase().includes(q) ||
        m.tag.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q)
    ).slice(0, safeLimit);
    return {
      live: false,
      items: filtered.map((m) => enrichHfModel(m, hardware)),
    };
  } finally {
    clearTimeout(timeout);
  }
}
