import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  GitBranch,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Upload,
  X,
} from 'lucide-react';
import {
  deleteUserSkill,
  fetchAgents,
  fetchSkills,
  toggleSkill,
} from '../../api';
import { API_BASE } from '../../services/api/client';
import { apiFetch } from '../../services/sessionTransport';
import type { AgentInfo, SkillInfo } from '../../types';
import {
  countStoreSkillsByCategory,
  filterStoreSkills,
  isSkillActive,
  type SkillCategoryFilter,
  type SkillStatusFilter,
} from '../../services/unifiedStoreEngine';
import { PageHeader } from '../../shared/layout/PageHeader';
import { SkillCard } from './SkillCard';
import { SkillAgentModal } from './SkillAgentModal';
import { CreateSkillModal } from './CreateSkillModal';
import { SkillDetailsModal } from './SkillDetailsModal';
import { ConfirmDialog } from '../../shared/common/ConfirmDialog';
import { notify } from '../../shared/common/Toast';

interface SkillsCatalogPanelProps {
  onSkillsCountChange?: (total: number, active: number) => void;
  compactHeader?: boolean;
  onOpenStore?: () => void;
  onOpenGitHubImport?: () => void;
  variant?: 'panel' | 'store';
}

const CATEGORY_TABS: Array<{ id: SkillCategoryFilter; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'arch', label: 'Arquitetura & Dev' },
  { id: 'sec', label: 'Segurança' },
  { id: 'qa', label: 'Qualidade & QA' },
  { id: 'custom', label: 'Personalizadas' },
];

