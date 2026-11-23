import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wifi,
  XCircle,
} from 'lucide-react';
import {
  ExternalProviderSlug,
  SessionProviderKeyRecord,
  SessionProviderKeysResponse,
  deleteSessionProviderKey,
  fetchSessionProviderKeys,
  probeConfiguredProvidersHealth,
  saveSessionProviderKey,
  setDefaultSessionProviderKey,
  testSessionProviderKey,
} from '../../services/api/models';
import {
  isWebCryptoAvailable,
  saveEncryptedSessionVaultMeta,
  scrubLegacyPlaintextApiKeys,
} from '../../services/secureVaultCrypto';
import {
  ProviderPingRecord,
  buildDraftKeyFingerprint,
  formatPingBadgeLabel,
  isDraftPingVerified,
  shouldRunPingBeforeSave,
} from '../../services/providerPingValidation';
import {
  ProviderConnectionHealthStrip,
  ProviderInlineHealthBar,
} from './ProviderConnectionHealthStrip';

interface ProviderDraft {
  apiKey: string;
  defaultModel: string;
  baseUrl: string;
  showKey: boolean;
  showAdvancedUrl: boolean;
}

interface ProviderFeedback {
  tone: 'success' | 'error' | 'info';
  text: string;
}

const SOURCE_LABELS: Record<SessionProviderKeyRecord['source'], string> = {
  http_only_cookie_and_vault: 'Cookie HttpOnly + Cofre AES-256-GCM',
  http_only_cookie: 'Cookie HttpOnly Criptografado',
  env: 'Variável de Ambiente do Servidor',
  none: 'Não configurado',
};

