import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Cpu,
  Edit3,
  Layers,
  Loader2,
  Package,
  Plus,
  Save,
  Server,
  Trash2,
  Wrench,
} from 'lucide-react';
import {
  ALL_MODULAR_TABS_CATALOG,
  MODULAR_TAB_LABEL_MAP,
  MODULE_PACK_CATEGORY_LABELS,
  normalizePackSlug,
  type CustomPackDraftInput,
  type ModulePackCategory,
  type ModulePackDefinition,
  type PackBundledAgentSpec,
  type PackStudyTrackSpec,
} from '../../services/modulePackEngine';
import { KNOWN_MCP_SERVERS } from '../../services/agentCoreEngine';
import {
  deleteAdminCustomPack,
  fetchAdminCustomPacks,
  saveAdminCustomPack,
} from '../../services/api/packs';
import { PackStudioUpdatesPanel } from './PackStudioUpdatesPanel';
import { PageHeader } from '../../shared/layout/PageHeader';

interface PackStudioAdminViewProps {
  onNavigate: (tab: string) => void;
}

interface AgentDraftRow {
  proper_name: string;
  name: string;
  handle: string;
  role: string;
  mission: string;
  preferred_model: string;
  autonomy_level: PackBundledAgentSpec['autonomy_level'];
  skillsCsv: string;
}

interface StudyTrackDraftRow {
  title: string;
  level: PackStudyTrackSpec['level'];
  summary: string;
  markdown_content: string;
}

const EMPTY_AGENT_ROW: AgentDraftRow = {
  proper_name: '',
  name: '',
  handle: '',
  role: '',
  mission: '',
  preferred_model: 'gemini-4-hydrogen',
  autonomy_level: 'ask_approval',
  skillsCsv: '',
};

const EMPTY_TRACK_ROW: StudyTrackDraftRow = {
  title: '',
  level: 'intermediario',
  summary: '',
  markdown_content: '',
};

