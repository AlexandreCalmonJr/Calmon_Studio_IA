import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRightLeft,
  ArrowUpCircle,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Code2,
  Cpu,
  Database,
  Download,
  HardDrive,
  Layers,
  Loader2,
  Package,
  Plug,
  Plus,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  Upload,
  Wifi,
} from 'lucide-react';
import { useAssistantIdentity } from '../../context/AssistantIdentityContext';
import { notify } from '../../shared/common/Toast';
import { emitAppEvent } from '../../shared/state/appBus';
import {
  buildDualModeServerArtifacts,
  DEFAULT_DEPLOYMENT_OPTIONS,
  UNIFIED_API_ROUTE_MAP,
  type BrainConnectionProfile,
  type BrainDeploymentOptions,
  type BrainMode,
  type GeneratedServerArtifact,
} from '../../services/brainArchitectureEngine';
import { BrainDualModePanel } from './BrainDualModePanel';
import { BrainApiMapPanel, BrainFilesPanel } from './BrainFilesAndApiPanel';
import {
  activateBrainProfileApi,
  addBrainProfileApi,
  createSqliteBackupApi,
  downloadDualModeBundleZipApi,
  exportBrainPackApi,
  fetchBrainInfoApi,
  fetchBrainProfilesApi,
  fetchBrainSchemaApi,
  importBrainPackApi,
  pingBrainProfileApi,
  previewDualModeBundleApi,
  removeBrainProfileApi,
  type BrainInfoResponse,
  type BrainSchemaResponse,
} from '../../services/api/brainServer';
import {
  fetchModulePacks,
  fetchPackageUpdatesStatus,
  PACKS_UPDATED_EVENT,
  PACK_UPDATES_CHANGED_EVENT,
  type ModulePacksPayload,
  type VersionCheckReport,
} from '../../services/api/packs';
import type { ModulePackWithState } from '../../services/modulePackEngine';
import {
  evaluateSyncFreshness,
  reconcileLocalPacksWithServerMetadata,
  type SyncFreshnessState,
  type UpdateBadgeState,
} from '../../services/packageVersionEngine';

import { BrainMemoryPanel } from './BrainMemoryPanel';
import { BrainPythonLanesPanel } from './BrainPythonLanesPanel';
import { BrainMcpPanel } from './BrainMcpPanel';
import { BrainUpdatesPanel } from './BrainUpdatesPanel';
import { BrainInfraRuntimePanel } from './BrainInfraRuntimePanel';
import { hubStore } from '../../services/hubStore';

type BrainHubTab =
  | 'multi_brain'
  | 'infra_runtime'
  | 'updates'
  | 'memory_hybrid'
  | 'python_lanes'
  | 'mcp_gateway'
  | 'dual_mode'
  | 'files'
  | 'api_map';

interface BrainServerHubViewProps {
  onNavigate?: (tab: string) => void;
  canManagePacks?: boolean;
}

const MODE_BADGE_MAP: Record<BrainMode, { label: string; color: string; bg: string; border: string }> = {
  local_sqlite: {
    label: 'Local · SQLite (Sem Docker)',
    color: '#047857',
    bg: 'rgba(16, 185, 129, 0.14)',
    border: 'rgba(16, 185, 129, 0.35)',
  },
  docker_postgres: {
    label: 'Docker · PostgreSQL + pgvector',
    color: '#1d4ed8',
    bg: 'rgba(59, 130, 246, 0.14)',
    border: 'rgba(59, 130, 246, 0.35)',
  },
  cloud: {
    label: 'Remoto · HTTPS Seguro',
    color: '#b45309',
    bg: 'rgba(245, 158, 11, 0.16)',
    border: 'rgba(245, 158, 11, 0.38)',
  },
};

const METHOD_COLORS: Record<string, { color: string; bg: string }> = {
  GET: { color: '#047857', bg: 'rgba(16, 185, 129, 0.14)' },
  POST: { color: '#b45309', bg: 'rgba(245, 158, 11, 0.16)' },
  PUT: { color: '#1d4ed8', bg: 'rgba(59, 130, 246, 0.14)' },
  DELETE: { color: '#b91c1c', bg: 'rgba(239, 68, 68, 0.14)' },
};

