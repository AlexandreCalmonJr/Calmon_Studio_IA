import React, { useMemo } from 'react';
import { Activity, RefreshCw, Wifi } from 'lucide-react';
import {
  ExternalProviderSlug,
  GeminiServerHealthRecord,
  SessionProviderKeyRecord,
} from '../../services/api/models';
import {
  ProviderHealthClassification,
  ProviderHealthRowSummary,
  classifyProviderHealth,
  formatRelativeCheckTime,
  summarizeProvidersHealth,
} from '../../services/providerHealthMetrics';
import { ProviderPingRecord } from '../../services/providerPingValidation';

interface SignalBarsProps {
  bars: 0 | 1 | 2 | 3 | 4;
  color: string;
}

export const SignalBars: React.FC<SignalBarsProps> = ({ bars, color }) => {
  const heights = [4, 7, 10, 13];
  return (
    <span className="jarvis-signal-bars" aria-hidden="true">
      {heights.map((h, idx) => {
        const active = idx < bars;
        return (
          <span
            key={h}
            className="jarvis-signal-bars__bar"
            style={{
              height: `${h}px`,
              backgroundColor: active ? color : 'rgba(148, 163, 184, 0.22)',
              opacity: active ? 1 : 0.65,
            }}
          />
        );
      })}
    </span>
  );
};

interface ProviderInlineHealthBarProps {
  provider: ExternalProviderSlug;
  configured: boolean;
  ping?: ProviderPingRecord | null;
  lastTestStatus: string | null;
  lastLatencyMs: number | null;
  lastStatusCode: number | null;
  lastTestMessage: string | null;
  lastTestedAt: string | null;
  endpointHost?: string;
}

/**
 * Indicador compacto de latência e saúde de conexão exibido logo abaixo
 * do seletor de modelo dentro do card de cada provedor.
 */
