import React, { useMemo, useState } from 'react';
import {
  Eye,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { AgentInfo } from '../../types';
import {
  AGENT_TEMPLATE_LIBRARY,
  AgentTemplate,
  AgentTemplateCategory,
  TEMPLATE_CATEGORY_TABS,
  canUninstallAgent,
  filterAgentTemplates,
  findInstalledAgentForTemplate,
  isTemplateInstalled,
} from '../../services/agentTemplates';
import { deleteAgent } from '../../services/api/agents';
import { MascotAvatar } from '../../shared/common/MascotAvatar';
import { ConfirmDialog } from '../../shared/common/ConfirmDialog';
import { notify } from '../../shared/common/Toast';
import { AgentTemplatePreviewModal } from './AgentTemplatePreviewModal';

interface AgentTemplateStoreGridProps {
  installedAgents: AgentInfo[];
  onRefreshAgents: () => Promise<void> | void;
  onOpenChat?: (agent: AgentInfo) => void;
  variant?: 'default' | 'store';
}

const CATEGORY_SHORT_BADGES: Record<Exclude<AgentTemplateCategory, 'all'>, string> = {
  dia_a_dia: 'DIA A DIA',
  estudos: 'ESTUDOS',
  financas: 'FINANÇAS',
  criativo: 'CRIATIVO',
  dados: 'DADOS & BI',
  tecnologia: 'ENGENHARIA',
  seguranca: 'SEGURANÇA',
};

const STORE_TAB_SHORT_LABELS: Record<AgentTemplateCategory, string> = {
  all: 'Todos',
  dia_a_dia: 'Dia a Dia',
  estudos: 'Estudos',
  financas: 'Finanças',
  criativo: 'Criativo',
  dados: 'Dados & BI',
  tecnologia: 'Engenharia',
  seguranca: 'Segurança',
};

export const AgentTemplateStoreGrid: React.FC<AgentTemplateStoreGridProps> = ({
  installedAgents,
  onRefreshAgents,
  onOpenChat,
  variant = 'store',
}) => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<AgentTemplateCategory>('all');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<AgentTemplate | null>(null);
  const [pendingUninstall, setPendingUninstall] = useState<{
    agent: AgentInfo;
    displayName: string;
  } | null>(null);
  const [uninstalling, setUninstalling] = useState(false);

  const filteredTemplates = useMemo(
    () =>
      filterAgentTemplates(AGENT_TEMPLATE_LIBRARY, {
        query: search,
        category,
        onlyAvailable,
        installedAgents,
      }),
    [search, category, onlyAvailable, installedAgents]
  );

  const categoryCounts = useMemo(() => {
    const base = onlyAvailable
      ? AGENT_TEMPLATE_LIBRARY.filter((tpl) => !isTemplateInstalled(tpl, installedAgents))
      : AGENT_TEMPLATE_LIBRARY;
    const counts: Record<AgentTemplateCategory, number> = {
      all: base.length,
      dia_a_dia: 0,
      estudos: 0,
      financas: 0,
      criativo: 0,
      dados: 0,
      tecnologia: 0,
      seguranca: 0,
    };
    for (const tpl of base) {
      counts[tpl.category] = (counts[tpl.category] || 0) + 1;
    }
    return counts;
  }, [onlyAvailable, installedAgents]);

  const handleConfirmUninstall = async () => {
    if (!pendingUninstall) return;
    setUninstalling(true);
    try {
      await deleteAgent(pendingUninstall.agent.role);
      notify(`${pendingUninstall.displayName} desinstalado da sua equipe.`, 'info');
      setPendingUninstall(null);
      await onRefreshAgents();
      window.dispatchEvent(new CustomEvent('jarvis:agents-updated'));
    } catch (err: any) {
      notify(err?.message || 'Não foi possível desinstalar o agente.', 'error');
    } finally {
      setUninstalling(false);
    }
  };

  return (
    <div className="jarvis-store-controls" style={{ gap: '16px' }}>
      {/* Barra de Busca e Filtro Disponíveis */}
      <div className="jarvis-store-search-row">
        <div className="jarvis-search-box jarvis-store-search-input">
          <Search size={15} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar agente por nome, especialidade ou missão..."
            aria-label="Buscar templates de agentes prontos"
            className="jarvis-search-box__input"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="btn btn-ghost btn-icon-sm"
              aria-label="Limpar busca de templates"
              style={{ width: '24px', height: '24px', padding: 0 }}
            >
              <X size={13} />
            </button>
          )}
        </div>

        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '7px',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => setOnlyAvailable(e.target.checked)}
          />
          <span>Somente não instalados</span>
        </label>
      </div>

      {/* Abas de Categoria com Contagem */}
      <div
        className="jarvis-segmented jarvis-store-segmented"
        role="tablist"
        aria-label="Categorias da biblioteca de agentes prontos"
      >
        {TEMPLATE_CATEGORY_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={category === tab.id}
            onClick={() => setCategory(tab.id)}
            className={`jarvis-segmented-btn ${category === tab.id ? 'is-active' : ''}`}
          >
            <span>
              {(variant === 'store' ? STORE_TAB_SHORT_LABELS[tab.id] : tab.label)} ({categoryCounts[tab.id] ?? 0})
            </span>
          </button>
        ))}
      </div>

      {/* Grid de Cards em 2 Colunas */}
      {filteredTemplates.length === 0 ? (
        <div className="jarvis-empty-state">
          <Sparkles size={22} color="var(--text-muted)" />
          <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
            Nenhum agente pronto encontrado com esses filtros.
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={() => {
              setSearch('');
              setCategory('all');
              setOnlyAvailable(false);
            }}
          >
            Mostrar todos os agentes
          </button>
        </div>
      ) : (
        <div className="jarvis-store-grid" data-store-variant={variant}>
          {filteredTemplates.map((tpl) => {
            const installedMatch = findInstalledAgentForTemplate(tpl, installedAgents);
            const isInstalled = Boolean(installedMatch);
            const allowUninstall = installedMatch ? canUninstallAgent(installedMatch) : false;

            return (
              <article
                key={tpl.templateId}
                className={`jarvis-store-card ${isInstalled ? 'is-installed' : ''}`}
              >
                {/* Cabeçalho: Avatar + Título/Subtítulo + Tag Uppercase */}
                <div className="jarvis-store-card__header">
                  <div className="jarvis-store-card__identity">
                    <MascotAvatar
                      mascot={tpl.mascot}
                      role={tpl.role}
                      name={tpl.proper_name}
                      size={40}
                    />
                    <div className="jarvis-store-card__titles">
                      <div className="jarvis-store-card__title-row">
                        <h3 className="jarvis-store-card__title">{tpl.proper_name}</h3>
                        <span className="jarvis-store-card__handle">{tpl.handle}</span>
                      </div>
                      <div className="jarvis-store-card__subtitle">{tpl.title}</div>
                    </div>
                  </div>

                  <span
                    className={`jarvis-store-card__badge ${isInstalled ? 'is-active' : ''}`}
                  >
                    {isInstalled ? 'INSTALADO' : CATEGORY_SHORT_BADGES[tpl.category]}
                  </span>
                </div>

                {/* Descrição concisa */}
                <p className="jarvis-store-card__desc">{tpl.tagline || tpl.mission}</p>

                {/* Rodapé de Ações */}
                <div className="jarvis-store-card__footer">
                  {!isInstalled ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm jarvis-store-card__primary-btn"
                        onClick={() => setPreviewTemplate(tpl)}
                      >
                        <Plus size={14} />
                        <span>Instalar na equipe</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm jarvis-store-card__secondary-btn"
                        onClick={() => setPreviewTemplate(tpl)}
                      >
                        <span className="jarvis-tabular">{tpl.skills.length} skills</span>
                      </button>
                    </>
                  ) : (
                    <>
                      {onOpenChat && installedMatch ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm jarvis-store-card__primary-btn"
                          onClick={() => onOpenChat(installedMatch)}
                        >
                          <MessageSquare size={14} />
                          <span>Conversar</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm jarvis-store-card__primary-btn"
                          onClick={() => setPreviewTemplate(tpl)}
                        >
                          <Eye size={14} />
                          <span>Ver habilidades</span>
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn btn-ghost btn-sm jarvis-store-card__secondary-btn"
                        onClick={() => setPreviewTemplate(tpl)}
                      >
                        <span>Habilidades</span>
                      </button>

                      {installedMatch && allowUninstall && (
                        <button
                          type="button"
                          className="btn btn-danger-ghost btn-icon-sm"
                          title={`Desinstalar ${tpl.proper_name}`}
                          aria-label={`Desinstalar ${tpl.proper_name}`}
                          onClick={() =>
                            setPendingUninstall({
                              agent: installedMatch,
                              displayName: installedMatch.proper_name || tpl.proper_name,
                            })
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Modal de Prévia de Habilidades & Instalação */}
      <AgentTemplatePreviewModal
        template={previewTemplate}
        installedAgent={
          previewTemplate
            ? findInstalledAgentForTemplate(previewTemplate, installedAgents) || null
            : null
        }
        onClose={() => setPreviewTemplate(null)}
        onChanged={onRefreshAgents}
        onOpenChat={onOpenChat}
      />

      {/* Confirmação Segura de Desinstalação */}
      <ConfirmDialog
        isOpen={Boolean(pendingUninstall)}
        title={`Desinstalar ${pendingUninstall?.displayName || 'agente'}?`}
        description={
          <>
            O especialista{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              {pendingUninstall?.displayName}
            </strong>{' '}
            será removido da sua equipe ativa para manter seu hub limpo. Você poderá reinstalá-lo a
            qualquer momento na Loja de Agentes Prontos.
          </>
        }
        confirmLabel="Desinstalar agente"
        cancelLabel="Manter instalado"
        tone="danger"
        isLoading={uninstalling}
        onCancel={() => setPendingUninstall(null)}
        onConfirm={handleConfirmUninstall}
      />
    </div>
  );
};
