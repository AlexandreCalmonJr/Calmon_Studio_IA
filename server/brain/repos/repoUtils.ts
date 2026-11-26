/**
 * Utilitários compartilhados entre os repositórios SQLite de domínio.
 */

export function nowIso(): string {
  return new Date().toISOString();
}

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
