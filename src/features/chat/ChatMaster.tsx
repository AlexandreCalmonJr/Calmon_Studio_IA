import React, { useState, useEffect, useRef, useCallback } from 'react';
import { subscribeAppEvent } from '../../shared/state/appBus';
import { Code2, ShieldCheck, Users, Compass, ArrowUpRight } from 'lucide-react';
import { fetchWorkspaceProjects, fetchModels, fetchChatSessionDetails, fetchAgents } from '../../api';
import { FormattedChatModel, parseChatModelOptions } from '../../services/chatModels';
import { useChatStream } from '../../hooks/useChatStream';
import { ArtifactCanvas, CanvasArtifact } from './ArtifactCanvas';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { ChatProjectModal } from './ChatProjectModal';
import { getLocalSessionsCatalog, getSessionMessagesLocally, saveSessionMessagesLocally } from './ChatHistoryDrawer';
import { OpenBotConversationRail } from './OpenBotConversationRail';
import { OpenBotChatHeader, ChatTabItem } from './OpenBotChatHeader';
import { getAccountStorageKey } from '../../services/accountScope';
import { getAgentDisplayColor, getAgentProperName } from '../../services/agentSync';
import { AgentInfo, ChatMessage } from '../../types';
import { useAssistantIdentity } from '../../context/AssistantIdentityContext';
import { AgentRunWorkspacePanel } from './AgentRunWorkspacePanel';
import {
  fetchAgentRunDetail,
  fetchAgentRuns,
  resumeAgentRun,
  type AgentRunDetailResponse,
  type AgentRunRecord,
  type StreamRunEventPayload,
} from '../../services/api/chat';
import { notify } from '../../shared/common/Toast';

interface ChatMasterProps {
  attachedProjectId?: string | null;
  onDetachProject?: () => void;
  targetSessionId?: string | null;
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
}

const GREETINGS = [
  'Como posso ajudar hoje?',
  'Pronto para construir juntos',
  'O que vamos resolver agora?',
];

const STARTER_CARDS = [
  {
    title: 'Praticar inglês com a Clara',
    desc: 'Chame um especialista pelo nome próprio com foco estrito no idioma.',
    prompt: 'Clara, me dê 3 frases curtas em inglês para usar no dia a dia com tradução e dica de pronúncia.',
    icon: Compass,
  },
  {
    title: 'Multi-agentes: Kira + Dante',
    desc: 'Acione dois especialistas pelo nome para auditar segurança e gerar slides .PPTX.',
    prompt: 'Chama a Kira para checar segurança de dados e o Dante para montar uma apresentação PowerPoint sobre IA segura.',
    icon: ShieldCheck,
  },
  {
    title: 'Deep Research com Atlas',
    desc: 'Pesquisa profunda em múltiplas fontes com relatório técnico pronto para PDF.',
    prompt: 'Atlas, faça uma pesquisa profunda sobre arquitetura de agentes locais e híbridos em 2026 e gere um relatório PDF.',
    icon: Code2,
  },
  {
    title: 'Mesa redonda de agentes',
    desc: 'Compare pontos de vista entre arquitetura, segurança e qualidade.',
    prompt: '/debate Qual a melhor estratégia para combinar IA local e online com segurança e velocidade?',
    icon: Users,
  },
];

