import React, { useEffect, useMemo, useRef, useState } from 'react';
import { subscribeAppEvent } from '../../shared/state/appBus';
import {
  Sparkles,
  BookOpen,
  Compass,
  HelpCircle,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Search,
  Bot,
  CloudUpload,
  CloudDownload,
  Mic,
  Wrench,
  Store,
  Workflow,
  Smartphone,
  X,
} from 'lucide-react';
import { getAccountStorageKey } from '../../services/accountScope';
import { API_BASE } from '../../services/api/client';
import { fetchAgents } from '../../api';
import type { AgentInfo } from '../../types';
import { useAssistantIdentity } from '../../context/AssistantIdentityContext';
import { MascotAvatar } from '../../shared/common/MascotAvatar';
import { PageHeader } from '../../shared/layout/PageHeader';

type GuideItem = {
  id: string;
  title: string;
  description: string;
  duration: string;
  category: string;
  steps: string[];
  targetTab: string;
};

const QUICK_GUIDES: GuideItem[] = [
  {
    id: 'voice_handsfree',
    title: 'Voz Mãos-Livres ("Ei Calmon IA" ou nome personalizado)',
    description: 'Chame seu assistente falando o nome escolhido ou clique uma vez para falar na hora.',
    duration: '2 min',
    category: 'Voz & Rotina',
    targetTab: 'companion',
    steps: [
      'No topo da tela, clique no botão "Ei [Nome]" para abrir o painel já ouvindo sua voz imediatamente.',
      'Quer chamar sem clicar em nada? Ative o ícone de ondas ao lado do botão ou ligue a opção "Escuta contínua por nome" no seu Perfil.',
      'Você pode mudar o nome do assistente a qualquer momento (ex.: Luna, Maria, João) pelo botão de Perfil no canto superior direito.',
    ],
  },
  {
    id: 'agents_store',
    title: 'Instalar e Desinstalar Agentes em 1 Clique',
    description: 'Monte sua equipe sem preencher formulários técnicos e remova quem não usar.',
    duration: '3 min',
    category: 'Agentes',
    targetTab: 'skills',
    steps: [
      'Abra "Loja & Apps" ou "Habilidades" para ver todos os 40 agentes prontos divididos por categoria (Dia a Dia, Estudos, Finanças, Criativo, Dados, Tecnologia e Segurança).',
      'Clique em "Instalar" em qualquer agente para ver suas habilidades e exemplos antes de confirmar.',
      'Para remover um agente que não usa mais, clique no botão "Desinstalar" na Loja, no Centro de Agentes ou diretamente pela equipe no Dock inferior.',
    ],
  },
  {
    id: 'skills_linking',
    title: 'Vincular Habilidades aos seus Agentes',
    description: 'Conecte habilidades reutilizáveis a qualquer agente instalado em tempo real.',
    duration: '3 min',
    category: 'Habilidades',
    targetTab: 'skills',
    steps: [
      'Em "Habilidades dos Agentes", clique em "Vincular a Agentes" em qualquer habilidade e marque os agentes que devem usá-la.',
      'Você também pode ir em "Agentes" e clicar no botão "Habilidades" de qualquer cartão para anexar ou remover habilidades daquele especialista.',
      'Todas as alterações sincronizam nos dois sentidos automaticamente.',
    ],
  },
  {
    id: 'chat_debates',
    title: 'Conversas, Menções (@) e Exclusão de Histórico',
    description: 'Converse com o Maestro, chame especialistas e organize suas conversas.',
    duration: '3 min',
    category: 'Conversas',
    targetTab: 'chat',
    steps: [
      'No Chat, digite sua pergunta normalmente ou use "@" para direcionar um especialista específico.',
      'Use "/debate" quando quiser ouvir opiniões de mais de um especialista antes de tomar uma decisão.',
      'Para limpar qualquer conversa do histórico (incluindo debates ou conversas com agentes), clique no ícone de lixeira ao lado da conversa e confirme.',
    ],
  },
  {
    id: 'workflows_auto',
    title: 'Fluxos Automáticos e Rotinas Agendadas',
    description: 'Automatize resumos matinais, revisões de estudos e checagens semanais.',
    duration: '4 min',
    category: 'Automação',
    targetTab: 'workflows',
    steps: [
      'Abra "Fluxos" e clique em "Templates" para escolher uma rotina pronta (como Resumo Matinal ou Verificador de Links & Golpes).',
      'Ou descreva em português na barra superior o que você quer automatizar e clique em "Gerar Fluxo".',
      'Clique em qualquer bloco do fluxo para abrir o editor lateral, trocar o agente instalado ou editar a instrução.',
    ],
  },
  {
    id: 'simple_mode',
    title: 'Modo Dia a Dia vs. Modo Avançado',
    description: 'Adapte a interface ao seu jeito de usar sem perder nenhum dado.',
    duration: '2 min',
    category: 'Personalização',
    targetTab: 'profile',
    steps: [
      'Abra seu Perfil no canto superior direito ou clique em "Usar Modo Simples" no rodapé do menu lateral.',
      'O Modo Dia a Dia deixa a tela limpa com Início, Conversas, Meus Agentes, Fluxos, Tarefas e Cadernos.',
      'Quando precisar de ferramentas de programação, governança ou logs, volte para o Modo Avançado com 1 clique.',
    ],
  },
  {
    id: 'knowledge_vault',
    title: 'Cadernos e Base de Conhecimento',
    description: 'Guarde notas, PDFs e documentos para que seus agentes consultem quando você pedir.',
    duration: '3 min',
    category: 'Conhecimento',
    targetTab: 'knowledge',
    steps: [
      'Abra "Base de Conhecimento" (ou "Cadernos" no Modo Simples).',
      'Adicione suas anotações, arquivos ou resumos de projetos.',
      'Use a busca semântica ou mencione o assunto no Chat para recuperar as informações na hora.',
    ],
  },
  {
    id: 'mobile_connect',
    title: 'Conectar Celular Android & Privacidade',
    description: 'Use seu assistente pelo celular com QR Code e mantenha seus dados protegidos.',
    duration: '3 min',
    category: 'Celular & Segurança',
    targetTab: 'settings',
    steps: [
      'Abra "Configurações → Conectar celular" ou a aba "Dispositivos" no seu Perfil.',
      'Gere um QR Code exclusivo da sua conta para parear o smartphone na mesma rede ou via acesso seguro.',
      'Revogue o acesso de qualquer dispositivo a qualquer momento pela central de acessos.',
    ],
  },
];

