import type { AgentInfo } from '../types';

export function canUninstallAgent(agent: Pick<AgentInfo, 'role'>): boolean {
  return agent.role !== 'jarvis_master';
}
