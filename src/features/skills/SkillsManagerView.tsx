import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutGrid,
  Bot,
  BookOpen,
  RefreshCw,
  Search,
  Filter,
  Check,
  Plus,
  X,
  Trash2,
  Upload,
  Plug,
  GitBranch,
} from 'lucide-react';
import {
  fetchSkills,
  toggleSkill,
  fetchAgents,
  fetchPonytailStatus,
  savePonytailLevel,
  deleteUserSkill,
} from '../../api';
import { SkillInfo, AgentInfo } from '../../types';
import { SkillCard } from './SkillCard';
import { SkillAgentModal } from './SkillAgentModal';
import { CreateSkillModal } from './CreateSkillModal';
import { SkillDetailsModal } from './SkillDetailsModal';
import { IntegrationsHubPanel } from './IntegrationsHubPanel';
import { notify } from '../../shared/common/Toast';
import { ConfirmDialog } from '../../shared/common/ConfirmDialog';
import { Modal } from '../../shared/common/Modal';
import { PageHeader } from '../../shared/layout/PageHeader';
import { API_BASE } from '../../services/api/client';
import { apiFetch } from '../../services/sessionTransport';
import { AGENT_TEMPLATE_LIBRARY } from '../../services/agentTemplates';
import { AgentTemplateStoreGrid } from '../agents/AgentTemplateStoreGrid';
import {
  STORE_APPS,
  STORE_APPS_UPDATED_EVENT,
  createCustomStoreApp,
  loadConnectedAppIds,
  loadCustomStoreApps,
  saveConnectedAppIds,
  saveCustomStoreApps,
  type StoreAppItem,
  type StoreAppsUpdatedDetail,
} from '../../services/storeAppsCatalog';
import { StoreAppIcon } from '../store/StoreAppIcon';

export type { StoreAppItem };

export interface SkillsManagerViewProps {
  initialTab?: 'apps' | 'agents' | 'skills' | 'integrations';
  onOpenGitHubImport?: () => void;
}

const normalizePonytailLevel = (raw?: string | null): 'off' | 'lite' | 'senior' | 'ultra' => {
  const val = String(raw || '').toLowerCase();
  if (val === 'off' || val === 'lite' || val === 'senior' || val === 'ultra') return val;
  if (val === 'strict') return 'senior';
  return 'senior';
};

