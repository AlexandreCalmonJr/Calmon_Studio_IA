import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Compass,
  Cpu,
  Download,
  LayoutGrid,
  Loader2,
  Package,
  Plug,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import {
  type ModulePackCategory,
  type ModulePackWithState,
} from '../../services/modulePackEngine';
import {
  PACKS_UPDATED_EVENT,
  fetchModulePacks,
  installModulePack,
  uninstallModulePack,
  type ModulePacksPayload,
} from '../../services/api/packs';
import { fetchAgents, fetchSkills } from '../../api';
import type { AgentInfo, SkillInfo } from '../../types';
import { AGENT_TEMPLATE_LIBRARY } from '../../services/agentTemplates';
import {
  computeUnifiedStoreSummary,
  countPacksByFilter,
  isSkillActive,
  type PackStoreFilter,
  type UnifiedStoreSection,
} from '../../services/unifiedStoreEngine';
import {
  APP_CATEGORY_LABELS,
  APP_CATEGORY_SHORT_LABELS,
  STORE_APPS,
  STORE_APPS_UPDATED_EVENT,
  countStoreAppsByCategory,
  createCustomStoreApp,
  filterStoreApps,
  loadConnectedAppIds,
  loadCustomStoreApps,
  saveConnectedAppIds,
  saveCustomStoreApps,
  type StoreAppCategory,
  type StoreAppItem,
  type StoreAppsUpdatedDetail,
} from '../../services/storeAppsCatalog';
import { PageHeader } from '../../shared/layout/PageHeader';
import { Modal } from '../../shared/common/Modal';
import { notify } from '../../shared/common/Toast';
import { AgentCoreInspectorModal } from '../agents/AgentCoreInspectorModal';
import { AgentTemplateStoreGrid } from '../agents/AgentTemplateStoreGrid';
import { SkillsCatalogPanel } from '../skills/SkillsCatalogPanel';
import { IntegrationsHubPanel } from '../skills/IntegrationsHubPanel';
import { StoreAppIcon } from './StoreAppIcon';

interface PackStoreViewProps {
  onNavigate: (tab: string) => void;
  canManagePacks?: boolean;
  initialSection?: UnifiedStoreSection;
  onOpenAgentChat?: (agentRole: string) => void;
}

const FILTER_OPTIONS: Array<{ id: PackStoreFilter; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'installed', label: 'Instalados' },
  { id: 'custom', label: 'Personalizados' },
  { id: 'engineering', label: 'Engenharia' },
  { id: 'development', label: 'Full-Stack' },
  { id: 'security', label: 'Segurança' },
  { id: 'productivity', label: 'Produtividade' },
  { id: 'infrastructure', label: 'Infra & Voz' },
];

const PACK_CATEGORY_SHORT: Record<ModulePackCategory, string> = {
  engineering: 'ENGENHARIA',
  development: 'FULL-STACK',
  security: 'SEGURANÇA',
  productivity: 'PRODUTIVIDADE',
  infrastructure: 'INFRA & VOZ',
};

function getPackVisual(category: ModulePackCategory) {
  switch (category) {
    case 'engineering':
      return {
        bg: 'var(--accent-soft)',
        border: 'var(--border-accent)',
        color: 'var(--accent-light)',
        Icon: Compass,
      };
    case 'development':
      return {
        bg: 'var(--info-soft)',
        border: 'rgba(56, 189, 248, 0.32)',
        color: 'var(--info-text)',
        Icon: Code2,
      };
    case 'security':
      return {
        bg: 'var(--success-soft)',
        border: 'rgba(34, 197, 94, 0.32)',
        color: 'var(--success-text)',
        Icon: ShieldCheck,
      };
    case 'productivity':
      return {
        bg: 'var(--purple-soft)',
        border: 'rgba(139, 92, 246, 0.32)',
        color: 'var(--purple-text)',
        Icon: Sparkles,
      };
    default:
      return {
        bg: 'var(--warning-soft)',
        border: 'rgba(245, 158, 11, 0.32)',
        color: 'var(--warning-text)',
        Icon: Cpu,
      };
  }
}

