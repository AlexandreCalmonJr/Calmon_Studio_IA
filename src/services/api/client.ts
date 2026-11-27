import { getPairedHostUrl } from '../localMobileAi';

export function getApiBase(): string {
  const pairedHost = typeof window !== 'undefined' ? getPairedHostUrl() : '';
  return pairedHost ? `${pairedHost}/api/v1` : '/api/v1';
}

export const API_BASE = getApiBase();

export async function handleApiResponse<T>(res: Response, defaultErrorMsg: string): Promise<T> {
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: defaultErrorMsg }));
    throw new Error(errorData.detail || defaultErrorMsg);
  }
  return res.json();
}
