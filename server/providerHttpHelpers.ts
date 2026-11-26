/**
 * Helpers centralizados de timeout, parsing de erros HTTP e formatação de falhas
 * de rede para provedores externos de IA.
 */

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: init.redirect ?? 'error',
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractProviderHttpError(
  response: Response,
  secretToMask?: string,
  maxLen = 180
): Promise<string> {
  let detail = `HTTP ${response.status}`;
  try {
    const errJson = (await response.json()) as Record<string, any>;
    const rawMsg = errJson?.error?.message || errJson?.message || errJson?.detail;
    if (rawMsg) {
      let msg = String(rawMsg);
      if (secretToMask) {
        msg = msg.split(secretToMask).join('[chave oculta]');
      }
      detail = `${detail}: ${msg.slice(0, maxLen)}`;
    }
  } catch {
    // Sem corpo JSON legível
  }
  return detail;
}

export function formatProviderNetworkError(err: unknown, providerLabel: string): string {
  const anyErr = err as { name?: string; message?: string } | null;
  if (anyErr?.name === 'AbortError') {
    return `Tempo limite excedido ao conectar com ${providerLabel}.`;
  }
  return `Não foi possível alcançar ${providerLabel}: ${String(anyErr?.message || 'erro de rede').slice(0, 160)}`;
}
