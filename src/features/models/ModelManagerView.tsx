import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  fetchModels,
  fetchCuratedHuggingFaceModels,
  searchHuggingFaceModels,
  fetchAgentModelRecommendations,
  fetchHardwareAdvisor,
  updateProviderConnectivity,
  HardwareAdvisorPayload,
  API_BASE,
} from '../../api';
import { apiFetch } from '../../services/sessionTransport';
import { notify } from '../../shared/common/Toast';
import { PageHeader } from '../../shared/layout/PageHeader';
import { HuggingFaceHubSection } from './HuggingFaceHubSection';
import { LocalModelsGrid } from './LocalModelsGrid';
import { AgentRecommendationTable } from './AgentRecommendationTable';
import { ModelQualityPanel } from './ModelQualityPanel';
import { HardwareAdvisorPanel } from './HardwareAdvisorPanel';
import { ModelArenaPanel } from './ModelArenaPanel';
import { HardwareAdvisorView } from '../hardware/HardwareAdvisorView';

type ModelsTabId = 'advisor' | 'hardware' | 'arena' | 'hub' | 'local' | 'quality';

interface ModelManagerViewProps {
  embedded?: boolean;
}

export const ModelManagerView: React.FC<ModelManagerViewProps> = ({ embedded = false }) => {
  const [data, setData] = useState<any>(null);
  const [advisor, setAdvisor] = useState<HardwareAdvisorPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ModelsTabId>('advisor');

  // Estados Hugging Face Hub & Instalação 1-Clique
  const [hfCurated, setHfCurated] = useState<any[]>([]);
  const [hfSearchQuery, setHfSearchQuery] = useState('');
  const [hfSearchResults, setHfSearchResults] = useState<any[]>([]);
  const [isHfSearching, setIsHfSearching] = useState(false);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadStatusText, setDownloadStatusText] = useState<string>('');
  const [agentRecommendations, setAgentRecommendations] = useState<Record<string, { model: string; reason: string }>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        fetchModels(),
        fetchHardwareAdvisor(),
        fetchCuratedHuggingFaceModels(),
        fetchAgentModelRecommendations(),
      ]);
      const failures: string[] = [];
      const [modelsResult, advisorResult, curatedResult, recommendationsResult] = results;

      if (modelsResult.status === 'fulfilled') setData(modelsResult.value);
      else {
        setData(null);
        failures.push(modelsResult.reason instanceof Error ? modelsResult.reason.message : 'Falha ao consultar modelos.');
      }

      if (advisorResult.status === 'fulfilled') setAdvisor(advisorResult.value);
      else {
        failures.push(
          advisorResult.reason instanceof Error ? advisorResult.reason.message : 'Falha ao consultar Consultor de Hardware.'
        );
      }

      if (curatedResult.status === 'fulfilled') setHfCurated(curatedResult.value);
      else failures.push(curatedResult.reason instanceof Error ? curatedResult.reason.message : 'Falha ao consultar Hugging Face.');

      if (recommendationsResult.status === 'fulfilled') setAgentRecommendations(recommendationsResult.value);
      else failures.push(recommendationsResult.reason instanceof Error ? recommendationsResult.reason.message : 'Falha ao consultar recomendações.');

      setLoadError(failures.length ? failures.join(' ') : null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Falha ao carregar modelos e configurações.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`${API_BASE}/auth/me`)
      .then(async (response) => (response.ok ? response.json() : null))
      .then((principal) => {
        if (cancelled) return;
        const admin = principal?.kind === 'human' && principal?.role === 'admin';
        setIsAdmin(admin);
        setRoleLoaded(true);
        void loadData();
      })
      .catch(() => {
        if (cancelled) return;
        setIsAdmin(false);
        setRoleLoaded(true);
        void loadData();
      });
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  const handleAdvisorUpdated = useCallback(async (next: HardwareAdvisorPayload) => {
    setAdvisor(next);
    try {
      const [curated, modelsRes, recs] = await Promise.all([
        fetchCuratedHuggingFaceModels(),
        fetchModels(),
        fetchAgentModelRecommendations(),
      ]);
      setHfCurated(curated);
      setData(modelsRes);
      setAgentRecommendations(recs);
    } catch {
      // mantém estado atual se atualização secundária falhar
    }
  }, []);

  const handleReconnectHf = async () => {
    try {
      const updated = await updateProviderConnectivity({ huggingface_connected: true });
      await handleAdvisorUpdated(updated);
      notify('Hugging Face Hub reconectado.', 'success');
    } catch (err: any) {
      notify(err.message || 'Falha ao reconectar Hugging Face.', 'error');
    }
  };

  const handleSearchHf = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!hfSearchQuery.trim()) {
      setHfSearchResults([]);
      return;
    }
    setIsHfSearching(true);
    try {
      const results = await searchHuggingFaceModels(hfSearchQuery.trim(), 8);
      setHfSearchResults(results);
      if (results.length === 0) {
        notify('Nenhum modelo compatível encontrado no Hugging Face', 'info');
      }
    } catch (err: any) {
      notify(`Erro ao buscar no Hugging Face: ${err.message}`, 'error');
    } finally {
      setIsHfSearching(false);
    }
  };

  const isModelInstalled = (tag: string) => {
    if (!data?.models || !Array.isArray(data.models)) return false;
    const cleanTag = tag.toLowerCase().replace(/^hf\.co\//, '');
    return data.models.some((m: any) => {
      const mName = (m.name || '').toLowerCase();
      return Boolean(mName) && (mName.includes(cleanTag) || cleanTag.includes(mName));
    });
  };

  const handleInstallModel = async (modelTag: string, displayName: string) => {
    if (!isAdmin) return;
    if (downloadingModelId) {
      notify('Já existe uma instalação em andamento', 'warning');
      return;
    }
    setDownloadingModelId(modelTag);
    setDownloadProgress(5);
    setDownloadStatusText('Conectando ao Hugging Face & Ollama Engine...');
    notify(`Iniciando download de ${displayName}...`, 'info');

    try {
      const response = await apiFetch(`${API_BASE}/models/huggingface/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_tag: modelTag, display_name: displayName }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Falha ao iniciar stream de instalação');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let terminalEventReceived = false;

      const processEventLine = async (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) return;
        try {
          const eventData = JSON.parse(trimmed.slice(6));
          if (eventData.status === 'downloading') {
            if (eventData.total && eventData.completed) {
              const pct = Math.min(99, Math.round((eventData.completed / eventData.total) * 100));
              setDownloadProgress(pct);
              setDownloadStatusText(`A descarregar camadas: ${pct}% concluído`);
            } else if (typeof eventData.percent === 'number') {
              setDownloadProgress(eventData.percent);
              setDownloadStatusText(`A descarregar: ${eventData.percent}%`);
            }
          } else if (eventData.status === 'success') {
            terminalEventReceived = true;
            setDownloadProgress(100);
            setDownloadStatusText('Modelo instalado e confirmado pelo servidor.');
            notify(`Modelo ${displayName} instalado com sucesso!`, 'success');
            await loadData();
          } else if (eventData.status === 'error') {
            terminalEventReceived = true;
            const message = eventData.message || 'Erro durante a instalação do modelo.';
            setDownloadStatusText(message);
            notify(message, 'error');
          }
        } catch {
          // Ignora heartbeats SSE incompletos
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) await processEventLine(line);
      }

      buffer += decoder.decode();
      if (buffer.trim()) await processEventLine(buffer);
      if (!terminalEventReceived) {
        throw new Error('O stream terminou sem confirmar a instalação do modelo.');
      }
    } catch (err: any) {
      notify(`Falha ao instalar modelo: ${err.message}`, 'error');
    } finally {
      window.setTimeout(() => {
        setDownloadingModelId(null);
        setDownloadProgress(0);
        setDownloadStatusText('');
      }, 3500);
    }
  };

  const localModelsCount = data?.models?.length || 0;
  const activeProfile = advisor?.profiles.find((p) => p.id === advisor.active_profile_id);
  const hfConnected = advisor ? advisor.providers.huggingface_connected : true;
  const geminiConnected = advisor ? advisor.providers.gemini_connected : true;

  return (
    <div className="jarvis-page-shell">
      {!embedded ? (
        <PageHeader
          title="Modelos & Hardware"
          subtitle="Hardware real deste computador, Ollama local, Hugging Face e provedores na nuvem."
          meta={[
            <span key="hw-vram" className="jarvis-tabular">
              {activeProfile
                ? `${activeProfile.ram_gb} GB RAM · ${activeProfile.gpu_name}${activeProfile.vram_gb > 0 ? ` (${activeProfile.vram_gb} GB VRAM)` : ''}`
                : `${localModelsCount} modelos locais`}
            </span>,
            <span
              key="hybrid-status"
              style={{ color: geminiConnected ? 'var(--info-text)' : 'var(--success-text)', fontWeight: 600 }}
            >
              {geminiConnected ? 'Motor Híbrido (Local + Nuvem)' : 'Modo 100% Local'}
            </span>,
            <span
              key="hf-status"
              style={{ color: hfConnected ? 'var(--success-text)' : 'var(--warning-text)', fontWeight: 500 }}
            >
              {hfConnected ? 'Hugging Face ativo' : 'Hugging Face desconectado'}
            </span>,
          ]}
          actions={
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="btn btn-ghost btn-sm"
              title="Recarregar status de modelos e hardware"
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              <span>{loading ? 'Atualizando…' : 'Atualizar'}</span>
            </button>
          }
        />
      ) : (
        <div
          className="jarvis-settings-card"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            padding: '14px 16px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
            <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Hardware Detectado: {activeProfile ? activeProfile.cpu : 'Carregando...'}
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
              {activeProfile
                ? `${activeProfile.ram_gb} GB RAM · ${activeProfile.gpu_name}${activeProfile.vram_gb > 0 ? ` (${activeProfile.vram_gb} GB VRAM)` : ' (Integrada)'} · ${localModelsCount} modelo(s) Ollama`
                : 'Consultando hardware local...'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="btn btn-secondary btn-xs"
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
            <span>{loading ? 'Atualizando…' : 'Atualizar'}</span>
          </button>
        </div>
      )}

      {!roleLoaded ? (
        <div role="status" className="jarvis-callout jarvis-callout--info">
          A carregar Central de Modelos…
        </div>
      ) : (
        <>
          {loadError && (
            <div role="alert" className="jarvis-error-banner">
              Algumas informações não puderam ser carregadas: {loadError}
            </div>
          )}

          {/* Barra de Navegação por Abas */}
          <div className="jarvis-filter-bar" style={{ justifyContent: 'space-between' }}>
            <div
              role="tablist"
              aria-label="Seções da central de modelos"
              className="jarvis-segmented"
              style={{ flexWrap: 'wrap' }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'advisor'}
                onClick={() => setActiveTab('advisor')}
                className={`jarvis-segmented-btn ${activeTab === 'advisor' ? 'is-active' : ''}`}
              >
                Consultor & Provedores
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'hardware'}
                onClick={() => setActiveTab('hardware')}
                className={`jarvis-segmented-btn ${activeTab === 'hardware' ? 'is-active' : ''}`}
              >
                Diagnóstico de Hardware
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'arena'}
                onClick={() => setActiveTab('arena')}
                className={`jarvis-segmented-btn ${activeTab === 'arena' ? 'is-active' : ''}`}
              >
                Modo Arena (A/B)
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'hub'}
                onClick={() => setActiveTab('hub')}
                className={`jarvis-segmented-btn ${activeTab === 'hub' ? 'is-active' : ''}`}
              >
                Hugging Face Hub
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'local'}
                onClick={() => setActiveTab('local')}
                className={`jarvis-segmented-btn ${activeTab === 'local' ? 'is-active' : ''}`}
              >
                Modelos Locais ({localModelsCount})
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'quality'}
                onClick={() => setActiveTab('quality')}
                className={`jarvis-segmented-btn ${activeTab === 'quality' ? 'is-active' : ''}`}
              >
                Qualidade & Aprendizagem
              </button>
            </div>
          </div>

          {activeTab === 'advisor' && (
            <HardwareAdvisorPanel
              advisor={advisor}
              loading={loading}
              onAdvisorUpdated={(next) => void handleAdvisorUpdated(next)}
              onRecommendationsApplied={() => void loadData()}
            />
          )}

          {activeTab === 'hardware' && <HardwareAdvisorView embedded />}

          {activeTab === 'arena' && <ModelArenaPanel installedLocalModels={data?.models || []} />}

          {activeTab === 'hub' && (
            <HuggingFaceHubSection
              curatedModels={hfCurated}
              searchResults={hfSearchResults}
              searchQuery={hfSearchQuery}
              isSearching={isHfSearching}
              downloadingModelId={downloadingModelId}
              downloadProgress={downloadProgress}
              downloadStatusText={downloadStatusText}
              agentRecommendations={agentRecommendations}
              canInstall={isAdmin}
              hfConnected={hfConnected}
              onReconnectHf={() => void handleReconnectHf()}
              isModelInstalled={isModelInstalled}
              onSearchChange={(q) => setHfSearchQuery(q)}
              onSearchSubmit={handleSearchHf}
              onClearSearch={() => {
                setHfSearchResults([]);
                setHfSearchQuery('');
              }}
              onInstallModel={handleInstallModel}
            />
          )}

          {activeTab === 'local' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <LocalModelsGrid models={data?.models} />
              <AgentRecommendationTable
                recommendations={agentRecommendations}
                isModelInstalled={isModelInstalled}
                onInstallModel={handleInstallModel}
                isInstalling={Boolean(downloadingModelId)}
              />
            </div>
          )}

          {activeTab === 'quality' && <ModelQualityPanel />}
        </>
      )}
    </div>
  );
};