interface FAQItem {
  id: string;
  category: string;
  question: string;
  answer: string;
}

const FAQS: FAQItem[] = [
  {
    id: 'voice_handsfree_faq',
    category: 'Voz',
    question: 'Como chamar o assistente por voz sem clicar no botão?',
    answer:
      'Ative a escuta contínua no ícone de ondas ao lado de "Ei Calmon IA" no topo da tela (ou em Perfil → Voz & Respostas). Depois basta falar "Ei [Nome do seu assistente]" que o painel abre sozinho. Se preferir clicar no botão "Ei [Nome]", o microfone já começa a ouvir imediatamente.',
  },
  {
    id: 'install_uninstall_faq',
    category: 'Agentes',
    question: 'Posso instalar agentes prontos e desinstalar os que não uso?',
    answer:
      'Sim! Na Loja de Agentes você encontra 40 especialistas prontos para ativar com 1 clique, já vendo todas as habilidades incluídas antes de instalar. Para remover qualquer agente que não usa, basta clicar em "Desinstalar" na Loja, em Agentes ou no painel lateral direito.',
  },
  {
    id: 'skills_attach_faq',
    category: 'Habilidades',
    question: 'Como anexar uma habilidade a um agente específico?',
    answer:
      'Você pode fazer isso de dois jeitos: na página "Habilidades dos Agentes" clicando em "Vincular a Agentes", ou na página "Agentes" clicando no botão "Habilidades" dentro do card do agente desejado.',
  },
  {
    id: 'delete_chat_faq',
    category: 'Conversas',
    question: 'Como apagar conversas antigas ou debates (/debate)?',
    answer:
      'Na lista de conversas do Chat, clique no ícone de lixeira ao lado de qualquer conversa salva (incluindo debates e conversas iniciadas por agentes) e confirme a exclusão.',
  },
  {
    id: 'privacy_faq',
    category: 'Privacidade',
    question: 'Meus dados ficam protegidos?',
    answer:
      'Sim. Suas conversas, agentes e documentos ficam isolados na sua conta, e você pode rodar modelos localmente via Ollama ou usar provedores configurados com segurança no servidor — sem expor chaves no navegador.',
  },
  {
    id: 'mobile_faq',
    category: 'Celular',
    question: 'Como conectar meu celular Android ao Hub?',
    answer:
      'Vá em Perfil → Dispositivos (ou Configurações → Conectar celular), gere um QR Code de pareamento e escaneie pelo aplicativo no celular.',
  },
];