export const PackStoreView: React.FC<PackStoreViewProps> = ({
  onNavigate,
  canManagePacks = false,
  initialSection = 'packs',
  onOpenAgentChat,
}) => {
  const [activeSection, setActiveSection] = useState<UnifiedStoreSection>(initialSection);
  const [payload, setPayload] = useState<ModulePacksPayload | null>(null);
  const [skillsSnapshot, setSkillsSnapshot] = useState<SkillInfo[]>([]);
  const [skillsCountOverride, setSkillsCountOverride] = useState<{ total: number; active: number } | null>(null);
  const [installedAgents, setInstalledAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPackId, setBusyPackId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<PackStoreFilter>('all');
  const [expandedPacks, setExpandedPacks] = useState<Record<string, boolean>>({});
  const [inspectingAgent, setInspectingAgent] = useState<{
    role: string;
    name: string;
    handle: string;
  } | null>(null);

  // Apps & Conectores state
  const [appSearch, setAppSearch] = useState('');
  const [appCategory, setAppCategory] = useState<'all' | StoreAppCategory | 'live'>('all');
  const [connectedAppIds, setConnectedAppIds] = useState<string[]>(loadConnectedAppIds);
  const [customApps, setCustomApps] = useState<StoreAppItem[]>(loadCustomStoreApps);
  const [selectedAppForModal, setSelectedAppForModal] = useState<StoreAppItem | null>(null);
  const [showCustomAppModal, setShowCustomAppModal] = useState(false);
  const [appTokenInput, setAppTokenInput] = useState('');
  const [connectingApp, setConnectingApp] = useState(false);
  const [customAppName, setCustomAppName] = useState('');
  const [customAppType, setCustomAppType] = useState<'mcp' | 'webhook' | 'custom_tool'>('mcp');
  const [customAppEndpoint, setCustomAppEndpoint] = useState('');

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  const loadStoreData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [packsData, skillsData, agentsData] = await Promise.all([
        fetchModulePacks(),
        fetchSkills().catch(() => [] as SkillInfo[]),
        fetchAgents().catch(() => [] as AgentInfo[]),
      ]);
      setPayload(packsData);
      setSkillsSnapshot(Array.isArray(skillsData) ? skillsData : []);
      setInstalledAgents(Array.isArray(agentsData) ? agentsData : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar o catálogo da loja.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshCatalogSideEffects = useCallback(() => {
    void fetchAgents()
      .then((agentsData) => {
        if (Array.isArray(agentsData)) {
          setInstalledAgents(agentsData);
        }
      })
      .catch(() => {});
    void fetchSkills()
      .then((skillsData) => {
        if (Array.isArray(skillsData)) {
          setSkillsSnapshot(skillsData);
          setSkillsCountOverride({
            total: skillsData.length,
            active: skillsData.filter(isSkillActive).length,
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void loadStoreData();
    const onAgentsUpdated = () => {
      void fetchAgents()
        .then((agentsData) => {
          if (Array.isArray(agentsData)) {
            setInstalledAgents(agentsData);
          }
        })
        .catch(() => {});
    };
    const onPacksUpdated = (e: Event) => {
      const detail = (e as CustomEvent<ModulePacksPayload>).detail;
      if (detail?.packs) {
        setPayload(detail);
      } else {
        void fetchModulePacks().then(setPayload).catch(() => {});
      }
      refreshCatalogSideEffects();
    };
    const onStoreAppsUpdated = (e: Event) => {
      const detail = (e as CustomEvent<StoreAppsUpdatedDetail>).detail;
      setConnectedAppIds(detail?.connectedAppIds ?? loadConnectedAppIds());
      setCustomApps(detail?.customApps ?? loadCustomStoreApps());
    };
    window.addEventListener('jarvis:agents-updated', onAgentsUpdated);
    window.addEventListener(PACKS_UPDATED_EVENT, onPacksUpdated);
    window.addEventListener(STORE_APPS_UPDATED_EVENT, onStoreAppsUpdated);
    return () => {
      window.removeEventListener('jarvis:agents-updated', onAgentsUpdated);
      window.removeEventListener(PACKS_UPDATED_EVENT, onPacksUpdated);
      window.removeEventListener(STORE_APPS_UPDATED_EVENT, onStoreAppsUpdated);
    };
  }, [loadStoreData, refreshCatalogSideEffects]);

  const handleInstall = async (pack: ModulePackWithState) => {
    setBusyPackId(pack.id);
    setError(null);
    setFeedback(null);
    try {
      const updated = await installModulePack(pack.id);
      setPayload(updated);
      setFeedback(
        `Pacote "${pack.name}" instalado: ${pack.tabs.length} módulos liberados na barra lateral e ${pack.agents.length} agente(s) provisionado(s) com núcleo próprio.`
      );
      window.dispatchEvent(new CustomEvent('jarvis:agents-updated'));
      refreshCatalogSideEffects();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível instalar o pacote.');
    } finally {
      setBusyPackId(null);
    }
  };

  const handleUninstall = async (pack: ModulePackWithState) => {
    setBusyPackId(pack.id);
    setError(null);
    setFeedback(null);
    try {
      const updated = await uninstallModulePack(pack.id);
      setPayload(updated);
      setFeedback(
        `Pacote "${pack.name}" removido da barra lateral. Você pode reinstalá-lo a qualquer momento em 1 clique.`
      );
      window.dispatchEvent(new CustomEvent('jarvis:agents-updated'));
      refreshCatalogSideEffects();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível remover o pacote.');
    } finally {
      setBusyPackId(null);
    }
  };

  const allStoreApps = useMemo(() => [...STORE_APPS, ...customApps], [customApps]);

  const connectedStoreApps = useMemo(
    () => allStoreApps.filter((a) => connectedAppIds.includes(a.id)),
    [allStoreApps, connectedAppIds]
  );

  const filteredApps = useMemo(
    () =>
      appCategory === 'live'
        ? []
        : filterStoreApps(allStoreApps, { query: appSearch, category: appCategory }),
    [allStoreApps, appSearch, appCategory]
  );

  const appCategoryCounts = useMemo(() => countStoreAppsByCategory(allStoreApps), [allStoreApps]);

  const updateConnectedApps = (nextIds: string[]) => {
    const saved = saveConnectedAppIds(nextIds);
    setConnectedAppIds(saved);
  };

  const handleOpenAppModal = (app: StoreAppItem) => {
    setAppTokenInput('');
    setSelectedAppForModal(app);
  };

  const confirmAppConnection = () => {
    if (!selectedAppForModal || connectingApp) return;
    setConnectingApp(true);
    try {
      const wasConnected = connectedAppIds.includes(selectedAppForModal.id);
      updateConnectedApps([...connectedAppIds, selectedAppForModal.id]);
      notify(
        wasConnected
          ? `Configuração de "${selectedAppForModal.name}" atualizada.`
          : `App "${selectedAppForModal.name}" conectado com sucesso!`,
        'success'
      );
      setAppTokenInput('');
      setSelectedAppForModal(null);
    } finally {
      setConnectingApp(false);
    }
  };

  const disconnectApp = (appId: string) => {
    updateConnectedApps(connectedAppIds.filter((id) => id !== appId));
    notify('App desconectado com sucesso!', 'info');
    setAppTokenInput('');
    setSelectedAppForModal(null);
  };

  const removeCustomApp = (app: StoreAppItem) => {
    const nextCustom = saveCustomStoreApps(customApps.filter((c) => c.id !== app.id));
    setCustomApps(nextCustom);
    updateConnectedApps(connectedAppIds.filter((id) => id !== app.id));
    if (selectedAppForModal?.id === app.id) {
      setSelectedAppForModal(null);
    }
    notify(`Conector "${app.name}" removido.`, 'info');
  };

  const closeCustomAppModal = () => {
    setShowCustomAppModal(false);
    setCustomAppName('');
    setCustomAppType('mcp');
    setCustomAppEndpoint('');
  };

  const handleSaveCustomConnector = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customAppName.trim() || !customAppEndpoint.trim()) {
      notify('Informe o nome e o comando/endpoint do conector.', 'error');
      return;
    }
    const newApp = createCustomStoreApp({
      name: customAppName,
      connectionType: customAppType,
      endpoint: customAppEndpoint,
    });
    const nextCustom = saveCustomStoreApps([...customApps, newApp]);
    setCustomApps(nextCustom);
    updateConnectedApps([...connectedAppIds, newApp.id]);
    setAppSearch('');
    if (appCategory !== 'all' && appCategory !== newApp.category) {
      setAppCategory('all');
    }
    notify(`Conector "${newApp.name}" cadastrado e conectado com sucesso!`, 'success');
    closeCustomAppModal();
  };

  const packsList = payload?.packs || [];
  const packFilterCounts = useMemo(() => countPacksByFilter(packsList), [packsList]);

  const filteredPacks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return packsList.filter((pack) => {
      if (categoryFilter === 'installed' && !pack.installed) return false;
      if (categoryFilter === 'custom' && !pack.is_custom) return false;
      if (
        categoryFilter !== 'all' &&
        categoryFilter !== 'installed' &&
        categoryFilter !== 'custom' &&
        pack.category !== categoryFilter
      ) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        pack.name,
        pack.tagline,
        pack.description,
        pack.category_label,
        ...pack.skills,
        ...pack.agents.map((a) => `${a.proper_name} ${a.name} ${a.handle}`),
        ...pack.study_tracks.map((t) => t.title),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [packsList, search, categoryFilter]);

  const handleSkillsCountChange = useCallback((total: number, active: number) => {
    setSkillsCountOverride({ total, active });
  }, []);

  const summary = payload?.summary;
  const unifiedSummary = useMemo(() => {
    const base = computeUnifiedStoreSummary({
      packs: packsList,
      skills: skillsSnapshot,
      templatesCount: AGENT_TEMPLATE_LIBRARY.length,
      connectedAppsCount: connectedStoreApps.length,
      totalAppsCount: allStoreApps.length,
    });
    if (skillsCountOverride) {
      return {
        ...base,
        totalSkills: skillsCountOverride.total,
        activeSkills: skillsCountOverride.active,
        totalCatalogItems:
          base.totalPacks + skillsCountOverride.total + base.totalTemplates + allStoreApps.length,
      };
    }
    return base;
  }, [packsList, skillsSnapshot, skillsCountOverride, connectedStoreApps.length, allStoreApps.length]);

  return (
    <div className="jarvis-settings-layout jarvis-store-layout">
      {/* Navegação Lateral da Loja Unificada (Padrão Split-Pane) */}
      <aside className="jarvis-settings-nav" aria-label="Navegação da Loja Unificada">
        <div className="jarvis-settings-nav__header">
          <h2 className="jarvis-settings-nav__title">Loja Unificada</h2>
        </div>

        <nav className="jarvis-settings-nav__list" aria-label="Departamentos da Loja Unificada">
          <div className="jarvis-settings-nav__group">
            <div className="jarvis-settings-nav__group-title">Explorar</div>

            <button
              type="button"
              aria-current={activeSection === 'packs' ? 'page' : undefined}
              onClick={() => setActiveSection('packs')}
              className={`jarvis-subnav-btn ${activeSection === 'packs' ? 'is-active' : ''}`}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <Package size={15} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Pacotes & Núcleos
                </span>
              </span>
              <span className="jarvis-tabular jarvis-store-nav-count">
                {unifiedSummary.totalPacks}
              </span>
            </button>

            <button
              type="button"
              aria-current={activeSection === 'apps' ? 'page' : undefined}
              onClick={() => setActiveSection('apps')}
              className={`jarvis-subnav-btn ${activeSection === 'apps' ? 'is-active' : ''}`}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <LayoutGrid size={15} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Apps & Conectores
                </span>
              </span>
              <span className="jarvis-tabular jarvis-store-nav-count">
                {allStoreApps.length}
              </span>
            </button>

            <button
              type="button"
              aria-current={activeSection === 'templates' ? 'page' : undefined}
              onClick={() => setActiveSection('templates')}
              className={`jarvis-subnav-btn ${activeSection === 'templates' ? 'is-active' : ''}`}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <Bot size={15} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Agentes
                </span>
              </span>
              <span className="jarvis-tabular jarvis-store-nav-count">
                {unifiedSummary.totalTemplates}
              </span>
            </button>

            <button
              type="button"
              aria-current={activeSection === 'skills' ? 'page' : undefined}
              onClick={() => setActiveSection('skills')}
              className={`jarvis-subnav-btn ${activeSection === 'skills' ? 'is-active' : ''}`}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <BookOpen size={15} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Habilidades
                </span>
              </span>
              <span className="jarvis-tabular jarvis-store-nav-count">
                {unifiedSummary.totalSkills}
              </span>
            </button>
          </div>

          {connectedStoreApps.length > 0 && (
            <div className="jarvis-settings-nav__group jarvis-store-apps-group">
              <div className="jarvis-settings-nav__group-title">
                Seus apps ({connectedStoreApps.length})
              </div>
              {connectedStoreApps.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => {
                    setActiveSection('apps');
                    handleOpenAppModal(app);
                  }}
                  className="jarvis-subnav-btn"
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
                    <StoreAppIcon iconType={app.iconType} size={18} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {app.name}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </nav>

        {/* Rodapé da Sub-Navegação: Atalhos Rápidos */}
        <div className="jarvis-settings-nav__footer jarvis-store-nav-footer">
          <button
            type="button"
            className="jarvis-subnav-btn"
            onClick={() => onNavigate('agents')}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '9px' }}>
              <Cpu size={14} />
              <span>Central de Agentes</span>
            </span>
          </button>
          <button
            type="button"
            className="jarvis-subnav-btn"
            onClick={() => onNavigate('architecture')}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '9px' }}>
              <Compass size={14} />
              <span>Agente de Arquitetura</span>
            </span>
          </button>
          {canManagePacks && (
            <button
              type="button"
              className="jarvis-subnav-btn"
              onClick={() => onNavigate('pack_studio')}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '9px' }}>
                <Wrench size={14} />
                <span>Estúdio de Pacotes</span>
              </span>
            </button>
          )}
        </div>
      </aside>

      {/* Área Principal de Catálogo */}
      <div className="jarvis-settings-content">
        <div className="jarvis-store-container">
          {/* DEPARTMENT 1: PACOTES & NÚCLEOS */}
          {activeSection === 'packs' && (
            <>
              <PageHeader
                variant="flat"
                icon={<Package size={16} />}
                title="Pacotes & Núcleos Modulares"
                subtitle="Instale pacotes modulares com telas exclusivas, agentes especialistas com núcleo próprio, habilidades e trilhas de estudo."
                meta={[
                  <span key="installed" className="jarvis-tabular">
                    {summary ? `${summary.installedCount}/${summary.totalPacks}` : `${unifiedSummary.installedPacks}/${unifiedSummary.totalPacks}`} instalados
                  </span>,
                  <span key="cores" className="jarvis-tabular">
                    {summary?.bundledAgentsCount ?? 0} núcleos próprios
                  </span>,
                  <span key="tracks" className="jarvis-tabular">
                    {(summary?.unlockedModulesCount ?? 0) + (summary?.studyTracksCount ?? 0)} módulos & trilhas
                  </span>,
                ]}
                actions={
                  canManagePacks ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => onNavigate('pack_studio')}
                    >
                      <Wrench size={14} />
                      <span>Estúdio de Pacotes</span>
                    </button>
                  ) : undefined
                }
              />

              <div className="jarvis-store-controls">
                <div className="jarvis-store-search-row">
                  <div className="jarvis-search-box jarvis-store-search-input">
                    <Search size={15} />
                    <input
                      type="text"
                      className="jarvis-search-box__input"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Buscar pacote, agente (ex.: Arquiteto, Vetor), módulo ou trilha..."
                      aria-label="Buscar pacotes modulares"
                    />
                    {search && (
                      <button
                        type="button"
                        onClick={() => setSearch('')}
                        className="btn btn-ghost btn-icon-sm"
                        aria-label="Limpar busca de pacotes"
                        style={{ width: '24px', height: '24px' }}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <div
                  className="jarvis-segmented jarvis-store-segmented"
                  role="group"
                  aria-label="Filtrar pacotes por categoria"
                >
                  {FILTER_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={categoryFilter === opt.id}
                      onClick={() => setCategoryFilter(opt.id)}
                      className={`jarvis-segmented-btn ${categoryFilter === opt.id ? 'is-active' : ''}`}
                    >
                      <span>
                        {opt.label} ({packFilterCounts[opt.id] ?? 0})
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div className="jarvis-inline-alert is-error" role="alert">
                  <span>{error}</span>
                </div>
              )}

              {feedback && (
                <div className="jarvis-inline-alert is-success" role="status">
                  <Check size={15} />
                  <span>{feedback}</span>
                </div>
              )}

              {loading ? (
                <div className="jarvis-pack-loading">
                  <Loader2 size={18} className="spin" />
                  <span>Carregando catálogo modular...</span>
                </div>
              ) : filteredPacks.length === 0 ? (
                <div className="jarvis-pack-empty glass-panel">
                  <Package size={24} />
                  <h3>Nenhum pacote encontrado</h3>
                  <p>Limpe a busca ou troque o filtro de categoria para ver todos os pacotes disponíveis.</p>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setSearch('');
                      setCategoryFilter('all');
                    }}
                  >
                    Mostrar todos os pacotes
                  </button>
                </div>
              ) : (
                <div className="jarvis-store-grid">
                  {filteredPacks.map((pack) => {
                    const isBusy = busyPackId === pack.id;
                    const isExpanded = Boolean(expandedPacks[pack.id]);
                    const visual = getPackVisual(pack.category);
                    const PackIcon = visual.Icon;

                    return (
                      <article
                        key={pack.id}
                        className={`jarvis-store-card ${pack.installed ? 'is-installed' : ''}`}
                        data-pack-id={pack.id}
                      >
                        {/* Cabeçalho do Card */}
                        <div className="jarvis-store-card__header">
                          <div className="jarvis-store-card__identity">
                            <div
                              className="jarvis-store-icon-badge"
                              style={{
                                backgroundColor: visual.bg,
                                borderColor: visual.border,
                                color: visual.color,
                              }}
                              aria-hidden="true"
                            >
                              <PackIcon size={18} />
                            </div>
                            <div className="jarvis-store-card__titles">
                              <div className="jarvis-store-card__title-row">
                                <h3 className="jarvis-store-card__title">{pack.name}</h3>
                                {pack.is_custom && (
                                  <span className="jarvis-store-card__handle">custom</span>
                                )}
                              </div>
                              <div className="jarvis-store-card__subtitle">
                                v{pack.version} · {pack.agents.length} agente(s) · {pack.tabs.length} módulo(s)
                              </div>
                            </div>
                          </div>

                          <span
                            className={`jarvis-store-card__badge ${pack.installed ? 'is-active' : ''}`}
                          >
                            {pack.installed ? 'INSTALADO' : PACK_CATEGORY_SHORT[pack.category]}
                          </span>
                        </div>

                        {/* Descrição */}
                        <p className="jarvis-store-card__desc">{pack.description || pack.tagline}</p>

                        {/* Meta compacta: Agentes + Trigger de Expansão */}
                        <div className="jarvis-store-card__meta-line">
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {pack.agents.map((a) => `${a.proper_name} (${a.handle})`).join(' · ')}
                          </span>

                          <button
                            type="button"
                            className="jarvis-pack-expand-btn"
                            aria-expanded={isExpanded}
                            onClick={() =>
                              setExpandedPacks((prev) => ({ ...prev, [pack.id]: !prev[pack.id] }))
                            }
                            style={{ padding: 0, fontSize: '0.74rem' }}
                          >
                            <span>
                              {isExpanded ? 'Ocultar specs' : `${pack.study_tracks.length} trilhas · ${pack.skills.length} skills`}
                            </span>
                            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </button>
                        </div>

                        {/* Detalhes Expandidos (Módulos, Inspeção de Núcleo, Trilhas e MCP) */}
                        {isExpanded && (
                          <div className="jarvis-store-card__expand">
                            <div className="jarvis-pack-spec-row">
                              <span className="jarvis-pack-spec-label">Módulos desbloqueados</span>
                              <div className="jarvis-pack-link-list">
                                {pack.tabs.map((tabId, idx) => {
                                  const label = pack.tab_labels[tabId] || tabId;
                                  return (
                                    <React.Fragment key={tabId}>
                                      {idx > 0 && (
                                        <span className="jarvis-sep" aria-hidden="true">
                                          ·
                                        </span>
                                      )}
                                      {pack.installed ? (
                                        <button
                                          type="button"
                                          className="jarvis-inline-link"
                                          onClick={() => onNavigate(tabId)}
                                        >
                                          {label}
                                        </button>
                                      ) : (
                                        <span className="jarvis-muted-item">{label}</span>
                                      )}
                                    </React.Fragment>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="jarvis-pack-spec-row">
                              <span className="jarvis-pack-spec-label">
                                Agentes com núcleo próprio ({pack.agents.length})
                              </span>
                              <div className="jarvis-pack-agent-list">
                                {pack.agents.map((ag) => (
                                  <div key={ag.role} className="jarvis-pack-agent-row">
                                    <div>
                                      <strong>{ag.proper_name}</strong>{' '}
                                      <span className="mono jarvis-core-handle">{ag.handle}</span>
                                      <span className="jarvis-sep" aria-hidden="true">
                                        {' · '}
                                      </span>
                                      <span className="jarvis-muted-item">{ag.name}</span>
                                    </div>
                                    {pack.installed && (
                                      <button
                                        type="button"
                                        className="jarvis-inline-link"
                                        onClick={() =>
                                          setInspectingAgent({
                                            role: ag.role,
                                            name: `${ag.proper_name} — ${ag.name}`,
                                            handle: ag.handle,
                                          })
                                        }
                                      >
                                        Inspecionar núcleo
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>

                            {pack.study_tracks.length > 0 && (
                              <div className="jarvis-pack-detail-group">
                                <span className="jarvis-pack-spec-label">Trilhas para Conhecimento</span>
                                <ul className="jarvis-pack-ul">
                                  {pack.study_tracks.map((track) => (
                                    <li key={track.id}>
                                      <strong>{track.title}</strong> — {track.summary}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            <div className="jarvis-pack-detail-group">
                              <span className="jarvis-pack-spec-label">Habilidades & Presets MCP</span>
                              <p className="jarvis-pack-inline-prose">{pack.skills.join(' · ')}</p>
                              <p className="jarvis-pack-inline-prose mono">
                                MCP: {pack.mcp_presets.join(', ')}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Rodapé de Ações */}
                        <div className="jarvis-store-card__footer">
                          {pack.installed ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm jarvis-store-card__primary-btn"
                                onClick={() => onNavigate(pack.tabs[0] || 'agents')}
                              >
                                <ArrowUpRight size={14} />
                                <span>Abrir {pack.tab_labels[pack.tabs[0]] || 'módulo'}</span>
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm jarvis-danger-text-btn jarvis-store-card__secondary-btn"
                                disabled={isBusy}
                                onClick={() => void handleUninstall(pack)}
                              >
                                {isBusy ? <Loader2 size={14} className="spin" /> : <Trash2 size={13} />}
                                <span>{isBusy ? 'Removendo...' : 'Remover'}</span>
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm jarvis-store-card__primary-btn"
                                disabled={isBusy}
                                onClick={() => void handleInstall(pack)}
                              >
                                {isBusy ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                                <span>{isBusy ? 'Instalando...' : `Instalar ${pack.name}`}</span>
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm jarvis-store-card__secondary-btn"
                                onClick={() =>
                                  setExpandedPacks((prev) => ({ ...prev, [pack.id]: !prev[pack.id] }))
                                }
                              >
                                <span>{isExpanded ? 'Fechar' : 'Detalhes'}</span>
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* DEPARTMENT 2: APPS & CONECTORES MCP */}
          {activeSection === 'apps' && (
            <>
              <PageHeader
                variant="flat"
                icon={<LayoutGrid size={16} />}
                title="Apps & Conectores MCP"
                subtitle="Conecte ferramentas, cofres, repositórios GitHub, tokens do Figma, Context Sets e servidores MCP com que seus agentes trabalham."
                meta={[
                  <span key="conn" className="jarvis-tabular">
                    {connectedStoreApps.length} conectados
                  </span>,
                  <span key="total" className="jarvis-tabular">
                    {allStoreApps.length} disponíveis
                  </span>,
                ]}
                actions={
                  <button
                    type="button"
                    onClick={() => setShowCustomAppModal(true)}
                    className="btn btn-primary btn-sm"
                  >
                    <Plus size={14} />
                    <span>Adicionar personalizado</span>
                  </button>
                }
              />

              <div className="jarvis-store-controls">
                <div className="jarvis-store-search-row">
                  <div className="jarvis-search-box jarvis-store-search-input">
                    <Search size={15} />
                    <input
                      type="text"
                      value={appSearch}
                      onChange={(e) => setAppSearch(e.target.value)}
                      placeholder="Buscar apps, integrações e servidores MCP..."
                      aria-label="Buscar apps e conectores"
                      className="jarvis-search-box__input"
                    />
                    {appSearch && (
                      <button
                        type="button"
                        onClick={() => setAppSearch('')}
                        className="btn btn-ghost btn-icon-sm"
                        aria-label="Limpar busca de apps"
                        style={{ width: '24px', height: '24px' }}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <div
                  className="jarvis-segmented jarvis-store-segmented"
                  role="tablist"
                  aria-label="Categorias de apps e conectores"
                >
                  {(
                    [
                      { id: 'all', label: `Todos (${appCategoryCounts.all})` },
                      { id: 'productivity', label: `Produtividade (${appCategoryCounts.productivity})` },
                      { id: 'documents', label: `Documentos (${appCategoryCounts.documents})` },
                      { id: 'development', label: `Desenvolvimento (${appCategoryCounts.development})` },
                      { id: 'ai', label: `IA & MCP (${appCategoryCounts.ai})` },
                      { id: 'live', label: 'Integrações ao Vivo' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={appCategory === tab.id}
                      onClick={() => setAppCategory(tab.id)}
                      className={`jarvis-segmented-btn ${appCategory === tab.id ? 'is-active' : ''}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {appCategory !== 'live' && (
                <>
                  {filteredApps.length === 0 ? (
                    <div className="jarvis-empty-state">
                      <LayoutGrid size={24} color="var(--text-muted)" />
                      <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Nenhum conector encontrado
                      </div>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Ajuste o termo de busca ou adicione um conector MCP/REST personalizado.
                      </p>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => {
                          setAppSearch('');
                          setAppCategory('all');
                        }}
                      >
                        Mostrar todos os apps
                      </button>
                    </div>
                  ) : (
                    <div className="jarvis-store-grid">
                      {filteredApps.map((app) => {
                        const isConnected = connectedAppIds.includes(app.id);
                        return (
                          <article
                            key={app.id}
                            className={`jarvis-store-card ${isConnected ? 'is-installed' : ''}`}
                          >
                            <div className="jarvis-store-card__header">
                              <div className="jarvis-store-card__identity">
                                <StoreAppIcon iconType={app.iconType} size={40} />
                                <div className="jarvis-store-card__titles">
                                  <div className="jarvis-store-card__title-row">
                                    <h3 className="jarvis-store-card__title">{app.name}</h3>
                                    {app.isCustom && (
                                      <span className="jarvis-store-card__handle">
                                        {app.connectionType?.toUpperCase() || 'MCP'}
                                      </span>
                                    )}
                                  </div>
                                  <div className="jarvis-store-card__subtitle">
                                    {APP_CATEGORY_LABELS[app.category]}
                                  </div>
                                </div>
                              </div>

                              <span
                                className={`jarvis-store-card__badge ${isConnected ? 'is-active' : ''}`}
                              >
                                {isConnected ? 'CONECTADO' : APP_CATEGORY_SHORT_LABELS[app.category]}
                              </span>
                            </div>

                            <p className="jarvis-store-card__desc">{app.description}</p>

                            <div className="jarvis-store-card__footer">
                              <button
                                type="button"
                                onClick={() => handleOpenAppModal(app)}
                                className="btn btn-secondary btn-sm jarvis-store-card__primary-btn"
                              >
                                {isConnected ? (
                                  <>
                                    <Check size={13} color="var(--success-color)" strokeWidth={2.5} />
                                    <span>Configurar</span>
                                  </>
                                ) : (
                                  <>
                                    <Plus size={14} />
                                    <span>Conectar</span>
                                  </>
                                )}
                              </button>

                              {app.isCustom ? (
                                <button
                                  type="button"
                                  onClick={() => removeCustomApp(app)}
                                  className="btn btn-danger-ghost btn-icon-sm"
                                  title={`Remover conector ${app.name}`}
                                  aria-label={`Remover conector ${app.name}`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              ) : isConnected ? (
                                <button
                                  type="button"
                                  onClick={() => disconnectApp(app.id)}
                                  className="btn btn-ghost btn-sm jarvis-store-card__secondary-btn"
                                >
                                  <span>Desconectar</span>
                                </button>
                              ) : null}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {(appCategory === 'all' || appCategory === 'live') && (
                <div className={appCategory === 'all' && filteredApps.length > 0 ? 'jarvis-store-section-divider' : ''}>
                  <IntegrationsHubPanel
                    embedded
                    onSkillImported={() => {
                      void fetchSkills()
                        .then((s) => {
                          const list = Array.isArray(s) ? s : [];
                          setSkillsSnapshot(list);
                          setSkillsCountOverride({
                            total: list.length,
                            active: list.filter(isSkillActive).length,
                          });
                        })
                        .catch(() => {});
                    }}
                  />
                </div>
              )}
            </>
          )}

          {/* DEPARTMENT 3: AGENTES (TEMPLATES PRONTOS EM 1 CLIQUE) */}
          {activeSection === 'templates' && (
            <>
              <PageHeader
                variant="flat"
                icon={<Bot size={16} />}
                title="Catálogo de Agentes IA"
                subtitle="Agentes autônomos com papéis formais, habilidades configuradas e personalidades prontas para instalar na sua equipe em 1 clique."
                meta={[
                  <span key="tpl" className="jarvis-tabular">
                    {AGENT_TEMPLATE_LIBRARY.length} especialistas prontos
                  </span>,
                  <span key="inst" className="jarvis-tabular">
                    {installedAgents.length} instalados na equipe
                  </span>,
                ]}
                actions={
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onNavigate('agents')}
                  >
                    <Cpu size={14} />
                    <span>Central de Agentes</span>
                  </button>
                }
              />

              <AgentTemplateStoreGrid
                variant="store"
                installedAgents={installedAgents}
                onRefreshAgents={async () => {
                  const updated = await fetchAgents().catch(() => null);
                  if (Array.isArray(updated)) {
                    setInstalledAgents(updated);
                  }
                }}
                onOpenChat={(agent) => {
                  if (onOpenAgentChat) {
                    onOpenAgentChat(agent.role);
                  } else {
                    onNavigate('chat');
                  }
                }}
              />
            </>
          )}

          {/* DEPARTMENT 4: HABILIDADES (SKILLS) UNIFICADAS */}
          {activeSection === 'skills' && (
            <SkillsCatalogPanel
              variant="store"
              onOpenGitHubImport={() => onNavigate('github_import')}
              onSkillsCountChange={handleSkillsCountChange}
            />
          )}
        </div>
      </div>

      {/* Inspetor de Núcleo de Agente */}
      {inspectingAgent && (
        <AgentCoreInspectorModal
          isOpen={Boolean(inspectingAgent)}
          agentRole={inspectingAgent.role}
          agentName={inspectingAgent.name}
          agentHandle={inspectingAgent.handle}
          onClose={() => setInspectingAgent(null)}
        />
      )}

      {/* Modal: Conectar / Gerenciar App */}
      <Modal
        isOpen={Boolean(selectedAppForModal)}
        onClose={() => setSelectedAppForModal(null)}
        title={selectedAppForModal?.name || 'Conector'}
        subtitle={
          selectedAppForModal && connectedAppIds.includes(selectedAppForModal.id)
            ? 'Conector ativo e sincronizado'
            : 'Conectar nova ferramenta'
        }
        icon={selectedAppForModal ? <StoreAppIcon iconType={selectedAppForModal.iconType} size={32} /> : undefined}
        maxWidth="sm"
        footer={
          selectedAppForModal ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%', flexWrap: 'wrap' }}>
              {connectedAppIds.includes(selectedAppForModal.id) && (
                <button
                  type="button"
                  onClick={() => disconnectApp(selectedAppForModal.id)}
                  className="btn btn-danger btn-sm"
                  style={{ marginRight: 'auto' }}
                >
                  <Trash2 size={14} />
                  <span>Desconectar</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setSelectedAppForModal(null)}
                className="btn btn-secondary btn-sm"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={connectingApp}
                onClick={confirmAppConnection}
                className="btn btn-primary btn-sm"
              >
                {connectingApp
                  ? 'Conectando...'
                  : connectedAppIds.includes(selectedAppForModal.id)
                    ? 'Atualizar conexão'
                    : 'Salvar & Conectar'}
              </button>
            </div>
          ) : undefined
        }
      >
        {selectedAppForModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
              {selectedAppForModal.description}. Autorize o Calmon Studio a interagir com este serviço através das suas chaves de API ou webhook seguro.
            </p>

            {selectedAppForModal.isCustom && selectedAppForModal.endpoint && (
              <div className="jarvis-settings-subcard">
                <div className="jarvis-pack-spec-label" style={{ marginBottom: '4px' }}>
                  Endpoint / Comando ({selectedAppForModal.connectionType?.toUpperCase() || 'MCP'})
                </div>
                <code className="mono" style={{ fontSize: '0.78rem', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                  {selectedAppForModal.endpoint}
                </code>
              </div>
            )}

            <div>
              <label htmlFor="store-app-token-input" className="user-profile-field-label">
                Token de Acesso / Chave de API / Webhook URL
              </label>
              <input
                id="store-app-token-input"
                type="password"
                placeholder="Insira o token ou webhook..."
                value={appTokenInput}
                onChange={(e) => setAppTokenInput(e.target.value)}
                className="jarvis-input"
              />
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                As credenciais são criptografadas e persistidas no cofre isolado da sua conta.
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Adicionar Conector Personalizado */}
      <Modal
        isOpen={showCustomAppModal}
        onClose={closeCustomAppModal}
        title="Adicionar Conector Personalizado"
        subtitle="Integre servidores MCP externos, webhooks customizados ou APIs REST aos seus agentes."
        icon={<Plug size={18} color="var(--accent-light)" />}
        maxWidth="sm"
      >
        <form onSubmit={handleSaveCustomConnector} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label htmlFor="custom-app-name" className="user-profile-field-label">
              Nome da Ferramenta *
            </label>
            <input
              id="custom-app-name"
              type="text"
              placeholder="Ex: Minha API Interna, Notion MCP..."
              value={customAppName}
              onChange={(e) => setCustomAppName(e.target.value)}
              className="jarvis-input"
              required
            />
          </div>

          <div>
            <label htmlFor="custom-app-type" className="user-profile-field-label">
              Tipo de Conexão
            </label>
            <select
              id="custom-app-type"
              value={customAppType}
              onChange={(e) => setCustomAppType(e.target.value as 'mcp' | 'webhook' | 'custom_tool')}
              className="jarvis-select"
            >
              <option value="mcp">Servidor MCP (Model Context Protocol via Stdio / SSE)</option>
              <option value="webhook">Webhook / Endpoint REST</option>
              <option value="custom_tool">Script Python / Shell Sandboxed</option>
            </select>
          </div>

          <div>
            <label htmlFor="custom-app-endpoint" className="user-profile-field-label">
              Comando de Inicialização ou Endpoint URL *
            </label>
            <input
              id="custom-app-endpoint"
              type="text"
              placeholder="Ex: npx -y @modelcontextprotocol/server-postgres ou https://api.exemplo.com/mcp"
              value={customAppEndpoint}
              onChange={(e) => setCustomAppEndpoint(e.target.value)}
              className="jarvis-input"
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
              required
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <button
              type="button"
              onClick={closeCustomAppModal}
              className="btn btn-secondary btn-sm"
            >
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary btn-sm">
              Adicionar Conector
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
