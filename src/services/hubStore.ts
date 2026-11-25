/**
 * Fase 5 — Store & Cache Assíncrono Unificado do Hub (React 19 `useSyncExternalStore`).
 *
 * Centraliza cache de metadados de domínio (informações do Cérebro, diagnóstico de
 * infraestrutura, relatório de versões de pacotes e execuções recentes) com
 * deduplicação de requisições em voo e invalidação reativa — substituindo
 * eventos globais fragmentados no `window`.
 */

import { useSyncExternalStore } from 'react';

export interface HubCacheEntry<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
}

type Listener = () => void;

export class HubDomainStore {
  private readonly entries = new Map<string, HubCacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<Listener>();
  private version = 0;

  private notify(): void {
    this.version += 1;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Ignora erro de assinante individual para não bloquear outros consumidores
      }
    }
  }

  public subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getVersion = (): number => this.version;

  public getEntry<T>(key: string): HubCacheEntry<T> {
    const existing = this.entries.get(key) as HubCacheEntry<T> | undefined;
    if (existing) return existing;
    return { data: null, loading: false, error: null, updatedAt: null };
  }

  public setData<T>(key: string, data: T): void {
    this.entries.set(key, {
      data,
      loading: false,
      error: null,
      updatedAt: Date.now(),
    });
    this.notify();
  }

  public invalidate(keyPrefix?: string): void {
    if (!keyPrefix) {
      this.entries.clear();
      this.notify();
      return;
    }
    let changed = false;
    for (const key of Array.from(this.entries.keys())) {
      if (key === keyPrefix || key.startsWith(`${keyPrefix}:`)) {
        this.entries.delete(key);
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  /**
   * Busca com deduplicação em voo e cache TTL (stale-while-revalidate).
   */
  public async fetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: { ttlMs?: number; force?: boolean } = {}
  ): Promise<T> {
    const ttlMs = options.ttlMs ?? 15_000;
    const current = this.getEntry<T>(key);
    const isFresh =
      !options.force &&
      current.data !== null &&
      current.updatedAt !== null &&
      Date.now() - current.updatedAt < ttlMs;

    if (isFresh) {
      return current.data as T;
    }

    const existingPromise = this.inflight.get(key) as Promise<T> | undefined;
    if (existingPromise) {
      return existingPromise;
    }

    this.entries.set(key, {
      data: current.data,
      loading: true,
      error: null,
      updatedAt: current.updatedAt,
    });
    this.notify();

    const promise = fetcher()
      .then((value) => {
        this.entries.set(key, {
          data: value,
          loading: false,
          error: null,
          updatedAt: Date.now(),
        });
        this.notify();
        return value;
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Falha ao sincronizar estado.';
        this.entries.set(key, {
          data: current.data,
          loading: false,
          error: msg,
          updatedAt: current.updatedAt,
        });
        this.notify();
        throw err;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }
}

export const hubStore = new HubDomainStore();

export function useHubCacheEntry<T>(key: string): HubCacheEntry<T> {
  useSyncExternalStore(hubStore.subscribe, hubStore.getVersion, hubStore.getVersion);
  return hubStore.getEntry<T>(key);
}
