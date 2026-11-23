import crypto from 'node:crypto';
import net from 'node:net';

export type ExternalProviderId =
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'groq'
  | 'openrouter'
  | 'xai'
  | 'custom';

export interface ExternalProviderMeta {
  id: ExternalProviderId;
  name: string;
  shortLabel: string;
  tier: 'primary' | 'secondary';
  defaultBaseUrl: string;
  defaultModel: string;
  suggestedModels: string[];
  envVar: string;
  keyPrefixHint: string;
  protocol: 'anthropic' | 'openai_compatible';
  docsHint: string;
}

export const EXTERNAL_PROVIDERS: Record<ExternalProviderId, ExternalProviderMeta> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    shortLabel: 'Anthropic',
    tier: 'primary',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-20250514',
    suggestedModels: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
    envVar: 'ANTHROPIC_API_KEY',
    keyPrefixHint: 'sk-ant-...',
    protocol: 'anthropic',
    docsHint: 'Ideal para arquitetura de código, raciocínio longo e revisão técnica.',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI (GPT)',
    shortLabel: 'OpenAI',
    tier: 'primary',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'o3-mini'],
    envVar: 'OPENAI_API_KEY',
    keyPrefixHint: 'sk-proj-... ou sk-...',
    protocol: 'openai_compatible',
    docsHint: 'Ecossistema amplo compatível com ferramentas, JSON estruturado e raciocínio rápido.',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    shortLabel: 'DeepSeek',
    tier: 'primary',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner'],
    envVar: 'DEEPSEEK_API_KEY',
    keyPrefixHint: 'sk-...',
    protocol: 'openai_compatible',
    docsHint: 'Excelente relação custo/desempenho para engenharia de software e raciocínio passo a passo.',
  },
  groq: {
    id: 'groq',
    name: 'Groq Cloud',
    shortLabel: 'Groq',
    tier: 'secondary',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    suggestedModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen-qwq-32b'],
    envVar: 'GROQ_API_KEY',
    keyPrefixHint: 'gsk_...',
    protocol: 'openai_compatible',
    docsHint: 'Inferência ultrarrápida em LPU para modelos abertos Llama e Qwen.',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    shortLabel: 'OpenRouter',
    tier: 'secondary',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    suggestedModels: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini', 'deepseek/deepseek-r1'],
    envVar: 'OPENROUTER_API_KEY',
    keyPrefixHint: 'sk-or-v1-...',
    protocol: 'openai_compatible',
    docsHint: 'Roteador unificado com acesso a dezenas de modelos sob uma única chave.',
  },
  xai: {
    id: 'xai',
    name: 'xAI (Grok)',
    shortLabel: 'xAI Grok',
    tier: 'secondary',
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-2-latest',
    suggestedModels: ['grok-2-latest', 'grok-beta'],
    envVar: 'XAI_API_KEY',
    keyPrefixHint: 'xai-...',
    protocol: 'openai_compatible',
    docsHint: 'Modelos Grok com protocolo compatível OpenAI.',
  },
  custom: {
    id: 'custom',
    name: 'Endpoint Compatível OpenAI',
    shortLabel: 'Custom API',
    tier: 'secondary',
    defaultBaseUrl: '',
    defaultModel: 'gpt-4o-mini',
    suggestedModels: [],
    envVar: 'CUSTOM_LLM_API_KEY',
    keyPrefixHint: 'sk-...',
    protocol: 'openai_compatible',
    docsHint: 'Qualquer gateway HTTPS compatível com /v1/chat/completions (vLLM, LiteLLM, Together, Mistral).',
  },
};

export const EXTERNAL_PROVIDER_IDS: ExternalProviderId[] = [
  'anthropic',
  'openai',
  'deepseek',
  'groq',
  'openrouter',
  'xai',
  'custom',
];

export const VAULT_COOKIE_NAME = 'jarvis_provider_vault';

export function isExternalProviderId(value: string): value is ExternalProviderId {
  return Object.prototype.hasOwnProperty.call(EXTERNAL_PROVIDERS, String(value || '').toLowerCase());
}

