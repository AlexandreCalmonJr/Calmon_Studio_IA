import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Plus,
  Search,
  Trash2,
  MessageSquare,
  Clock,
  Database,
} from 'lucide-react';
import { fetchChatSessions, deleteChatSession, fetchChatSessionTasks } from '../../api';
import { ChatSessionItem, ChatMessage } from '../../types';
import { getAccountStorageKey } from '../../services/accountScope';
import { ConfirmDialog } from '../../shared/common/ConfirmDialog';

export interface LocalSessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export const STORAGE_CATALOG_KEY = 'jarvis_sessions_catalog_v1';
export const MAX_PERSISTED_MESSAGES_PER_SESSION = 100;
export const MAX_PERSISTED_CATALOG_ITEMS = 60;

/**
 * Detecta se uma exceção do localStorage é decorrente de quota estourada no navegador.
 */
export function isQuotaExceededError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object') {
    const error = err as any;
    if (
      error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014
    ) {
      return true;
    }
    if (typeof error.message === 'string' && /quota|storage full|exceeded/i.test(error.message)) {
      return true;
    }
  }
  return false;
}

/**
 * Limita o número de mensagens para persistência local mantendo as mais recentes.
 */
export function clampMessagesForPersistence(
  messages: ChatMessage[],
  maxCount: number = MAX_PERSISTED_MESSAGES_PER_SESSION
): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  if (messages.length <= maxCount) return messages;
  return messages.slice(-maxCount);
}

export function getLocalSessionsCatalog(): LocalSessionMeta[] {
  try {
    const raw = localStorage.getItem(getAccountStorageKey(STORAGE_CATALOG_KEY));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Erro ao ler catálogo local de sessões:', e);
  }
  return [];
}

/**
 * Descarta as sessões locais mais antigas para liberar quota no localStorage.
 * Retorna a quantidade de sessões descartadas.
 */
export function pruneOldestLocalSessions(
  keepSessionId?: string,
  countToPrune: number = 3
): number {
  try {
    const catalog = getLocalSessionsCatalog();
    let pruned = 0;
    const remainingCatalog: LocalSessionMeta[] = [];

    if (catalog && catalog.length > 0) {
      // Ordena do mais antigo para o mais recente
      const sorted = [...catalog].sort((a, b) => {
        const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime() || 0;
        const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime() || 0;
        return timeA - timeB;
      });

      for (const session of sorted) {
        if (session.id !== keepSessionId && pruned < countToPrune) {
          try {
            localStorage.removeItem(getAccountStorageKey(`jarvis_session_messages_${session.id}`));
          } catch {
            // ignore
          }
          pruned++;
        } else {
          remainingCatalog.push(session);
        }
      }

      if (pruned > 0) {
        // Reordena pelo mais recente para o catálogo remanescente
        remainingCatalog.sort((a, b) => {
          const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime() || 0;
          const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime() || 0;
          return timeB - timeA;
        });
        saveLocalSessionsCatalog(remainingCatalog);
      }
    }

    // Se ainda precisa purgar ou o catálogo estava vazio/só continha a sessão ativa,
    // busca por chaves órfãs de mensagens no localStorage que não pertençam à sessão ativa
    if (pruned < countToPrune && typeof localStorage !== 'undefined') {
      try {
        const accountSuffix = getAccountStorageKey('__probe__').slice('__probe__'.length);
        const prefix = 'jarvis_session_messages_';
        const activeKey = keepSessionId ? getAccountStorageKey(`jarvis_session_messages_${keepSessionId}`) : null;
        const keysToRemove: string[] = [];

        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(prefix) && key.endsWith(accountSuffix) && key !== activeKey) {
            keysToRemove.push(key);
            if (pruned + keysToRemove.length >= countToPrune) break;
          }
        }

        for (const k of keysToRemove) {
          try {
            localStorage.removeItem(k);
            pruned++;
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore localStorage scan issues
      }
    }

    return pruned;
  } catch (e) {
    console.warn('Erro ao descartar sessões antigas para liberar quota:', e);
    return 0;
  }
}