export const BrainServerHubView: React.FC<BrainServerHubViewProps> = ({
  onNavigate,
  canManagePacks = false,
}) => {
  const { assistantName } = useAssistantIdentity();
  const [activeTab, setActiveTab] = useState<BrainHubTab>('multi_brain');

  // Estado Multi-Cérebros
  const [brainInfo, setBrainInfo] = useState<BrainInfoResponse | null>(null);
  const [profiles, setProfiles] = useState<BrainConnectionProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('brain_local_primary');
  const [loadingBrains, setLoadingBrains] = useState<boolean>(true);
  const [busyProfileId, setBusyProfileId] = useState<string | null>(null);

  // Verificação de Versões: compara pacotes locais vs. metadados do servidor
  const [localPacks, setLocalPacks] = useState<ModulePackWithState[]>([]);
  const [serverUpdatesReport, setServerUpdatesReport] = useState<VersionCheckReport | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState<boolean>(true);
  const [lastSuccessfulSyncAt, setLastSuccessfulSyncAt] = useState<string | null>(null);
  const [syncClockMs, setSyncClockMs] = useState<number>(() => Date.now());
  const versionCheckSeqRef = useRef<number>(0);

  // Formulário Novo Cérebro
  const [newName, setNewName] = useState<string>('');
  const [newUrl, setNewUrl] = useState<string>('');
  const [newMode, setNewMode] = useState<BrainMode>('docker_postgres');
  const [newDescription, setNewDescription] = useState<string>('');
  const [addingBrain, setAddingBrain] = useState<boolean>(false);

  // Migração .jarvis-pack & Backup SQLite
  const [exportingPack, setExportingPack] = useState<boolean>(false);
  const [importingPack, setImportingPack] = useState<boolean>(false);
  const [creatingBackup, setCreatingBackup] = useState<boolean>(false);
  const [schemaInfo, setSchemaInfo] = useState<BrainSchemaResponse | null>(null);
  const packInputRef = useRef<HTMLInputElement | null>(null);

  // Configurador Dual-Mode & Arquivos do Servidor
  const [deployOpts, setDeployOpts] = useState<BrainDeploymentOptions>({
    ...DEFAULT_DEPLOYMENT_OPTIONS,
    assistantName: assistantName || 'JARVIS',
  });
  const [serverFiles, setServerFiles] = useState<GeneratedServerArtifact[]>(() =>
    buildDualModeServerArtifacts(DEFAULT_DEPLOYMENT_OPTIONS)
  );
  const [selectedFilePath, setSelectedFilePath] = useState<string>('docker-compose.yml');
  const [zipSizeBytes, setZipSizeBytes] = useState<number>(0);
  const [downloadingZip, setDownloadingZip] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Filtro da Aba Mapa da API
  const [apiSearch, setApiSearch] = useState<string>('');

  const { report: updatesReport, badgeState: updateBadgeState } = useMemo<{
    report: VersionCheckReport | null;
    badgeState: UpdateBadgeState;
  }>(
    () =>
      reconcileLocalPacksWithServerMetadata({
        localPacks,
        serverReport: serverUpdatesReport,
        serverBrainVersion: brainInfo?.version || null,
      }),
    [localPacks, serverUpdatesReport, brainInfo?.version]
  );

  const syncFreshness = useMemo<SyncFreshnessState>(
    () => evaluateSyncFreshness(lastSuccessfulSyncAt, syncClockMs),
    [lastSuccessfulSyncAt, syncClockMs]
  );

  // Atualiza apenas o relógio local a cada 30s para indicar frescor sem disparar novo fetch
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSyncClockMs(Date.now());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadUpdatesStatus = async (silent = false) => {
    const seq = ++versionCheckSeqRef.current;
    if (!silent) {
      setCheckingUpdates(true);
    }
    try {
      const [localPayload, serverReport] = await Promise.all([
        fetchModulePacks().catch(() => null),
        fetchPackageUpdatesStatus(),
      ]);
      if (seq !== versionCheckSeqRef.current) return;
      if (localPayload?.packs) {
        setLocalPacks(localPayload.packs);
      }
      setServerUpdatesReport(serverReport);
      const syncedAt = serverReport.summary?.checked_at || new Date().toISOString();
      setLastSuccessfulSyncAt(syncedAt);
      setSyncClockMs(Date.now());
    } catch (err: any) {
      if (seq === versionCheckSeqRef.current && !silent) {
        notify(err?.message || 'Não foi possível verificar versões de pacotes e agentes.', 'error');
      }
    } finally {
      if (seq === versionCheckSeqRef.current) {
        setCheckingUpdates(false);
      }
    }
  };

  const loadAllBrainState = async () => {
    const seq = ++versionCheckSeqRef.current;
    setLoadingBrains(true);
    try {
      const [info, profs, schema, localPayload, serverReport] = await Promise.all([
        hubStore.fetch('brain_info', () => fetchBrainInfoApi(), { ttlMs: 12_000 }),
        hubStore.fetch('brain_profiles', () => fetchBrainProfilesApi(), { ttlMs: 12_000 }),
        fetchBrainSchemaApi().catch(() => null),
        fetchModulePacks().catch(() => null),
        fetchPackageUpdatesStatus().catch(() => null),
      ]);
      if (seq !== versionCheckSeqRef.current) return;
      setBrainInfo(info);
      setProfiles(profs.profiles);
      setActiveProfileId(profs.activeProfileId);
      if (schema) setSchemaInfo(schema);
      if (localPayload?.packs) setLocalPacks(localPayload.packs);
      if (serverReport) {
        setServerUpdatesReport(serverReport);
        setLastSuccessfulSyncAt(serverReport.summary?.checked_at || new Date().toISOString());
        setSyncClockMs(Date.now());
      }
    } catch (err: any) {
      notify(err?.message || 'Não foi possível carregar os Cérebros conectados.', 'error');
    } finally {
      if (seq === versionCheckSeqRef.current) {
        setLoadingBrains(false);
        setCheckingUpdates(false);
      }
    }
  };

  useEffect(() => {
    void loadAllBrainState();
  }, []);

  useEffect(() => {
    const onUpdatesChanged = (event: Event) => {
      const custom = event as CustomEvent<VersionCheckReport>;
      if (custom.detail?.summary) {
        setServerUpdatesReport(custom.detail);
        setLastSuccessfulSyncAt(custom.detail.summary.checked_at || new Date().toISOString());
        setSyncClockMs(Date.now());
      } else {
        void loadUpdatesStatus(true);
      }
    };
    const onPacksUpdated = (event: Event) => {
      const custom = event as CustomEvent<ModulePacksPayload>;
      if (Array.isArray(custom.detail?.packs)) {
        setLocalPacks(custom.detail.packs);
      }
      void loadUpdatesStatus(true);
    };
    window.addEventListener(PACK_UPDATES_CHANGED_EVENT, onUpdatesChanged);
    window.addEventListener(PACKS_UPDATED_EVENT, onPacksUpdated);
    return () => {
      window.removeEventListener(PACK_UPDATES_CHANGED_EVENT, onUpdatesChanged);
      window.removeEventListener(PACKS_UPDATED_EVENT, onPacksUpdated);
    };
  }, []);

  useEffect(() => {
    const generated = buildDualModeServerArtifacts(deployOpts);
    setServerFiles(generated);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const preview = await previewDualModeBundleApi(deployOpts);
        if (!cancelled) {
          setServerFiles(preview.files);
          setZipSizeBytes(preview.zip_size_bytes);
        }
      } catch {
        // Fallback local já está populado
      }
    }, 240);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [deployOpts]);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) || profiles[0] || null,
    [profiles, activeProfileId]
  );

  const activeFile = useMemo(
    () => serverFiles.find((f) => f.path === selectedFilePath) || serverFiles[0] || null,
    [serverFiles, selectedFilePath]
  );

  const filteredApiRoutes = useMemo(() => {
    const q = apiSearch.trim().toLowerCase();
    if (!q) return UNIFIED_API_ROUTE_MAP;
    return UNIFIED_API_ROUTE_MAP.filter(
      (r) =>
        r.path.toLowerCase().includes(q) ||
        r.summary.toLowerCase().includes(q) ||
        r.group.toLowerCase().includes(q) ||
        r.method.toLowerCase().includes(q)
    );
  }, [apiSearch]);

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      notify('Copiado para a área de transferência.', 'success');
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1800);
    } catch {
      notify('Não foi possível copiar automaticamente.', 'error');
    }
  };

  const handleActivateProfile = async (profile: BrainConnectionProfile) => {
    setBusyProfileId(profile.id);
    try {
      const res = await activateBrainProfileApi(profile.id);
      setProfiles(res.profiles);
      setActiveProfileId(res.activeProfileId);
      emitAppEvent('jarvis:brain-switched', {
        id: res.active.id,
        name: res.active.name,
        mode: res.active.mode,
      });
      hubStore.invalidate('brain_info');
      hubStore.invalidate('brain_profiles');
      const info = await hubStore.fetch('brain_info', () => fetchBrainInfoApi(), { force: true });
      setBrainInfo(info);
      void loadUpdatesStatus(true);
      notify(`Conectado ao Cérebro "${res.active.name}" com sucesso!`, 'success');
    } catch (err: any) {
      notify(err?.message || 'Falha ao alternar o Cérebro.', 'error');
    } finally {
      setBusyProfileId(null);
    }
  };

  const handlePingProfile = async (profile: BrainConnectionProfile) => {
    setBusyProfileId(profile.id);
    try {
      const res = await pingBrainProfileApi(profile.id);
      setProfiles(res.profiles);
      notify(res.detail, res.profile.status === 'online' ? 'success' : 'info');
    } catch (err: any) {
      notify(err?.message || 'Não foi possível testar a conexão.', 'error');
    } finally {
      setBusyProfileId(null);
    }
  };

  const handleRemoveProfile = async (profile: BrainConnectionProfile) => {
    setBusyProfileId(profile.id);
    try {
      const res = await removeBrainProfileApi(profile.id);
      setProfiles(res.profiles);
      setActiveProfileId(res.activeProfileId);
      notify(`Cérebro "${profile.name}" removido da lista.`, 'info');
    } catch (err: any) {
      notify(err?.message || 'Não foi possível remover este Cérebro.', 'error');
    } finally {
      setBusyProfileId(null);
    }
  };

  const handleAddProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newUrl.trim()) {
      notify('Informe o nome amigável e o endereço do servidor do Cérebro.', 'error');
      return;
    }
    setAddingBrain(true);
    try {
      const res = await addBrainProfileApi({
        name: newName.trim(),
        baseUrl: newUrl.trim(),
        mode: newMode,
        description: newDescription.trim() || undefined,
      });
      setProfiles(res.profiles);
      setActiveProfileId(res.activeProfileId);
      setNewName('');
      setNewUrl('');
      setNewDescription('');
      notify(`Cérebro "${res.created.name}" adicionado ao seu gerenciador!`, 'success');
    } catch (err: any) {
      notify(err?.message || 'Não foi possível cadastrar este Cérebro.', 'error');
    } finally {
      setAddingBrain(false);
    }
  };

  const handleExportPack = async () => {
    setExportingPack(true);
    try {
      const pack = await exportBrainPackApi();
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jarvis-brain-pack-${new Date().toISOString().slice(0, 10)}.jarvis-pack.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify(
        `Pacote exportado (${pack.agents.length} agentes, ${pack.skills.length} habilidades, ${pack.workflows.length} fluxos e ${pack.knowledge.length} documentos).`,
        'success'
      );
    } catch (err: any) {
      notify(err?.message || 'Falha ao exportar pacote do Cérebro.', 'error');
    } finally {
      setExportingPack(false);
    }
  };

  const handleImportPackFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingPack(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await importBrainPackApi(parsed);
      notify(res.message, 'success');
      await loadAllBrainState();
    } catch (err: any) {
      notify(err?.message || 'Arquivo .jarvis-pack inválido ou corrompido.', 'error');
    } finally {
      setImportingPack(false);
      if (packInputRef.current) {
        packInputRef.current.value = '';
      }
    }
  };

  const handleCreateSqliteBackup = async () => {
    setCreatingBackup(true);
    try {
      const res = await createSqliteBackupApi();
      notify(res.message, 'success');
      await loadAllBrainState();
    } catch (err: any) {
      notify(err?.message || 'Não foi possível criar o backup SQLite.', 'error');
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleDownloadBundleZip = async () => {
    setDownloadingZip(true);
    try {
      await downloadDualModeBundleZipApi(deployOpts);
      notify('Pacote completo do Servidor Dual-Mode (.zip) baixado com sucesso!', 'success');
    } catch (err: any) {
      notify(err?.message || 'Falha ao baixar pacote do servidor.', 'error');
    } finally {
      setDownloadingZip(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1320px', margin: '0 auto' }}>
      {/* Hero Header Horizontal */}
      <section
        className="jarvis-settings-card"
        style={{
          padding: '24px 26px',
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '18px',
          background:
            'linear-gradient(135deg, rgba(249, 115, 22, 0.11) 0%, var(--bg-secondary) 55%)',
          borderColor: 'rgba(249, 115, 22, 0.3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', flex: '1 1 460px', minWidth: 0 }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, #f97316 0%, #c2410c 100%)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: '0 10px 26px rgba(249, 115, 22, 0.35)',
            }}
          >
            <Server size={24} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: '1.32rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Cérebro Poliglota &amp; Servidor (Node 22 + Python 3.11 + Go + SQLite Híbrido)
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              Rode <strong>local-first em SQLite WAL + FTS5 + vetores</strong> com memória editável em Markdown (<code>SOUL.md</code> / <code>MEMORY.md</code>),{' '}
              <strong>Worker Python 3.11 ao vivo</strong>, filas seriais por sessão, <strong>Gateway MCP nativo</strong> e{' '}
              <strong>Serviço Go (Gateway + Crawler)</strong> no pacote Docker/VPS.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', marginTop: '12px' }}>
              <button
                type="button"
                onClick={() => setActiveTab('updates')}
                data-testid="brain-updates-badge"
                aria-label="Status de atualizações de pacotes e agentes"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: updateBadgeState.hasUpdates ? '1px solid #d97706' : '1px solid #16a34a',
                  backgroundColor: updateBadgeState.hasUpdates ? '#fef3c7' : '#dcfce7',
                  color: updateBadgeState.hasUpdates ? '#92400e' : '#166534',
                }}
              >
                <ArrowUpCircle
                  size={15}
                  color={updateBadgeState.hasUpdates ? '#b45309' : '#15803d'}
                />
                <span>
                  {checkingUpdates && !updatesReport
                    ? 'Verificando versões...'
                    : updateBadgeState.hasUpdates
                      ? `${updateBadgeState.totalUpdatesAvailable} atualização(ões) disponível(is) (${updateBadgeState.outdatedPackagesCount} pacote · ${updateBadgeState.outdatedAgentsCount} agente)`
                      : 'Pacotes e agentes atualizados'}
                </span>
              </button>

              {canManagePacks && onNavigate && updateBadgeState.hasUpdates && (
                <button
                  type="button"
                  onClick={() => onNavigate('pack_studio')}
                  data-testid="brain-hero-pack-studio-btn"
                  className="btn btn-secondary btn-sm"
                >
                  <Package size={13} />
                  <span>Aplicar no Estúdio de Pacotes</span>
                  <ArrowUpRight size={13} />
                </button>
              )}

              <div
                data-testid="brain-last-sync-indicator"
                data-sync-level={syncFreshness.level}
                title={
                  syncFreshness.lastSyncAt
                    ? `Última sincronização bem-sucedida em ${new Date(syncFreshness.lastSyncAt).toLocaleString('pt-BR')} (${syncFreshness.statusLabel})`
                    : 'Nenhuma sincronização concluída nesta sessão'
                }
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '6px',
                  padding: '5px 11px',
                  borderRadius: '8px',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  border:
                    syncFreshness.level === 'stale'
                      ? '1px solid #d97706'
                      : syncFreshness.level === 'fresh' || syncFreshness.level === 'aging'
                        ? '1px solid var(--border-color)'
                        : '1px solid var(--border-subtle)',
                  backgroundColor:
                    syncFreshness.level === 'stale'
                      ? '#fef3c7'
                      : 'var(--bg-primary)',
                  color:
                    syncFreshness.level === 'stale'
                      ? '#92400e'
                      : 'var(--text-secondary)',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '999px',
                    flexShrink: 0,
                    backgroundColor:
                      syncFreshness.level === 'fresh'
                        ? '#16a34a'
                        : syncFreshness.level === 'aging'
                          ? '#2563eb'
                          : syncFreshness.level === 'stale'
                            ? '#d97706'
                            : '#94a3b8',
                  }}
                />
                <Clock
                  size={13}
                  color={
                    syncFreshness.level === 'stale'
                      ? '#b45309'
                      : syncFreshness.level === 'fresh'
                        ? '#15803d'
                        : 'var(--text-muted)'
                  }
                />
                <span>
                  Última sincronização:{' '}
                  <strong
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color:
                        syncFreshness.level === 'stale' ? '#78350f' : 'var(--text-primary)',
                    }}
                  >
                    {syncFreshness.formattedTime}
                  </strong>
                </span>
                <span style={{ opacity: 0.7 }}>·</span>
                <span>{syncFreshness.relativeLabel}</span>
                {syncFreshness.level === 'stale' && (
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      padding: '1px 6px',
                      borderRadius: '5px',
                      backgroundColor: '#fde68a',
                      color: '#78350f',
                    }}
                  >
                    Desatualizado
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
          <button
            type="button"
            disabled={downloadingZip}
            onClick={() => void handleDownloadBundleZip()}
            className="btn btn-primary"
          >
            {downloadingZip ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
            <span>{downloadingZip ? 'Empacotando...' : 'Baixar Stack Poliglota (.zip)'}</span>
          </button>
          <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {serverFiles.length} arquivos reais · {zipSizeBytes > 0 ? `${(zipSizeBytes / 1024).toFixed(1)} KB` : 'Node + Python + Go'} · API /api/v1
          </span>
        </div>
      </section>

      {/* Tabs */}
      <div role="tablist" aria-label="Seções de Cérebros e Servidor" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {[
          { id: 'multi_brain' as const, label: `Meus Cérebros (${profiles.length})`, icon: ArrowRightLeft, badgeCount: 0 },
          { id: 'infra_runtime' as const, label: 'Infra, Sandbox & Canais 24/7', icon: ShieldCheck, badgeCount: 0 },
          {
            id: 'updates' as const,
            label: 'Versões & Updates',
            icon: ArrowUpCircle,
            badgeCount: updateBadgeState.totalUpdatesAvailable,
          },
          { id: 'memory_hybrid' as const, label: 'Memória & Markdown', icon: BookOpen, badgeCount: 0 },
          { id: 'python_lanes' as const, label: 'Worker Python & Filas', icon: Cpu, badgeCount: 0 },
          { id: 'mcp_gateway' as const, label: 'Gateway MCP', icon: Plug, badgeCount: 0 },
          { id: 'dual_mode' as const, label: 'Local vs. Docker Poliglota', icon: Layers, badgeCount: 0 },
          { id: 'files' as const, label: `Arquivos do Servidor (${serverFiles.length})`, icon: Code2, badgeCount: 0 },
          { id: 'api_map' as const, label: 'Mapa da API (/api/v1) & Banco', icon: Database, badgeCount: 0 },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={isActive ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
              {tab.badgeCount > 0 && (
                <span
                  data-testid="brain-updates-tab-badge"
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    padding: '1px 6px',
                    borderRadius: '999px',
                    backgroundColor: isActive ? 'rgba(255,255,255,0.22)' : '#d97706',
                    color: '#ffffff',
                    marginLeft: '2px',
                  }}
                >
                  {tab.badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ABA INFRAESTRUTURA PLUGÁVEL, SANDBOX, MCP RUNTIME & CANAIS 24/7 */}
      {activeTab === 'infra_runtime' && <BrainInfraRuntimePanel />}

      {/* ABA DE VERIFICAÇÃO DE VERSÕES E UPDATES */}
      {activeTab === 'updates' && (
        <BrainUpdatesPanel
          report={updatesReport}
          loading={checkingUpdates}
          canManagePacks={canManagePacks}
          syncFreshness={syncFreshness}
          onRefresh={() => void loadUpdatesStatus(false)}
          onOpenPackStudio={onNavigate ? () => onNavigate('pack_studio') : undefined}
        />
      )}

      {/* NOVAS ABAS POLIGLOTAS: MEMÓRIA MARKDOWN/HÍBRIDA, WORKER PYTHON/FILAS & GATEWAY MCP */}
      {activeTab === 'memory_hybrid' && (
        <BrainMemoryPanel onMutated={() => void loadAllBrainState()} />
      )}

      {activeTab === 'python_lanes' && (
        <BrainPythonLanesPanel onWorkspaceChanged={() => void loadAllBrainState()} />
      )}

      {activeTab === 'mcp_gateway' && (
        <BrainMcpPanel onMutated={() => void loadAllBrainState()} />
      )}

      {/* ABA 1: GERENCIADOR MULTI-CÉREBROS + MIGRAÇÃO .jarvis-pack */}
      {activeTab === 'multi_brain' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Resumo do Cérebro Ativo */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '12px',
            }}
          >
            <div className="jarvis-settings-card" style={{ padding: '16px', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.73rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                <Activity size={14} color="#6ee7b7" />
                <span>Cérebro Conectado Agora</span>
              </div>
              <div style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {activeProfile?.name || brainInfo?.name || 'Esta Máquina · Local'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                {activeProfile?.baseUrl || 'http://localhost:3000'}
              </div>
            </div>

            <div className="jarvis-settings-card" style={{ padding: '16px', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.73rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                <Database size={14} color="var(--accent-light)" />
                <span>Motor de Banco &amp; Vetores</span>
              </div>
              <div style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {brainInfo?.database_engine || activeProfile?.databaseEngine || 'SQLite WAL (node:sqlite)'}
              </div>
              <div
                style={{
                  fontSize: '0.73rem',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={brainInfo?.storage_path || '~/JARVIS-Brain/brain.db'}
              >
                {brainInfo?.journal_mode ? `${brainInfo.journal_mode.toUpperCase()} ativo` : 'WAL ativo'}
                {brainInfo?.db_size_bytes ? ` · ${(brainInfo.db_size_bytes / 1024).toFixed(1)} KB em disco` : ''}
                {typeof brainInfo?.backups_count === 'number' ? ` · ${brainInfo.backups_count} backup(s)` : ''}
              </div>
            </div>

            <div className="jarvis-settings-card" style={{ padding: '16px', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.73rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                <Cpu size={14} color="#93c5fd" />
                <span>Memória Sincronizada</span>
              </div>
              <div style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {brainInfo ? `${brainInfo.counts.agents} agentes · ${brainInfo.counts.skills} skills` : 'Carregando...'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {brainInfo
                  ? `${brainInfo.counts.workflows} fluxos · ${brainInfo.counts.knowledge} docs · ${brainInfo.counts.paired_devices} celular(es)`
                  : 'Sincronizado em tempo real'}
              </div>
            </div>

            <div className="jarvis-settings-card" style={{ padding: '16px', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.73rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                <Radio size={14} color="#c084fc" />
                <span>Descoberta Local (mDNS)</span>
              </div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {brainInfo?.mdns_service || '_jarvis-brain._tcp.local'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                App Android encontra seu PC ou Docker no Wi-Fi automaticamente
              </div>
            </div>
          </div>

          {/* Grid Principal: Lista de Cérebros (Esq) + Adicionar & Migrar (Dir) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
              gap: '18px',
              alignItems: 'start',
            }}
          >
            {/* Lista de Cérebros Registrados */}
            <section className="jarvis-settings-card" style={{ padding: '22px', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Cérebros Cadastrados (Troca em 1 Clique)
                  </h2>
                  <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Alterne entre seu banco local sem Docker, um servidor Docker em casa ou uma instância remota HTTPS.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadAllBrainState()}
                  className="btn btn-secondary btn-sm"
                  disabled={loadingBrains}
                >
                  <RefreshCw size={13} className={loadingBrains ? 'spin' : ''} />
                  <span>Atualizar</span>
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {profiles.map((profile) => {
                  const isCurrent = profile.id === activeProfileId;
                  const modeMeta = MODE_BADGE_MAP[profile.mode];
                  const isBusy = busyProfileId === profile.id;

                  return (
                    <div
                      key={profile.id}
                      className="jarvis-settings-subcard"
                      style={{
                        padding: '14px',
                        gap: '10px',
                        borderColor: isCurrent ? 'rgba(249, 115, 22, 0.55)' : 'var(--border-color)',
                        backgroundColor: isCurrent ? 'rgba(249, 115, 22, 0.06)' : 'var(--bg-primary)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                            <strong style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{profile.name}</strong>
                            {isCurrent && (
                              <span
                                style={{
                                  fontSize: '0.68rem',
                                  fontWeight: 700,
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  border: '1px solid rgba(22, 163, 74, 0.38)',
                                  backgroundColor: 'rgba(22, 163, 74, 0.14)',
                                  color: '#15803d',
                                }}
                              >
                                Ativo agora
                              </span>
                            )}
                            <span
                              style={{
                                fontSize: '0.68rem',
                                fontWeight: 600,
                                padding: '2px 8px',
                                borderRadius: '6px',
                                border: `1px solid ${modeMeta.border}`,
                                backgroundColor: modeMeta.bg,
                                color: modeMeta.color,
                              }}
                            >
                              {modeMeta.label}
                            </span>
                          </div>
                          <div
                            style={{
                              marginTop: '4px',
                              fontSize: '0.75rem',
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {profile.baseUrl}
                            {profile.latencyMs !== null ? ` · ${profile.latencyMs} ms` : ''}
                          </div>
                          <p style={{ margin: '6px 0 0', fontSize: '0.77rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                            {profile.description}
                          </p>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px', paddingTop: '4px' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            fontSize: '0.73rem',
                            fontWeight: 600,
                            color: profile.status === 'online' ? '#15803d' : 'var(--text-muted)',
                          }}
                        >
                          <Wifi size={13} />
                          <span>
                            {profile.status === 'online'
                              ? 'Respondendo na rede'
                              : 'Aguardando servidor iniciar'}
                          </span>
                        </span>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {!isCurrent && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleActivateProfile(profile)}
                              className="btn btn-primary btn-sm"
                            >
                              <CheckCircle2 size={13} />
                              <span>Conectar</span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handlePingProfile(profile)}
                            className="btn btn-secondary btn-sm"
                          >
                            {isBusy ? <Loader2 size={13} className="spin" /> : <Activity size={13} />}
                            <span>Testar</span>
                          </button>
                          {!profile.isLocalCurrent && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleRemoveProfile(profile)}
                              className="btn btn-danger-ghost btn-sm"
                              aria-label={`Remover ${profile.name}`}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Coluna Direita: Conectar Novo Cérebro + Portabilidade .jarvis-pack */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <form onSubmit={handleAddProfile} className="jarvis-settings-card" style={{ padding: '22px', gap: '12px' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Conectar Novo Cérebro (PC, Docker ou VPS)
                  </h2>
                  <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Subiu o JARVIS em um Docker na sua máquina, Mini PC ou servidor? Adicione abaixo para alternar quando quiser.
                  </p>
                </div>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                  <span>Nome amigável</span>
                  <input
                    type="text"
                    className="jarvis-input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ex.: Meu Docker no Escritório"
                    aria-label="Nome amigável do novo Cérebro"
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                  <span>Endereço do servidor (LAN/mDNS ou HTTPS)</span>
                  <input
                    type="text"
                    className="jarvis-input"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="Ex.: http://192.168.1.90:3000 ou https://jarvis.meudominio.com"
                    aria-label="Endereço URL do novo Cérebro"
                  />
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                    <span>Tipo de Cérebro</span>
                    <select
                      className="jarvis-input"
                      value={newMode}
                      onChange={(e) => setNewMode(e.target.value as BrainMode)}
                      aria-label="Tipo de Cérebro"
                    >
                      <option value="docker_postgres">Docker (PostgreSQL + Redis)</option>
                      <option value="local_sqlite">Local Sem Docker (SQLite)</option>
                      <option value="cloud">Servidor Remoto (HTTPS)</option>
                    </select>
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                    <span>Nota opcional</span>
                    <input
                      type="text"
                      className="jarvis-input"
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      placeholder="Ex.: Com GPU RTX para Ollama"
                      aria-label="Descrição do novo Cérebro"
                    />
                  </label>
                </div>

                <button type="submit" disabled={addingBrain} className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }}>
                  {addingBrain ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
                  <span>Adicionar Cérebro</span>
                </button>
              </form>

              {/* Portabilidade e Migração .jarvis-pack */}
              <section className="jarvis-settings-card" style={{ padding: '22px', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <ShieldCheck size={18} color="#6ee7b7" />
                  <div>
                    <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Migração &amp; Backup Portátil (.jarvis-pack)
                    </h2>
                    <p style={{ margin: '2px 0 0', fontSize: '0.79rem', color: 'var(--text-secondary)' }}>
                      Evoluiu do modo Local (SQLite) para Docker (PostgreSQL)? Leve todos os seus agentes, habilidades, fluxos e documentos sem perder nada — chaves de API nunca são exportadas.
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', paddingTop: '4px' }}>
                  <button
                    type="button"
                    disabled={creatingBackup}
                    onClick={() => void handleCreateSqliteBackup()}
                    className="btn btn-primary btn-sm"
                  >
                    {creatingBackup ? <Loader2 size={14} className="spin" /> : <HardDrive size={14} />}
                    <span>{creatingBackup ? 'Salvando...' : 'Criar Backup SQLite (.db)'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={exportingPack}
                    onClick={() => void handleExportPack()}
                    className="btn btn-secondary btn-sm"
                  >
                    {exportingPack ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                    <span>Exportar .jarvis-pack.json</span>
                  </button>

                  <button
                    type="button"
                    disabled={importingPack}
                    onClick={() => packInputRef.current?.click()}
                    className="btn btn-secondary btn-sm"
                  >
                    {importingPack ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                    <span>Importar .jarvis-pack.json</span>
                  </button>
                  <input
                    ref={packInputRef}
                    type="file"
                    accept=".json,.jarvis-pack.json"
                    onChange={(e) => void handleImportPackFile(e)}
                    style={{ display: 'none' }}
                  />
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* ABA 2: MODO LOCAL SEM DOCKER VS. DOCKER + ESCOLHA DA LINGUAGEM */}
      {activeTab === 'dual_mode' && (
        <BrainDualModePanel
          deployOpts={deployOpts}
          setDeployOpts={setDeployOpts}
          downloadingZip={downloadingZip}
          onDownloadBundleZip={handleDownloadBundleZip}
        />
      )}

      {/* ABA 3: EXPLORADOR DOS ARQUIVOS DO SERVIDOR DUAL-MODE */}
      {activeTab === 'files' && (
        <BrainFilesPanel
          serverFiles={serverFiles}
          activeFile={activeFile}
          setSelectedFilePath={setSelectedFilePath}
          copiedKey={copiedKey}
          onCopy={handleCopy}
        />
      )}

      {/* ABA 4: MAPA COMPLETO DA API /api/v1 & MODELAGEM UNIFICADA */}
      {activeTab === 'api_map' && (
        <BrainApiMapPanel
          apiSearch={apiSearch}
          setApiSearch={setApiSearch}
          filteredApiRoutes={filteredApiRoutes}
          methodColors={METHOD_COLORS}
          schemaInfo={schemaInfo}
        />
      )}
    </div>
  );
};