export function normalizeProviderId(value: string): ExternalProviderId | null {
  const clean = String(value || '').trim().toLowerCase();
  if (isExternalProviderId(clean)) return clean;
  if (clean === 'claude') return 'anthropic';
  if (clean === 'grok') return 'xai';
  return null;
}

const EPHEMERAL_FALLBACK_SEED = crypto.randomBytes(32);

function deriveVaultKey(secretOverride?: string): Buffer {
  const raw = (secretOverride || process.env.KEYVAULT_MASTER_KEY || process.env.JWT_SECRET || '').trim();
  if (raw.length >= 16) {
    return crypto.createHash('sha256').update(`jarvis-provider-vault-v1:${raw}`).digest();
  }
  return crypto.createHash('sha256').update(EPHEMERAL_FALLBACK_SEED).digest();
}

export function encryptProviderSecret(plaintext: string, secretOverride?: string): string {
  const clean = String(plaintext || '').trim();
  if (!clean) {
    throw new Error('A chave de API não pode estar vazia.');
  }
  const key = deriveVaultKey(secretOverride);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptProviderSecret(ciphertext: string, secretOverride?: string): string {
  const parts = String(ciphertext || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Formato de segredo criptografado inválido.');
  }
  const key = deriveVaultKey(secretOverride);
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const encrypted = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export interface CookieVaultEntry {
  provider: ExternalProviderId;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  isDefault: boolean;
  label?: string;
}

export interface CookieVaultEnvelope {
  ownerUserId: string;
  updatedAt: string;
  entries: Partial<Record<ExternalProviderId, CookieVaultEntry>>;
}

export function sealVaultCookieEnvelope(envelope: CookieVaultEnvelope, secretOverride?: string): string {
  const serialized = JSON.stringify(envelope);
  const sealed = encryptProviderSecret(serialized, secretOverride);
  return Buffer.from(sealed, 'utf8').toString('base64url');
}

export function unsealVaultCookieEnvelope(
  cookieValue: string | undefined | null,
  expectedOwnerUserId: string,
  secretOverride?: string
): CookieVaultEnvelope | null {
  if (!cookieValue) return null;
  try {
    const rawSealed = Buffer.from(String(cookieValue), 'base64url').toString('utf8');
    const jsonText = decryptProviderSecret(rawSealed, secretOverride);
    const parsed = JSON.parse(jsonText) as CookieVaultEnvelope;
    if (!parsed || parsed.ownerUserId !== expectedOwnerUserId || typeof parsed.entries !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(val);
  }
  return out;
}

export function buildSecureVaultCookieHeader(value: string, isHttpsRequest: boolean, maxAgeSeconds = 60 * 60 * 24 * 30): string {
  const attrs = [
    `${VAULT_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/api/v1',
    'HttpOnly',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    isHttpsRequest ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (isHttpsRequest) {
    attrs.push('Secure');
  }
  return attrs.join('; ');
}

export function maskApiKey(apiKey: string): string {
  const clean = String(apiKey || '').trim();
  if (clean.length <= 8) {
    return '••••••';
  }
  const dashIdx = clean.indexOf('-');
  const prefixLen = dashIdx > 0 && dashIdx < 6 ? dashIdx + 2 : 4;
  const prefix = clean.slice(0, Math.min(6, Math.max(3, prefixLen)));
  const suffix = clean.slice(-4);
  return `${prefix}••••${suffix}`;
}

function isBlockedPrivateIp(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    normalized === 'localhost' ||
    normalized === 'metadata.google.internal' ||
    normalized === 'metadata' ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  ) {
    return true;
  }

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    const octets = normalized.split('.').map(Number);
    if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return true;
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (ipVersion === 6) {
    if (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80') ||
      normalized.startsWith('::ffff:127.') ||
      normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:169.254.') ||
      normalized.startsWith('::ffff:192.168.')
    ) {
      return true;
    }
  }
  return false;
}

export function validateProviderBaseUrl(
  provider: ExternalProviderId,
  rawUrl?: string
): { valid: boolean; normalizedUrl: string; error?: string } {
  const meta = EXTERNAL_PROVIDERS[provider];
  const candidate = String(rawUrl || '').trim() || meta.defaultBaseUrl;
  if (!candidate) {
    return {
      valid: false,
      normalizedUrl: '',
      error: 'Informe uma URL HTTPS válida para o endpoint personalizado.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      valid: false,
      normalizedUrl: '',
      error: 'URL de endpoint inválida. Utilize o formato https://api.exemplo.com/v1.',
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      normalizedUrl: '',
      error: 'Por segurança, endpoints de provedores externos devem usar HTTPS.',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      normalizedUrl: '',
      error: 'Não inclua credenciais embutidas na URL do provedor.',
    };
  }

  if (isBlockedPrivateIp(parsed.hostname)) {
    return {
      valid: false,
      normalizedUrl: '',
      error: 'Endereços locais, privados ou de metadados de nuvem não são permitidos como provedor externo.',
    };
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString().replace(/\/+$/, ''),
  };
}

export function inferExternalProviderFromModel(modelName?: string): ExternalProviderId | null {
  const m = String(modelName || '').trim().toLowerCase();
  if (!m) return null;
  if (m.startsWith('claude-') || m.startsWith('anthropic/')) return 'anthropic';
  if (
    m.startsWith('gpt-') ||
    m.startsWith('o1-') ||
    m.startsWith('o3-') ||
    m.startsWith('o4-') ||
    m === 'o1' ||
    m === 'o3-mini' ||
    m.startsWith('chatgpt-')
  ) {
    return 'openai';
  }
  if (m.startsWith('deepseek-chat') || m.startsWith('deepseek-reasoner') || m.startsWith('deepseek/')) {
    return 'deepseek';
  }
  if (m.startsWith('grok-')) return 'xai';
  if (m.includes('/') && !m.startsWith('hf.co/')) return 'openrouter';
  return null;
}

export interface ResolvedExternalCredential {
  provider: ExternalProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  source: 'session_vault' | 'http_only_cookie' | 'env';
  keyId?: string;
  label?: string;
}

export function getEnvProviderCredential(provider: ExternalProviderId): ResolvedExternalCredential | null {
  const meta = EXTERNAL_PROVIDERS[provider];
  const apiKey = (process.env[meta.envVar] || '').trim();
  if (!apiKey) return null;

  const customBase =
    provider === 'custom'
      ? (process.env.CUSTOM_LLM_BASE_URL || '').trim()
      : meta.defaultBaseUrl;
  const check = validateProviderBaseUrl(provider, customBase);
  if (!check.valid) return null;

  const model =
    provider === 'custom'
      ? (process.env.CUSTOM_LLM_MODEL || meta.defaultModel).trim()
      : meta.defaultModel;

  return {
    provider,
    apiKey,
    baseUrl: check.normalizedUrl,
    model,
    source: 'env',
    label: `${meta.name} (Variável de Ambiente)`,
  };
}

export interface ProviderTestResult {
  ok: boolean;
  provider: ExternalProviderId;
  status_code: number;
  latency_ms: number;
  endpoint_host: string;
  models_detected: string[];
  message: string;
}

export async function testExternalProviderConnection(input: {
  provider: ExternalProviderId;
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}): Promise<ProviderTestResult> {
  const urlCheck = validateProviderBaseUrl(input.provider, input.baseUrl);
  if (!urlCheck.valid) {
    return {
      ok: false,
      provider: input.provider,
      status_code: 400,
      latency_ms: 0,
      endpoint_host: '',
      models_detected: [],
      message: urlCheck.error || 'Endpoint inválido.',
    };
  }

  let endpointHost = '';
  try {
    endpointHost = new URL(urlCheck.normalizedUrl).host;
  } catch {
    endpointHost = '';
  }

  const apiKey = String(input.apiKey || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      provider: input.provider,
      status_code: 400,
      latency_ms: 0,
      endpoint_host: endpointHost,
      models_detected: [],
      message: 'Informe uma chave de API válida antes de testar a conexão.',
    };
  }

  const meta = EXTERNAL_PROVIDERS[input.provider];
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs || 8000);

  try {
    const endpoint =
      meta.protocol === 'anthropic'
        ? `${urlCheck.normalizedUrl.replace(/\/v1$/i, '')}/v1/models`
        : `${urlCheck.normalizedUrl}/models`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'jarvis-ai-hub',
    };

    if (meta.protocol === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
      if (input.provider === 'openrouter') {
        headers['X-Title'] = 'JARVIS AI Hub';
      }
    }

    const response = await fetch(endpoint, {
      method: 'GET',
      headers,
      signal: controller.signal,
      redirect: 'error',
    });

    const latency_ms = Date.now() - start;
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const errJson = (await response.json()) as any;
        const rawMsg = errJson?.error?.message || errJson?.message || errJson?.detail;
        if (rawMsg) {
          const sanitized = String(rawMsg)
            .split(apiKey)
            .join('[chave oculta]')
            .slice(0, 180);
          detail = `${detail}: ${sanitized}`;
        }
      } catch {
        // sem corpo JSON
      }
      const friendly =
        response.status === 401 || response.status === 403
          ? `Credencial recusada por ${meta.shortLabel} (${detail}). Verifique se a chave está ativa e sem espaços extras.`
          : `Falha ao validar ${meta.shortLabel} (${detail}).`;
      return {
        ok: false,
        provider: input.provider,
        status_code: response.status,
        latency_ms,
        endpoint_host: endpointHost,
        models_detected: [],
        message: friendly,
      };
    }

    const payload = (await response.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
    const detected = Array.isArray(payload?.data)
      ? payload.data
          .map((item) => String(item?.id || '').trim())
          .filter(Boolean)
          .slice(0, 12)
      : [];

    return {
      ok: true,
      provider: input.provider,
      status_code: response.status,
      latency_ms,
      endpoint_host: endpointHost,
      models_detected: detected,
      message:
        detected.length > 0
          ? `Conexão autenticada com ${meta.shortLabel} em ${latency_ms} ms (${detected.length}+ modelos disponíveis).`
          : `Conexão autenticada com ${meta.shortLabel} em ${latency_ms} ms.`,
    };
  } catch (err: any) {
    const latency_ms = Date.now() - start;
    const msg =
      err?.name === 'AbortError'
        ? `Tempo limite excedido ao conectar com ${meta.shortLabel}.`
        : `Não foi possível alcançar ${meta.shortLabel}: ${String(err?.message || 'erro de rede').slice(0, 160)}`;
    return {
      ok: false,
      provider: input.provider,
      status_code: 0,
      latency_ms,
      endpoint_host: endpointHost,
      models_detected: [],
      message: msg,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export interface GeminiServerHealthResult {
  configured: boolean;
  ok: boolean;
  status_code: number;
  latency_ms: number;
  endpoint_host: string;
  model: string;
  checked_at: string;
  message: string;
}

export async function testGeminiServerConnection(timeoutMs = 8000): Promise<GeminiServerHealthResult> {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const checked_at = new Date().toISOString();
  const endpoint_host = 'generativelanguage.googleapis.com';
  const model = 'gemini-4-hydrogen';

  if (!apiKey) {
    return {
      configured: false,
      ok: false,
      status_code: 0,
      latency_ms: 0,
      endpoint_host,
      model,
      checked_at,
      message: 'GEMINI_API_KEY não configurada no ambiente do servidor.',
    };
  }

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-goog-api-key': apiKey,
        'User-Agent': 'jarvis-ai-hub',
      },
      signal: controller.signal,
      redirect: 'error',
    });

    const latency_ms = Date.now() - start;
    if (!response.ok) {
      return {
        configured: true,
        ok: false,
        status_code: response.status,
        latency_ms,
        endpoint_host,
        model,
        checked_at,
        message: `Google Gemini respondeu HTTP ${response.status} em ${latency_ms} ms.`,
      };
    }

    return {
      configured: true,
      ok: true,
      status_code: response.status,
      latency_ms,
      endpoint_host,
      model,
      checked_at,
      message: `Google Gemini operacional em ${latency_ms} ms.`,
    };
  } catch (err: any) {
    const latency_ms = Date.now() - start;
    const message =
      err?.name === 'AbortError'
        ? 'Tempo limite excedido ao consultar Google Gemini.'
        : `Falha de rede ao consultar Google Gemini: ${String(err?.message || 'erro desconhecido').slice(0, 140)}`;
    return {
      configured: true,
      ok: false,
      status_code: 0,
      latency_ms,
      endpoint_host,
      model,
      checked_at,
      message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runExternalProviderChat(input: {
  credential: ResolvedExternalCredential;
  systemInstruction: string;
  prompt: string;
  requestedModel?: string;
  timeoutMs?: number;
}): Promise<{
  text: string;
  reasoning: string;
  latencyMs: number;
  modelUsed: string;
  provider: ExternalProviderId;
}> {
  const { credential } = input;
  const meta = EXTERNAL_PROVIDERS[credential.provider];
  const urlCheck = validateProviderBaseUrl(credential.provider, credential.baseUrl);
  if (!urlCheck.valid) {
    throw new Error(urlCheck.error || `Endpoint inválido para ${meta.name}.`);
  }

  const modelUsed = (input.requestedModel || credential.model || meta.defaultModel).trim();
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs || 45000);

  try {
    if (meta.protocol === 'anthropic') {
      const response = await fetch(`${urlCheck.normalizedUrl}/v1/messages`, {
        method: 'POST',
        signal: controller.signal,
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': credential.apiKey,
          'anthropic-version': '2023-06-01',
          'User-Agent': 'jarvis-ai-hub',
        },
        body: JSON.stringify({
          model: modelUsed,
          max_tokens: 2048,
          system: input.systemInstruction,
          messages: [{ role: 'user', content: input.prompt }],
        }),
      });

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as any;
        const errMsg = errBody?.error?.message || `HTTP ${response.status}`;
        throw new Error(`Anthropic retornou erro: ${String(errMsg).slice(0, 220)}`);
      }

      const data = (await response.json()) as {
        content?: Array<{ type?: string; text?: string; thinking?: string }>;
      };
      const blocks = Array.isArray(data?.content) ? data.content : [];
      const thinking = blocks
        .filter((b) => b.type === 'thinking' && b.thinking)
        .map((b) => String(b.thinking))
        .join('\n\n')
        .trim();
      const text = blocks
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => String(b.text))
        .join('\n')
        .trim();

      return {
        text: text || 'O modelo Anthropic concluiu sem conteúdo textual.',
        reasoning: thinking || `Roteamento concluído em ${meta.name} (${modelUsed}).`,
        latencyMs: Date.now() - start,
        modelUsed,
        provider: credential.provider,
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credential.apiKey}`,
      'User-Agent': 'jarvis-ai-hub',
    };
    if (credential.provider === 'openrouter') {
      headers['X-Title'] = 'JARVIS AI Hub';
    }

    const response = await fetch(`${urlCheck.normalizedUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      redirect: 'error',
      headers,
      body: JSON.stringify({
        model: modelUsed,
        messages: [
          { role: 'system', content: input.systemInstruction },
          { role: 'user', content: input.prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as any;
      const errMsg = errBody?.error?.message || errBody?.message || `HTTP ${response.status}`;
      throw new Error(`${meta.shortLabel} retornou erro: ${String(errMsg).slice(0, 220)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string; reasoning_content?: string };
      }>;
    };
    const msg = data?.choices?.[0]?.message;
    const rawContent = String(msg?.content || '').trim();
    const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/i);
    const reasoning =
      String(msg?.reasoning_content || '').trim() ||
      (thinkMatch?.[1] || '').trim() ||
      `Roteamento concluído em ${meta.name} (${modelUsed}).`;
    const text = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    return {
      text: text || `O modelo ${meta.shortLabel} concluiu sem conteúdo textual.`,
      reasoning,
      latencyMs: Date.now() - start,
      modelUsed,
      provider: credential.provider,
    };
  } finally {
    clearTimeout(timeout);
  }
}