export function saveLocalSessionsCatalog(catalog: LocalSessionMeta[]): void {
  try {
    const list = Array.isArray(catalog) ? catalog : [];
    const clamped = list.slice(0, MAX_PERSISTED_CATALOG_ITEMS);

    // Remove mensagens de sessões que foram cortadas além do teto do catálogo
    if (list.length > MAX_PERSISTED_CATALOG_ITEMS) {
      const dropped = list.slice(MAX_PERSISTED_CATALOG_ITEMS);
      for (const d of dropped) {
        if (d && d.id) {
          try {
            localStorage.removeItem(getAccountStorageKey(`jarvis_session_messages_${d.id}`));
          } catch {
            // ignore
          }
        }
      }
    }

    localStorage.setItem(getAccountStorageKey(STORAGE_CATALOG_KEY), JSON.stringify(clamped));
  } catch (e) {
    if (isQuotaExceededError(e)) {
      console.warn('[QuotaExceededError] Quota estourada ao salvar catálogo. Reduzindo para itens essenciais...');
      try {
        const minimal = (Array.isArray(catalog) ? catalog : []).slice(0, 20);
        localStorage.setItem(getAccountStorageKey(STORAGE_CATALOG_KEY), JSON.stringify(minimal));
      } catch (inner) {
        console.warn('Falha ao salvar catálogo mínimo:', inner);
      }
    } else {
      console.warn('Erro ao salvar catálogo local de sessões:', e);
    }
  }
}

export function saveSessionMessagesLocally(sessionId: string, messages: ChatMessage[]): boolean {
  if (!sessionId) return false;
  const storageKey = getAccountStorageKey(`jarvis_session_messages_${sessionId}`);
  let messagesToSave = clampMessagesForPersistence(messages, MAX_PERSISTED_MESSAGES_PER_SESSION);

  // Tentativa primária: salvar respeitando o teto de 100 mensagens
  try {
    localStorage.setItem(storageKey, JSON.stringify(messagesToSave));
    return true;
  } catch (e) {
    if (!isQuotaExceededError(e)) {
      console.warn('Erro ao persistir mensagens da sessão:', e);
      return false;
    }
    console.warn(`[QuotaExceededError] Quota do localStorage atingida para ${sessionId}. Iniciando purga defensiva...`);
  }

  // Nível 1: purga das 3 sessões mais antigas
  pruneOldestLocalSessions(sessionId, 3);
  try {
    localStorage.setItem(storageKey, JSON.stringify(messagesToSave));
    return true;
  } catch (e2) {
    if (!isQuotaExceededError(e2)) {
      console.warn('Erro após purga nível 1:', e2);
      return false;
    }
  }

  // Nível 2: purga de mais 5 sessões e redução defensiva para 50 mensagens
  pruneOldestLocalSessions(sessionId, 5);
  messagesToSave = clampMessagesForPersistence(messages, 50);
  try {
    localStorage.setItem(storageKey, JSON.stringify(messagesToSave));
    return true;
  } catch (e3) {
    if (!isQuotaExceededError(e3)) {
      console.warn('Erro após purga nível 2:', e3);
      return false;
    }
  }

  // Nível 3: emergência — descarte agressivo mantendo apenas as últimas 15 mensagens
  messagesToSave = clampMessagesForPersistence(messages, 15);
  try {
    localStorage.setItem(storageKey, JSON.stringify(messagesToSave));
    return true;
  } catch (e4) {
    if (!isQuotaExceededError(e4)) {
      console.warn('Erro após purga nível 3:', e4);
      return false;
    }
  }

  // Nível 4: emergência máxima — compactação removendo metadados pesados (ex: taskData volumoso)
  // e retendo as últimas 8 mensagens essenciais
  try {
    const compactMessages: ChatMessage[] = clampMessagesForPersistence(messages, 8).map((m) => ({
      sender: m.sender,
      text: typeof m.text === 'string' && m.text.length > 2000 ? m.text.slice(0, 2000) + '... [truncado por quota]' : m.text,
      timestamp: m.timestamp,
    }));
    localStorage.setItem(storageKey, JSON.stringify(compactMessages));
    return true;
  } catch (finalErr) {
    console.error('Falha crítica de quota no localStorage mesmo após compactação extrema:', finalErr);
    return false;
  }
}

export function getSessionMessagesLocally(sessionId: string): ChatMessage[] | null {
  try {
    const raw = localStorage.getItem(getAccountStorageKey(`jarvis_session_messages_${sessionId}`));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.warn('Erro ao ler mensagens da sessão:', e);
  }
  return null;
}

export function removeSessionLocally(sessionId: string): void {
  try {
    localStorage.removeItem(getAccountStorageKey(`jarvis_session_messages_${sessionId}`));
    const cat = getLocalSessionsCatalog().filter((s) => s.id !== sessionId);
    saveLocalSessionsCatalog(cat);
  } catch (e) {
    console.warn('Erro ao remover sessão local:', e);
  }
}

