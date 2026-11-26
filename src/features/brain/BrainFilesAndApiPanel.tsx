import React from 'react';
import { Check, Copy, FileCode2, FolderOpen, Search } from 'lucide-react';
import {
  UNIFIED_SCHEMA_TABLES,
  type GeneratedServerArtifact,
} from '../../services/brainArchitectureEngine';
import type { BrainSchemaResponse } from '../../services/api/brainServer';

export interface BrainFilesPanelProps {
  serverFiles: GeneratedServerArtifact[];
  activeFile: GeneratedServerArtifact | undefined;
  setSelectedFilePath: (path: string) => void;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void | Promise<void>;
}

export const BrainFilesPanel: React.FC<BrainFilesPanelProps> = ({
  serverFiles,
  activeFile,
  setSelectedFilePath,
  copiedKey,
  onCopy,
}) => (
  <section
    className="jarvis-settings-card"
    style={{
      padding: '20px',
      display: 'grid',
      gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)',
      gap: '16px',
      alignItems: 'start',
    }}
  >
    <div className="jarvis-settings-subcard" style={{ padding: '10px', gap: '4px' }}>
      <div
        style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          color: 'var(--text-muted)',
          padding: '4px 8px 6px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <FolderOpen size={13} />
        <span>jarvis-brain-server/</span>
      </div>
      {serverFiles.map((file) => {
        const selected = activeFile?.path === file.path;
        const slashIdx = file.path.lastIndexOf('/');
        const fileName = slashIdx >= 0 ? file.path.slice(slashIdx + 1) : file.path;
        const dirPath = slashIdx >= 0 ? file.path.slice(0, slashIdx) : '';
        return (
          <button
            key={file.path}
            type="button"
            title={file.path}
            onClick={() => setSelectedFilePath(file.path)}
            className={selected ? 'btn btn-primary btn-sm btn-start' : 'btn btn-ghost btn-sm btn-start'}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.74rem',
              width: '100%',
              height: 'auto',
              padding: '7px 10px',
              justifyContent: 'flex-start',
              alignItems: 'flex-start',
            }}
          >
            <FileCode2 size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, textAlign: 'left' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                {fileName}
              </span>
              {dirPath && (
                <span
                  style={{
                    fontSize: '0.64rem',
                    opacity: selected ? 0.85 : 0.58,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {dirPath}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>

    {activeFile && (
      <div className="jarvis-settings-subcard" style={{ padding: 0, overflow: 'hidden', minWidth: 0 }}>
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-elevated)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {activeFile.path}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {activeFile.description}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void onCopy(activeFile.content, `srv-${activeFile.path}`)}
            className="btn btn-secondary btn-sm"
          >
            {copiedKey === `srv-${activeFile.path}` ? <Check size={13} /> : <Copy size={13} />}
            <span>{copiedKey === `srv-${activeFile.path}` ? 'Copiado' : 'Copiar arquivo'}</span>
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: '16px',
            maxHeight: '540px',
            overflow: 'auto',
            fontSize: '0.77rem',
            lineHeight: 1.55,
            fontFamily: 'var(--font-mono)',
            color: '#e2e8f0',
            backgroundColor: '#090c12',
          }}
        >
          <code>{activeFile.content}</code>
        </pre>
      </div>
    )}
  </section>
);

export interface BrainApiMapPanelProps {
  apiSearch: string;
  setApiSearch: (q: string) => void;
  filteredApiRoutes: Array<{ method: string; path: string; summary: string; group: string; auth: string }>;
  methodColors: Record<string, { color: string; bg: string }>;
  schemaInfo: BrainSchemaResponse | null;
}

export const BrainApiMapPanel: React.FC<BrainApiMapPanelProps> = ({
  apiSearch,
  setApiSearch,
  filteredApiRoutes,
  methodColors,
  schemaInfo,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
    <section className="jarvis-settings-card" style={{ padding: '22px', gap: '14px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Contrato Unificado da API REST &amp; SSE (/api/v1)
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            As mesmas rotas atendem o Hub Web, Desktop e o App Mobile Android — tanto no modo Local (SQLite) quanto em Docker (PostgreSQL).
          </p>
        </div>
        <div style={{ position: 'relative', width: '260px' }}>
          <Search
            size={14}
            color="var(--text-muted)"
            style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}
          />
          <input
            type="text"
            className="jarvis-input"
            value={apiSearch}
            onChange={(e) => setApiSearch(e.target.value)}
            placeholder="Filtrar rota (ex.: brain, excel, devices)..."
            style={{ paddingLeft: '32px' }}
            aria-label="Filtrar rotas da API"
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {filteredApiRoutes.map((route) => {
          const mc = methodColors[route.method] || methodColors.GET;
          return (
            <div
              key={`${route.method}-${route.path}`}
              className="jarvis-settings-subcard"
              style={{
                padding: '10px 14px',
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 380px', minWidth: 0 }}>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    padding: '2px 7px',
                    borderRadius: '5px',
                    color: mc.color,
                    backgroundColor: mc.bg,
                    minWidth: '52px',
                    textAlign: 'center',
                    flexShrink: 0,
                  }}
                >
                  {route.method}
                </span>
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                  {route.path}
                </code>
                <span style={{ fontSize: '0.77rem', color: 'var(--text-secondary)' }}>— {route.summary}</span>
              </div>
              <span style={{ fontSize: '0.69rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {route.group} · {route.auth}
              </span>
            </div>
          );
        })}
      </div>
    </section>

    <section className="jarvis-settings-card" style={{ padding: '22px', gap: '14px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Modelagem de Dados Unificada (SQLite WAL &amp; PostgreSQL 16 + pgvector)
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Banco ativo no modo <code>local_sqlite</code> ({schemaInfo?.tables?.length || 12} tabelas em disco · esquema v{schemaInfo?.schema_version || '1.0.0'}).
          </p>
        </div>
        {schemaInfo && (
          <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: '#6ee7b7' }}>
            {schemaInfo.journal_mode.toUpperCase()} · {(schemaInfo.db_size_bytes / 1024).toFixed(1)} KB
          </span>
        )}
      </div>
      {schemaInfo?.tables && schemaInfo.tables.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: '8px' }}>
          {schemaInfo.tables.map((tbl) => (
            <div
              key={tbl.table}
              className="jarvis-settings-subcard"
              style={{
                padding: '8px 12px',
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
              }}
            >
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--text-primary)' }}>
                {tbl.table}
              </code>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-light)' }}>
                {tbl.rows} reg.
              </span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '10px' }}>
        {UNIFIED_SCHEMA_TABLES.map((table) => (
          <div key={table.name} className="jarvis-settings-subcard" style={{ padding: '12px 14px', gap: '4px' }}>
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-light)' }}>
              {table.name}
            </code>
            <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>{table.role}</span>
          </div>
        ))}
      </div>
    </section>
  </div>
);