export const ThirdPartyApiKeysCard: React.FC = () => {
  const [vaultState, setVaultState] = useState<SessionProviderKeysResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState('');
  const [showSecondary, setShowSecondary] = useState(false);
  const [validateBeforeSave, setValidateBeforeSave] = useState(true);
  const [scrubbedCount, setScrubbedCount] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>({});
  const [busyMap, setBusyMap] = useState<Record<string, 'save' | 'ping_and_save' | 'test' | 'default' | 'delete' | null>>({});
  const [feedbackMap, setFeedbackMap] = useState<Record<string, ProviderFeedback | null>>({});
  const [pingMap, setPingMap] = useState<Record<string, ProviderPingRecord | null>>({});
  const [probingAllHealth, setProbingAllHealth] = useState(false);

  const webCryptoReady = useMemo(() => isWebCryptoAvailable(), []);

  const syncDraftsFromResponse = useCallback((data: SessionProviderKeysResponse) => {
    setDrafts((prev) => {
      const next: Record<string, ProviderDraft> = { ...prev };
      for (const item of data.providers) {
        const current = prev[item.provider];
        next[item.provider] = {
          apiKey: current?.apiKey ?? '',
          defaultModel: current?.defaultModel || item.default_model || '',
          baseUrl: current?.baseUrl || item.base_url || '',
          showKey: current?.showKey ?? false,
          showAdvancedUrl: current?.showAdvancedUrl ?? item.provider === 'custom',
        };
      }
      return next;
    });
  }, []);

  const persistEncryptedMeta = useCallback((data: SessionProviderKeysResponse) => {
    const configuredCount = data.providers.filter((p) => p.configured).length;
    const defaultProvider = data.providers.find((p) => p.is_default)?.provider ?? null;
    void saveEncryptedSessionVaultMeta({
      configuredCount,
      defaultProvider,
      syncedAt: new Date().toISOString(),
    });
  }, []);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setGlobalError('');
    try {
      const data = await fetchSessionProviderKeys();
      setVaultState(data);
      syncDraftsFromResponse(data);
      persistEncryptedMeta(data);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Não foi possível carregar o cofre de chaves da sessão.');
    } finally {
      setLoading(false);
    }
  }, [persistEncryptedMeta, syncDraftsFromResponse]);

  useEffect(() => {
    const cleaned = scrubLegacyPlaintextApiKeys();
    if (cleaned > 0) setScrubbedCount(cleaned);
    void loadKeys();
  }, [loadKeys]);

  const updateDraft = (provider: ExternalProviderSlug, patch: Partial<ProviderDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [provider]: {
        apiKey: prev[provider]?.apiKey ?? '',
        defaultModel: prev[provider]?.defaultModel ?? '',
        baseUrl: prev[provider]?.baseUrl ?? '',
        showKey: prev[provider]?.showKey ?? false,
        showAdvancedUrl: prev[provider]?.showAdvancedUrl ?? provider === 'custom',
        ...patch,
      },
    }));

    // Ao editar chave ou URL, invalida qualquer selo anterior de ping para evitar falso positivo
    if (patch.apiKey !== undefined || patch.baseUrl !== undefined) {
      setPingMap((prev) => (prev[provider] ? { ...prev, [provider]: null } : prev));
    }
  };

  const executePingCheck = useCallback(
    async (
      item: SessionProviderKeyRecord,
      rawKey: string,
      rawBaseUrl: string,
      offerSaveAnyway = false
    ): Promise<ProviderPingRecord> => {
      const cleanKey = rawKey.trim();
      const effectiveUrl = rawBaseUrl.trim() || item.base_url;
      const res = await testSessionProviderKey(item.provider, {
        api_key: cleanKey || undefined,
        base_url: effectiveUrl || undefined,
      });

      if (res.state) {
        setVaultState(res.state);
        persistEncryptedMeta(res.state);
      }

      const record: ProviderPingRecord = {
        ok: res.ok,
        statusCode: res.status_code,
        latencyMs: res.latency_ms,
        endpointHost: res.endpoint_host,
        modelsDetected: res.models_detected || [],
        message: res.message,
        fingerprint: buildDraftKeyFingerprint(cleanKey, effectiveUrl),
        testedAt: new Date().toISOString(),
        savedAnywayOffered: !res.ok && offerSaveAnyway && Boolean(cleanKey),
      };

      setPingMap((prev) => ({ ...prev, [item.provider]: record }));
      return record;
    },
    [persistEncryptedMeta]
  );

  const handleTest = async (item: SessionProviderKeyRecord) => {
    const draft = drafts[item.provider];
    const cleanKey = (draft?.apiKey || '').trim();
    if (!cleanKey && !item.configured) {
      setPingMap((prev) => ({
        ...prev,
        [item.provider]: {
          ok: false,
          statusCode: 400,
          latencyMs: 0,
          endpointHost: '',
          modelsDetected: [],
          message: `Informe sua chave de API do provedor ${item.short_label} para executar o teste de conexão.`,
          fingerprint: buildDraftKeyFingerprint('', draft?.baseUrl || item.base_url),
          testedAt: new Date().toISOString(),
        },
      }));
      return;
    }

    setBusyMap((prev) => ({ ...prev, [item.provider]: 'test' }));
    setFeedbackMap((prev) => ({ ...prev, [item.provider]: null }));
    try {
      await executePingCheck(item, cleanKey, draft?.baseUrl || item.base_url, false);
    } catch (err) {
      setPingMap((prev) => ({
        ...prev,
        [item.provider]: {
          ok: false,
          statusCode: 0,
          latencyMs: 0,
          endpointHost: '',
          modelsDetected: [],
          message: err instanceof Error ? err.message : 'Falha ao executar ping de conexão.',
          fingerprint: buildDraftKeyFingerprint(cleanKey, draft?.baseUrl || item.base_url),
          testedAt: new Date().toISOString(),
        },
      }));
    } finally {
      setBusyMap((prev) => ({ ...prev, [item.provider]: null }));
    }
  };

  const handleProbeAllHealth = async () => {
    setProbingAllHealth(true);
    setGlobalError('');
    try {
      const response = await probeConfiguredProvidersHealth();
      if (response.state) {
        setVaultState(response.state);
        persistEncryptedMeta(response.state);
      }
      if (Array.isArray(response.results) && response.results.length > 0) {
        setPingMap((prev) => {
          const next = { ...prev };
          for (const entry of response.results) {
            const draft = drafts[entry.provider];
            const cleanKey = (draft?.apiKey || '').trim();
            const providerItem = response.state?.providers?.find((p) => p.provider === entry.provider);
            const effectiveUrl = (draft?.baseUrl || providerItem?.base_url || '').trim();
            // Não sobrescreve rascunho de nova chave ainda não salva
            if (!cleanKey) {
              next[entry.provider] = {
                ok: entry.ok,
                statusCode: entry.status_code,
                latencyMs: entry.latency_ms,
                endpointHost: entry.endpoint_host,
                modelsDetected: entry.models_detected || [],
                message: entry.message,
                fingerprint: buildDraftKeyFingerprint('', effectiveUrl),
                testedAt: entry.checked_at,
              };
            }
          }
          return next;
        });
      }
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : 'Não foi possível medir a latência dos provedores configurados.'
      );
    } finally {
      setProbingAllHealth(false);
    }
  };

  const handleSave = async (item: SessionProviderKeyRecord, forceSkipPing = false) => {
    const draft = drafts[item.provider];
    const cleanKey = (draft?.apiKey || '').trim();
    const effectiveUrl = (draft?.baseUrl || item.base_url).trim();

    if (!cleanKey && !item.configured) {
      setFeedbackMap((prev) => ({
        ...prev,
        [item.provider]: {
          tone: 'error',
          text: `Cole sua chave de API do provedor ${item.short_label} antes de salvar.`,
        },
      }));
      return;
    }

    const needsPing = shouldRunPingBeforeSave({
      validateBeforeSave,
      forceSkipPing,
      apiKey: cleanKey,
      baseUrl: effectiveUrl,
      lastPing: pingMap[item.provider],
    });

    setBusyMap((prev) => ({ ...prev, [item.provider]: needsPing ? 'ping_and_save' : 'save' }));
    setFeedbackMap((prev) => ({ ...prev, [item.provider]: null }));

    try {
      if (needsPing) {
        const pingResult = await executePingCheck(item, cleanKey, effectiveUrl, true);
        if (!pingResult.ok) {
          // Bloqueia o salvamento automático e exibe o erro visual com opção de salvar manualmente se desejado
          return;
        }
      }

      const updated = await saveSessionProviderKey(item.provider, {
        api_key: cleanKey || undefined,
        default_model: (draft?.defaultModel || item.default_model).trim(),
        base_url: effectiveUrl || undefined,
        is_default: item.is_default,
      });
      setVaultState(updated);
      persistEncryptedMeta(updated);
      // Limpa imediatamente o segredo em texto claro do campo do formulário
      setDrafts((prev) => ({
        ...prev,
        [item.provider]: {
          apiKey: '',
          defaultModel: prev[item.provider]?.defaultModel || item.default_model,
          baseUrl: prev[item.provider]?.baseUrl || item.base_url,
          showKey: false,
          showAdvancedUrl: prev[item.provider]?.showAdvancedUrl ?? item.provider === 'custom',
        },
      }));
      setPingMap((prev) => {
        const current = prev[item.provider];
        if (!current || !current.ok) return { ...prev, [item.provider]: null };
        return { ...prev, [item.provider]: { ...current, savedAnywayOffered: false } };
      });
      setFeedbackMap((prev) => ({
        ...prev,
        [item.provider]: {
          tone: 'success',
          text: `${item.short_label} salvo com criptografia AES-256-GCM e selado no Cookie HttpOnly da sessão.`,
        },
      }));
    } catch (err) {
      setFeedbackMap((prev) => ({
        ...prev,
        [item.provider]: {
          tone: 'error',
          text: err instanceof Error ? err.message : 'Erro ao salvar chave de API.',
        },
      }));
    } finally {
      setBusyMap((prev) => ({ ...prev, [item.provider]: null }));
    }
  };

  const handleSetDefault = async (provider: ExternalProviderSlug | 'none') => {
    const busyKey = provider === 'none' ? '_default_reset' : provider;
    setBusyMap((prev) => ({ ...prev, [busyKey]: 'default' }));
    try {
      const updated = await setDefaultSessionProviderKey(provider);
      setVaultState(updated);
      persistEncryptedMeta(updated);
      if (provider !== 'none') {
        setFeedbackMap((prev) => ({
          ...prev,
          [provider]: {
            tone: 'info',
            text: 'Definido como provedor padrão de inferência para esta sessão.',
          },
        }));
      }
    } catch (err) {
      if (provider !== 'none') {
        setFeedbackMap((prev) => ({
          ...prev,
          [provider]: {
            tone: 'error',
            text: err instanceof Error ? err.message : 'Não foi possível definir como padrão.',
          },
        }));
      } else {
        setGlobalError(err instanceof Error ? err.message : 'Falha ao restaurar provedor padrão.');
      }
    } finally {
      setBusyMap((prev) => ({ ...prev, [busyKey]: null }));
    }
  };

  const handleDelete = async (item: SessionProviderKeyRecord) => {
    setBusyMap((prev) => ({ ...prev, [item.provider]: 'delete' }));
    setFeedbackMap((prev) => ({ ...prev, [item.provider]: null }));
    try {
      const updated = await deleteSessionProviderKey(item.provider);
      setVaultState(updated);
      persistEncryptedMeta(updated);
      updateDraft(item.provider, { apiKey: '', showKey: false });
      setPingMap((prev) => ({ ...prev, [item.provider]: null }));
      setFeedbackMap((prev) => ({
        ...prev,
        [item.provider]: {
          tone: 'info',
          text: `Credencial de ${item.short_label} removida da sessão e do Cookie HttpOnly.`,
        },
      }));
    } catch (err) {
      setFeedbackMap((prev) => ({
        ...prev,
        [item.provider]: {
          tone: 'error',
          text: err instanceof Error ? err.message : 'Não foi possível remover a credencial.',
        },
      }));
    } finally {
      setBusyMap((prev) => ({ ...prev, [item.provider]: null }));
    }
  };

  const primaryProviders = useMemo(
    () => (vaultState?.providers || []).filter((p) => p.tier === 'primary'),
    [vaultState]
  );

  const secondaryProviders = useMemo(
    () => (vaultState?.providers || []).filter((p) => p.tier === 'secondary'),
    [vaultState]
  );

  const activeDefaultProvider = useMemo(
    () => (vaultState?.providers || []).find((p) => p.configured && p.is_default) || null,
    [vaultState]
  );

  const configuredCount = useMemo(
    () => (vaultState?.providers || []).filter((p) => p.configured).length,
    [vaultState]
  );

  const renderProviderCard = (item: SessionProviderKeyRecord) => {
    const draft = drafts[item.provider] || {
      apiKey: '',
      defaultModel: item.default_model,
      baseUrl: item.base_url,
      showKey: false,
      showAdvancedUrl: item.provider === 'custom',
    };
    const busy = busyMap[item.provider];
    const feedback = feedbackMap[item.provider];
    const ping = pingMap[item.provider];
    const canRemove = item.configured && item.source !== 'env';
    const hasNewDraftKey = draft.apiKey.trim().length > 0;
    const draftVerified = isDraftPingVerified(ping, draft.apiKey, draft.baseUrl || item.base_url);
    const willValidateOnSave = shouldRunPingBeforeSave({
      validateBeforeSave,
      apiKey: draft.apiKey,
      baseUrl: draft.baseUrl || item.base_url,
      lastPing: ping,
    });

    return (
      <div
        key={item.provider}
        data-testid={`provider-key-card-${item.provider}`}
        className="jarvis-settings-subcard"
        style={{
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          border: item.is_default
            ? '1px solid var(--accent-color, #6366f1)'
            : ping?.ok
              ? '1px solid rgba(34, 197, 94, 0.35)'
              : ping && !ping.ok
                ? '1px solid rgba(239, 68, 68, 0.35)'
                : '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 260px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <KeyRound size={15} style={{ color: item.configured || draftVerified ? '#4ade80' : 'var(--text-muted)', flexShrink: 0 }} />
              <strong style={{ fontSize: '0.94rem', color: 'var(--text-primary)' }}>{item.name}</strong>
              {item.is_default && (
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    padding: '2px 7px',
                    borderRadius: '4px',
                    background: 'rgba(99, 102, 241, 0.16)',
                    color: '#a5b4fc',
                    border: '1px solid rgba(99, 102, 241, 0.35)',
                  }}
                >
                  Provedor Padrão
                </span>
              )}
              {item.configured && (
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    padding: '2px 7px',
                    borderRadius: '4px',
                    background: 'rgba(34, 197, 94, 0.14)',
                    color: '#4ade80',
                    border: '1px solid rgba(34, 197, 94, 0.28)',
                  }}
                >
                  Conectado
                </span>
              )}
              {ping && (
                <span
                  data-testid={`ping-badge-${item.provider}`}
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    padding: '2px 7px',
                    borderRadius: '4px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: ping.ok ? 'rgba(34, 197, 94, 0.16)' : 'rgba(239, 68, 68, 0.16)',
                    color: ping.ok ? '#4ade80' : '#f87171',
                    border: ping.ok ? '1px solid rgba(34, 197, 94, 0.34)' : '1px solid rgba(239, 68, 68, 0.34)',
                  }}
                >
                  {ping.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                  {formatPingBadgeLabel(ping)}
                </span>
              )}
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{item.docs_hint}</span>
          </div>

          <div style={{ flexShrink: 0, textAlign: 'right', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            {item.configured ? (
              <>
                <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>
                  {item.masked_key}
                </div>
                <div>{SOURCE_LABELS[item.source]}</div>
              </>
            ) : (
              <div>Chave ausente · env: <code>{item.env_var}</code></div>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label
              htmlFor={`provider-apikey-${item.provider}`}
              style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}
            >
              {item.configured ? 'Atualizar Chave de API (opcional)' : 'Chave de API'}
            </label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                id={`provider-apikey-${item.provider}`}
                type={draft.showKey ? 'text' : 'password'}
                className="jarvis-input"
                autoComplete="off"
                spellCheck={false}
                placeholder={item.configured ? `Salva (${item.masked_key}) — cole para substituir` : item.key_prefix_hint}
                value={draft.apiKey}
                onChange={(e) => updateDraft(item.provider, { apiKey: e.target.value })}
                style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
              />
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => updateDraft(item.provider, { showKey: !draft.showKey })}
                title={draft.showKey ? 'Ocultar chave' : 'Exibir chave'}
                aria-label={draft.showKey ? 'Ocultar chave' : 'Exibir chave'}
              >
                {draft.showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label
              htmlFor={`provider-model-${item.provider}`}
              style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}
            >
              Modelo Padrão
            </label>
            <input
              id={`provider-model-${item.provider}`}
              type="text"
              className="jarvis-input"
              list={`models-list-${item.provider}`}
              placeholder={item.default_model || 'ex: gpt-4o-mini'}
              value={draft.defaultModel}
              onChange={(e) => updateDraft(item.provider, { defaultModel: e.target.value })}
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
            />
            {item.suggested_models.length > 0 && (
              <datalist id={`models-list-${item.provider}`}>
                {item.suggested_models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            )}
          </div>
        </div>

        {/* Indicador visual inline de latência e saúde logo abaixo do seletor de modelo */}
        <ProviderInlineHealthBar
          provider={item.provider}
          configured={item.configured}
          ping={ping}
          lastTestStatus={item.last_test_status}
          lastLatencyMs={item.last_latency_ms}
          lastStatusCode={item.last_status_code}
          lastTestMessage={item.last_test_message}
          lastTestedAt={item.last_tested_at}
          endpointHost={(() => {
            const url = (draft.baseUrl || item.base_url || '').trim();
            if (!url) return '';
            try {
              return new URL(url).host;
            } catch {
              return '';
            }
          })()}
        />

        {(draft.showAdvancedUrl || item.provider === 'custom') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label
              htmlFor={`provider-url-${item.provider}`}
              style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}
            >
              Endpoint HTTPS da API
            </label>
            <input
              id={`provider-url-${item.provider}`}
              type="url"
              className="jarvis-input"
              placeholder="https://api.exemplo.com/v1"
              value={draft.baseUrl}
              onChange={(e) => updateDraft(item.provider, { baseUrl: e.target.value })}
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
            />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              disabled={busy !== null && busy !== undefined}
              onClick={() => void handleTest(item)}
              data-testid={`test-provider-${item.provider}`}
            >
              <Wifi size={13} />
              {busy === 'test'
                ? 'Testando ping…'
                : hasNewDraftKey
                  ? 'Testar Chave (Ping)'
                  : 'Testar Conexão'}
            </button>

            <button
              type="button"
              className="btn btn-primary btn-xs"
              disabled={busy !== null && busy !== undefined}
              onClick={() => void handleSave(item, false)}
              data-testid={`save-provider-${item.provider}`}
            >
              <Lock size={13} />
              {busy === 'ping_and_save'
                ? 'Validando (ping)…'
                : busy === 'save'
                  ? 'Criptografando…'
                  : willValidateOnSave
                    ? 'Validar e Salvar'
                    : item.configured
                      ? 'Atualizar na Sessão'
                      : 'Salvar na Sessão'}
            </button>

            {item.configured && !item.is_default && (
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                disabled={busy !== null && busy !== undefined}
                onClick={() => void handleSetDefault(item.provider)}
                data-testid={`default-provider-${item.provider}`}
              >
                <CheckCircle2 size={13} />
                {busy === 'default' ? 'Aplicando…' : 'Usar como Padrão'}
              </button>
            )}

            {item.provider !== 'custom' && (
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => updateDraft(item.provider, { showAdvancedUrl: !draft.showAdvancedUrl })}
              >
                {draft.showAdvancedUrl ? 'Ocultar URL' : 'URL HTTPS'}
              </button>
            )}
          </div>

          {canRemove && (
            <button
              type="button"
              className="btn btn-danger-ghost btn-xs"
              disabled={busy !== null && busy !== undefined}
              onClick={() => void handleDelete(item)}
              data-testid={`delete-provider-${item.provider}`}
            >
              <Trash2 size={13} />
              {busy === 'delete' ? 'Removendo…' : 'Remover'}
            </button>
          )}
        </div>

        {/* Painel visual detalhado do resultado do Ping (Sucesso ou Erro) */}
        {ping && (
          <div
            data-testid={`ping-feedback-${item.provider}`}
            role="status"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '10px 12px',
              borderRadius: '8px',
              background: ping.ok ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: ping.ok ? '1px solid rgba(34, 197, 94, 0.34)' : '1px solid rgba(239, 68, 68, 0.34)',
              borderLeft: ping.ok ? '3px solid #22c55e' : '3px solid #ef4444',
              fontSize: '0.78rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontWeight: 600, color: ping.ok ? '#4ade80' : '#fca5a5' }}>
                {ping.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                <span>
                  {ping.ok
                    ? hasNewDraftKey
                      ? 'Ping aprovado — chave válida e pronta para salvar'
                      : 'Ping aprovado — conexão autenticada com sucesso'
                    : 'Falha no teste de conexão (Ping)'}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                {ping.endpointHost && <span>{ping.endpointHost}</span>}
                {ping.statusCode > 0 && <span>HTTP {ping.statusCode}</span>}
                {ping.latencyMs > 0 && <span>{ping.latencyMs} ms</span>}
              </div>
            </div>

            <div style={{ color: 'var(--text-primary)', lineHeight: 1.45 }}>{ping.message}</div>

            {ping.ok && ping.modelsDetected.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Modelos detectados:</span>
                {ping.modelsDetected.slice(0, 5).map((modelId) => (
                  <button
                    key={modelId}
                    type="button"
                    className="btn btn-secondary btn-xs"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', padding: '2px 7px' }}
                    onClick={() => updateDraft(item.provider, { defaultModel: modelId })}
                    title="Clique para usar este modelo como padrão"
                  >
                    {modelId}
                  </button>
                ))}
              </div>
            )}

            {ping.savedAnywayOffered && hasNewDraftKey && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', paddingTop: '4px', borderTop: '1px solid rgba(239, 68, 68, 0.2)' }}>
                <span style={{ fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
                  A chave não foi salva porque o ping falhou. Corrija a chave ou salve manualmente para uso posterior.
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  data-testid={`force-save-provider-${item.provider}`}
                  onClick={() => void handleSave(item, true)}
                >
                  Salvar mesmo assim
                </button>
              </div>
            )}
          </div>
        )}

        {/* Feedback de salvamento / alteração de padrão / remoção */}
        {feedback && (
          <div
            className={`jarvis-callout ${
              feedback.tone === 'error'
                ? 'jarvis-callout--danger'
                : feedback.tone === 'success'
                  ? 'jarvis-callout--success'
                  : 'jarvis-callout--info'
            }`}
            style={{ fontSize: '0.76rem', padding: '8px 10px' }}
          >
            {feedback.text}
          </div>
        )}

        {!ping && !feedback && item.last_test_message && item.last_test_status === 'error' && (
          <div
            className="jarvis-callout jarvis-callout--danger"
            style={{ fontSize: '0.75rem', padding: '7px 10px' }}
          >
            Último erro de ping registrado: {item.last_test_message}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div className="jarvis-settings-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 280px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={17} style={{ color: '#4ade80', flexShrink: 0 }} />
              <strong style={{ fontSize: '0.96rem', color: 'var(--text-primary)' }}>
                Cofre Protegido da Sessão — Chaves de API de Terceiros
              </strong>
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Conecte suas contas <strong>Anthropic</strong>, <strong>OpenAI</strong> e <strong>DeepSeek</strong> com teste de ping em tempo real antes de salvar.
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.76rem',
                color: 'var(--text-primary)',
                padding: '5px 10px',
                borderRadius: '6px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={validateBeforeSave}
                onChange={(e) => setValidateBeforeSave(e.target.checked)}
                data-testid="toggle-validate-before-save"
              />
              <Activity size={13} style={{ color: validateBeforeSave ? '#4ade80' : 'var(--text-muted)' }} />
              Validar (ping) antes de salvar
            </label>

            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => void loadKeys()}
              disabled={loading}
            >
              <RefreshCw size={13} />
              {loading ? 'Sincronizando…' : 'Atualizar'}
            </button>
          </div>
        </div>

        <div
          className="jarvis-callout jarvis-callout--info"
          style={{ fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: '6px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <Lock size={14} />
            <strong>Blindagem contra exposição em localStorage:</strong>
            <span>
              Chaves são criptografadas em <strong>AES-256-GCM</strong> no servidor e seladas em{' '}
              <strong>Cookie HttpOnly</strong> (<code>jarvis_provider_vault</code>) inacessível a scripts do navegador
              {webCryptoReady ? ' · Web Crypto API (AES-GCM 256-bit) ativo na aba.' : '.'}
            </span>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            <Sparkles size={12} style={{ display: 'inline', marginRight: '5px', verticalAlign: '-1px' }} />
            Google Gemini:{' '}
            <strong>
              {vaultState?.gemini_server_managed
                ? 'Ativo e gerenciado automaticamente pelos segredos do servidor'
                : 'Configurável via variável de ambiente GEMINI_API_KEY no servidor'}
            </strong>
            . {configuredCount > 0 ? `${configuredCount} provedor(es) externo(s) ativo(s) nesta sessão.` : 'Nenhum provedor externo cadastrado ainda.'}
          </div>
          {scrubbedCount > 0 && (
            <div style={{ fontSize: '0.74rem', color: '#fbbf24' }}>
              {scrubbedCount} entrada(s) legada(s) em texto claro foram limpas automaticamente do armazenamento do navegador.
            </div>
          )}
        </div>

        {activeDefaultProvider && (
          <div
            className="jarvis-settings-subcard"
            style={{
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>
              Motor padrão ativo na sessão:{' '}
              <strong>{activeDefaultProvider.name}</strong> (<code>{activeDefaultProvider.default_model}</code>)
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => void handleSetDefault('none')}
              disabled={Boolean(busyMap['_default_reset'])}
            >
              Voltar para Roteamento Híbrido / Gemini
            </button>
          </div>
        )}

        {globalError && (
          <div className="jarvis-callout jarvis-callout--danger" style={{ fontSize: '0.78rem' }}>
            {globalError}
          </div>
        )}

        {loading && !vaultState ? (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '12px 0' }}>
            Carregando estado protegido da sessão…
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {primaryProviders.map(renderProviderCard)}

            <div style={{ paddingTop: '4px' }}>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => setShowSecondary((v) => !v)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                {showSecondary ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showSecondary
                  ? 'Ocultar provedores adicionais'
                  : `Mais provedores compatíveis (${secondaryProviders.length}: Groq, OpenRouter, xAI Grok, Custom)`}
              </button>
            </div>

            {showSecondary && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {secondaryProviders.map(renderProviderCard)}
              </div>
            )}

            {/* Indicador consolidado de latência e saúde para todos os provedores configurados */}
            <ProviderConnectionHealthStrip
              providers={vaultState?.providers || []}
              pingMap={pingMap}
              geminiServerManaged={Boolean(vaultState?.gemini_server_managed)}
              geminiHealth={vaultState?.gemini_health}
              probingAll={probingAllHealth}
              busyProviderMap={busyMap}
              onProbeAll={() => void handleProbeAllHealth()}
              onProbeSingleExternal={(item) => void handleTest(item)}
            />
          </div>
        )}
      </div>
    </div>
  );
};