export const ChatMaster: React.FC<ChatMasterProps> = ({
  attachedProjectId: propProjectId,
  onDetachProject,
  targetSessionId,
  initialPrompt,
  onInitialPromptConsumed,
}) => {
  const { assistantName } = useAssistantIdentity();
  const [input, setInput] = useState('');
  const [activeArtifact, setActiveArtifact] = useState<CanvasArtifact | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(propProjectId || null);
  const [availableProjects, setAvailableProjects] = useState<any[]>([]);
  const [greetingIndex, setGreetingIndex] = useState(0);
  const [isRailOpen, setIsRailOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 960 : true
  );
  const [isNarrowViewport, setIsNarrowViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 960 : false
  );
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);

  useEffect(() => {
    const onResize = () => {
      const narrow = window.innerWidth < 960;
      setIsNarrowViewport(narrow);
      if (narrow) {
        setIsRailOpen(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [sessionRuns, setSessionRuns] = useState<AgentRunRecord[]>([]);
  const [recoverableRunsCount, setRecoverableRunsCount] = useState(0);
  const [activeRunDetail, setActiveRunDetail] = useState<AgentRunDetailResponse | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [resumingRun, setResumingRun] = useState(false);
  const [availableModels, setAvailableModels] = useState<FormattedChatModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    try {
      return localStorage.getItem(getAccountStorageKey('jarvis_selected_model')) || 'auto';
    } catch {
      return 'auto';
    }
  });

  // Sincroniza modelos disponíveis do backend preservando modo Automático (Agente) ou escolha explícita
  useEffect(() => {
    let isMounted = true;
    fetchModels()
      .then((data) => {
        if (!isMounted || !data) return;
        const list = parseChatModelOptions(data);
        setAvailableModels(list);
        const saved = localStorage.getItem(getAccountStorageKey('jarvis_selected_model'));
        if (!saved || saved === 'auto') {
          setSelectedModel('auto');
        } else {
          setSelectedModel(saved);
        }
      })
      .catch((e) => console.warn('Falha ao listar modelos:', e));
    return () => {
      isMounted = false;
    };
  }, []);

  const handleSelectModel = useCallback((modelId: string) => {
    const normalized = (modelId || '').trim() || 'auto';
    setSelectedModel(normalized);
    try {
      if (normalized === 'auto') {
        localStorage.removeItem(getAccountStorageKey('jarvis_selected_model'));
      } else {
        localStorage.setItem(getAccountStorageKey('jarvis_selected_model'), normalized);
      }
    } catch {}
  }, []);

  // Sincroniza propriedade de projeto externo
  useEffect(() => {
    if (propProjectId !== undefined) {
      setActiveProjectId(propProjectId);
    }
  }, [propProjectId]);

  const loadProjects = async () => {
    try {
      const data = await fetchWorkspaceProjects();
      setAvailableProjects(data);
    } catch (e) {
      console.warn('Falha ao listar projetos no chat:', e);
    }
  };

  useEffect(() => {
    loadProjects();
  }, [showProjectModal]);

  const activeProject = availableProjects.find((p) => p.id === activeProjectId);

  // Hook desacoplado de streaming e estado da conversa
  const {
    messages,
    setMessages,
    sessionId,
    setSessionId,
    loading,
    isListening,
    handleToggleVoiceInput,
    handleStopGeneration,
    handleNewChat,
    handleExportChat,
    handleSubmit: submitStream,
  } = useChatStream(
    activeProjectId,
    activeProject?.name || null,
    (art) => {
      setWorkspaceOpen(false);
      setActiveArtifact(art);
    },
    () => loadProjects(),
    handleSelectModel
  );

  // Carrega execuções duráveis (runs + checkpoints) da sessão ativa com fallback para execuções recentes/retomáveis da conta
  const loadSessionRuns = useCallback(async (sid: string, preferredRunId?: string) => {
    setLoadingRuns(true);
    try {
      const hasConcreteSession = Boolean(sid && !sid.startsWith('new_'));
      let data = await fetchAgentRuns(hasConcreteSession ? sid : undefined, 20);
      if (hasConcreteSession && (!data.runs || data.runs.length === 0)) {
        data = await fetchAgentRuns(undefined, 20);
      }
      setSessionRuns(data.runs || []);
      setRecoverableRunsCount(data.recoverable_count || 0);
      const targetId = preferredRunId || data.runs?.[0]?.id;
      if (targetId) {
        const detail = await fetchAgentRunDetail(targetId);
        setActiveRunDetail(detail);
      } else {
        setActiveRunDetail(null);
      }
    } catch {
      // Sessão ainda sem runs ou ambiente offline
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  useEffect(() => {
    if (sessionId) {
      void loadSessionRuns(sessionId);
    }
  }, [sessionId, loadSessionRuns]);

  const handleSelectRun = useCallback(async (runId: string) => {
    setLoadingRuns(true);
    try {
      const detail = await fetchAgentRunDetail(runId);
      setActiveRunDetail(detail);
    } catch (err: any) {
      notify(err?.message || 'Falha ao carregar detalhes da execução.', 'error');
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const handleResumeCheckpoint = useCallback(
    async (runId: string, fromStepIndex?: number) => {
      setResumingRun(true);
      try {
        const resumed = await resumeAgentRun(runId, fromStepIndex);
        setActiveRunDetail(resumed);
        setSessionRuns((prev) => {
          const exists = prev.some((r) => r.id === resumed.run.id);
          return exists
            ? prev.map((r) => (r.id === resumed.run.id ? resumed.run : r))
            : [resumed.run, ...prev];
        });
        fetchAgentRuns(undefined, 1)
          .then((meta) => setRecoverableRunsCount(meta.recoverable_count || 0))
          .catch(() => {});
        notify('Execução retomada com continuidade real a partir do checkpoint salvo.', 'success');
      } catch (err: any) {
        notify(err?.message || 'Não foi possível retomar do checkpoint.', 'error');
      } finally {
        setResumingRun(false);
      }
    },
    []
  );

  const handleRunStreamEvent = useCallback((ev: StreamRunEventPayload) => {
    if (ev.type === 'run_started' && ev.run) {
      const startedRun = ev.run;
      setActiveArtifact(null);
      setWorkspaceOpen(true);
      setSessionRuns((prev) => [startedRun, ...prev.filter((r) => r.id !== startedRun.id)]);
      setActiveRunDetail({ run: startedRun, steps: [], artifacts: [] });
      return;
    }
    if (ev.type === 'run_step' && ev.step) {
      const incomingStep = ev.step;
      setActiveRunDetail((prev) => {
        if (!prev || prev.run.id !== incomingStep.run_id) return prev;
        const exists = prev.steps.some((s) => s.id === incomingStep.id);
        const nextSteps = exists
          ? prev.steps.map((s) => (s.id === incomingStep.id ? incomingStep : s))
          : [...prev.steps, incomingStep];
        return {
          ...prev,
          run: {
            ...prev.run,
            current_step_index: Math.max(prev.run.current_step_index, incomingStep.step_index),
            total_steps: Math.max(prev.run.total_steps, nextSteps.length),
          },
          steps: nextSteps,
        };
      });
      return;
    }
    if (ev.type === 'run_artifact' && ev.artifact) {
      const incomingArt = ev.artifact;
      setActiveRunDetail((prev) => {
        if (!prev || prev.run.id !== incomingArt.run_id) return prev;
        const exists = prev.artifacts.some((a) => a.id === incomingArt.id);
        return {
          ...prev,
          artifacts: exists ? prev.artifacts : [...prev.artifacts, incomingArt],
        };
      });
      return;
    }
    if (ev.type === 'run_completed' && ev.run) {
      const finishedRun = ev.run;
      setSessionRuns((prev) =>
        prev.map((r) => (r.id === finishedRun.id ? finishedRun : r))
      );
      setActiveRunDetail((prev) =>
        prev && prev.run.id === finishedRun.id ? { ...prev, run: finishedRun } : prev
      );
    }
  }, []);

  const [tabs, setTabs] = useState<ChatTabItem[]>(() => {
    const firstUser = messages.find((m) => m.sender === 'user')?.text?.trim();
    const initialTitle = firstUser
      ? firstUser.slice(0, 24) + (firstUser.length > 24 ? '...' : '')
      : assistantName;
    return [{ id: sessionId || 'default', title: initialTitle }];
  });
  const [activeTabId, setActiveTabId] = useState(() => sessionId || 'default');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTabs((prev) =>
      prev.map((t) =>
        (t.id === 'default' || t.id === sessionId) &&
        (t.title === 'JARVIS Master' || t.title === 'JARVIS' || t.title === 'Calmon')
          ? { ...t, title: assistantName }
          : t
      )
    );
  }, [assistantName, sessionId]);

  const [myAgents, setMyAgents] = useState<AgentInfo[]>([]);

  useEffect(() => {
    let active = true;
    const loadAgents = () => {
      fetchAgents()
        .then((list) => {
          if (active && Array.isArray(list)) setMyAgents(list);
        })
        .catch(() => {});
    };
    loadAgents();
    const unsubAgents = subscribeAppEvent('jarvis:agents-updated', loadAgents);
    return () => {
      active = false;
      unsubAgents();
    };
  }, []);

  // Resolve especialista real da equipe caso a sessão tenha sido aberta pelo Dock lateral ou sidebar
  const activeAgent = React.useMemo(() => {
    if (!sessionId) return null;
    const rawKey = sessionId.startsWith('agent_')
      ? sessionId.slice(6)
      : sessionId.startsWith('agent-')
        ? sessionId.slice(6)
        : null;
    if (!rawKey) return null;
    const found = myAgents.find((a) => a.role === rawKey);
    if (!found) return null;
    return {
      id: found.role,
      role: found.role,
      name: getAgentProperName(found),
      categoryLabel: found.name || found.handle || 'Especialista',
      mission: found.mission,
      color: getAgentDisplayColor(found),
    };
  }, [sessionId, myAgents]);

  // Função central para carregar e sincronizar histórico de sessão com o SQLite do backend
  const loadSessionMessages = useCallback(async (sid: string, titleHint?: string) => {
    setSessionId(sid);
    setActiveArtifact(null);

    // 1. Tenta carregar do cache local imediatamente para exibição fluida
    const local = getSessionMessagesLocally(sid);
    if (local && local.length > 0) {
      setMessages(local);
    }

    // 2. Busca do backend (SQLite) para garantir integridade e mensagens persistidas
    let reconstructedMessages: ChatMessage[] = [];
    try {
      const details = await fetchChatSessionDetails(sid);
      if (details) {
        let reconstructed: ChatMessage[] = [];
        const tasksList = Array.isArray(details.tasks) ? details.tasks : [];
        if (details.messages && details.messages.length > 0) {
          let assistantIdx = 0;
          reconstructed = details.messages.map((m: any) => {
            const isUser = m.role === 'user';
            let matchedTaskData: any = undefined;
            if (!isUser && tasksList.length > 0) {
              const contentStr = String(m.content || '').trim();
              const bySummary = tasksList.find(
                (t: any) =>
                  typeof (t?.state?.final_summary || t?.final_summary) === 'string' &&
                  String(t?.state?.final_summary || t?.final_summary).trim() === contentStr
              );
              const fallbackByOrder = tasksList[assistantIdx];
              const chosen = bySummary || fallbackByOrder;
              if (chosen) {
                matchedTaskData = chosen.state || chosen;
              }
              assistantIdx += 1;
            }
            return {
              sender: isUser ? 'user' : 'jarvis',
              text: m.content || '',
              taskData: matchedTaskData,
              timestamp: m.created_at
                ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            };
          });
        } else if (tasksList.length > 0) {
          tasksList.forEach((t: any) => {
            const time = t.created_at
              ? new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            if (t.prompt) {
              reconstructed.push({ sender: 'user', text: t.prompt, timestamp: time });
            }
            const summary = t.state?.final_summary || t.final_summary;
            if (summary) {
              reconstructed.push({
                sender: 'jarvis',
                text: summary,
                taskData: t.state || t,
                timestamp: time,
              });
            }
          });
        }

        if (reconstructed.length > 0) {
          reconstructedMessages = reconstructed;
          setMessages(reconstructed);
          saveSessionMessagesLocally(sid, reconstructed);
        } else if (!local || local.length === 0) {
          setMessages([]);
        }
      }
    } catch (e) {
      console.warn('Falha ao restaurar mensagens da sessão do backend:', e);
      if (!local || local.length === 0) {
        setMessages([]);
      }
    }

    // Atualiza aba da conversa com nome amigável (agente, catálogo local, 1ª mensagem ou 'Novo Chat')
    const agentKey = sid.startsWith('agent_')
      ? sid.slice(6)
      : sid.startsWith('agent-')
        ? sid.slice(6)
        : null;
    const matchedAgent = agentKey
      ? myAgents.find((a) => a.role === agentKey)
      : null;

    const catalogTitle = getLocalSessionsCatalog().find((s) => s.id === sid)?.title;
    const firstUserMsg = (
      reconstructedMessages.find((m) => m.sender === 'user')?.text ||
      local?.find((m) => m.sender === 'user')?.text ||
      ''
    ).trim();
    const derivedMsgTitle = firstUserMsg
      ? firstUserMsg.slice(0, 28) + (firstUserMsg.length > 28 ? '...' : '')
      : '';

    const resolvedTitle =
      (titleHint && !titleHint.startsWith('Chat sess_') ? titleHint : '') ||
      (matchedAgent ? getAgentProperName(matchedAgent) : agentKey ? agentKey.toUpperCase() : '') ||
      (catalogTitle && !catalogTitle.startsWith('Chat sess_') ? catalogTitle : '') ||
      derivedMsgTitle ||
      'Novo Chat';

    setTabs((prev) => {
      const exists = prev.find((t) => t.id === sid);
      if (exists) {
        return resolvedTitle && exists.title !== resolvedTitle
          ? prev.map((t) => (t.id === sid ? { ...t, title: resolvedTitle } : t))
          : prev;
      }
      return [...prev, { id: sid, title: resolvedTitle }];
    });
    setActiveTabId(sid);
  }, [setSessionId, setMessages, myAgents]);

  // Se o App ou Sidebar solicitar carregar uma sessão específica ou iniciar nova conversa
  useEffect(() => {
    if (targetSessionId) {
      if (targetSessionId.startsWith('new_')) {
        handleOpenNewChatTab();
      } else if (targetSessionId !== sessionId) {
        loadSessionMessages(targetSessionId);
      }
    }
  }, [targetSessionId]);

  // Reidratação inicial da sessão ativa caso o banco SQLite tenha dados não sincronizados localmente
  useEffect(() => {
    if (sessionId && !messages.some((m) => m.sender === 'user') && !sessionId.startsWith('new_') && sessionId !== 'default') {
      loadSessionMessages(sessionId);
    }
  }, []);

  // Auto-scroll suave para a mensagem mais recente
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleDetachProject = () => {
    setActiveProjectId(null);
    if (onDetachProject) {
      onDetachProject();
    }
  };

  const handleSelectSession = (sid: string, titleHint?: string) => {
    loadSessionMessages(sid, titleHint);
  };

  const handleOpenNewChatTab = () => {
    const newId = handleNewChat();
    setActiveArtifact(null);
    setTabs((prev) => [...prev, { id: newId, title: 'Novo Chat' }]);
    setActiveTabId(newId);
  };

  const handleFormSubmit = useCallback((overrideText?: string, modelOverride?: string) => {
    const textToSend = overrideText || input;
    if (!textToSend.trim() || loading) return;
    if (!overrideText || overrideText === input) {
      setInput('');
    }

    // Atualiza título da aba ativa caso ainda seja o nome genérico inicial
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId &&
        (t.title === assistantName ||
          t.title === 'JARVIS Master' ||
          t.title === 'Novo Chat' ||
          t.title === 'Calmon Dev' ||
          t.title.startsWith('Chat sess_'))
          ? { ...t, title: textToSend.slice(0, 24) + (textToSend.length > 24 ? '...' : '') }
          : t
      )
    );

    const rawChosenModel = modelOverride ?? selectedModel;
    const effectiveModelOverride =
      rawChosenModel && rawChosenModel !== 'auto' ? rawChosenModel : undefined;

    submitStream(textToSend, effectiveModelOverride, {
      enableWebSearch: webSearchEnabled,
      assistantName,
      onRunEvent: handleRunStreamEvent,
    });
  }, [input, loading, activeTabId, submitStream, selectedModel, webSearchEnabled, assistantName, handleRunStreamEvent]);

  // Consome prompt inicial enviado a partir da Visão Geral
  useEffect(() => {
    if (!initialPrompt || !initialPrompt.trim() || loading) return;
    const promptToRun = initialPrompt.trim();
    onInitialPromptConsumed?.();
    handleFormSubmit(promptToRun, selectedModel);
  }, [initialPrompt, loading, handleFormSubmit, onInitialPromptConsumed, selectedModel]);

  const hasUserMessages = messages.some((m) => m.sender === 'user');

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        backgroundColor: 'var(--bg-primary)',
      }}
    >
      {/* Sub-rail Esquerdo de Conversas (auto-oculta quando Artefatos ou Workspace está aberto, ou em telas estreitas) */}
      <OpenBotConversationRail
        activeSessionId={sessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleOpenNewChatTab}
        isCollapsed={!isRailOpen || Boolean(activeArtifact) || Boolean(workspaceOpen)}
      />

      {/* Coluna Principal do Chat */}
      <div
        style={{
          flex: activeArtifact || workspaceOpen ? '1 1 55%' : '1 1 auto',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          transition: 'flex 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          borderRight: activeArtifact || workspaceOpen ? '1px solid var(--border-color)' : 'none',
        }}
      >
        {/* Header do Chat no Padrão OpenBot com Abas e Seletor de Modelo */}
        <OpenBotChatHeader
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={(tid) => {
            setActiveTabId(tid);
            handleSelectSession(tid);
          }}
          onCloseTab={(tid) => {
            if (tabs.length <= 1) return;
            const remaining = tabs.filter((t) => t.id !== tid);
            setTabs(remaining);
            if (activeTabId === tid) {
              const next = remaining[remaining.length - 1];
              setActiveTabId(next.id);
              handleSelectSession(next.id);
            }
          }}
          onNewTab={handleOpenNewChatTab}
          onToggleRail={() => setIsRailOpen((prev) => !prev)}
          isRailOpen={isRailOpen}
          selectedModel={selectedModel}
          onSelectModel={handleSelectModel}
          availableModels={availableModels}
          activeProjectId={activeProjectId}
          activeProjectName={activeProject?.name}
          onDetachProject={handleDetachProject}
          onOpenProjectModal={() => setShowProjectModal(true)}
          onExportChat={handleExportChat}
          webSearchEnabled={webSearchEnabled}
          onToggleWebSearch={() => setWebSearchEnabled((prev) => !prev)}
          onOpenArtifactStudio={() => {
            setWorkspaceOpen(false);
            setActiveArtifact((prev) =>
              prev?.studioMode
                ? prev
                : {
                    title: 'Estúdio de Artefatos (.PPTX / .PDF / .PNG)',
                    studioMode: true,
                    structuredArtifact: prev?.structuredArtifact || null,
                  }
            );
          }}
          workspaceOpen={workspaceOpen && !activeArtifact}
          onToggleWorkspace={() => {
            setActiveArtifact(null);
            setWorkspaceOpen((prev) => {
              const next = !prev;
              if (next && sessionId) {
                void loadSessionRuns(sessionId, activeRunDetail?.run?.id);
              }
              return next;
            });
          }}
          workspaceStepCount={activeRunDetail?.steps?.length || 0}
          workspaceRunning={activeRunDetail?.run?.status === 'running' || loading}
          recoverableRunsCount={recoverableRunsCount}
          compactHeader={Boolean(activeArtifact || workspaceOpen || isNarrowViewport)}
        />

        {/* Tela inicial do Chat */}
        {!hasUserMessages ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '24px 20px calc(28px + var(--jarvis-dock-clearance, 0px))',
              overflowY: 'auto',
              animation: 'fadeIn 0.25s ease-out',
            }}
          >
            <div
              style={{
                margin: 'auto 0',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '22px',
              }}
            >
            <div
              onClick={() => !activeAgent && setGreetingIndex((prev) => (prev + 1) % GREETINGS.length)}
              style={{
                cursor: activeAgent ? 'default' : 'pointer',
                userSelect: 'none',
                textAlign: 'center',
                maxWidth: '640px',
              }}
              title={activeAgent ? undefined : 'Clique para alternar saudação'}
            >
              {activeAgent && (
                <div
                  style={{
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    color: activeAgent.color || 'var(--accent-light)',
                    marginBottom: '6px',
                  }}
                >
                  Especialista ativo · {activeAgent.categoryLabel}
                </div>
              )}
              <h1
                style={{
                  fontSize: 'clamp(1.65rem, 2.8vw, 2.15rem)',
                  margin: 0,
                  fontWeight: 700,
                  letterSpacing: '-0.03em',
                  color: 'var(--text-primary)',
                }}
              >
                {activeAgent ? `Conversando com ${activeAgent.name}` : GREETINGS[greetingIndex]}
              </h1>
              <p style={{ margin: '8px 0 0', fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {activeAgent
                  ? activeAgent.mission
                  : 'Converse naturalmente, digite @ para chamar um especialista ou / para comandos rápidos.'}
              </p>
            </div>

            <ChatInput
              input={input}
              onInputChange={(val) => setInput(val)}
              onSubmit={handleFormSubmit}
              loading={loading}
              onStopGeneration={handleStopGeneration}
              isListening={isListening}
              onToggleVoiceInput={() =>
                handleToggleVoiceInput((text, isLive) => {
                  if (isLive) {
                    setInput(text);
                  } else {
                    setInput((prev) => (prev ? `${prev} ${text}` : text));
                  }
                }, input)
              }
              activeProjectId={activeProjectId}
              activeProjectName={activeProject?.name}
              onDetachProject={handleDetachProject}
              onOpenProjectModal={() => setShowProjectModal(true)}
              isFloatingCenter={true}
              selectedModelId={selectedModel}
              onSelectModelId={handleSelectModel}
              availableModels={availableModels}
            />

            {/* Sugestões clicáveis para descoberta imediata */}
            <div className="jarvis-starter-grid" aria-label="Sugestões para começar">
              {STARTER_CARDS.map((card) => {
                const Icon = card.icon;
                return (
                  <button
                    key={card.title}
                    type="button"
                    className="jarvis-choice-card"
                    onClick={() => handleFormSubmit(card.prompt, selectedModel)}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        width: '100%',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontWeight: 600,
                          fontSize: '0.84rem',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <Icon size={15} color="var(--accent-light)" />
                        {card.title}
                      </span>
                      <ArrowUpRight size={14} color="var(--text-muted)" />
                    </div>
                    <p
                      style={{
                        margin: '6px 0 0',
                        fontSize: '0.78rem',
                        color: 'var(--text-secondary)',
                        lineHeight: 1.45,
                      }}
                    >
                      {card.desc}
                    </p>
                  </button>
                );
              })}
            </div>
            </div>
          </div>
        ) : (
          <>
            {/* Área de Mensagens centralizada para leitura confortável */}
            <div
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-label="Mensagens da conversa"
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '24px 20px',
              }}
            >
              <div
                style={{
                  maxWidth: '860px',
                  width: '100%',
                  margin: '0 auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '22px',
                }}
              >
                {messages.map((m, idx) => (
                  <MessageBubble
                    key={`${m.timestamp}-${idx}`}
                    message={m}
                    onOpenArtifact={(art) => setActiveArtifact(art)}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Cápsula de Entrada Fixada na Base */}
            <div
              style={{
                padding: '12px 20px calc(18px + var(--jarvis-dock-clearance, 0px))',
                backgroundColor: 'var(--bg-primary)',
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <ChatInput
                input={input}
                onInputChange={(val) => setInput(val)}
                onSubmit={handleFormSubmit}
                loading={loading}
                onStopGeneration={handleStopGeneration}
                isListening={isListening}
                onToggleVoiceInput={() =>
                  handleToggleVoiceInput((text, isLive) => {
                    if (isLive) {
                      setInput(text);
                    } else {
                      setInput((prev) => (prev ? `${prev} ${text}` : text));
                    }
                  }, input)
                }
                activeProjectId={activeProjectId}
                activeProjectName={activeProject?.name}
                onDetachProject={handleDetachProject}
                onOpenProjectModal={() => setShowProjectModal(true)}
                isFloatingCenter={false}
                selectedModelId={selectedModel}
                onSelectModelId={handleSelectModel}
                availableModels={availableModels}
              />
            </div>
          </>
        )}
      </div>

      {/* Coluna Direita: Live Artifact Canvas ou Workspace Vivo do Agente */}
      {activeArtifact ? (
        <ArtifactCanvas
          artifact={activeArtifact}
          onClose={() => setActiveArtifact(null)}
        />
      ) : workspaceOpen ? (
        <AgentRunWorkspacePanel
          runs={sessionRuns}
          activeDetail={activeRunDetail}
          loading={loadingRuns}
          resuming={resumingRun}
          onSelectRun={(runId) => void handleSelectRun(runId)}
          onResumeCheckpoint={(runId, stepIdx) => void handleResumeCheckpoint(runId, stepIdx)}
          onRunDetailUpdated={(detail) => {
            setActiveRunDetail(detail);
            setSessionRuns((prev) =>
              prev.some((r) => r.id === detail.run.id)
                ? prev.map((r) => (r.id === detail.run.id ? detail.run : r))
                : [detail.run, ...prev]
            );
          }}
          onRefresh={() => void loadSessionRuns(sessionId, activeRunDetail?.run?.id)}
          onClose={() => setWorkspaceOpen(false)}
        />
      ) : null}

      {/* Modal para Anexar / Selecionar Projeto no Chat */}
      <ChatProjectModal
        isOpen={showProjectModal}
        onClose={() => setShowProjectModal(false)}
        availableProjects={availableProjects}
        activeProjectId={activeProjectId}
        onSelectProject={(pId) => setActiveProjectId(pId)}
        onProjectsReload={loadProjects}
      />
    </div>
  );
};
