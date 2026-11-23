export interface ServerLogRecord {
  id: string | number;
  timestamp: string;
  level: string;
  logger: string;
  message: string;
}

export interface LogExportMetadata {
  levelFilter?: string;
  searchFilter?: string;
  totalBuffered?: number;
  exportedAt?: string;
}

export type LogExportFormat = 'json' | 'csv';

/**
 * Normalizes raw server log objects coming from either the Express backend
 * (`source`) or FastAPI/Uvicorn SSE (`logger`) into a consistent structure.
 */
export function normalizeServerLogEntry(raw: unknown, fallbackIndex = 0): ServerLogRecord {
  const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawId = item.id;
  const id =
    typeof rawId === 'number' || (typeof rawId === 'string' && rawId.trim().length > 0)
      ? rawId
      : `log_${fallbackIndex}`;
  const timestamp =
    typeof item.timestamp === 'string' && item.timestamp.trim().length > 0
      ? item.timestamp.trim()
      : new Date().toISOString();
  const level =
    typeof item.level === 'string' && item.level.trim().length > 0
      ? item.level.trim().toUpperCase()
      : 'INFO';
  const loggerRaw =
    typeof item.logger === 'string' && item.logger.trim().length > 0
      ? item.logger
      : typeof item.source === 'string' && item.source.trim().length > 0
        ? item.source
        : 'server';
  const message =
    typeof item.message === 'string'
      ? item.message
      : item.message != null
        ? String(item.message)
        : '';

  return {
    id,
    timestamp,
    level,
    logger: loggerRaw.trim(),
    message,
  };
}

export function normalizeServerLogList(rawLogs: unknown): ServerLogRecord[] {
  if (!Array.isArray(rawLogs)) return [];
  return rawLogs.map((entry, idx) => normalizeServerLogEntry(entry, idx + 1));
}

/**
 * Pure filter shared between the terminal console and the JSON/CSV exporter
 * so exported slices always match what the administrator sees.
 */
export function filterServerLogs(
  logs: ServerLogRecord[],
  levelFilter: string,
  searchFilter: string
): ServerLogRecord[] {
  const normalizedLevel = (levelFilter || 'ALL').trim().toUpperCase();
  const normalizedSearch = (searchFilter || '').trim().toLowerCase();

  return logs.filter((entry) => {
    if (normalizedLevel !== 'ALL' && entry.level.toUpperCase() !== normalizedLevel) {
      return false;
    }
    if (normalizedSearch) {
      const msg = (entry.message || '').toLowerCase();
      const logger = (entry.logger || '').toLowerCase();
      const lvl = (entry.level || '').toLowerCase();
      const ts = (entry.timestamp || '').toLowerCase();
      return (
        msg.includes(normalizedSearch) ||
        logger.includes(normalizedSearch) ||
        lvl.includes(normalizedSearch) ||
        ts.includes(normalizedSearch)
      );
    }
    return true;
  });
}

/**
 * Escapes a single CSV cell per RFC 4180 and neutralizes spreadsheet formula
 * injection (OWASP CSV Injection: leading =, +, -, @, tab, CR).
 */
export function escapeCsvCell(value: unknown): string {
  const raw = value == null ? '' : String(value);
  const trimmedLeading = raw.replace(/^[ ]+/, '');
  const safe =
    trimmedLeading.length > 0 && /^[=+\-@\t\r]/.test(trimmedLeading)
      ? `'${raw}`
      : raw;

  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/**
 * Serializes server logs to UTF-8 BOM RFC 4180 CSV for Excel, Google Sheets,
 * and external SIEM/audit tools.
 */
export function formatServerLogsAsCsv(logs: ServerLogRecord[]): string {
  const header = 'id,timestamp,level,logger,message';
  const rows = logs.map((entry) =>
    [
      escapeCsvCell(entry.id),
      escapeCsvCell(entry.timestamp),
      escapeCsvCell(entry.level),
      escapeCsvCell(entry.logger),
      escapeCsvCell(entry.message),
    ].join(',')
  );
  return `\uFEFF${[header, ...rows].join('\r\n')}\r\n`;
}

/**
 * Serializes server logs to a structured audit JSON document with export metadata.
 */
export function formatServerLogsAsJson(
  logs: ServerLogRecord[],
  meta: LogExportMetadata = {}
): string {
  const payload = {
    schema_version: '1.0',
    exported_at: meta.exportedAt || new Date().toISOString(),
    total_exported: logs.length,
    total_buffered: typeof meta.totalBuffered === 'number' ? meta.totalBuffered : logs.length,
    filters: {
      level: (meta.levelFilter || 'ALL').toUpperCase(),
      search: meta.searchFilter || '',
    },
    logs: logs.map((entry) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      level: entry.level,
      logger: entry.logger,
      message: entry.message,
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function buildLogExportFilename(format: LogExportFormat, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('-') + '_' + [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('-');
  return `jarvis-server-logs-${stamp}.${format}`;
}

export function triggerTextFileDownload(
  content: string,
  filename: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
