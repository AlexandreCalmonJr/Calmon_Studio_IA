/**
 * Fase 5 — Barramento Tipado e Cache Unificado de Eventos do Frontend (`appBus`).
 *
 * Substitui `window.dispatchEvent(new CustomEvent(...))` e `window.addEventListener(...)`
 * soltos por um pub/sub tipado em memória com unsubscribe automático e zero vazamento global.
 */

export interface AppEventMap {
  'jarvis:agents-updated': void;
  'jarvis:open-agent-chat': { agentId: string; agentName?: string };
  'jarvis:session-deleted': { sessionId: string };
  'jarvis:brain-switched': { id?: string; name?: string; mode?: string; profileId?: string; baseUrl?: string };
  'jarvis:open-android-pairing': void;
  'jarvis:open-access-management': void;
  'jarvis_ui_preferences_changed': void;
  'jarvis_voice_prefs_changed': void;
  'jarvis_rail_agents_mode_changed': void;
}

export type AppEventName = keyof AppEventMap;
type Listener<T> = (detail: T) => void;

class TypedAppEventBus {
  private readonly listeners = new Map<AppEventName, Set<Listener<any>>>();

  public emit<K extends AppEventName>(
    event: K,
    ...args: AppEventMap[K] extends void ? [] : [AppEventMap[K]]
  ): void {
    const detail = args[0] as AppEventMap[K];
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const fn of Array.from(set)) {
      try {
        fn(detail);
      } catch (err) {
        console.warn(`[appBus] Erro no listener de ${String(event)}:`, err);
      }
    }
  }

  public on<K extends AppEventName>(event: K, handler: Listener<AppEventMap[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
      if (set && set.size === 0) {
        this.listeners.delete(event);
      }
    };
  }
}

export const appBus = new TypedAppEventBus();

export function emitAppEvent<K extends AppEventName>(
  event: K,
  ...args: AppEventMap[K] extends void ? [] : [AppEventMap[K]]
): void {
  appBus.emit(event, ...args);
}

export function subscribeAppEvent<K extends AppEventName>(
  event: K,
  handler: Listener<AppEventMap[K]>
): () => void {
  return appBus.on(event, handler);
}