export const SkillsManagerView: React.FC<SkillsManagerViewProps> = ({
  initialTab = 'apps',
  onOpenGitHubImport,
}) => {
  // Aba da Loja: Apps, Agentes, Habilidades ou Integrações & Context Sets
  const [activeStoreTab, setActiveStoreTab] = useState<'apps' | 'agents' | 'skills' | 'integrations'>(initialTab);

  useEffect(() => {
    setActiveStoreTab(initialTab);
  }, [initialTab]);

  // Estado das Habilidades
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canManageSkills, setCanManageSkills] = useState(false);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [ponytailError, setPonytailError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryTab, setCategoryTab] = useState<'all' | 'arch' | 'sec' | 'qa' | 'custom'>('all');
  const [domainFilter, setDomainFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [editingSkill, setEditingSkill] = useState<SkillInfo | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createModalTab, setCreateModalTab] = useState<'create' | 'import'>('create');
  const [viewingSkillDetails, setViewingSkillDetails] = useState<SkillInfo | null>(null);
  const [pendingDeleteSkill, setPendingDeleteSkill] = useState<{ id: string; name: string } | null>(null);
  const [deletingSkill, setDeletingSkill] = useState(false);

  // Estado do Modo Ponytail (Senior YAGNI)
  const [ponytailLevel, setPonytailLevel] = useState<string>('senior');
  const [savingPonytail, setSavingPonytail] = useState<boolean>(false);

  // Estado da Loja de Apps
  const [appSearchQuery, setAppSearchQuery] = useState('');
  const [connectedApps, setConnectedApps] = useState<string[]>(loadConnectedAppIds);
  const [customApps, setCustomApps] = useState<StoreAppItem[]>(loadCustomStoreApps);
  const [selectedAppForModal, setSelectedAppForModal] = useState<StoreAppItem | null>(null);
  const [showCustomAppModal, setShowCustomAppModal] = useState(false);
  const [appTokenInput, setAppTokenInput] = useState('');
  const [connectingApp, setConnectingApp] = useState(false);
  const [customAppName, setCustomAppName] = useState('');
  const [customAppType, setCustomAppType] = useState<'mcp' | 'webhook' | 'custom_tool'>('mcp');
  const [customAppEndpoint, setCustomAppEndpoint] = useState('');

  const saveConnectedApps = (list: string[]) => {
    setConnectedApps(saveConnectedAppIds(list));
  };

  const handleToggleConnect = (app: StoreAppItem) => {
    setAppTokenInput('');
    setSelectedAppForModal(app);
  };

  const confirmAppConnection = () => {
    if (!selectedAppForModal || connectingApp) return;
    setConnectingApp(true);
    try {
      const wasConnected = connectedApps.includes(selectedAppForModal.id);
      const next = Array.from(new Set([...connectedApps, selectedAppForModal.id]));
      saveConnectedApps(next);
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
    const next = connectedApps.filter((id) => id !== appId);
    saveConnectedApps(next);
    notify('App desconectado com sucesso!', 'info');
    setAppTokenInput('');
    setSelectedAppForModal(null);
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
    const created = createCustomStoreApp({
      name: customAppName,
      connectionType: customAppType,
      endpoint: customAppEndpoint,
    });
    setCustomApps(saveCustomStoreApps([...customApps, created]));
    saveConnectedApps([...connectedApps, created.id]);
    setAppSearchQuery('');
    notify(`Conector "${created.name}" cadastrado e conectado com sucesso!`, 'success');
    closeCustomAppModal();
  };

  const loadData = async () => {
    setLoading(true);
    const [skillsResult, agentsResult, ponytailResult] = await Promise.allSettled([
      fetchSkills(),
      fetchAgents(),
      fetchPonytailStatus(),
    ]);
    if (skillsResult.status === 'fulfilled') {
      setSkills(skillsResult.value);
      setCatalogError(null);
    } else {
      setCatalogError(
        skillsResult.reason instanceof Error
          ? skillsResult.reason.message
          : 'Falha ao carregar catálogo de habilidades.'
      );
    }
    if (agentsResult.status === 'fulfilled') {
      setAgents(agentsResult.value);
      setAgentsError(null);
    } else {
      setAgentsError(
        agentsResult.reason instanceof Error
          ? agentsResult.reason.message
          : 'Falha ao carregar agentes disponíveis.'
      );
    }
    if (ponytailResult.status === 'fulfilled') {
      setPonytailLevel(normalizePonytailLevel(ponytailResult.value.level));
      setPonytailError(null);
    } else {
      setPonytailError(
        ponytailResult.reason instanceof Error
          ? ponytailResult.reason.message
          : 'Falha ao carregar política Ponytail.'
      );
    }
    setLoading(false);
  };

  const handleDeleteSkill = (skillId: string, skillName: string) => {
    if (!canManageSkills) return;
    setPendingDeleteSkill({ id: skillId, name: skillName });
  };

  const confirmDeleteSkill = async () => {
    if (!canManageSkills || !pendingDeleteSkill) return;
    const { id: skillId, name: skillName } = pendingDeleteSkill;
    setDeletingSkill(true);
    try {
      const result = await deleteUserSkill(skillId);
      if (result?.status !== 'deleted' && !result?.deleted) {
        throw new Error('A habilidade não foi encontrada na sua conta.');
      }
      notify(`Habilidade "${skillName}" excluída com sucesso!`, 'success');
      setPendingDeleteSkill(null);
      await loadData();
    } catch (err: any) {
      notify(`Erro ao excluir habilidade: ${err.message}`, 'error');
    } finally {
      setDeletingSkill(false);
    }
  };

  const handlePonytailChange = async (newLevel: string) => {
    if (!isAdmin) return;
    setSavingPonytail(true);
    try {
      await savePonytailLevel(newLevel);
      setPonytailLevel(newLevel);
      notify(`Modo Ponytail atualizado para '${newLevel.toUpperCase()}'!`, 'success');
    } catch (err: any) {
      notify(`Erro ao alterar modo Ponytail: ${err.message}`, 'error');
    } finally {
      setSavingPonytail(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    apiFetch(`${API_BASE}/auth/me`)
      .then(async (response) => (response.ok ? response.json() : null))
      .then((principal) => {
        if (cancelled) return;
        const human = principal?.kind === 'human';
        setIsAdmin(human && principal?.role === 'admin');
        setCanManageSkills(human && (principal?.role === 'admin' || principal?.role === 'developer'));
        setRoleLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setIsAdmin(false);
          setCanManageSkills(false);
          setRoleLoaded(true);
        }
      });
    loadData();
    const onAgentsUpdated = () => {
      loadData();
    };
    const onStoreAppsUpdated = (e: Event) => {
      const detail = (e as CustomEvent<StoreAppsUpdatedDetail>).detail;
      setConnectedApps(detail?.connectedAppIds ?? loadConnectedAppIds());
      setCustomApps(detail?.customApps ?? loadCustomStoreApps());
    };
    window.addEventListener('jarvis:agents-updated', onAgentsUpdated);
    window.addEventListener(STORE_APPS_UPDATED_EVENT, onStoreAppsUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('jarvis:agents-updated', onAgentsUpdated);
      window.removeEventListener(STORE_APPS_UPDATED_EVENT, onStoreAppsUpdated);
    };
  }, []);

  const handleToggle = async (skillId: string) => {
    if (!canManageSkills) return;
    try {
      await toggleSkill(skillId);
      await loadData();
    } catch (e) {
      notify(
        `Não foi possível alterar a habilidade: ${e instanceof Error ? e.message : 'erro desconhecido'}`,
        'error'
      );
    }
  };

  const domains = useMemo(() => {
    const set = new Set<string>();
    skills.forEach((s) => set.add(s.domain));
    return Array.from(set).sort();
  }, [skills]);

  const filteredSkills = useMemo(() => {
    return skills.filter((s) => {
      const q = searchQuery.toLowerCase();
      const matchSearch =
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q);

      const matchDomain = domainFilter === 'all' || s.domain === domainFilter;

      let matchCategory = true;
      if (categoryTab === 'arch') {
        matchCategory = ['web', 'backend', 'flutter', 'architecture', 'mobile'].includes(s.domain.toLowerCase());
      } else if (categoryTab === 'sec') {
        matchCategory =
          ['security', 'cve', 'devsecops', 'auth'].includes(s.domain.toLowerCase()) || s.id.includes('sec');
      } else if (categoryTab === 'qa') {
        matchCategory =
          ['qa', 'testing', 'test', 'tdd'].includes(s.domain.toLowerCase()) || s.id.includes('test');
      } else if (categoryTab === 'custom') {
        matchCategory =
          s.origin === 'user_created' || Boolean(s.origin?.includes('imported')) || s.id.startsWith('user_');
      }

      const isAct = s.is_approved && !s.is_revoked;
      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && isAct) ||
        (statusFilter === 'inactive' && !isAct);

      return matchSearch && matchDomain && matchStatus && matchCategory;
    });
  }, [skills, searchQuery, domainFilter, statusFilter, categoryTab]);

  const activeCount = skills.filter((s) => s.is_approved && !s.is_revoked).length;

  const renderAppIcon = (iconType: string, size = 38) => (
    <StoreAppIcon iconType={iconType} size={size} />
  );

  const allStoreApps = useMemo(() => [...STORE_APPS, ...customApps], [customApps]);

  // Filtragem de apps na aba "Apps"
  const appsFiltered = useMemo(() => {
    const q = appSearchQuery.toLowerCase().trim();
    return allStoreApps.filter(
      (a) => !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
    );
  }, [allStoreApps, appSearchQuery]);

  const appSections = useMemo(
    () =>
      [
        { id: 'productivity', title: 'Produtividade', items: appsFiltered.filter((a) => a.category === 'productivity') },
        { id: 'documents', title: 'Documentos', items: appsFiltered.filter((a) => a.category === 'documents') },
        {
          id: 'development',
          title: 'Desenvolvimento & Código',
          items: appsFiltered.filter((a) => a.category === 'development'),
        },
        {
          id: 'ai',
          title: 'Inteligência Artificial & MCP',
          items: appsFiltered.filter((a) => a.category === 'ai'),
        },
      ].filter((section) => section.items.length > 0),
    [appsFiltered]
  );

  const connectedStoreApps = useMemo(
    () => allStoreApps.filter((a) => connectedApps.includes(a.id)),
    [allStoreApps, connectedApps]
  );

  return (
    <div className="jarvis-settings-layout">
      {/* Sub-navegação lateral responsiva da Loja */}
      <aside className="jarvis-settings-nav" aria-label="Navegação da Loja e Habilidades">
        <div className="jarvis-settings-nav__header">
          <h2 className="jarvis-settings-nav__title">Loja & Habilidades</h2>
        </div>

        <div className="jarvis-settings-nav__list">
          <div className="jarvis-settings-nav__group">
            <div className="jarvis-settings-nav__group-title">Explorar</div>
            <button
              type="button"
              onClick={() => setActiveStoreTab('apps')}
              className={`jarvis-subnav-btn ${activeStoreTab === 'apps' ? 'is-active' : ''}`}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                <LayoutGrid size={15} />
                <span>Apps</span>
              </span>
              <span className="jarvis-tabular" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {allStoreApps.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveStoreTab('agents')}
              className={`jarvis-subnav-btn ${activeStoreTab === 'agents' ? 'is-active' : ''}`}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                <Bot size={15} />
                <span>Agentes</span>
              </span>
              <span className="jarvis-tabular" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {AGENT_TEMPLATE_LIBRARY.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveStoreTab('skills')}
              className={`jarvis-subnav-btn ${activeStoreTab === 'skills' ? 'is-active' : ''}`}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                <BookOpen size={15} />
                <span>Habilidades</span>
              </span>
              <span className="jarvis-tabular" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {skills.length}
              </span>
            </button>

            <button
              type="button"
              data-testid="store-tab-integrations"
              onClick={() => setActiveStoreTab('integrations')}
              className={`jarvis-subnav-btn ${activeStoreTab === 'integrations' ? 'is-active' : ''}`}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                <Plug size={15} />
                <span>Integrações & Context Sets</span>
              </span>
            </button>
          </div>

          {connectedStoreApps.length > 0 && (
            <div className="jarvis-settings-nav__group">
              <div className="jarvis-settings-nav__group-title">Seus apps ({connectedStoreApps.length})</div>
              {connectedStoreApps.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => setSelectedAppForModal(app)}
                  className="jarvis-subnav-btn"
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
                    {renderAppIcon(app.iconType, 18)}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {app.name}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Área Principal */}
      <div className="jarvis-settings-content">
        {/* VIEW 1: APPS */}
        {activeStoreTab === 'apps' && (
          <div style={{ maxWidth: '1040px', width: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <PageHeader
              title="Apps & Conectores"
              subtitle="Conecte as ferramentas, cofres e servidores MCP com que seus agentes trabalham."
              icon={<LayoutGrid size={16} />}
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

            <div className="jarvis-filter-bar">
              <div className="jarvis-search-box" style={{ flex: 1, maxWidth: '460px', minWidth: 'min(100%, 220px)' }}>
                <Search size={15} />
                <input
                  type="text"
                  value={appSearchQuery}
                  onChange={(e) => setAppSearchQuery(e.target.value)}
                  placeholder="Buscar apps e conectores..."
                  aria-label="Buscar apps e conectores"
                  className="jarvis-search-box__input"
                />
                {appSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setAppSearchQuery('')}
                    className="btn btn-ghost btn-icon-sm"
                    aria-label="Limpar busca de apps"
                    style={{ width: '24px', height: '24px' }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            {appSections.length === 0 ? (
              <div className="jarvis-empty-state">
                <LayoutGrid size={26} color="var(--text-muted)" />
                <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Nenhum conector encontrado
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Ajuste o termo de busca ou adicione um conector MCP/REST personalizado.
                </p>
              </div>
            ) : (
              appSections.map((section) => (
                <section key={section.id} className="jarvis-settings-section">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <h2 className="jarvis-settings-section__title">
                      <span>{section.title}</span>
                      <span className="jarvis-tabular" style={{ color: 'var(--text-secondary)' }}>
                        · {section.items.length}
                      </span>
                    </h2>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))',
                      gap: '12px',
                    }}
                  >
                    {section.items.map((app) => {
                      const isConnected = connectedApps.includes(app.id);
                      return (
                        <div
                          key={app.id}
                          className="jarvis-settings-card"
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px 14px',
                            gap: '12px',
                            minWidth: 0,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                            {renderAppIcon(app.iconType, 38)}
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: '0.88rem',
                                  fontWeight: 600,
                                  color: 'var(--text-primary)',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {app.name}
                              </div>
                              <div
                                style={{
                                  fontSize: '0.76rem',
                                  color: 'var(--text-secondary)',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {app.description}
                              </div>
                            </div>
                          </div>

                          {isConnected ? (
                            <button
                              type="button"
                              onClick={() => handleToggleConnect(app)}
                              className="btn btn-success btn-xs"
                              style={{ flexShrink: 0 }}
                            >
                              <Check size={13} strokeWidth={2.5} />
                              <span>Conectado</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleToggleConnect(app)}
                              className="btn btn-secondary btn-xs"
                              style={{ flexShrink: 0 }}
                            >
                              <Plus size={13} />
                              <span>Conectar</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </div>
        )}

        {/* VIEW 2: AGENTES (Biblioteca Unificada Pronta em 1 Clique) */}
        {activeStoreTab === 'agents' && (
          <div style={{ maxWidth: '1080px', width: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <PageHeader
              title="Loja de Agentes IA Prontos"
              subtitle="Todos os agentes — do dia a dia à engenharia, dados e segurança — já prontos com habilidades configuradas. Instale em 1 clique e desinstale os que não usar."
              icon={<Bot size={16} />}
              meta={[
                <span key="tpl" className="jarvis-tabular">
                  {AGENT_TEMPLATE_LIBRARY.length} templates prontos
                </span>,
                <span key="active" className="jarvis-tabular">
                  {agents.length} instalados na sua equipe
                </span>,
              ]}
            />

            <AgentTemplateStoreGrid
              installedAgents={agents}
              onRefreshAgents={loadData}
              onOpenChat={(ag) => {
                window.dispatchEvent(
                  new CustomEvent('jarvis:open-agent-chat', {
                    detail: { agentId: ag.role, agentName: ag.proper_name || ag.name },
                  })
                );
              }}
            />
          </div>
        )}

        {/* VIEW 3: HABILIDADES DOS AGENTES */}
        {activeStoreTab === 'skills' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1100px', width: '100%' }}>
            {!roleLoaded && (
              <div role="status" className="jarvis-callout jarvis-callout--info">
                A verificar permissões do Gestor de Habilidades…
              </div>
            )}

            <PageHeader
              title="Habilidades dos Agentes"
              subtitle="Capacidades modulares, ferramentas e diretrizes especializadas que você pode anexar diretamente aos seus agentes instalados."
              icon={<BookOpen size={16} />}
              meta={[
                <span key="active" className="jarvis-tabular">
                  <strong style={{ color: 'var(--text-primary)' }}>
                    {activeCount}/{skills.length}
                  </strong>{' '}
                  ativas
                </span>,
                <span key="spec" className="jarvis-tabular">
                  {agents.length} agentes instalados
                </span>,
              ]}
              actions={
                <>
                  {canManageSkills && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setCreateModalTab('create');
                          setShowCreateModal(true);
                        }}
                        className="btn btn-primary btn-sm"
                      >
                        <Plus size={14} />
                        <span>Nova Habilidade</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setCreateModalTab('import');
                          setShowCreateModal(true);
                        }}
                        className="btn btn-secondary btn-sm"
                      >
                        <Upload size={14} />
                        <span>Importar Habilidade</span>
                      </button>
                    </>
                  )}

                  {onOpenGitHubImport && (
                    <button
                      type="button"
                      onClick={onOpenGitHubImport}
                      className="btn btn-secondary btn-sm"
                    >
                      <GitBranch size={14} />
                      <span>Importar do GitHub</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => loadData()}
                    className="btn btn-secondary btn-sm"
                  >
                    <RefreshCw size={13} className={loading ? 'spin' : ''} />
                    <span>{loading ? 'Atualizando...' : 'Atualizar'}</span>
                  </button>
                </>
              }
            />

            {catalogError && (
              <div role="alert" className="jarvis-error-banner">
                {catalogError}
              </div>
            )}
            {agentsError && (
              <div role="alert" className="jarvis-callout jarvis-callout--warning">
                Agentes indisponíveis: {agentsError}
              </div>
            )}
            {ponytailError && (
              <div role="alert" className="jarvis-callout jarvis-callout--warning">
                Política Ponytail indisponível: {ponytailError}
              </div>
            )}

            {/* Política Ponytail */}
            <div className="jarvis-settings-card">
              <div className="jarvis-setting-row">
                <div className="jarvis-setting-row__info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span className="jarvis-setting-row__title">
                      Modo Ponytail (The Laziest Senior Developer)
                    </span>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        color: ponytailLevel !== 'off' ? 'var(--success-color)' : 'var(--text-muted)',
                      }}
                    >
                      · {ponytailLevel !== 'off' ? 'YAGNI Ativo' : 'Desativado'}
                    </span>
                  </div>
                  <div className="jarvis-setting-row__desc">
                    Política global de minimalismo técnico: reaproveitar código existente, usar standard library e evitar dependências redundantes.
                  </div>
                </div>

                <div className="jarvis-setting-row__control">
                  <label
                    htmlFor="ponytail-level-select"
                    style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 500 }}
                  >
                    Nível:
                  </label>
                  {isAdmin ? (
                    <select
                      id="ponytail-level-select"
                      value={ponytailLevel}
                      disabled={savingPonytail}
                      onChange={(e) => handlePonytailChange(e.target.value)}
                      aria-label="Nível do modo Ponytail"
                      className="jarvis-select"
                      style={{ width: 'auto', minWidth: '220px' }}
                    >
                      <option value="off">Desativado (Criação Livre)</option>
                      <option value="lite">Ponytail Leve (Evita Pacotes)</option>
                      <option value="senior">Ponytail Sênior (YAGNI & DRY Padrão)</option>
                      <option value="ultra">Ponytail Ultra (Minimalismo Radical)</option>
                    </select>
                  ) : (
                    <span style={{ color: 'var(--text-primary)', fontSize: '0.8rem' }}>
                      {ponytailLevel.toUpperCase()} · definido pelo administrador
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Categorias de Skills */}
            <div
              className="jarvis-segmented"
              style={{ overflowX: 'auto', flexWrap: 'nowrap', maxWidth: '100%' }}
              role="tablist"
              aria-label="Categorias de habilidades"
            >
              {[
                { id: 'all' as const, label: `Todas (${skills.length})` },
                { id: 'arch' as const, label: 'Arquitetura & Clean Code' },
                { id: 'sec' as const, label: 'Cibersegurança & OWASP' },
                { id: 'qa' as const, label: 'QA & Testes' },
                { id: 'custom' as const, label: 'Customizadas' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={categoryTab === tab.id}
                  onClick={() => setCategoryTab(tab.id)}
                  className={`jarvis-segmented-btn ${categoryTab === tab.id ? 'is-active' : ''}`}
                  style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Barra de Filtros e Busca de Skills */}
            <div className="jarvis-filter-bar">
              <div className="jarvis-search-box" style={{ flex: 1, minWidth: 'min(100%, 220px)' }}>
                <Search size={15} />
                <input
                  type="text"
                  placeholder="Buscar por nome, ID ou descrição da skill..."
                  aria-label="Buscar habilidades"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="jarvis-search-box__input"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="btn btn-ghost btn-icon-sm"
                    aria-label="Limpar busca de habilidades"
                    style={{ width: '24px', height: '24px' }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Filter size={14} color="var(--text-muted)" />
                  <select
                    value={domainFilter}
                    onChange={(e) => setDomainFilter(e.target.value)}
                    aria-label="Filtrar por domínio"
                    className="jarvis-select"
                    style={{ width: 'auto', minWidth: '150px', fontSize: '0.8rem', padding: '7px 10px' }}
                  >
                    <option value="all">Todos os Domínios</option>
                    {domains.map((dom) => (
                      <option key={dom} value={dom}>
                        {dom.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
                  aria-label="Filtrar por status"
                  className="jarvis-select"
                  style={{ width: 'auto', minWidth: '140px', fontSize: '0.8rem', padding: '7px 10px' }}
                >
                  <option value="all">Todos os Status</option>
                  <option value="active">Apenas Ativas</option>
                  <option value="inactive">Apenas Desativadas</option>
                </select>
              </div>
            </div>

            {/* Grid de Skills */}
            {loading ? (
              <div className="jarvis-empty-state">
                <RefreshCw size={22} className="spin" color="var(--text-muted)" />
                <span style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                  Carregando catálogo de skills e vinculações...
                </span>
              </div>
            ) : catalogError ? (
              <div role="alert" className="jarvis-error-banner">
                O catálogo não pôde ser carregado. Atualize a página ou tente novamente.
              </div>
            ) : filteredSkills.length === 0 ? (
              <div className="jarvis-empty-state">
                <BookOpen size={28} color="var(--text-muted)" />
                <div style={{ fontSize: '0.94rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Nenhuma skill encontrada com os filtros selecionados
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Limpe a busca ou altere a categoria para visualizar outras habilidades disponíveis.
                </p>
              </div>
            ) : (
              <div className="jarvis-store-grid">
                {filteredSkills.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    agents={agents}
                    onToggle={handleToggle}
                    onEditAgents={(s) => setEditingSkill(s)}
                    onViewInstructions={(s) => setViewingSkillDetails(s)}
                    onDelete={canManageSkills ? handleDeleteSkill : undefined}
                    canManageSkills={canManageSkills}
                    isAdmin={isAdmin}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW 4: INTEGRAÇÕES REAIS & CONTEXT SETS */}
        {activeStoreTab === 'integrations' && (
          <IntegrationsHubPanel onSkillImported={loadData} />
        )}
      </div>

      {/* Modal: Conectar / Gerenciar App */}
      <Modal
        isOpen={Boolean(selectedAppForModal)}
        onClose={() => setSelectedAppForModal(null)}
        title={selectedAppForModal?.name || 'Conector'}
        subtitle={
          selectedAppForModal && connectedApps.includes(selectedAppForModal.id)
            ? 'Conector ativo e sincronizado'
            : 'Conectar nova ferramenta'
        }
        icon={selectedAppForModal ? renderAppIcon(selectedAppForModal.iconType, 32) : undefined}
        maxWidth="sm"
        footer={
          selectedAppForModal ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%', flexWrap: 'wrap' }}>
              {connectedApps.includes(selectedAppForModal.id) && (
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
                {connectingApp ? 'Conectando...' : 'Salvar & Conectar'}
              </button>
            </div>
          ) : undefined
        }
      >
        {selectedAppForModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
              {selectedAppForModal.description}. Autorize o JARVIS AI Hub a interagir com este serviço através das suas chaves de API ou webhook seguro.
            </p>

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

      {/* Modal de Detalhes e Diretrizes da Skill */}
      {viewingSkillDetails && (
        <SkillDetailsModal
          isOpen={true}
          onClose={() => setViewingSkillDetails(null)}
          skill={viewingSkillDetails}
          onEditAgents={(s) => setEditingSkill(s)}
          canManageSkills={canManageSkills}
        />
      )}

      {/* Modal de Vinculação de Agentes da Skill */}
      {canManageSkills && editingSkill && (
        <SkillAgentModal
          isOpen={true}
          onClose={() => setEditingSkill(null)}
          skill={editingSkill}
          agents={agents}
          onSaved={loadData}
        />
      )}

      {/* Modal de Criação / Importação de Skill ECC */}
      {canManageSkills && showCreateModal && (
        <CreateSkillModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          agents={agents}
          onSkillCreated={loadData}
          initialTab={createModalTab}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(pendingDeleteSkill)}
        title="Excluir habilidade"
        description={
          pendingDeleteSkill ? (
            <>
              Tem certeza que deseja excluir a habilidade <strong>{pendingDeleteSkill.name}</strong>? Esta ação não pode ser desfeita.
            </>
          ) : null
        }
        confirmLabel="Excluir"
        tone="danger"
        isLoading={deletingSkill}
        onConfirm={confirmDeleteSkill}
        onCancel={() => setPendingDeleteSkill(null)}
      />
    </div>
  );
};
