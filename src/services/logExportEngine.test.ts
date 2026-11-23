import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeServerLogEntry,
  normalizeServerLogList,
  filterServerLogs,
  escapeCsvCell,
  formatServerLogsAsCsv,
  formatServerLogsAsJson,
  buildLogExportFilename,
} from './logExportEngine';

test('normalizeServerLogEntry maps backend source field to logger cleanly', () => {
  const normalized = normalizeServerLogEntry({
    id: 'log_1',
    timestamp: '2026-11-23T12:00:00.000Z',
    level: 'warning',
    source: 'sqlite_backup',
    message: 'Backup criado',
  });
  assert.equal(normalized.id, 'log_1');
  assert.equal(normalized.level, 'WARNING');
  assert.equal(normalized.logger, 'sqlite_backup');
  assert.equal(normalized.message, 'Backup criado');
});

test('filterServerLogs filters accurately by level and search term across message and logger', () => {
  const entries = normalizeServerLogList([
    { id: 1, timestamp: '2026-11-23T10:00:00Z', level: 'INFO', source: 'auth', message: 'Login ok' },
    { id: 2, timestamp: '2026-11-23T10:01:00Z', level: 'ERROR', logger: 'uvicorn', message: 'Timeout on /packs' },
    { id: 3, timestamp: '2026-11-23T10:02:00Z', level: 'WARNING', source: 'sqlite', message: 'Slow query detected' },
  ]);

  assert.equal(filterServerLogs(entries, 'ALL', '').length, 3);
  assert.equal(filterServerLogs(entries, 'ERROR', '').length, 1);
  assert.equal(filterServerLogs(entries, 'ALL', 'sqlite').length, 1);
  assert.equal(filterServerLogs(entries, 'WARNING', 'slow').length, 1);
  assert.equal(filterServerLogs(entries, 'ERROR', 'sqlite').length, 0);
});

test('escapeCsvCell neutralizes spreadsheet formula injection and escapes quotes/commas/newlines', () => {
  assert.equal(escapeCsvCell('=CMD|"/C calc"!A0'), `"'=CMD|""/C calc""!A0"`);
  assert.equal(escapeCsvCell('+SUM(A1:A2)'), `'+SUM(A1:A2)`);
  assert.equal(escapeCsvCell('-1+2'), `'-1+2`);
  assert.equal(escapeCsvCell('@evil'), `'@evil`);
  assert.equal(escapeCsvCell('plain, "quoted"\nline2'), '"plain, ""quoted""\nline2"');
});

test('formatServerLogsAsCsv produces UTF-8 BOM and RFC 4180 rows', () => {
  const csv = formatServerLogsAsCsv([
    {
      id: 'evt_1',
      timestamp: '2026-11-23T12:00:00Z',
      level: 'ERROR',
      logger: 'api.gateway',
      message: 'Falha "crítica", código=500',
    },
  ]);

  assert.ok(csv.startsWith('\uFEFFid,timestamp,level,logger,message\r\n'));
  assert.ok(csv.includes('evt_1,2026-11-23T12:00:00Z,ERROR,api.gateway,"Falha ""crítica"", código=500"\r\n'));
});

test('formatServerLogsAsJson wraps entries with audit metadata envelope', () => {
  const jsonText = formatServerLogsAsJson(
    [
      {
        id: 42,
        timestamp: '2026-11-23T12:34:56Z',
        level: 'INFO',
        logger: 'system',
        message: 'Servidor iniciado',
      },
    ],
    {
      levelFilter: 'info',
      searchFilter: 'servidor',
      totalBuffered: 120,
      exportedAt: '2026-11-23T13:00:00Z',
    }
  );
  const parsed = JSON.parse(jsonText);
  assert.equal(parsed.schema_version, '1.0');
  assert.equal(parsed.exported_at, '2026-11-23T13:00:00Z');
  assert.equal(parsed.total_exported, 1);
  assert.equal(parsed.total_buffered, 120);
  assert.deepEqual(parsed.filters, { level: 'INFO', search: 'servidor' });
  assert.equal(parsed.logs.length, 1);
  assert.equal(parsed.logs[0].logger, 'system');
});

test('buildLogExportFilename generates deterministic safe filenames', () => {
  const date = new Date(2026, 10, 23, 9, 5, 7);
  assert.equal(buildLogExportFilename('csv', date), 'jarvis-server-logs-2026-11-23_09-05-07.csv');
  assert.equal(buildLogExportFilename('json', date), 'jarvis-server-logs-2026-11-23_09-05-07.json');
});
