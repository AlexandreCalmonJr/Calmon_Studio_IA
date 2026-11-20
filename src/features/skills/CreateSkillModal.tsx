import React, { useState } from 'react';
import { Modal } from '../../shared/common/Modal';
import { Plus, Upload, Sparkles, Code } from 'lucide-react';
import { createUserSkill, importEccSkill } from '../../api';
import { notify } from '../../shared/common/Toast';
import { AgentInfo } from '../../types';
import { ALL_26_AGENTS } from '../../data/agentsCatalog';

interface CreateSkillModalProps {
  isOpen: boolean;
  onClose: () => void;
  agents: AgentInfo[];
  onSkillCreated: () => void;
  initialTab?: 'create' | 'import';
}

const SKILL_TEMPLATES = [
  {
    label: 'Clean Architecture & SOLID',
    domain: 'backend',
    desc: 'Boas práticas de desacoplamento, Domain-Driven Design e injeção de dependência.',
    instructions:
      'Separe estritamente as camadas de Domínio (Entidades/Regras de Negócio), Aplicação (Casos de Uso), Infraestrutura (Banco/Gateways) e Apresentação (Controllers/APIs). Não permita dependências da camada de domínio para bibliotecas externas.',
  },
  {
    label: 'OWASP Hardening & SAST',
    domain: 'security',
    desc: 'Blindagem contra SQL Injection, XSS, CSRF, SSRF e controle rígido de autorização.',
    instructions:
      'Valide todas as entradas de dados contra schemas estritos. Aplique escape contextual de saídas, parametrização obrigatória em consultas SQL e verificação do escopo do usuário autenticado antes de qualquer mutação de estado.',
  },
  {
    label: 'TDD & Testes Automatizados',
    domain: 'qa',
    desc: 'Fluxo Red-Green-Refactor com testes unitários, de integração e contratos de API.',
    instructions:
      'Escreva testes unitários concisos antes da implementação. Isole efeitos colaterais com fakes em memória. Garanta que todas as ramificações de erro e casos de borda possuam asserções explícitas.',
  },
  {
    label: 'DevOps & Contêineres',
    domain: 'ops',
    desc: 'Padronização de Dockerfile multi-stage, pipelines CI/CD e observabilidade.',
    instructions:
      'Utilize imagens base minimalistas (distroless ou alpine). Execute a aplicação sob usuário não-root (UID 1000). Garanta healthchecks HTTP e logs estruturados em formato JSON para stdout.',
  },
];