interface ChatHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentSessionId: string;
  onSelectSession: (sessionId: string, loadedMessages?: ChatMessage[]) => void;
  onNewChat: () => void;
}

export const ChatHistoryDrawer: React.FC<ChatHistoryDrawerProps> = ({
  isOpen,
  onClose,
  currentSessionId,
  onSelectSession,
  onNewChat,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sessions, setSessions] = useState<LocalSessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Carrega e sincroniza sessões do backend + local
  const refreshSessions = async () => {
    setLoading(true);
    try {
      const localCat = getLocalSessionsCatalog();
      let remoteSessions: ChatSessionItem[] = [];
      try {
        remoteSessions = await fetchChatSessions();
        setHistoryError(null);
      } catch (e) {
        setHistoryError(e instanceof Error ? e.message : 'Falha ao carregar histórico remoto.');
        remoteSessions = [];
      }

      // Combina catálogo local com tarefas persistidas no SQLite
      const map = new Map<string, LocalSessionMeta>();

      // Insere locais
      localCat.forEach((s) => {
        map.set(s.id, s);
      });

      // Insere ou complementa com os remotos
      remoteSessions.forEach((r) => {
        const existing = map.get(r.session_id);
        const title = r.title || (r.first_prompt ? r.first_prompt.slice(0, 50) : 'Conversa com Especialistas');
        if (existing) {
          map.set(r.session_id, {
            ...existing,
            title: existing.title || title,
            messageCount: Math.max(existing.messageCount, r.task_count * 2),
            updatedAt: r.last_activity || existing.updatedAt,
          });
        } else {
          map.set(r.session_id, {
            id: r.session_id,
            title,
            createdAt: r.last_activity || new Date().toISOString(),
            updatedAt: r.last_activity || new Date().toISOString(),
            messageCount: r.task_count * 2,
          });
        }
      });

      const merged = Array.from(map.values()).sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      setSessions(merged);
      saveLocalSessionsCatalog(merged);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      refreshSessions();
    }
  }, [isOpen]);

  const handleDelete = (e: React.MouseEvent, sid: string) => {
    e.stopPropagation();
    setPendingDeleteId(sid);
  };

  const confirmDeleteSession = async () => {
    if (!pendingDeleteId) return;
    const sid = pendingDeleteId;
    setDeletingId(sid);
    try {
      await deleteChatSession(sid);
      removeSessionLocally(sid);
      setSessions((prev) => prev.filter((s) => s.id !== sid));
      setHistoryError(null);
      setPendingDeleteId(null);
      if (sid === currentSessionId) {
        onNewChat();
      }
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Não foi possível excluir a conversa.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSelect = async (sid: string) => {
    // Tenta primeiro carregar do localStorage
    let msgs = getSessionMessagesLocally(sid);
    if (!msgs || msgs.length === 0) {
      // Se não houver em cache local, busca as tarefas do SQLite no backend
      try {
        const tasks = await fetchChatSessionTasks(sid);
        if (tasks && tasks.length > 0) {
          const reconstructed: ChatMessage[] = [];
          tasks.forEach((t: any) => {
            const time = new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            reconstructed.push({
              sender: 'user',
              text: t.prompt,
              timestamp: time,
            });
            reconstructed.push({
              sender: 'jarvis',
              text: t.state?.final_summary || 'Tarefa concluída.',
              taskData: t.state,
              timestamp: time,
            });
          });
          msgs = reconstructed;
          saveSessionMessagesLocally(sid, reconstructed);
        }
      } catch (err) {
        console.warn('Erro ao restaurar tarefas do backend:', err);
      }
    }

    onSelectSession(sid, msgs || undefined);
    onClose();
  };

  // Filtragem de busca
  const filteredSessions = useMemo(() => {
    if (!searchTerm.trim()) return sessions;
    const q = searchTerm.toLowerCase();
    return sessions.filter(
      (s) => s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
    );
  }, [sessions, searchTerm]);

  // Agrupamento temporal
  const groupedSessions = useMemo(() => {
    const today: LocalSessionMeta[] = [];
    const yesterday: LocalSessionMeta[] = [];
    const last7Days: LocalSessionMeta[] = [];
    const older: LocalSessionMeta[] = [];

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const startOf7Days = startOfToday - 6 * 86400000;

    filteredSessions.forEach((s) => {
      const t = new Date(s.updatedAt).getTime();
      if (t >= startOfToday) {
        today.push(s);
      } else if (t >= startOfYesterday) {
        yesterday.push(s);
      } else if (t >= startOf7Days) {
        last7Days.push(s);
      } else {
        older.push(s);
      }
    });

    return [
      { label: 'Hoje', items: today },
      { label: 'Ontem', items: yesterday },
      { label: 'Últimos 7 dias', items: last7Days },
      { label: 'Mais antigas', items: older },
    ].filter((g) => g.items.length > 0);
  }, [filteredSessions]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999,
        display: 'flex',
        animation: 'fadeIn 0.2s ease-out',
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)',
        }}
      />

      {/* Drawer Panel */}
      <div
        style={{
          position: 'relative',
          width: '360px',
          maxWidth: '85vw',
          height: '100%',
          backgroundColor: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border-color)',
          boxShadow: '10px 0 35px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1000,
        }}
      >
        {/* Top Header */}
        <div
          style={{
            padding: '16px 18px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--bg-tertiary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Clock size={18} color="var(--accent-color)" />
            <h3 style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Histórico de Conversas
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon-sm"
            title="Fechar histórico"
            aria-label="Fechar histórico"
          >
            <X size={16} />
          </button>
        </div>

        {/* Action: Nova Conversa */}
        <div style={{ padding: '14px 18px 10px' }}>
          <button
            type="button"
            onClick={() => {
              onNewChat();
              onClose();
            }}
            className="btn btn-primary btn-block"
          >
            <Plus size={16} />
            <span>Nova Conversa</span>
          </button>
        </div>

        {/* Search Bar */}
        <div style={{ padding: '0 18px 12px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
              padding: '7px 12px',
            }}
          >
            <Search size={14} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Pesquisar conversas..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text-primary)',
                fontSize: '0.82rem',
              }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="btn btn-ghost btn-icon-sm"
                title="Limpar pesquisa"
                aria-label="Limpar pesquisa"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Sessions List */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 12px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {historyError && (
            <div role="alert" style={{ margin: '8px 6px', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(248, 113, 113, 0.3)', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
              {historyError}
            </div>
          )}
          {loading && sessions.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
              Carregando histórico...
            </div>
          ) : groupedSessions.length === 0 ? (
            <div
              style={{
                padding: '36px 16px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '0.84rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <MessageSquare size={28} color="rgba(255, 255, 255, 0.2)" />
              <span>Nenhuma conversa encontrada.</span>
            </div>
          ) : (
            groupedSessions.map((group) => (
              <div key={group.label}>
                <div
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--text-muted)',
                    padding: '4px 10px 8px',
                  }}
                >
                  {group.label}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {group.items.map((item) => {
                    const isActive = item.id === currentSessionId;
                    const isDeleting = deletingId === item.id;

                    return (
                      <div
                        key={item.id}
                        onClick={() => handleSelect(item.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 12px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          backgroundColor: isActive ? 'var(--accent-soft)' : 'transparent',
                          border: isActive
                            ? '1px solid var(--border-accent)'
                            : '1px solid transparent',
                          transition: 'all 0.15s ease',
                          gap: '8px',
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                          <MessageSquare
                            size={16}
                            color={isActive ? 'var(--accent-color)' : 'var(--text-muted)'}
                            style={{ flexShrink: 0 }}
                          />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                fontSize: '0.84rem',
                                fontWeight: isActive ? 600 : 500,
                                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {item.title}
                            </div>
                            <div
                              style={{
                                fontSize: '0.7rem',
                                color: 'var(--text-muted)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                marginTop: '2px',
                              }}
                            >
                              <span>
                                {new Date(item.updatedAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              {item.messageCount > 0 && (
                                <>
                                  <span>•</span>
                                  <span>{item.messageCount} msgs</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Botão de Excluir */}
                        <button
                          type="button"
                          onClick={(e) => handleDelete(e, item.id)}
                          disabled={isDeleting}
                          className="btn btn-danger-ghost btn-icon-sm"
                          title="Excluir conversa"
                          aria-label={`Excluir conversa ${item.title}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Info */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-tertiary)',
            fontSize: '0.72rem',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Database size={13} color="var(--accent-color)" />
            <span>Persistência Local SQLite</span>
          </div>
          <span>{sessions.length} conversas</span>
        </div>
      </div>

      <ConfirmDialog
        isOpen={Boolean(pendingDeleteId)}
        title="Excluir conversa"
        description="Excluir esta conversa do histórico?"
        confirmLabel="Excluir"
        tone="danger"
        isLoading={Boolean(deletingId)}
        onConfirm={confirmDeleteSession}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
};