interface Props {
  activeTab?: string;
  initialSubTab?: string;
  onNavigate: (tab: string) => void;
  onStartTour?: () => void;
  onOpenProfile?: () => void;
}

export const LearningCenterView: React.FC<Props> = ({
  activeTab,
  initialSubTab = 'news',
  onNavigate,
  onStartTour,
  onOpenProfile,
}) => {
  const { assistantName } = useAssistantIdentity();
  const [currentSubTab, setCurrentSubTab] = useState<'news' | 'agents_guide' | 'faq' | 'guides'>(() => {
    if (initialSubTab === 'agents_guide' || initialSubTab === 'react_architecture') return 'agents_guide';
    if (initialSubTab === 'faq' || initialSubTab === 'shortcuts' || initialSubTab === 'ollama_local') return 'faq';
    if (initialSubTab === 'lessons' || initialSubTab === 'guides') return 'guides';
    return 'news';
  });

  const [query, setQuery] = useState('');
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null);
  const [completed, setCompleted] = useState<string[]>([]);
  const [expandedFaqId, setExpandedFaqId] = useState<string | null>('voice_handsfree_faq');
  const [installedAgents, setInstalledAgents] = useState<AgentInfo[]>([]);
  const [syncState, setSyncState] = useState<'loading' | 'synced' | 'offline'>('loading');
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    const loadAgents = () => {
      fetchAgents()
        .then((list) => {
          if (active && Array.isArray(list)) setInstalledAgents(list);
        })
        .catch(() => {});
    };
    loadAgents();
    const unsubAgents = subscribeAppEvent("jarvis:agents-updated", loadAgents);
    return () => {
      active = false;
      unsubAgents();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const localLoad = () => {
      try {
        const raw = localStorage.getItem(getAccountStorageKey('jarvis_learning_progress_v2'));
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((id) => QUICK_GUIDES.some((g) => g.id === id)) : [];
      } catch {
        return [];
      }
    };

    setCompleted(localLoad());

    fetch(API_BASE + '/learning/progress', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Sincronização indisponível');
        return response.json();
      })
      .then(async (data) => {
        if (cancelled) return;
        const remote = Array.isArray(data.completed_ids)
          ? data.completed_ids.filter((id: string) => QUICK_GUIDES.some((g) => g.id === id))
          : [];
        const local = localLoad();
        const merged = Array.from(new Set([...remote, ...local]));
        setCompleted(merged);
        try {
          localStorage.setItem(getAccountStorageKey('jarvis_learning_progress_v2'), JSON.stringify(merged));
        } catch {}
        setSyncState('synced');
      })
      .catch(() => {
        if (!cancelled) setSyncState('offline');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const toggleGuide = (id: string) => {
    const next = completed.includes(id) ? completed.filter((x) => x !== id) : [...completed, id];
    setCompleted(next);
    try {
      localStorage.setItem(getAccountStorageKey('jarvis_learning_progress_v2'), JSON.stringify(next));
    } catch {}
    setSyncState('loading');
    saveQueue.current = saveQueue.current
      .then(async () => {
        const response = await fetch(API_BASE + '/learning/progress', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completed_ids: next }),
        });
        if (!response.ok) throw new Error('Falha ao sincronizar.');
      })
      .then(() => setSyncState('synced'))
      .catch(() => setSyncState('offline'));
  };

  const filteredGuides = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return QUICK_GUIDES;
    return QUICK_GUIDES.filter((g) =>
      [g.title, g.description, g.category, ...g.steps].join(' ').toLowerCase().includes(q)
    );
  }, [query]);

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return installedAgents;
    return installedAgents.filter((a) =>
      [a.name, a.role, a.mission, ...(a.installed_skills || [])].join(' ').toLowerCase().includes(q)
    );
  }, [installedAgents, query]);

  const filteredFaqs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FAQS;
    return FAQS.filter((f) =>
      [f.question, f.answer, f.category].join(' ').toLowerCase().includes(q)
    );
  }, [query]);

  const activeGuide = QUICK_GUIDES.find((g) => g.id === selectedGuideId) || null;

  const startChatWithAgent = (agent: AgentInfo) => {
    try {
      localStorage.setItem(
        'jarvis_active_chat_prompt',
        `Olá @${agent.name || agent.role}, pode me ajudar agora?`
      );
    } catch {}
    onNavigate('chat');
  };

  return (
    <div className="jarvis-settings-layout">
      {/* Sub-painel Esquerdo: Navegação de Ajuda & Guias */}
      <aside className="jarvis-settings-nav" aria-label="Menu de ajuda e guias">
        <div className="jarvis-settings-nav__header">
          <h2 className="jarvis-settings-nav__title">Ajuda &amp; Guias</h2>

          <div className="jarvis-search-box">
            <Search size={13} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar guia ou dúvida..."
              aria-label="Pesquisar ajuda e guias"
              className="jarvis-search-box__input"
              style={{ fontSize: '0.8rem', padding: '5px 0' }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="btn btn-ghost btn-icon-sm"
                aria-label="Limpar busca"
                style={{ width: '22px', height: '22px', padding: 0 }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <nav className="jarvis-settings-nav__list">
          <div className="jarvis-settings-nav__group">
            <div className="jarvis-settings-nav__group-title">Explorar</div>

            <button
              type="button"
              onClick={() => {
                setCurrentSubTab('news');
                setSelectedGuideId(null);
              }}
              aria-current={currentSubTab === 'news' ? 'page' : undefined}
              className={`jarvis-subnav-btn ${currentSubTab === 'news' ? 'is-active' : ''}`}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '9px' }}>
                <Sparkles size={15} color={currentSubTab === 'news' ? 'var(--accent-light)' : 'var(--text-muted)'} />
                <span>Novidades</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setCurrentSubTab('guides');
                setSelectedGuideId(null);
              }}
              aria-current={currentSubTab === 'guides' ? 'page' : undefined}
              className={`jarvis-subnav-btn ${currentSubTab === 'guides' ? 'is-active' : ''}`}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '9px' }}>
                <BookOpen size={15} color={currentSubTab === 'guides' ? 'var(--accent-light)' : 'var(--text-muted)'} />
                <span>Guias Rápidos</span>
              </span>
              <span className="jarvis-tabular" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {completed.length}/{QUICK_GUIDES.length}
              </span>
            </button>
          </div>

          <div className="jarvis-settings-nav__group">
            <div className="jarvis-settings-nav__group-title">Referência</div>

            <button
              type="button"
              onClick={() => {
                setCurrentSubTab('agents_guide');
                setSelectedGuideId(null);
              }}
              aria-current={currentSubTab === 'agents_guide' ? 'page' : undefined}
              className={`jarvis-subnav-btn ${currentSubTab === 'agents_guide' ? 'is-active' : ''}`}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '9px' }}>
                <Bot size={15} color={currentSubTab === 'agents_guide' ? 'var(--accent-light)' : 'var(--text-muted)'} />
                <span>Meus Agentes</span>
              </span>
              <span className="jarvis-tabular" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {installedAgents.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setCurrentSubTab('faq');
                setSelectedGuideId(null);
              }}
              aria-current={currentSubTab === 'faq' ? 'page' : undefined}
              className={`jarvis-subnav-btn ${currentSubTab === 'faq' ? 'is-active' : ''}`}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '9px' }}>
                <HelpCircle size={15} color={currentSubTab === 'faq' ? 'var(--accent-light)' : 'var(--text-muted)'} />
                <span>Dúvidas Comuns</span>
              </span>
            </button>
          </div>
        </nav>

        <div className="jarvis-settings-nav__footer">
          <button
            type="button"
            onClick={onStartTour}
            className="btn btn-secondary btn-sm btn-block"
          >
            <Compass size={13} />
            <span>Iniciar Tour Guiado</span>
          </button>
        </div>
      </aside>

      {/* Área Principal */}
      <main className="jarvis-settings-content">
        <div className="jarvis-settings-container">
          {/* Sub-aba: Novidades */}
          {currentSubTab === 'news' && (
            <>
              <PageHeader
                icon={<Sparkles size={18} />}
                title={`Central de Ajuda do ${assistantName}`}
                subtitle="Tudo em português simples para você aproveitar voz mãos-livres, agentes prontos em 1 clique, habilidades conectadas e fluxos automáticos no seu dia a dia."
              />

              <section className="jarvis-settings-section">
                <h3 className="jarvis-settings-section__title">Destaques da Plataforma</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
                  <div className="jarvis-settings-card" style={{ gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-light)' }}>
                      <Mic size={16} />
                      <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>Voz &ldquo;Ei {assistantName}&rdquo;</strong>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
                      Clique em &ldquo;Ei {assistantName}&rdquo; para falar na hora ou ative a escuta mãos-livres para chamar seu assistente sem clicar em nada.
                    </p>
                  </div>

                  <div className="jarvis-settings-card" style={{ gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-light)' }}>
                      <Store size={16} />
                      <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>Loja Unificada de Agentes</strong>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
                      40 agentes prontos para instalar em 1 clique com prévia de habilidades e botão Desinstalar sempre visível no painel lateral.
                    </p>
                  </div>

                  <div className="jarvis-settings-card" style={{ gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--status-ok, #34d399)' }}>
                      <Wrench size={16} />
                      <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>Habilidades Conectadas</strong>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
                      Vincule habilidades a qualquer agente instalado tanto pela página de Habilidades quanto diretamente pelo card de cada agente.
                    </p>
                  </div>

                  <div className="jarvis-settings-card" style={{ gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--status-warn, #fbbf24)' }}>
                      <Workflow size={16} />
                      <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>Fluxos Editáveis &amp; Modelos</strong>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
                      Escolha modelos prontos como Resumo Matinal ou Verificador de Golpes e clique em qualquer etapa para escolher o agente responsável.
                    </p>
                  </div>
                </div>
              </section>

              <section className="jarvis-settings-section">
                <h3 className="jarvis-settings-section__title">Acesso Rápido</h3>
                <div className="jarvis-settings-card" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: '10px' }}>
                  <button type="button" onClick={() => setCurrentSubTab('guides')} className="btn btn-primary btn-sm">
                    <BookOpen size={14} />
                    <span>Ver Guias Rápidos</span>
                  </button>
                  <button type="button" onClick={() => onNavigate('skills')} className="btn btn-secondary btn-sm">
                    <Store size={14} />
                    <span>Abrir Loja &amp; Habilidades</span>
                  </button>
                  <button type="button" onClick={() => onOpenProfile?.()} className="btn btn-secondary btn-sm">
                    <Smartphone size={14} />
                    <span>Personalizar Perfil e Voz</span>
                  </button>
                </div>
              </section>
            </>
          )}

          {/* Sub-aba: Meus Agentes Instalados */}
          {currentSubTab === 'agents_guide' && (
            <>
              <PageHeader
                icon={<Bot size={18} />}
                title={`Seus Agentes Instalados (${installedAgents.length})`}
                subtitle="Estes são os agentes ativos no seu hub agora. Clique em Conversar ou instale novos na Loja."
                actions={
                  <button type="button" onClick={() => onNavigate('skills')} className="btn btn-primary btn-sm">
                    <Store size={14} />
                    <span>Explorar Loja de Agentes</span>
                  </button>
                }
              />

              {filteredAgents.length === 0 ? (
                <div className="jarvis-settings-card" style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                  Nenhum agente encontrado para &ldquo;{query}&rdquo;.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(265px, 1fr))', gap: '12px' }}>
                  {filteredAgents.map((agent) => (
                    <div
                      key={agent.role}
                      className="jarvis-settings-card"
                      style={{ padding: '14px 16px', gap: '10px' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
                          <MascotAvatar
                            mascot={agent.mascot}
                            role={agent.role}
                            name={agent.name || agent.role}
                            size={30}
                          />
                          <div style={{ minWidth: 0 }}>
                            <strong style={{ fontSize: '0.86rem', color: 'var(--text-primary)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {agent.name || agent.role}
                            </strong>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              {(agent.installed_skills || []).length} habilidade(s)
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => startChatWithAgent(agent)}
                          className="btn btn-secondary btn-xs"
                        >
                          Conversar
                        </button>
                      </div>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                        {agent.mission || 'Agente especialista pronto para ajudar nas suas conversas.'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Sub-aba: Dúvidas Comuns (FAQ) */}
          {currentSubTab === 'faq' && (
            <>
              <PageHeader
                icon={<HelpCircle size={18} />}
                title="Perguntas Frequentes"
                subtitle="Respostas diretas sobre voz, agentes, habilidades, conversas e privacidade."
              />

              <div className="jarvis-settings-subcard" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>Atalhos úteis:</strong>
                <span>Ctrl + K (Busca rápida)</span>
                <span>·</span>
                <span>Ctrl + B (Menu lateral)</span>
                <span>·</span>
                <span>Enter (Enviar mensagem)</span>
                <span>·</span>
                <span>Shift + Enter (Nova linha)</span>
              </div>

              <div className="jarvis-settings-card" style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
                {filteredFaqs.map((faq, idx) => {
                  const isExpanded = expandedFaqId === faq.id;
                  return (
                    <div
                      key={faq.id}
                      style={{
                        borderTop: idx > 0 ? '1px solid var(--border-subtle)' : undefined,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedFaqId(isExpanded ? null : faq.id)}
                        className="jarvis-accordion-trigger"
                        aria-expanded={isExpanded}
                      >
                        <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{faq.question}</span>
                        {isExpanded ? <ChevronDown size={15} color="var(--text-muted)" /> : <ChevronRight size={15} color="var(--text-muted)" />}
                      </button>
                      {isExpanded && (
                        <div style={{ padding: '12px 16px 14px', color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.6, borderTop: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-surface)' }}>
                          {faq.answer}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Sub-aba: Guias Rápidos */}
          {currentSubTab === 'guides' && (
            <>
              <PageHeader
                icon={<BookOpen size={18} />}
                title="Guias Rápidos Passo a Passo"
                subtitle={`Aprenda em poucos minutos como usar cada recurso do ${assistantName}.`}
                meta={[
                  <span
                    key="guides-progress"
                    className={`jarvis-status-pill ${syncState === 'synced' ? 'is-ok' : ''}`}
                    style={{ color: syncState === 'synced' ? undefined : 'var(--text-secondary)' }}
                  >
                    {syncState === 'synced' ? <CloudUpload size={13} /> : <CloudDownload size={13} />}
                    <span className="jarvis-tabular">{completed.length} de {QUICK_GUIDES.length} concluídos</span>
                  </span>,
                ]}
              />

              {activeGuide ? (
                <div className="jarvis-settings-card" style={{ gap: '16px' }}>
                  <div>
                    <button type="button" onClick={() => setSelectedGuideId(null)} className="btn btn-ghost btn-xs">
                      ← Todos os guias
                    </button>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.73rem', color: 'var(--accent-light)', fontWeight: 600 }}>
                      {activeGuide.category} · {activeGuide.duration}
                    </div>
                    <h2 style={{ fontSize: '1.12rem', fontWeight: 700, color: 'var(--text-primary)', margin: '4px 0 6px' }}>
                      {activeGuide.title}
                    </h2>
                    <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
                      {activeGuide.description}
                    </p>
                  </div>
                  <div className="jarvis-settings-subcard">
                    <ol style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-primary)', fontSize: '0.83rem', lineHeight: 1.75 }}>
                      {activeGuide.steps.map((st, idx) => (
                        <li key={idx}>{st}</li>
                      ))}
                    </ol>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => toggleGuide(activeGuide.id)}
                      className={`btn btn-sm ${completed.includes(activeGuide.id) ? 'btn-success' : 'btn-primary'}`}
                    >
                      {completed.includes(activeGuide.id) ? 'Concluído ✓' : 'Marcar como Concluído'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (activeGuide.targetTab === 'profile') onOpenProfile?.();
                        else onNavigate(activeGuide.targetTab);
                      }}
                      className="btn btn-secondary btn-sm"
                    >
                      Testar agora
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          localStorage.setItem(
                            'jarvis_active_chat_prompt',
                            `Oi ${assistantName}, estou lendo o guia "${activeGuide.title}" e quero tirar uma dúvida rápida.`
                          );
                        } catch {}
                        onNavigate('chat');
                      }}
                      className="btn btn-secondary btn-sm"
                    >
                      Perguntar ao {assistantName}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(265px, 1fr))', gap: '12px' }}>
                  {filteredGuides.map((guide) => {
                    const isDone = completed.includes(guide.id);
                    const isRecommended = Boolean(activeTab && guide.targetTab === activeTab);
                    return (
                      <div
                        key={guide.id}
                        className="jarvis-settings-card"
                        style={{
                          padding: '16px',
                          gap: '8px',
                          borderColor: isRecommended ? 'var(--border-accent)' : undefined,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.72rem', color: 'var(--accent-light)', fontWeight: 600 }}>
                            {guide.category} · {guide.duration}
                          </span>
                          {isDone && <CheckCircle2 size={14} color="var(--status-ok, #34d399)" />}
                        </div>
                        <strong style={{ fontSize: '0.86rem', color: 'var(--text-primary)', lineHeight: 1.35 }}>
                          {guide.title}
                        </strong>
                        <p style={{ fontSize: '0.77rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5, flex: 1 }}>
                          {guide.description}
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
                          <button
                            type="button"
                            onClick={() => setSelectedGuideId(guide.id)}
                            className="btn btn-ghost btn-xs"
                          >
                            Ler guia →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
};