export const SkillsCatalogPanel: React.FC<SkillsCatalogPanelProps> = ({
  onSkillsCountChange,
  compactHeader = false,
  onOpenStore,
  onOpenGitHubImport,
  variant = 'panel',
}) => {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canManageSkills, setCanManageSkills] = useState(false);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<SkillCategoryFilter>('all');
  const [status, setStatus] = useState<SkillStatusFilter>('all');

  const [editingSkill, setEditingSkill] = useState<SkillInfo | null>(null);
  const [viewingSkill, setViewingSkill] = useState<SkillInfo | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTab, setCreateTab] = useState<'create' | 'import'>('create');
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const onSkillsCountChangeRef = useRef(onSkillsCountChange);
  onSkillsCountChangeRef.current = onSkillsCountChange;

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [skillsData, agentsData] = await Promise.all([
        fetchSkills(),
        fetchAgents().catch(() => [] as AgentInfo[]),
      ]);
      const list = Array.isArray(skillsData) ? skillsData : [];
      setSkills(list);
      setAgents(Array.isArray(agentsData) ? agentsData : []);
      if (onSkillsCountChangeRef.current) {
        onSkillsCountChangeRef.current(list.length, list.filter(isSkillActive).length);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar catálogo de habilidades.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    apiFetch(`${API_BASE}/auth/me`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((principal) => {
        if (!active) return;
        const admin = principal?.kind === 'human' && principal?.role === 'admin';
        const perms: string[] = Array.isArray(principal?.permissions) ? principal.permissions : [];
        setIsAdmin(admin);
        setCanManageSkills(
          principal?.kind === 'human' &&
            (admin || perms.includes('*') || perms.includes('skills:write') || perms.includes('skills:read'))
        );
      })
      .catch(() => {
        if (active) {
          setIsAdmin(false);
          setCanManageSkills(true);
        }
      });

    void loadCatalog();
    return () => {
      active = false;
    };
  }, [loadCatalog]);

  const filtered = useMemo(
    () => filterStoreSkills(skills, { search, category, status }),
    [skills, search, category, status]
  );

  const categoryCounts = useMemo(() => {
    const statusFiltered = skills.filter((skill) => {
      const active = isSkillActive(skill);
      if (status === 'active' && !active) return false;
      if (status === 'inactive' && active) return false;
      return true;
    });
    return countStoreSkillsByCategory(statusFiltered);
  }, [skills, status]);

  const activeCount = useMemo(() => skills.filter(isSkillActive).length, [skills]);

  const handleToggle = async (id: string) => {
    try {
      await toggleSkill(id);
      notify('Status da habilidade atualizado.', 'success');
      await loadCatalog();
    } catch (err: any) {
      notify(err?.message || 'Não foi possível alternar esta habilidade.', 'error');
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteUserSkill(pendingDelete.id);
      notify(`Habilidade "${pendingDelete.name}" removida.`, 'info');
      setPendingDelete(null);
      await loadCatalog();
    } catch (err: any) {
      notify(err?.message || 'Erro ao excluir habilidade.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const actionButtons = (
    <>
      {onOpenStore && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenStore}>
          <Layers size={14} />
          <span>Explorar na Loja Unificada</span>
        </button>
      )}
      {onOpenGitHubImport && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenGitHubImport}>
          <GitBranch size={14} />
          <span>Importar GitHub</span>
        </button>
      )}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => {
          setCreateTab('import');
          setShowCreateModal(true);
        }}
      >
        <Upload size={14} />
        <span>Importar ECC / MD</span>
      </button>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => {
          setCreateTab('create');
          setShowCreateModal(true);
        }}
      >
        <Plus size={14} />
        <span>Nova Habilidade</span>
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-icon-sm"
        onClick={() => void loadCatalog()}
        disabled={loading}
        aria-label="Atualizar catálogo de habilidades"
        title="Atualizar catálogo de habilidades"
      >
        <RefreshCw size={14} className={loading ? 'spin' : ''} />
      </button>
    </>
  );

  return (
    <div className="jarvis-store-controls" style={{ gap: '18px' }}>
      {variant === 'store' ? (
        <PageHeader
          variant="flat"
          icon={<BookOpen size={16} />}
          title="Catálogo de Habilidades (Skills)"
          subtitle="Ative playbooks especializados, importe receitas Markdown/ECC ou vincule habilidades diretamente aos seus agentes."
          meta={[
            <span key="active" className="jarvis-tabular">
              {activeCount}/{skills.length} ativas
            </span>,
            <span key="agents" className="jarvis-tabular">
              {agents.length} agentes na equipe
            </span>,
          ]}
          actions={actionButtons}
        />
      ) : (
        <div
          className="glass-panel"
          style={{
            padding: '16px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: compactHeader ? '1rem' : '1.1rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
              }}
            >
              Catálogo de Habilidades (Skills)
            </h2>
            <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Ative playbooks especializados, importe receitas Markdown/ECC ou vincule habilidades aos seus agentes.{' '}
              <strong className="tabular-nums" style={{ color: 'var(--success-text)' }}>
                {activeCount} de {skills.length} ativas
              </strong>
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {actionButtons}
          </div>
        </div>
      )}

      {/* Search + Status Row */}
      <div className="jarvis-store-search-row">
        <div className="jarvis-search-box jarvis-store-search-input">
          <Search size={15} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar habilidade por nome, domínio ou especialista..."
            aria-label="Buscar habilidades"
            className="jarvis-search-box__input"
          />
          {search && (
            <button
              type="button"
              className="btn btn-ghost btn-icon-sm"
              onClick={() => setSearch('')}
              aria-label="Limpar busca de habilidades"
              style={{ width: '24px', height: '24px' }}
            >
              <X size={13} />
            </button>
          )}
        </div>

        <div className="jarvis-segmented" role="group" aria-label="Filtrar por status">
          {([
            { id: 'all', label: 'Todos' },
            { id: 'active', label: 'Ativas' },
            { id: 'inactive', label: 'Inativas' },
          ] as const).map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => setStatus(st.id)}
              className={`jarvis-segmented-btn ${status === st.id ? 'is-active' : ''}`}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      {/* Category Filter Tabs with Counts */}
      <div
        className="jarvis-segmented jarvis-store-segmented"
        role="group"
        aria-label="Filtrar por categoria"
      >
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setCategory(tab.id)}
            className={`jarvis-segmented-btn ${category === tab.id ? 'is-active' : ''}`}
          >
            <span>
              {tab.label} ({categoryCounts[tab.id] ?? 0})
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div className="jarvis-inline-alert is-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="jarvis-pack-loading">
          <Loader2 size={18} className="spin" />
          <span>Carregando habilidades dos agentes...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="jarvis-pack-empty glass-panel">
          <BookOpen size={24} />
          <h3>Nenhuma habilidade encontrada</h3>
          <p>Ajuste os filtros ou crie sua própria habilidade personalizada para os agentes.</p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setSearch('');
              setCategory('all');
              setStatus('all');
            }}
          >
            Limpar filtros
          </button>
        </div>
      ) : (
        <div className="jarvis-store-grid">
          {filtered.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              agents={agents}
              onToggle={(id) => void handleToggle(id)}
              onEditAgents={(s) => setEditingSkill(s)}
              onViewInstructions={(s) => setViewingSkill(s)}
              onDelete={(id, name) => setPendingDelete({ id, name })}
              canManageSkills={canManageSkills}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}

      <SkillAgentModal
        isOpen={Boolean(editingSkill)}
        onClose={() => setEditingSkill(null)}
        skill={editingSkill}
        agents={agents}
        onSaved={() => {
          setEditingSkill(null);
          void loadCatalog();
        }}
      />

      <SkillDetailsModal
        isOpen={Boolean(viewingSkill)}
        onClose={() => setViewingSkill(null)}
        skill={viewingSkill}
        canManageSkills={canManageSkills}
        onEditAgents={(s) => {
          setViewingSkill(null);
          setEditingSkill(s);
        }}
      />

      <CreateSkillModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        agents={agents}
        initialTab={createTab}
        onSkillCreated={() => {
          setShowCreateModal(false);
          void loadCatalog();
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        title="Excluir habilidade"
        description={
          pendingDelete ? (
            <>
              Deseja remover a habilidade personalizada <strong>{pendingDelete.name}</strong>?
            </>
          ) : null
        }
        confirmLabel="Excluir"
        tone="danger"
        isLoading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
};
