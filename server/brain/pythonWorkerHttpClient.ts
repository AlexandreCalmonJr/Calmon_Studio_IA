/**
 * Cliente HTTP leve para o FastAPI Python Worker (porta 8001).
 * Degrada graciosamente (retorna null) quando o worker Python está offline,
 * mantendo o aplicativo Electron/Express 100% operacional sem Python.
 */

const DEFAULT_WORKER_URL = 'http://127.0.0.1:8001';

export function getPythonWorkerBaseUrl(): string {
  return (process.env.PYTHON_WORKER_URL || DEFAULT_WORKER_URL).replace(/\/+$/, '');
}

export async function callPythonWorkerJson<T = Record<string, unknown>>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    timeoutMs?: number;
  } = {}
): Promise<T | null> {
  const baseUrl = getPythonWorkerBaseUrl();
  const method = options.method || 'GET';
  const timeoutMs = Math.max(400, options.timeoutMs ?? 2500);
  const headers: Record<string, string> = {};

  const token = (process.env.INTERNAL_WORKER_TOKEN || '').trim();
  if (token) {
    headers['X-Worker-Token'] = token;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const resp = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

