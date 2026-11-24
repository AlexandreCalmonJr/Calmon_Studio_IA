import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Cpu,
  Download,
  Layers,
  Loader2,
  Package,
  Plug,
  Search,
  Sparkles,
  Trash2,
  Wrench,
} from 'lucide-react';
import {
  MODULE_PACK_CATEGORY_LABELS,
  type ModulePackCategory,
  type ModulePackWithState,
} from '../../services/modulePackEngine';
import {
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
  type UnifiedStoreSection,
} from '../../services/unifiedStoreEngine';
import { AgentCoreInspectorModal } from '../agents/AgentCoreInspectorModal';
import { AgentTemplateStoreGrid } from '../agents/AgentTemplateStoreGrid';
import { SkillsCatalogPanel } from '../skills/SkillsCatalogPanel';
import { IntegrationsHubPanel } from '../skills/IntegrationsHubPanel';

interface PackStoreViewProps {
  onNavigate: (tab: string) => void;
  canManagePacks?: boolean;
  initialSection?: UnifiedStoreSection;
}

type FilterOption = 'all' | 'installed' | 'custom' | ModulePackCategory;

const FILTER_OPTIONS: Array<{ id: FilterOption; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'installed', label: 'Instalados' },
  { id: 'custom', label: 'Personalizados' },
  { id: 'engineering', label: MODULE_PACK_CATEGORY_LABELS.engineering },
  { id: 'development', label: MODULE_PACK_CATEGORY_LABELS.development },
  { id: 'security', label: MODULE_PACK_CATEGORY_LABELS.security },
  { id: 'productivity', label: MODULE_PACK_CATEGORY_LABELS.productivity },
  { id: 'infrastructure', label: MODULE_PACK_CATEGORY_LABELS.infrastructure },
];