export const CreateSkillModal: React.FC<CreateSkillModalProps> = ({
  isOpen,
  onClose,
  agents = [],
  onSkillCreated,
  initialTab = 'create',
}) => {
  const [activeTab, setActiveTab] = useState<'create' | 'import'>(initialTab);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('backend');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [selectedAgents, setSelectedAgents] = useState<string[]>(['jarvis_master']);
  const [markdownContent, setMarkdownContent] = useState('');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  const applyTemplate = (tpl: (typeof SKILL_TEMPLATES)[0]) => {
    setName(tpl.label);
    setDomain(tpl.domain);
    setDescription(tpl.desc);
    setInstructions(tpl.instructions);
    notify(`Template '${tpl.label}' carregado!`, 'info');
  };

  const loadEccExample = () => {
    const example = `---
name: "Clean Code & Refactoring Guidelines"
version: "1.2.0"
domain: "backend"
license: "Apache-2.0"
description: "Padrões de refatoração contínua e redução de dívida técnica para microsserviços."
allowed_tools:
  - "read_file"
  - "search_symbols"
---

# Diretrizes Técnicas
Ao refatorar métodos com complexidade ciclomática elevada:
1. Extraia funções pequenas com responsabilidade única.
2. Evite boolean flags como parâmetros de controle.
3. Garanta que os testes de regressão existentes continuem passando antes de commitar.
`;
    setMarkdownContent(example);
    notify('Exemplo de Skill ECC carregado no editor!', 'info');
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !instructions.trim()) {
      notify('Por favor, informe o nome e as diretrizes da skill', 'error');
      return;
    }
    setSaving(true);
    try {
      await createUserSkill({
        name: name.trim(),
        domain,
        description: description.trim(),
        instructions: instructions.trim(),
        assigned_agents: selectedAgents,
      });
      notify(`Skill '${name}' criada e associada aos agentes com sucesso!`, 'success');
      onSkillCreated();
      onClose();
      setName('');
      setDescription('');
      setInstructions('');
    } catch (err: any) {
      notify(`Erro ao criar skill: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!markdownContent.trim()) {
      notify('Cole uma skill com frontmatter YAML válido e licença declarada.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await importEccSkill(markdownContent.trim());
      notify(`Skill '${res?.skill?.name || 'ECC'}' importada e aprovada!`, 'success');
      onSkillCreated();
      onClose();
      setMarkdownContent('');
    } catch (err: any) {
      notify(`Erro ao importar skill: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleAgent = (role: string) => {
    setSelectedAgents((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Adicionar Habilidade ECC & Ponytail"
      subtitle="Crie diretrizes customizadas para seus especialistas ou importe uma especificação ECC em Markdown."
      icon={<Sparkles size={18} color="var(--accent-light)" />}
      maxWidth="lg"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Abas */}
        <div className="jarvis-segmented" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'create'}
            className={`jarvis-segmented-btn ${activeTab === 'create' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('create')}
          >
            <Plus size={14} /> Criar Nova Skill
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'import'}
            className={`jarvis-segmented-btn ${activeTab === 'import' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            <Upload size={14} /> Importar Skill ECC (Markdown)
          </button>
        </div>

        {activeTab === 'create' ? (
          <form onSubmit={handleCreateSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Quick Templates Bar */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <Sparkles size={13} color="var(--accent-light)" />
                <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Modelos Rápidos (1 clique para preencher):
                </span>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {SKILL_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    onClick={() => applyTemplate(tpl)}
                    className="btn btn-secondary btn-xs"
                  >
                    + {tpl.label}
                  </button>
                ))}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                gap: '12px',
              }}
            >
              <div>
                <label htmlFor="skill-name-input" className="user-profile-field-label">
                  Nome da Habilidade *
                </label>
                <input
                  id="skill-name-input"
                  type="text"
                  placeholder="ex: Microsserviços e Padrão Saga"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="jarvis-input"
                  required
                />
              </div>

              <div>
                <label htmlFor="skill-domain-select" className="user-profile-field-label">
                  Domínio Técnico
                </label>
                <select
                  id="skill-domain-select"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="jarvis-select"
                >
                  <option value="backend">Backend & APIs</option>
                  <option value="flutter">Flutter / Mobile</option>
                  <option value="web">Web & Frontend</option>
                  <option value="security">Segurança & OWASP</option>
                  <option value="qa">QA & Testes</option>
                  <option value="data">Dados & BI</option>
                  <option value="ops">DevOps & Infra</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="skill-desc-input" className="user-profile-field-label">
                Descrição Resumida
              </label>
              <input
                id="skill-desc-input"
                type="text"
                placeholder="Breve resumo da finalidade desta habilidade"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="jarvis-input"
              />
            </div>

            <div>
              <label htmlFor="skill-instructions-textarea" className="user-profile-field-label">
                Diretrizes de Prompt & Instruções Técnicas *
              </label>
              <textarea
                id="skill-instructions-textarea"
                placeholder="Descreva as instruções que serão injetadas no contexto do agente..."
                rows={5}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                className="jarvis-textarea"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
                required
              />
            </div>

            {/* Agentes Iniciais */}
            <div>
              <div className="user-profile-field-label jarvis-tabular">
                Vincular a Especialistas Iniciais ({selectedAgents.length} selecionados)
              </div>
              <div
                className="jarvis-settings-subcard"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 175px), 1fr))',
                  gap: '6px',
                  maxHeight: '132px',
                  overflowY: 'auto',
                  padding: '8px',
                }}
              >
                {(agents.length > 0 ? agents : ALL_26_AGENTS).map((ag) => {
                  const isChecked = selectedAgents.includes(ag.role);
                  const displayName = 'proper_name' in ag && ag.proper_name ? `${ag.proper_name} · ${ag.name}` : ag.name;
                  return (
                    <label
                      key={ag.role}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '0.76rem',
                        color: isChecked ? 'var(--text-primary)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        padding: '4px 6px',
                        borderRadius: '6px',
                        backgroundColor: isChecked ? 'var(--accent-soft)' : 'transparent',
                        border: isChecked ? '1px solid var(--border-accent)' : '1px solid transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleAgent(ag.role)}
                        style={{ accentColor: 'var(--accent-color)' }}
                      />
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {displayName}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
                {saving ? 'Criando...' : 'Salvar Habilidade'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleImportSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                flexWrap: 'wrap',
              }}
            >
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                Cole a especificação Markdown da skill contendo frontmatter YAML (com campos{' '}
                <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>name</code>,{' '}
                <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>version</code>,{' '}
                <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>license</code>).
              </p>
              <button type="button" onClick={loadEccExample} className="btn btn-ghost btn-xs">
                <Code size={13} />
                <span>Carregar Exemplo</span>
              </button>
            </div>

            <div>
              <label htmlFor="skill-ecc-markdown-textarea" className="user-profile-field-label">
                Especificação ECC (Markdown + YAML) *
              </label>
              <textarea
                id="skill-ecc-markdown-textarea"
                placeholder={`---\nname: 'Padrões de Arquitetura'\nversion: '1.0.0'\ndomain: 'backend'\nlicense: 'MIT'\n---\n\nInstruções detalhadas...`}
                rows={11}
                value={markdownContent}
                onChange={(e) => setMarkdownContent(e.target.value)}
                className="jarvis-textarea"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
                required
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
                {saving ? 'Importando...' : 'Importar e Validar ECC'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
