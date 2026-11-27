import { useCallback, useEffect, useState } from 'react';
import {
  OfflineCommandItem,
  enqueueOfflineCommand,
} from '../../services/voiceCompanion';
import { enqueueRemoteCommand, sendVoiceTurn } from '../../services/api';

const OFFLINE_QUEUE_STORAGE_KEY = 'jarvis_offline_queue_v1';

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return isOnline;
}

function readOfflineQueue(): OfflineCommandItem[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useOfflineQueue() {
  const isOnline = useOnlineStatus();
  const [queue, setQueue] = useState<OfflineCommandItem[]>(readOfflineQueue);
  const [syncing, setSyncing] = useState(false);

  const persist = (next: OfflineCommandItem[]) => {
    setQueue(next);
    try {
      localStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent('jarvis:offline-queue-updated', { detail: next }));
    } catch {
      // ignore storage quota
    }
  };

  useEffect(() => {
    const onUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent<OfflineCommandItem[]>).detail;
      if (Array.isArray(detail)) setQueue(detail);
    };
    window.addEventListener('jarvis:offline-queue-updated', onUpdated);
    return () => window.removeEventListener('jarvis:offline-queue-updated', onUpdated);
  }, []);

  const addCommand = useCallback((text: string, target: 'voice' | 'companion' = 'voice') => {
    const next = enqueueOfflineCommand(readOfflineQueue(), text, target);
    persist(next);
    return next;
  }, []);

  const removeCommand = useCallback((id: string) => {
    const next = readOfflineQueue().filter((item) => item.id !== id);
    persist(next);
  }, []);

  const syncNow = useCallback(async () => {
    const current = readOfflineQueue();
    if (current.length === 0) return { synced: 0 };
    setSyncing(true);
    let synced = 0;
    const remaining: OfflineCommandItem[] = [];

    for (const item of current) {
      try {
        if (item.target === 'companion') {
          await enqueueRemoteCommand({ command: item.text, source: 'offline_sync' });
        } else {
          await sendVoiceTurn({ transcript: item.text });
        }
        synced += 1;
      } catch {
        remaining.push(item);
      }
    }

    persist(remaining);
    setSyncing(false);
    return { synced };
  }, []);

  useEffect(() => {
    if (isOnline && readOfflineQueue().length > 0) {
      void syncNow();
    }
  }, [isOnline, syncNow]);

  return { isOnline, queue, syncing, addCommand, removeCommand, syncNow };
}