export const PackStoreView: React.FC<PackStoreViewProps> = ({
  onNavigate,
  canManagePacks = false,
  initialSection = 'packs',
}) => {
  const [activeSection, setActiveSection] = useState<UnifiedStoreSection>(initialSection);
  const [payload, setPayload] = useState<ModulePacksPayload | null>(null);
  const [skillsSnapshot, setSkillsSnapshot] = useState<SkillInfo[]>([]);
  const [installedAgents, setInstalledAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPackId, setBusyPackId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<FilterOption>('all');
  const [expandedPacks, setExpandedPacks] = useState<Record<string, boolean>>({});
  const [inspectingAgent, setInspectingAgent] = useState<{
    role: string;
    name: string;
    handle: string;
  } | null>(null);

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

  useEffect(() => {
    void loadStoreData();
  }, [loadStoreData]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível remover o pacote.');
    } finally {
      setBusyPackId(null);
    }
  };

  const filteredPacks = useMemo(() => {
    const list = payload?.packs || [];
    const q = search.trim().toLowerCase();
    return list.filter((pack) => {
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
  }, [payload, search, categoryFilter]);

  const summary = payload?.summary;
  const unifiedSummary = useMemo(
    () =>
      computeUnifiedStoreSummary({
        packs: payload?.packs || [],
        skills: skillsSnapshot,
        templatesCount: AGENT_TEMPLATE_LIBRARY.length,
        connectedAppsCount: 7,
        totalAppsCount: 15,
      }),
    [payload, skillsSnapshot]
  );

  return (
    <div className="jarvis-pack-store-page">
      <header className="jarvis-pack-store-header">
        <div className="jarvis-pack-store-copy">
          <h1 className="jarvis-pack-store-title">Loja Unificada — Pacotes, Núcleos & Habilidades</h1>
          <p className="jarvis-pack-store-subtitle">
            Tudo o que expande seu assistente em um só lugar: instale pacotes modulares com núcleos autônomos, ative habilidades (Skills), adicione especialistas prontos ou conecte apps e servidores MCP.
          </p>
        </div>

        <div className="jarvis-pack-header-actions">
          {canManagePacks && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => onNavigate('pack_studio')}
            >
              <Wrench size={15} />
              <span>Estúdio de Pacotes (Admin)</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onNavigate('architecture')}
          >
            <Compass size={15} />
            <span>Agente de Arquitetura</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onNavigate('agents')}
          >
            <Cpu size={15} />
            <span>Central de Agentes</span>
          </button>
        </div>
      </header>

      {/* Unified Store Department Switcher */}
      <nav
        className="jarvis-unified-store-tabs"
        role="tablist"
        aria-label="Departamentos da Loja Unificada"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === 'packs'}
          className={`jarvis-unified-store-tab ${activeSection === 'packs' ? 'is-active' : ''}`}
          onClick={() => setActiveSection('packs')}
        >
          <Package size={15} />
          <span>Pacotes & Núcleos</span>
          <span className="jarvis-unified-store-tab__count">
            {unifiedSummary.installedPacks}/{unifiedSummary.totalPacks}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeSection === 'skills'}
          className={`jarvis-unified-store-tab ${activeSection === 'skills' ? 'is-active' : ''}`}
          onClick={() => setActiveSection('skills')}
        >
          <Layers size={15} />
          <span>Habilidades (Skills)</span>
          <span className="jarvis-unified-store-tab__count">
            {unifiedSummary.activeSkills}/{unifiedSummary.totalSkills}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeSection === 'templates'}
          className={`jarvis-unified-store-tab ${activeSection === 'templates' ? 'is-active' : ''}`}
          onClick={() => setActiveSection('templates')}
        >
          <Bot size={15} />
          <span>Templates de Agentes</span>
          <span className="jarvis-unified-store-tab__count">{unifiedSummary.totalTemplates}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeSection === 'apps'}
          className={`jarvis-unified-store-tab ${activeSection === 'apps' ? 'is-active' : ''}`}
          onClick={() => setActiveSection('apps')}
        >
          <Plug size={15} />
          <span>Apps & Conectores MCP</span>
          <span className="jarvis-unified-store-tab__count">MCP</span>
        </button>
      </nav>

      {/* Unified KPI Strip */}
      <section className="jarvis-pack-summary-strip" aria-label="Resumo da Loja Unificada">
        <div className="jarvis-pack-stat glass-card">
          <span className="jarvis-pack-stat-label">Pacotes ativos</span>
          <strong className="jarvis-pack-stat-value tabular-nums">
            {summary ? `${summary.installedCount} / ${summary.totalPacks}` : `${unifiedSummary.installedPacks} / ${unifiedSummary.totalPacks}`}
          </strong>
        </div>
        <div className="jarvis-pack-stat glass-card">
          <span className="jarvis-pack-stat-label">Habilidades ativas</span>
          <strong className="jarvis-pack-stat-value tabular-nums">
            {unifiedSummary.activeSkills} / {unifiedSummary.totalSkills}
          </strong>
        </div>
        <div className="jarvis-pack-stat glass-card">
          <span className="jarvis-pack-stat-label">Agentes com núcleo próprio</span>
          <strong className="jarvis-pack-stat-value tabular-nums">
            {summary?.bundledAgentsCount ?? 0}
          </strong>
        </div>
        <div className="jarvis-pack-stat glass-card">
          <span className="jarvis-pack-stat-label">Módulos & Trilhas</span>
          <strong className="jarvis-pack-stat-value tabular-nums">
            {(summary?.unlockedModulesCount ?? 0) + (summary?.studyTracksCount ?? 0)}
          </strong>
        </div>
      </section>

      {/* DEPARTMENT 1: PACOTES & NÚCLEOS */}
      {activeSection === 'packs' && (
        <>
          <section className="jarvis-pack-controls" aria-label="Filtros de pacotes">
            <label className="jarvis-pack-search-wrap">
              <Search size={15} className="jarvis-pack-search-icon" />
              <input
                type="search"
                className="jarvis-input jarvis-pack-search-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar pacote, agente (ex.: Arquiteto, Vetor), módulo ou trilha..."
                aria-label="Buscar pacotes modulares"
              />
            </label>

            <div className="jarvis-pack-filter-bar" role="group" aria-label="Filtrar por categoria">
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setCategoryFilter(opt.id)}
                  className={`jarvis-pack-filter-btn ${categoryFilter === opt.id ? 'is-active' : ''}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

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
            <div className="jarvis-pack-grid">
              {filteredPacks.map((pack) => {
                const isBusy = busyPackId === pack.id;
                const isExpanded = Boolean(expandedPacks[pack.id]);

                return (
                  <article
                    key={pack.id}
                    className={`jarvis-pack-card glass-card ${pack.installed ? 'is-installed' : ''}`}
                    data-pack-id={pack.id}
                  >
                    <div className="jarvis-pack-card-top">
                      <div className="jarvis-kicker-text">
                        <span>{pack.category_label}</span>
                        <span aria-hidden="true"> · </span>
                        <span className="mono tabular-nums">v{pack.version}</span>
                        {pack.is_custom && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="jarvis-text-accent">Personalizado</span>
                          </>
                        )}
                        <span aria-hidden="true"> · </span>
                        <span className={pack.installed ? 'jarvis-text-success' : ''}>
                          {pack.installed ? 'Instalado' : 'Disponível'}
                        </span>
                      </div>

                      <h2 className="jarvis-pack-card-title">{pack.name}</h2>
                      <p className="jarvis-pack-card-tagline">{pack.tagline}</p>
                      <p className="jarvis-pack-card-desc">{pack.description}</p>
                    </div>

                    <div className="jarvis-pack-spec-block">
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
                                  {' '}
                                  ·{' '}
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

                      <button
                        type="button"
                        className="jarvis-pack-expand-btn"
                        aria-expanded={isExpanded}
                        onClick={() =>
                          setExpandedPacks((prev) => ({ ...prev, [pack.id]: !prev[pack.id] }))
                        }
                      >
                        <BookOpen size={14} />
                        <span>
                          Trilhas de estudo ({pack.study_tracks.length}) e habilidades ({pack.skills.length})
                        </span>
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>

                      {isExpanded && (
                        <div className="jarvis-pack-details">
                          <div className="jarvis-pack-detail-group">
                            <span className="jarvis-pack-spec-label">Trilhas enviadas para Conhecimento</span>
                            <ul className="jarvis-pack-ul">
                              {pack.study_tracks.map((track) => (
                                <li key={track.id}>
                                  <strong>{track.title}</strong> — {track.summary}
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="jarvis-pack-detail-group">
                            <span className="jarvis-pack-spec-label">Habilidades & Presets MCP</span>
                            <p className="jarvis-pack-inline-prose">{pack.skills.join(' · ')}</p>
                            <p className="jarvis-pack-inline-prose mono">
                              MCP: {pack.mcp_presets.join(', ')}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    <footer className="jarvis-pack-card-footer">
                      {pack.installed ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onNavigate(pack.tabs[0] || 'agents')}
                          >
                            <ArrowUpRight size={14} />
                            <span>Abrir {pack.tab_labels[pack.tabs[0]] || 'módulo'}</span>
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm jarvis-danger-text-btn"
                            disabled={isBusy}
                            onClick={() => void handleUninstall(pack)}
                          >
                            {isBusy ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                            <span>{isBusy ? 'Removendo...' : 'Remover pacote'}</span>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={isBusy}
                          onClick={() => void handleInstall(pack)}
                        >
                          {isBusy ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                          <span>{isBusy ? 'Instalando...' : `Instalar ${pack.name}`}</span>
                        </button>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* DEPARTMENT 2: HABILIDADES (SKILLS) UNIFICADAS */}
      {activeSection === 'skills' && (
        <SkillsCatalogPanel
          onSkillsCountChange={() => {
            void fetchSkills()
              .then((s) => setSkillsSnapshot(Array.isArray(s) ? s : []))
              .catch(() => {});
          }}
        />
      )}

      {/* DEPARTMENT 3: TEMPLATES DE AGENTES */}
      {activeSection === 'templates' && (
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ marginBottom: '14px' }}>
            <h2 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={16} color="var(--accent-light)" />
              <span>Biblioteca de Especialistas Prontos</span>
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Adicione novos agentes à sua equipe em 1 clique — cada especialista já vem com missão, ferramentas e modelo recomendados.
            </p>
          </div>
          <AgentTemplateStoreGrid
            installedAgents={installedAgents}
            onRefreshAgents={async () => {
              const updated = await fetchAgents().catch(() => [] as AgentInfo[]);
              setInstalledAgents(Array.isArray(updated) ? updated : []);
            }}
            onOpenChat={() => onNavigate('chat')}
          />
        </div>
      )}

      {/* DEPARTMENT 4: APPS & CONECTORES MCP */}
      {activeSection === 'apps' && (
        <div className="glass-panel" style={{ padding: '20px' }}>
          <IntegrationsHubPanel />
        </div>
      )}

      {inspectingAgent && (
        <AgentCoreInspectorModal
          isOpen={Boolean(inspectingAgent)}
          agentRole={inspectingAgent.role}
          agentName={inspectingAgent.name}
          agentHandle={inspectingAgent.handle}
          onClose={() => setInspectingAgent(null)}
        />
      )}
    </div>
  );
};