export const PackStudioAdminView: React.FC<PackStudioAdminViewProps> = ({ onNavigate }) => {
  const [customPacks, setCustomPacks] = useState<ModulePackDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Estado do formulário do pacote
  const [editingPackId, setEditingPackId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [packId, setPackId] = useState('');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ModulePackCategory>('engineering');
  const [version, setVersion] = useState('1.0.0');
  const [selectedTabs, setSelectedTabs] = useState<string[]>(['backend_studio', 'coding']);
  const [selectedMcp, setSelectedMcp] = useState<string[]>(['mcp_local_workspace']);
  const [skillsCsv, setSkillsCsv] = useState('Arquitetura Modular, Automação');
  const [workflowsCsv, setWorkflowsCsv] = useState('Revisão Contínua do Módulo');
  const [agents, setAgents] = useState<AgentDraftRow[]>([
    {
      proper_name: 'Kael',
      name: 'Especialista do Pacote',
      handle: '@kael',
      role: 'custom_specialist',
      mission: 'Executar tarefas técnicas especializadas com núcleo dedicado.',
      preferred_model: 'gemini-4-hydrogen',
      autonomy_level: 'ask_approval',
      skillsCsv: 'Arquitetura Modular',
    },
  ]);
  const [studyTracks, setStudyTracks] = useState<StudyTrackDraftRow[]>([]);

  const loadCustomPacks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminCustomPacks();
      setCustomPacks(data.custom_packs || []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Não foi possível carregar os pacotes personalizados.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCustomPacks();
  }, [loadCustomPacks]);

  const groupedTabs = useMemo(() => {
    const groups = new Map<string, Array<{ id: string; label: string }>>();
    for (const item of ALL_MODULAR_TABS_CATALOG) {
      const list = groups.get(item.group) || [];
      list.push({ id: item.id, label: item.label });
      groups.set(item.group, list);
    }
    return Array.from(groups.entries());
  }, []);

  const derivedSlug = useMemo(() => {
    return normalizePackSlug(packId || name || 'meu_pacote');
  }, [packId, name]);

  const resetForm = () => {
    setEditingPackId(null);
    setName('');
    setPackId('');
    setTagline('');
    setDescription('');
    setCategory('engineering');
    setVersion('1.0.0');
    setSelectedTabs(['backend_studio', 'coding']);
    setSelectedMcp(['mcp_local_workspace']);
    setSkillsCsv('Arquitetura Modular, Automação');
    setWorkflowsCsv('Revisão Contínua do Módulo');
    setAgents([
      {
        proper_name: 'Kael',
        name: 'Especialista do Pacote',
        handle: '@kael',
        role: 'custom_specialist',
        mission: 'Executar tarefas técnicas especializadas com núcleo dedicado.',
        preferred_model: 'gemini-4-hydrogen',
        autonomy_level: 'ask_approval',
        skillsCsv: 'Arquitetura Modular',
      },
    ]);
    setStudyTracks([]);
    setError(null);
  };

  const loadPackIntoForm = (pack: ModulePackDefinition) => {
    setEditingPackId(pack.id);
    setName(pack.name);
    setPackId(pack.id);
    setTagline(pack.tagline);
    setDescription(pack.description);
    setCategory(pack.category);
    setVersion(pack.version);
    setSelectedTabs([...pack.tabs]);
    setSelectedMcp(pack.mcp_presets.length > 0 ? [...pack.mcp_presets] : ['mcp_local_workspace']);
    setSkillsCsv(pack.skills.join(', '));
    setWorkflowsCsv(pack.workflows.join(', '));
    setAgents(
      pack.agents.map((ag) => ({
        proper_name: ag.proper_name,
        name: ag.name,
        handle: ag.handle,
        role: ag.role,
        mission: ag.mission,
        preferred_model: ag.preferred_model,
        autonomy_level: ag.autonomy_level,
        skillsCsv: ag.installed_skills.join(', '),
      }))
    );
    setStudyTracks(
      pack.study_tracks.map((tr) => ({
        title: tr.title,
        level: tr.level,
        summary: tr.summary,
        markdown_content: tr.markdown_content,
      }))
    );
    setFeedback(`Editando pacote "${pack.name}" (${pack.id}).`);
    setError(null);
  };

  const toggleTab = (tabId: string) => {
    setSelectedTabs((prev) =>
      prev.includes(tabId) ? prev.filter((id) => id !== tabId) : [...prev, tabId]
    );
  };

  const toggleMcp = (mcpId: string) => {
    setSelectedMcp((prev) =>
      prev.includes(mcpId) ? prev.filter((id) => id !== mcpId) : [...prev, mcpId]
    );
  };

  const updateAgentRow = (index: number, patch: Partial<AgentDraftRow>) => {
    setAgents((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const updateTrackRow = (index: number, patch: Partial<StudyTrackDraftRow>) => {
    setStudyTracks((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);

    if (name.trim().length < 3) {
      setError('Informe um nome de pacote com pelo menos 3 caracteres.');
      return;
    }

    const payload: CustomPackDraftInput = {
      id: editingPackId || derivedSlug,
      name: name.trim(),
      tagline: tagline.trim(),
      description: description.trim(),
      category,
      version: version.trim() || '1.0.0',
      tabs: selectedTabs,
      mcp_presets: selectedMcp,
      skills: skillsCsv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      workflows: workflowsCsv
        .split(',')
        .map((w) => w.trim())
        .filter(Boolean),
      agents: agents
        .filter((ag) => ag.proper_name.trim() || ag.name.trim())
        .map((ag) => ({
          proper_name: ag.proper_name.trim() || ag.name.trim(),
          name: ag.name.trim() || ag.proper_name.trim(),
          handle: ag.handle.trim(),
          role: ag.role.trim(),
          mission: ag.mission.trim(),
          preferred_model: ag.preferred_model.trim() || 'gemini-2.5-flash',
          autonomy_level: ag.autonomy_level,
          installed_skills: ag.skillsCsv
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        })),
      study_tracks: studyTracks
        .filter((tr) => tr.title.trim().length >= 3)
        .map((tr) => ({
          title: tr.title.trim(),
          level: tr.level,
          summary: tr.summary.trim(),
          markdown_content: tr.markdown_content,
        })),
    };

    setSaving(true);
    try {
      const res = await saveAdminCustomPack(payload, editingPackId);
      setCustomPacks(res.custom_packs || []);
      setFeedback(
        editingPackId
          ? `Pacote "${payload.name}" atualizado e publicado imediatamente na Loja de Pacotes.`
          : `Pacote "${payload.name}" criado e publicado na Loja de Pacotes! Você já pode instalá-lo em 1 clique.`
      );
      if (!editingPackId && res.pack?.id) {
        setEditingPackId(res.pack.id);
        setPackId(res.pack.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar o pacote personalizado.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (idToDelete: string) => {
    setDeletingId(idToDelete);
    setError(null);
    setFeedback(null);
    try {
      const res = await deleteAdminCustomPack(idToDelete);
      setCustomPacks(res.custom_packs || []);
      setConfirmDeleteId(null);
      if (editingPackId === idToDelete) {
        resetForm();
      }
      setFeedback(`Pacote "${idToDelete}" excluído do Estúdio e da Loja.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir pacote personalizado.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="jarvis-settings-container is-wide" style={{ paddingBottom: '36px' }}>
      <PageHeader
        icon={<Package size={18} />}
        title="Estúdio de Pacotes & Módulos"
        subtitle="Monte pacotes completos sob medida combinando telas da navegação lateral, agentes especialistas com núcleo próprio, habilidades, presets MCP e trilhas de estudo. Tudo publicado aqui aparece imediatamente na Loja de Pacotes."
        meta={[
          <span key="published-count" className="jarvis-tabular" style={{ fontFamily: 'var(--font-mono)' }}>
            {customPacks.length} publicado(s)
          </span>,
        ]}
        actions={
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onNavigate('brain_server')}
            >
              <Server size={14} />
              <span>Cérebros &amp; Servidor</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onNavigate('store')}
            >
              <Package size={14} />
              <span>Ver na Loja de Pacotes</span>
              <ArrowUpRight size={14} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={resetForm}>
              <Plus size={14} />
              <span>Novo Pacote</span>
            </button>
          </div>
        }
      />

      {error && (
        <div className="jarvis-inline-alert is-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      {feedback && (
        <div className="jarvis-inline-alert is-success" role="status">
          <Check size={16} />
          <span>{feedback}</span>
        </div>
      )}

      <PackStudioUpdatesPanel
        onUpdateApplied={(res) => {
          setError(null);
          setFeedback(res.message);
          if (res.custom_packs) {
            setCustomPacks(res.custom_packs);
          }
        }}
        onError={(msg) => setError(msg)}
      />

      <div className="jarvis-studio-layout">
        {/* Coluna Principal: Formulário Construtor */}
        <form className="jarvis-studio-form" onSubmit={handleSubmit}>
          <section className="jarvis-arch-panel">
            <h2 className="jarvis-arch-panel-title">
              <Wrench size={16} />
              <span>1. Identidade & Metadados do Pacote</span>
            </h2>

            <div className="jarvis-studio-grid-2">
              <div className="jarvis-schema-field">
                <label htmlFor="pack-studio-name">Nome do Pacote *</label>
                <input
                  id="pack-studio-name"
                  type="text"
                  required
                  className="jarvis-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Pacote Dados & Analytics"
                />
              </div>

              <div className="jarvis-schema-field">
                <label htmlFor="pack-studio-id">Identificador (Slug)</label>
                <input
                  id="pack-studio-id"
                  type="text"
                  className="jarvis-input mono"
                  disabled={Boolean(editingPackId)}
                  value={packId}
                  onChange={(e) => setPackId(e.target.value)}
                  placeholder={derivedSlug || 'dados_analytics'}
                />
              </div>

              <div className="jarvis-schema-field">
                <label htmlFor="pack-studio-category">Categoria</label>
                <select
                  id="pack-studio-category"
                  className="jarvis-input"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ModulePackCategory)}
                >
                  {(Object.keys(MODULE_PACK_CATEGORY_LABELS) as ModulePackCategory[]).map((cat) => (
                    <option key={cat} value={cat}>
                      {MODULE_PACK_CATEGORY_LABELS[cat]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="jarvis-schema-field">
                <label htmlFor="pack-studio-version">Versão</label>
                <input
                  id="pack-studio-version"
                  type="text"
                  className="jarvis-input mono"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="1.0.0"
                />
              </div>
            </div>

            <div className="jarvis-schema-field">
              <label htmlFor="pack-studio-tagline">Resumo curto (Tagline)</label>
              <input
                id="pack-studio-tagline"
                type="text"
                className="jarvis-input"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Ex.: Agentes de SQL, modelagem de dados e relatórios executivos."
              />
            </div>

            <div className="jarvis-schema-field">
              <label htmlFor="pack-studio-desc">Descrição completa</label>
              <textarea
                id="pack-studio-desc"
                rows={3}
                className="jarvis-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descreva o que este pacote desbloqueia, para quem é indicado e quais fluxos automatiza."
              />
            </div>
          </section>

          <section className="jarvis-arch-panel">
            <h2 className="jarvis-arch-panel-title">
              <Layers size={16} />
              <span>2. Módulos Desbloqueados na Barra Lateral ({selectedTabs.length})</span>
            </h2>

            <div className="jarvis-studio-tab-groups">
              {groupedTabs.map(([groupName, items]) => (
                <div key={groupName} className="jarvis-studio-tab-group">
                  <span className="jarvis-pack-spec-label">{groupName}</span>
                  <div className="jarvis-studio-check-list">
                    {items.map((tab) => (
                      <label key={tab.id} className="jarvis-schema-check-row">
                        <input
                          type="checkbox"
                          checked={selectedTabs.includes(tab.id)}
                          onChange={() => toggleTab(tab.id)}
                        />
                        <span>{tab.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="jarvis-arch-panel">
            <div className="jarvis-arch-panel-head jarvis-arch-panel-head-row">
              <h2 className="jarvis-arch-panel-title">
                <Cpu size={16} />
                <span>3. Agentes Inclusos com Núcleo Próprio ({agents.length})</span>
              </h2>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setAgents((prev) => [...prev, { ...EMPTY_AGENT_ROW }])}
              >
                <Plus size={14} />
                <span>Adicionar Agente</span>
              </button>
            </div>

            <div className="jarvis-studio-repeaters">
              {agents.map((ag, idx) => (
                <div key={idx} className="jarvis-studio-repeater-card">
                  <div className="jarvis-studio-repeater-head">
                    <strong>Agente #{idx + 1}</strong>
                    {agents.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm jarvis-danger-text-btn"
                        aria-label={`Remover agente ${idx + 1}`}
                        onClick={() => setAgents((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        <Trash2 size={14} />
                        <span>Remover</span>
                      </button>
                    )}
                  </div>

                  <div className="jarvis-studio-grid-2">
                    <div className="jarvis-schema-field">
                      <label htmlFor={`studio-ag-proper-${idx}`}>Nome próprio</label>
                      <input
                        id={`studio-ag-proper-${idx}`}
                        type="text"
                        className="jarvis-input"
                        value={ag.proper_name}
                        onChange={(e) => updateAgentRow(idx, { proper_name: e.target.value })}
                        placeholder="Ex.: Lumen"
                      />
                    </div>
                    <div className="jarvis-schema-field">
                      <label htmlFor={`studio-ag-handle-${idx}`}>@Handle</label>
                      <input
                        id={`studio-ag-handle-${idx}`}
                        type="text"
                        className="jarvis-input mono"
                        value={ag.handle}
                        onChange={(e) => updateAgentRow(idx, { handle: e.target.value })}
                        placeholder="@lumen"
                      />
                    </div>
                    <div className="jarvis-schema-field">
                      <label htmlFor={`studio-ag-title-${idx}`}>Especialidade / Cargo</label>
                      <input
                        id={`studio-ag-title-${idx}`}
                        type="text"
                        className="jarvis-input"
                        value={ag.name}
                        onChange={(e) => updateAgentRow(idx, { name: e.target.value })}
                        placeholder="Ex.: Analista de Dados & SQL"
                      />
                    </div>
                    <div className="jarvis-schema-field">
                      <label htmlFor={`studio-ag-model-${idx}`}>Modelo Preferido</label>
                      <input
                        id={`studio-ag-model-${idx}`}
                        type="text"
                        className="jarvis-input mono"
                        value={ag.preferred_model}
                        onChange={(e) => updateAgentRow(idx, { preferred_model: e.target.value })}
                        placeholder="gemini-2.5-flash"
                      />
                    </div>
                  </div>

                  <div className="jarvis-schema-field">
                    <label htmlFor={`studio-ag-mission-${idx}`}>Missão do Agente</label>
                    <input
                      id={`studio-ag-mission-${idx}`}
                      type="text"
                      className="jarvis-input"
                      value={ag.mission}
                      onChange={(e) => updateAgentRow(idx, { mission: e.target.value })}
                      placeholder="Descreva o foco e responsabilidade deste especialista."
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="jarvis-arch-panel">
            <h2 className="jarvis-arch-panel-title">
              <BookOpen size={16} />
              <span>4. Habilidades, MCPs & Trilhas de Estudo</span>
            </h2>

            <div className="jarvis-studio-grid-2">
              <div className="jarvis-schema-field">
                <label htmlFor="pack-studio-skills">Skills do Pacote (separadas por vírgula)</label>
                <input
                  id="pack-studio-skills"
                  type="text"
                  className="jarvis-input"
                  value={skillsCsv}
                  onChange={(e) => setSkillsCsv(e.target.value)}
                />
              </div>
              <div className="jarvis-schema-field">
                <label htmlFor="pack-studio-workflows">
                  Fluxos Sugeridos (separados por vírgula)
                </label>
                <input
                  id="pack-studio-workflows"
                  type="text"
                  className="jarvis-input"
                  value={workflowsCsv}
                  onChange={(e) => setWorkflowsCsv(e.target.value)}
                />
              </div>
            </div>

            <div className="jarvis-schema-mcp-block">
              <span className="jarvis-pack-spec-label">Presets MCP habilitados</span>
              <div className="jarvis-schema-mcp-grid">
                {KNOWN_MCP_SERVERS.map((srv) => (
                  <label key={srv.id} className="jarvis-schema-check-row">
                    <input
                      type="checkbox"
                      checked={selectedMcp.includes(srv.id)}
                      onChange={() => toggleMcp(srv.id)}
                    />
                    <span>{srv.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="jarvis-arch-panel-head jarvis-arch-panel-head-row">
              <span className="jarvis-pack-spec-label">
                Trilhas de Estudo enviadas para Conhecimento ({studyTracks.length})
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setStudyTracks((prev) => [...prev, { ...EMPTY_TRACK_ROW }])}
              >
                <Plus size={14} />
                <span>Adicionar Trilha</span>
              </button>
            </div>

            {studyTracks.length > 0 && (
              <div className="jarvis-studio-repeaters">
                {studyTracks.map((tr, idx) => (
                  <div key={idx} className="jarvis-studio-repeater-card">
                    <div className="jarvis-studio-repeater-head">
                      <strong>Trilha #{idx + 1}</strong>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm jarvis-danger-text-btn"
                        onClick={() => setStudyTracks((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        <Trash2 size={14} />
                        <span>Remover</span>
                      </button>
                    </div>
                    <div className="jarvis-studio-grid-2">
                      <div className="jarvis-schema-field">
                        <label htmlFor={`studio-tr-title-${idx}`}>Título da Trilha</label>
                        <input
                          id={`studio-tr-title-${idx}`}
                          type="text"
                          className="jarvis-input"
                          value={tr.title}
                          onChange={(e) => updateTrackRow(idx, { title: e.target.value })}
                          placeholder="Ex.: Guia Prático de Modelagem Dimensional"
                        />
                      </div>
                      <div className="jarvis-schema-field">
                        <label htmlFor={`studio-tr-level-${idx}`}>Nível</label>
                        <select
                          id={`studio-tr-level-${idx}`}
                          className="jarvis-input"
                          value={tr.level}
                          onChange={(e) =>
                            updateTrackRow(idx, {
                              level: e.target.value as PackStudyTrackSpec['level'],
                            })
                          }
                        >
                          <option value="essencial">Essencial</option>
                          <option value="intermediario">Intermediário</option>
                          <option value="avancado">Avançado</option>
                        </select>
                      </div>
                    </div>
                    <div className="jarvis-schema-field">
                      <label htmlFor={`studio-tr-summary-${idx}`}>Resumo</label>
                      <input
                        id={`studio-tr-summary-${idx}`}
                        type="text"
                        className="jarvis-input"
                        value={tr.summary}
                        onChange={(e) => updateTrackRow(idx, { summary: e.target.value })}
                        placeholder="Resumo objetivo do conteúdo desta trilha."
                      />
                    </div>
                    <div className="jarvis-schema-field">
                      <label htmlFor={`studio-tr-md-${idx}`}>Conteúdo Markdown</label>
                      <textarea
                        id={`studio-tr-md-${idx}`}
                        rows={3}
                        className="jarvis-input mono"
                        value={tr.markdown_content}
                        onChange={(e) => updateTrackRow(idx, { markdown_content: e.target.value })}
                        placeholder="# Título&#10;- Ponto 1&#10;- Ponto 2"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="jarvis-studio-submit-bar">
            <button type="button" className="btn btn-ghost" onClick={resetForm}>
              Limpar rascunho
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
              <span>
                {saving
                  ? 'Publicando...'
                  : editingPackId
                    ? 'Atualizar Pacote na Loja'
                    : 'Publicar Pacote na Loja'}
              </span>
            </button>
          </div>
        </form>

        {/* Coluna Direita: Pré-visualização + Lista Publicada */}
        <aside className="jarvis-studio-sidebar" aria-label="Pré-visualização e pacotes publicados">
          <section className="jarvis-arch-panel">
            <span className="jarvis-pack-spec-label">Pré-visualização na Loja</span>
            <div className="jarvis-studio-preview-card">
              <div className="jarvis-kicker-text">
                <span>{MODULE_PACK_CATEGORY_LABELS[category]}</span>
                <span aria-hidden="true"> · </span>
                <span className="mono">v{version || '1.0.0'}</span>
                <span aria-hidden="true"> · </span>
                <span className="jarvis-text-accent">Personalizado</span>
              </div>
              <h3 className="jarvis-pack-card-title">{name.trim() || 'Nome do Novo Pacote'}</h3>
              <p className="jarvis-pack-card-tagline">
                {tagline.trim() ||
                  `Pacote sob medida com ${selectedTabs.length} módulo(s) e ${agents.length} agente(s).`}
              </p>
              <div className="jarvis-studio-preview-meta">
                <span>
                  <strong>Módulos:</strong>{' '}
                  {selectedTabs.length > 0
                    ? selectedTabs.map((t) => MODULAR_TAB_LABEL_MAP[t] || t).join(' · ')
                    : 'Nenhum módulo selecionado'}
                </span>
                <span>
                  <strong>Agentes:</strong>{' '}
                  {agents
                    .filter((a) => a.proper_name || a.name)
                    .map((a) => `${a.proper_name || a.name} (${a.handle || '@agente'})`)
                    .join(', ') || 'Nenhum agente'}
                </span>
              </div>
            </div>
          </section>

          <section className="jarvis-arch-panel">
            <div className="jarvis-arch-panel-head">
              <h2 className="jarvis-arch-panel-title">
                <Package size={16} />
                <span>Pacotes Criados ({customPacks.length})</span>
              </h2>
            </div>

            {loading ? (
              <div className="jarvis-pack-loading">
                <Loader2 size={16} className="spin" />
                <span>Carregando pacotes...</span>
              </div>
            ) : customPacks.length === 0 ? (
              <p className="jarvis-arch-panel-sub">
                Nenhum pacote personalizado publicado ainda. Preencha o construtor ao lado e clique
                em <strong>Publicar Pacote na Loja</strong>.
              </p>
            ) : (
              <div className="jarvis-studio-saved-list">
                {customPacks.map((pack) => {
                  const isConfirming = confirmDeleteId === pack.id;
                  const isDeleting = deletingId === pack.id;
                  return (
                    <article key={pack.id} className="jarvis-studio-saved-item">
                      <div className="jarvis-kicker-text">
                        <span className="mono">{pack.id}</span>
                        <span aria-hidden="true"> · </span>
                        <span className="mono">v{pack.version}</span>
                      </div>
                      <h3 className="jarvis-studio-saved-name">{pack.name}</h3>
                      <p className="jarvis-studio-saved-meta">
                        {pack.tabs.length} módulo(s) · {pack.agents.length} agente(s) ·{' '}
                        {pack.study_tracks.length} trilha(s)
                      </p>

                      <div className="jarvis-studio-saved-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => loadPackIntoForm(pack)}
                        >
                          <Edit3 size={14} />
                          <span>Editar</span>
                        </button>

                        {isConfirming ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              disabled={isDeleting}
                              onClick={() => void handleDelete(pack.id)}
                            >
                              {isDeleting ? (
                                <Loader2 size={14} className="spin" />
                              ) : (
                                <Trash2 size={14} />
                              )}
                              <span>Confirmar</span>
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm jarvis-danger-text-btn"
                            aria-label={`Excluir pacote ${pack.name}`}
                            onClick={() => setConfirmDeleteId(pack.id)}
                          >
                            <Trash2 size={14} />
                            <span>Excluir</span>
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
};