export const ProviderInlineHealthBar: React.FC<ProviderInlineHealthBarProps> = ({
  provider,
  configured,
  ping,
  lastTestStatus,
  lastLatencyMs,
  lastStatusCode,
  lastTestMessage,
  lastTestedAt,
  endpointHost,
}) => {
  const health: ProviderHealthClassification = useMemo(() => {
    if (ping) {
      return classifyProviderHealth({
        configured: true,
        status: ping.ok ? 'ok' : 'error',
        latencyMs: ping.latencyMs,
        statusCode: ping.statusCode,
        lastTestMessage: ping.message,
        lastTestedAt: ping.testedAt,
      });
    }
    const normalizedStatus =
      lastTestStatus === 'ok' ? 'ok' : lastTestStatus === 'error' ? 'error' : null;
    return classifyProviderHealth({
      configured,
      status: normalizedStatus,
      latencyMs: lastLatencyMs,
      statusCode: lastStatusCode,
      lastTestMessage,
      lastTestedAt,
    });
  }, [configured, ping, lastTestStatus, lastLatencyMs, lastStatusCode, lastTestMessage, lastTestedAt]);

  const effectiveHost = ping?.endpointHost || endpointHost || '';
  const effectiveTestedAt = ping?.testedAt || lastTestedAt;

  if (!configured && !ping) {
    return null;
  }

  return (
    <div
      className="jarvis-health-inline"
      data-testid={`provider-inline-health-${provider}`}
      aria-label={`Saúde de conexão ${provider}: ${health.label}`}
    >
      <div className="jarvis-health-inline__left">
        <SignalBars bars={health.signalBars} color={health.color} />
        <span style={{ fontWeight: 600, color: health.color }}>{health.label}</span>
        {health.latencyMs !== null && (
          <span
            className="jarvis-latency-track"
            style={{ width: '64px' }}
            aria-hidden="true"
          >
            <span
              className="jarvis-latency-track__fill"
              style={{
                width: `${health.latencyPercent}%`,
                backgroundColor: health.color,
              }}
            />
          </span>
        )}
        {effectiveHost && (
          <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.71rem' }}>
            {effectiveHost}
          </span>
        )}
      </div>

      <div className="jarvis-health-inline__right">
        <span style={{ color: health.latencyMs !== null ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: 600 }}>
          {health.latencyMs !== null ? `${health.latencyMs} ms` : '— ms'}
        </span>
        {health.statusCode !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span>HTTP {health.statusCode}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
          {formatRelativeCheckTime(effectiveTestedAt)}
        </span>
      </div>
    </div>
  );
};

interface ProviderConnectionHealthStripProps {
  providers: SessionProviderKeyRecord[];
  pingMap: Record<string, ProviderPingRecord | null>;
  geminiServerManaged: boolean;
  geminiHealth?: GeminiServerHealthRecord | null;
  probingAll: boolean;
  busyProviderMap: Record<string, string | null | undefined>;
  onProbeAll: () => void;
  onProbeSingleExternal: (item: SessionProviderKeyRecord) => void;
}

/**
 * Painel consolidado de latência e saúde de conexão posicionado logo abaixo
 * dos seletores de modelo na SettingsView para todos os provedores configurados.
 */
export const ProviderConnectionHealthStrip: React.FC<ProviderConnectionHealthStripProps> = ({
  providers,
  pingMap,
  geminiServerManaged,
  geminiHealth,
  probingAll,
  busyProviderMap,
  onProbeAll,
  onProbeSingleExternal,
}) => {
  const rows: Array<ProviderHealthRowSummary & { externalItem?: SessionProviderKeyRecord; isGemini?: boolean }> =
    useMemo(() => {
      const list: Array<ProviderHealthRowSummary & { externalItem?: SessionProviderKeyRecord; isGemini?: boolean }> = [];

      if (geminiServerManaged) {
        const gStatus = geminiHealth ? (geminiHealth.ok ? 'ok' : 'error') : null;
        list.push({
          id: 'gemini',
          name: 'Google Gemini',
          shortLabel: 'Gemini',
          model: geminiHealth?.model || 'gemini-4-hydrogen',
          configured: true,
          isDefault: !providers.some((p) => p.configured && p.is_default),
          health: classifyProviderHealth({
            configured: true,
            status: gStatus,
            latencyMs: geminiHealth?.latency_ms ?? null,
            statusCode: geminiHealth?.status_code ?? null,
            lastTestMessage: geminiHealth?.message ?? null,
            lastTestedAt: geminiHealth?.checked_at ?? null,
          }),
          testedAt: geminiHealth?.checked_at ?? null,
          endpointHost: geminiHealth?.endpoint_host || 'generativelanguage.googleapis.com',
          isGemini: true,
        });
      }

      for (const item of providers) {
        if (!item.configured) continue;
        const livePing = pingMap[item.provider];
        const status = livePing
          ? livePing.ok
            ? 'ok'
            : 'error'
          : item.last_test_status === 'ok'
            ? 'ok'
            : item.last_test_status === 'error'
              ? 'error'
              : null;

        let host = livePing?.endpointHost || '';
        if (!host && item.base_url) {
          try {
            host = new URL(item.base_url).host;
          } catch {
            host = '';
          }
        }

        list.push({
          id: item.provider,
          name: item.name,
          shortLabel: item.short_label,
          model: item.default_model || 'modelo padrão',
          configured: true,
          isDefault: item.is_default,
          health: classifyProviderHealth({
            configured: true,
            status,
            latencyMs: livePing ? livePing.latencyMs : item.last_latency_ms,
            statusCode: livePing ? livePing.statusCode : item.last_status_code,
            lastTestMessage: livePing ? livePing.message : item.last_test_message,
            lastTestedAt: livePing ? livePing.testedAt : item.last_tested_at,
          }),
          testedAt: livePing?.testedAt || item.last_tested_at,
          endpointHost: host,
          externalItem: item,
        });
      }

      return list;
    }, [providers, pingMap, geminiServerManaged, geminiHealth]);

  const summary = useMemo(() => summarizeProvidersHealth(rows), [rows]);
  const externalConfiguredCount = rows.filter((r) => !r.isGemini).length;

  return (
    <section
      className="jarvis-health-matrix"
      data-testid="configured-providers-health-strip"
      aria-label="Indicador de latência e saúde de conexão dos provedores configurados"
    >
      <div className="jarvis-health-matrix__header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <Activity size={14} style={{ color: 'var(--accent-light)', flexShrink: 0 }} />
            <strong style={{ fontSize: '0.86rem', color: 'var(--text-primary)' }}>
              Latência &amp; Saúde de Conexão dos Provedores Configurados
            </strong>
          </div>

          <div className="jarvis-health-matrix__meta">
            <span>
              {summary.totalConfigured}{' '}
              {summary.totalConfigured === 1 ? 'provedor configurado' : 'provedores configurados'}
            </span>
            <span aria-hidden="true">·</span>
            <span style={{ color: summary.healthyCount > 0 ? '#4ade80' : 'var(--text-secondary)' }}>
              {summary.healthyCount} {summary.healthyCount === 1 ? 'saudável' : 'saudáveis'}
            </span>
            {summary.degradedCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span style={{ color: '#f87171' }}>
                  {summary.degradedCount} com alerta
                </span>
              </>
            )}
            {summary.avgLatencyMs !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  média <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{summary.avgLatencyMs} ms</strong>
                </span>
              </>
            )}
            {summary.fastestProvider && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  mais rápido: {summary.fastestProvider.shortLabel}{' '}
                  <strong style={{ fontFamily: 'var(--font-mono)', color: '#4ade80' }}>
                    {summary.fastestProvider.latencyMs} ms
                  </strong>
                </span>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-xs"
          onClick={onProbeAll}
          disabled={probingAll || rows.length === 0}
          data-testid="probe-all-providers-health"
          style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          <RefreshCw size={13} className={probingAll ? 'spin' : ''} />
          <span>{probingAll ? 'Medindo latência…' : 'Medir Todos'}</span>
        </button>
      </div>

      {rows.length === 0 ? (
        <div
          className="jarvis-callout"
          style={{ fontSize: '0.76rem', padding: '10px 12px', color: 'var(--text-secondary)' }}
        >
          Nenhum provedor configurado nesta sessão ainda. Salve uma chave de OpenAI, Anthropic, DeepSeek ou compatível acima para monitorar a latência e saúde em tempo real.
        </div>
      ) : (
        <div className="jarvis-health-table" role="list">
          {rows.map((row) => {
            const rowBusy = Boolean(
              probingAll || (row.externalItem && busyProviderMap[row.externalItem.provider])
            );
            return (
              <div
                key={row.id}
                role="listitem"
                className="jarvis-health-row"
                data-testid={`health-row-${row.id}`}
                data-health-tier={row.health.tier}
              >
                <div className="jarvis-health-row__provider">
                  <div className="jarvis-health-row__name">
                    <span>{row.name}</span>
                    {row.isDefault && (
                      <span style={{ fontSize: '0.7rem', fontWeight: 500, color: 'var(--accent-light)' }}>
                        · Padrão
                      </span>
                    )}
                    {row.isGemini && (
                      <span style={{ fontSize: '0.7rem', fontWeight: 500, color: 'var(--text-muted)' }}>
                        · Servidor
                      </span>
                    )}
                  </div>
                  <div className="jarvis-health-row__model" title={`${row.model}${row.endpointHost ? ` · ${row.endpointHost}` : ''}`}>
                    {row.model}
                    {row.endpointHost ? ` · ${row.endpointHost}` : ''}
                  </div>
                </div>

                <div className="jarvis-health-row__status" style={{ color: row.health.color }}>
                  <SignalBars bars={row.health.signalBars} color={row.health.color} />
                  <span>{row.health.label}</span>
                </div>

                <div className="jarvis-health-row__latency">
                  <div className="jarvis-health-row__latency-top">
                    <span style={{ color: row.health.latencyMs !== null ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: 600 }}>
                      {row.health.latencyMs !== null ? `${row.health.latencyMs} ms` : '— ms'}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                      {row.health.statusCode !== null ? `HTTP ${row.health.statusCode}` : 'Sem ping'}
                    </span>
                  </div>
                  <div className="jarvis-latency-track" aria-hidden="true">
                    <div
                      className="jarvis-latency-track__fill"
                      style={{
                        width: `${row.health.latencyPercent}%`,
                        backgroundColor: row.health.color,
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                  <span style={{ fontSize: '0.71rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {formatRelativeCheckTime(row.testedAt)}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    disabled={rowBusy}
                    onClick={() => {
                      if (row.externalItem) {
                        onProbeSingleExternal(row.externalItem);
                      } else {
                        onProbeAll();
                      }
                    }}
                    aria-label={`Medir latência de ${row.shortLabel}`}
                    data-testid={`health-ping-btn-${row.id}`}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    <Wifi size={12} />
                    <span>{rowBusy ? '…' : 'Ping'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {geminiServerManaged && externalConfiguredCount === 0 && (
        <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
          Salve credenciais de OpenAI, Anthropic, DeepSeek ou provedores compatíveis acima para acompanhar a latência de cada endpoint lado a lado aqui.
        </div>
      )}
    </section>
  );
};
