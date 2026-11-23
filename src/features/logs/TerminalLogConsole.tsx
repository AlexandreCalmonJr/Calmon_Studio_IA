import React, { useRef, useEffect, useMemo } from 'react';
import { Terminal, Search, ArrowDown, X } from 'lucide-react';
import { filterServerLogs, type ServerLogRecord } from '../../services/logExportEngine';

interface TerminalLogConsoleProps {
  logs: ServerLogRecord[];
  levelFilter: string;
  setLevelFilter: (level: string) => void;
  searchFilter: string;
  setSearchFilter: (search: string) => void;
  autoScroll: boolean;
  setAutoScroll: (scroll: boolean) => void;
}

export const TerminalLogConsole: React.FC<TerminalLogConsoleProps> = ({
  logs,
  levelFilter,
  setLevelFilter,
  searchFilter,
  setSearchFilter,
  autoScroll,
  setAutoScroll,
}) => {
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const filteredLogs = useMemo(
    () => filterServerLogs(logs, levelFilter, searchFilter),
    [logs, levelFilter, searchFilter]
  );

  const getLevelColor = (level: string) => {
    switch (level.toUpperCase()) {
      case 'ERROR':
      case 'CRITICAL':
        return 'var(--log-level-error, #ef4444)';
      case 'WARNING':
      case 'WARN':
        return 'var(--log-level-warning, #d97706)';
      case 'INFO':
        return 'var(--accent-color)';
      case 'DEBUG':
        return 'var(--text-muted)';
      default:
        return 'var(--warning-color)';
    }
  };

  return (
    <section
      className="jarvis-settings-card"
      style={{
        padding: 0,
        height: '520px',
        overflow: 'hidden',
        gap: 0,
      }}
    >
      {/* Barra de Filtros e Ferramentas do Terminal */}
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Terminal size={15} color="var(--accent-color)" />
          <span
            className="jarvis-tabular"
            style={{
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.02em',
            }}
          >
            CONSOLA DO SERVIDOR ({filteredLogs.length} eventos)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div className="jarvis-segmented" role="group" aria-label="Filtrar por nível de log">
            {['ALL', 'INFO', 'WARNING', 'ERROR'].map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLevelFilter(lvl)}
                className={`jarvis-segmented-btn ${levelFilter === lvl ? 'is-active' : ''}`}
                style={{ padding: '5px 10px', fontSize: '0.74rem' }}
              >
                {lvl === 'ALL' ? 'Todos' : lvl}
              </button>
            ))}
          </div>

          <div className="jarvis-search-box" style={{ minHeight: '34px', padding: '0 10px', width: '210px' }}>
            <Search size={13} />
            <input
              type="text"
              className="jarvis-search-box__input"
              placeholder="Filtrar logs..."
              aria-label="Filtrar logs por texto"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', padding: '5px 0' }}
            />
            {searchFilter && (
              <button
                type="button"
                onClick={() => setSearchFilter('')}
                className="btn btn-ghost btn-icon-sm"
                aria-label="Limpar filtro de logs"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            className={`btn btn-xs ${autoScroll ? 'btn-success' : 'btn-ghost'}`}
            aria-pressed={autoScroll}
            title="Rolar automaticamente para a mensagem mais recente"
          >
            <ArrowDown size={12} />
            <span>Auto-Scroll</span>
          </button>
        </div>
      </div>

      {/* Corpo do Terminal com Logs */}
      <div
        className="jarvis-tabular"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px 18px',
          backgroundColor: 'var(--code-bg, var(--bg-primary))',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.78rem',
          lineHeight: 1.7,
        }}
      >
        {filteredLogs.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', paddingTop: '80px', fontFamily: 'inherit' }}>
            Nenhum registro encontrado para os filtros selecionados.
          </div>
        ) : (
          filteredLogs.map((l) => (
            <div
              key={l.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                marginBottom: '3px',
                wordBreak: 'break-word',
              }}
            >
              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                [{(l.timestamp || '').slice(11, 19) || l.timestamp}]
              </span>
              <span
                style={{
                  color: getLevelColor(l.level),
                  fontWeight: 700,
                  width: '74px',
                  flexShrink: 0,
                }}
              >
                [{l.level}]
              </span>
              <span
                style={{
                  color: 'var(--text-secondary)',
                  flexShrink: 0,
                  maxWidth: '160px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                [{l.logger}]:
              </span>
              <span style={{ color: 'var(--text-primary)', flex: 1 }}>{l.message}</span>
            </div>
          ))
        )}
        <div ref={terminalEndRef} />
      </div>
    </section>
  );
};
