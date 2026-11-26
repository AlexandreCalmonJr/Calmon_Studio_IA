import { useCallback, useEffect, useState } from 'react';
import { fetchHealth, fetchApprovals } from '../api';
import { fetchResources, SystemResourceUsage } from '../services/api/system';
import { subscribeJarvisRealtime } from '../services/api/brain';
import type { ApprovalRequestItem, SystemHealth } from '../types';

/**
 * Gerencia polling de saúde, aprovações e recursos do sistema com revalidação
 * por visibilidade da aba e eventos WebSocket em tempo real.
 */
export function useSystemPolling() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRequestItem[]>([]);
  const [healthLoading, setHealthLoading] = useState(true);
  const [approvalsLoading, setApprovalsLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [approvalsError, setApprovalsError] = useState<string | null>(null);
  const [systemResources, setSystemResources] = useState<SystemResourceUsage | null>(null);

  const loadData = useCallback(async (opts: { initial?: boolean } = {}) => {
    if (opts.initial) {
      setHealthLoading(true);
      setApprovalsLoading(true);
    }
    const [healthResult, approvalsResult, resourcesResult] = await Promise.allSettled([
      fetchHealth(),
      fetchApprovals(),
      fetchResources(),
    ]);
    if (healthResult.status === 'fulfilled') {
      setHealth(healthResult.value);
      setHealthError(null);
    } else {
      setHealthError(
        healthResult.reason instanceof Error
          ? healthResult.reason.message
          : 'Falha ao consultar a saúde do sistema.'
      );
    }
    setHealthLoading(false);

    if (approvalsResult.status === 'fulfilled') {
      setApprovals(approvalsResult.value);
      setApprovalsError(null);
    } else {
      setApprovalsError(
        approvalsResult.reason instanceof Error
          ? approvalsResult.reason.message
          : 'Falha ao consultar aprovações.'
      );
    }
    setApprovalsLoading(false);

    if (resourcesResult.status === 'fulfilled') {
      setSystemResources(resourcesResult.value);
    }
  }, []);

  useEffect(() => {
    void loadData({ initial: true });

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadData();
      }
    }, 60000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    let wsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribeWs = subscribeJarvisRealtime((event) => {
      if (
        event.type === 'sentinel_incident' ||
        event.type === 'companion_update' ||
        event.type === 'office_agent_event' ||
        event.type === 'roundtable_started' ||
        event.type === 'roundtable_verdict' ||
        event.type === 'connected'
      ) {
        if (document.visibilityState === 'visible') {
          if (wsDebounceTimer) clearTimeout(wsDebounceTimer);
          wsDebounceTimer = setTimeout(() => {
            void loadData();
          }, 1000);
        }
      }
    });

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wsDebounceTimer) clearTimeout(wsDebounceTimer);
      unsubscribeWs();
    };
  }, [loadData]);

  return {
    health,
    approvals,
    healthLoading,
    approvalsLoading,
    healthError,
    approvalsError,
    systemResources,
    loadData,
  };
}
