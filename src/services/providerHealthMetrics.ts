/**
 * Lógica pura de classificação de saúde de conexão e latência dos provedores de IA.
 * Mantém regras de limiares, barras de sinal, resumo agregado e formatação de tempo
 * desacopladas dos componentes React para testes determinísticos via node:test.
 */

export type ProviderHealthTier = 'excellent' | 'good' | 'slow' | 'error' | 'untested';

export interface ProviderHealthInput {
  configured: boolean;
  status: 'ok' | 'error' | null | undefined;
  latencyMs: number | null | undefined;
  statusCode?: number | null;
  lastTestMessage?: string | null;
  lastTestedAt?: string | null;
}

export interface ProviderHealthClassification {
  tier: ProviderHealthTier;
  label: string;
  shortLabel: string;
  signalBars: 0 | 1 | 2 | 3 | 4;
  color: string;
  trackColor: string;
  latencyMs: number | null;
  /** Porcentagem visual (0..100) da barra de latência numa escala de 0..1500ms */
  latencyPercent: number;
  statusCode: number | null;
  description: string;
}

export interface ProviderHealthRowSummary {
  id: string;
  name: string;
  shortLabel: string;
  model: string;
  configured: boolean;
  isDefault: boolean;
  health: ProviderHealthClassification;
  testedAt: string | null;
  endpointHost?: string;
}

export interface AggregateProvidersHealth {
  totalConfigured: number;
  healthyCount: number;
  degradedCount: number;
  untestedCount: number;
  avgLatencyMs: number | null;
  fastestProvider: { shortLabel: string; latencyMs: number } | null;
}

const LATENCY_EXCELLENT_MAX_MS = 350;
const LATENCY_GOOD_MAX_MS = 900;
const LATENCY_SCALE_CAP_MS = 1500;

/**
 * Extrai a latência em milissegundos de mensagens históricas de ping
 * (ex.: "Conexão autenticada com OpenAI em 214 ms") caso a coluna numérica ainda esteja vazia.
 */
export function extractLatencyFromTestMessage(message?: string | null): number | null {
  if (!message) return null;
  const match = String(message).match(/\b(\d{1,5})\s*ms\b/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Classifica a saúde e qualidade de latência de um provedor com base em medição real.
 * Sempre retorna rótulo textual explícito + contagem de barras (nunca apenas cor).
 */
export function classifyProviderHealth(input: ProviderHealthInput): ProviderHealthClassification {
  const numericLatency =
    typeof input.latencyMs === 'number' && Number.isFinite(input.latencyMs) && input.latencyMs > 0
      ? Math.round(input.latencyMs)
      : extractLatencyFromTestMessage(input.lastTestMessage);

  const statusCode =
    typeof input.statusCode === 'number' && Number.isFinite(input.statusCode) && input.statusCode > 0
      ? Math.round(input.statusCode)
      : null;

  if (input.status === 'error') {
    return {
      tier: 'error',
      label: statusCode ? `Falha · HTTP ${statusCode}` : 'Conexão indisponível',
      shortLabel: 'Erro',
      signalBars: 1,
      color: '#f87171',
      trackColor: 'rgba(248, 113, 113, 0.24)',
      latencyMs: numericLatency,
      latencyPercent: 100,
      statusCode,
      description: 'O último ping retornou erro de autenticação, cota ou rede.',
    };
  }

  if (input.status === 'ok') {
    const ms = numericLatency ?? 0;
    const latencyPercent =
      ms > 0 ? Math.max(8, Math.min(100, Math.round((ms / LATENCY_SCALE_CAP_MS) * 100))) : 18;

    if (ms === 0 || ms <= LATENCY_EXCELLENT_MAX_MS) {
      return {
        tier: 'excellent',
        label: 'Saudável · Excelente',
        shortLabel: 'Excelente',
        signalBars: 4,
        color: '#4ade80',
        trackColor: 'rgba(74, 222, 128, 0.22)',
        latencyMs: numericLatency,
        latencyPercent,
        statusCode: statusCode ?? 200,
        description: 'Resposta rápida e estável para inferência em tempo real.',
      };
    }

    if (ms <= LATENCY_GOOD_MAX_MS) {
      return {
        tier: 'good',
        label: 'Saudável · Estável',
        shortLabel: 'Estável',
        signalBars: 3,
        color: '#34d399',
        trackColor: 'rgba(52, 211, 153, 0.22)',
        latencyMs: numericLatency,
        latencyPercent,
        statusCode: statusCode ?? 200,
        description: 'Conexão autenticada com tempo de resposta moderado.',
      };
    }

    return {
      tier: 'slow',
      label: 'Conectado · Latência alta',
      shortLabel: 'Lenta',
      signalBars: 2,
      color: '#fbbf24',
      trackColor: 'rgba(251, 191, 36, 0.24)',
      latencyMs: numericLatency,
      latencyPercent,
      statusCode: statusCode ?? 200,
      description: 'Provedor acessível, porém com tempo de resposta acima de 900 ms.',
    };
  }

  return {
    tier: 'untested',
    label: input.configured ? 'Aguardando medição' : 'Não configurado',
    shortLabel: input.configured ? 'Sem medição' : 'Inativo',
    signalBars: 0,
    color: 'var(--text-muted, #8b949e)',
    trackColor: 'rgba(148, 163, 184, 0.16)',
    latencyMs: null,
    latencyPercent: 0,
    statusCode: null,
    description: input.configured
      ? 'Execute um ping para medir a latência real deste endpoint.'
      : 'Cadastre uma chave de API para habilitar monitoramento.',
  };
}

export function formatRelativeCheckTime(isoTimestamp?: string | null, nowMs: number = Date.now()): string {
  if (!isoTimestamp) return 'Não medido';
  const ts = Date.parse(isoTimestamp);
  if (!Number.isFinite(ts)) return 'Não medido';
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 10) return 'agora';
  if (diffSec < 60) return `há ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `há ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  return `há ${diffDays} d`;
}

export function summarizeProvidersHealth(rows: ProviderHealthRowSummary[]): AggregateProvidersHealth {
  const configured = rows.filter((r) => r.configured);
  let healthyCount = 0;
  let degradedCount = 0;
  let untestedCount = 0;
  const latencies: Array<{ shortLabel: string; latencyMs: number }> = [];

  for (const row of configured) {
    const tier = row.health.tier;
    if (tier === 'excellent' || tier === 'good') {
      healthyCount += 1;
      if (row.health.latencyMs !== null) {
        latencies.push({ shortLabel: row.shortLabel, latencyMs: row.health.latencyMs });
      }
    } else if (tier === 'slow' || tier === 'error') {
      degradedCount += 1;
      if (tier === 'slow' && row.health.latencyMs !== null) {
        latencies.push({ shortLabel: row.shortLabel, latencyMs: row.health.latencyMs });
      }
    } else {
      untestedCount += 1;
    }
  }

  const avgLatencyMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((sum, item) => sum + item.latencyMs, 0) / latencies.length)
      : null;

  const fastestProvider =
    latencies.length > 0
      ? latencies.reduce((best, cur) => (cur.latencyMs < best.latencyMs ? cur : best), latencies[0])
      : null;

  return {
    totalConfigured: configured.length,
    healthyCount,
    degradedCount,
    untestedCount,
    avgLatencyMs,
    fastestProvider,
  };
}
