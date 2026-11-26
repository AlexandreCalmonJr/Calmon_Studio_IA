import React from 'react';
import { Check, Cloud, Download, HardDrive } from 'lucide-react';
import {
  SERVER_LANGUAGE_COMPARISON,
  type BrainDeploymentOptions,
} from '../../services/brainArchitectureEngine';

export interface BrainDualModePanelProps {
  deployOpts: BrainDeploymentOptions;
  setDeployOpts: React.Dispatch<React.SetStateAction<BrainDeploymentOptions>>;
  downloadingZip: boolean;
  onDownloadBundleZip: () => void | Promise<void>;
}

export const BrainDualModePanel: React.FC<BrainDualModePanelProps> = ({
  deployOpts,
  setDeployOpts,
  downloadingZip,
  onDownloadBundleZip,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Comparativo 2 Colunas: Sem Docker vs Com Docker */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '16px' }}>
        <section
          className="jarvis-settings-card"
          style={{
            padding: '22px',
            gap: '12px',
            borderColor: deployOpts.mode === 'local_sqlite' ? 'rgba(16, 185, 129, 0.5)' : 'var(--border-color)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <HardDrive size={20} color="#6ee7b7" />
              <h2 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Modo Local Direto (Sem Docker)
              </h2>
            </div>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6ee7b7' }}>USUÁRIO COMUM</span>
          </div>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Instala direto no seu computador sem precisar saber o que é Docker. Salva tudo em uma única pasta fácil de fazer backup.
          </p>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.65 }}>
            <li><strong>Banco embarcado:</strong> SQLite em modo WAL + busca vetorial <code>sqlite-vec</code>.</li>
            <li><strong>Pasta única:</strong> <code>~/JARVIS-Brain/brain.db</code> + planilhas e mídias geradas.</li>
            <li><strong>IA automática:</strong> Gemini na nuvem + detecção automática de Ollama local se instalado.</li>
            <li><strong>1 comando:</strong> <code>./scripts/start-local-brain.sh</code></li>
          </ul>
          <button
            type="button"
            onClick={() => setDeployOpts((prev) => ({ ...prev, mode: 'local_sqlite' }))}
            className={deployOpts.mode === 'local_sqlite' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
            style={{ alignSelf: 'flex-start', marginTop: '4px' }}
          >
            {deployOpts.mode === 'local_sqlite' ? <Check size={14} /> : null}
            <span>Selecionar Padrão Local (SQLite)</span>
          </button>
        </section>

        <section
          className="jarvis-settings-card"
          style={{
            padding: '22px',
            gap: '12px',
            borderColor: deployOpts.mode === 'docker_postgres' ? 'rgba(249, 115, 22, 0.55)' : 'var(--border-color)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Cloud size={20} color="var(--accent-light)" />
              <h2 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Modo Docker Completo (Compose)
              </h2>
            </div>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent-light)' }}>USUÁRIO AVANÇADO</span>
          </div>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Sobe todo o ecossistema isolado com <code>docker compose up -d</code> no seu PC, Mini PC, NAS ou VPS.
          </p>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.65 }}>
            <li><strong>Banco escalável:</strong> PostgreSQL 16 + <code>pgvector</code> para milhões de trechos RAG.</li>
            <li><strong>Filas &amp; Agendador:</strong> Redis 7 para vídeos, GitHub import e Fluxos Cron.</li>
            <li><strong>Perfis opcionais:</strong> <code>--profile local-ai</code> (Ollama) e <code>--profile remote</code> (Caddy HTTPS).</li>
            <li><strong>Zero configuração manual:</strong> QR Code pronto para parear o App Android.</li>
          </ul>
          <button
            type="button"
            onClick={() => setDeployOpts((prev) => ({ ...prev, mode: 'docker_postgres' }))}
            className={deployOpts.mode === 'docker_postgres' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
            style={{ alignSelf: 'flex-start', marginTop: '4px' }}
          >
            {deployOpts.mode === 'docker_postgres' ? <Check size={14} /> : null}
            <span>Selecionar Padrão Docker (PostgreSQL)</span>
          </button>
        </section>
      </div>

      {/* Personalizador do Pacote Dual-Mode */}
      <section className="jarvis-settings-card" style={{ padding: '22px', gap: '14px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Personalizar Pacote do Servidor (.zip)
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              As alterações abaixo atualizam instantaneamente o <code>docker-compose.yml</code>, <code>.env.example</code> e o script local na aba Arquivos.
            </p>
          </div>
          <button
            type="button"
            disabled={downloadingZip}
            onClick={() => void onDownloadBundleZip()}
            className="btn btn-primary btn-sm"
          >
            <Download size={14} />
            <span>Baixar Pacote Personalizado (.zip)</span>
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
            <span>Nome deste Cérebro</span>
            <input
              type="text"
              className="jarvis-input"
              value={deployOpts.brainName}
              onChange={(e) => setDeployOpts((prev) => ({ ...prev, brainName: e.target.value }))}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
            <span>Porta HTTP da API</span>
            <input
              type="number"
              className="jarvis-input"
              value={deployOpts.port}
              onChange={(e) => setDeployOpts((prev) => ({ ...prev, port: Number(e.target.value) || 3000 }))}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
            <span>Nome do Banco PostgreSQL</span>
            <input
              type="text"
              className="jarvis-input"
              value={deployOpts.postgresDb}
              onChange={(e) => setDeployOpts((prev) => ({ ...prev, postgresDb: e.target.value }))}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
            <span>Pasta do SQLite Local</span>
            <input
              type="text"
              className="jarvis-input"
              value={deployOpts.dataDir}
              onChange={(e) => setDeployOpts((prev) => ({ ...prev, dataDir: e.target.value }))}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
          {[
            {
              key: 'enableOllama' as const,
              title: 'Perfil Ollama Local (--profile local-ai)',
              desc: 'Inclui container Ollama para rodar modelos privados 100% offline com CPU ou GPU.',
            },
            {
              key: 'enableRemoteGateway' as const,
              title: 'Gateway Caddy HTTPS (--profile remote)',
              desc: 'Adiciona proxy reverso HTTPS automático para conectar seu App Android de fora de casa.',
            },
            {
              key: 'enablePythonWorker' as const,
              title: 'Worker Python 3.11 (--profile python-worker)',
              desc: 'Chunking Markdown, busca híbrida FTS5 + vetores (RRF) e extração de fatos Hermes.',
            },
            {
              key: 'enableGoGateway' as const,
              title: 'Serviço Go Gateway + Crawler (--profile go-gateway)',
              desc: 'Binário Go (~12 MB) de alta concorrência: Reverse Proxy, Rate Limit e Crawler goroutines.',
            },
          ].map((opt) => {
            const enabled = deployOpts[opt.key];
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setDeployOpts((prev) => ({ ...prev, [opt.key]: !prev[opt.key] }))}
                style={{
                  textAlign: 'left',
                  padding: '12px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  border: enabled ? '1px solid rgba(249, 115, 22, 0.5)' : '1px solid var(--border-color)',
                  backgroundColor: enabled ? 'rgba(249, 115, 22, 0.08)' : 'var(--bg-primary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>{opt.title}</span>
                  <span style={{ fontSize: '0.66rem', fontWeight: 700, color: enabled ? '#6ee7b7' : 'var(--text-muted)' }}>
                    {enabled ? 'INCLUÍDO' : 'OPCIONAL'}
                  </span>
                </div>
                <span style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>{opt.desc}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Por que TypeScript + Node.js 22 LTS? */}
      <section className="jarvis-settings-card" style={{ padding: '22px', gap: '14px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Melhor Linguagem para o Servidor (&quot;Cérebro&quot;): Decisão Arquitetural
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Comparativo objetivo entre TypeScript/Node.js 22, Python/FastAPI e Go para sustentar Web + Android em modo Local e Docker.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' }}>
          {SERVER_LANGUAGE_COMPARISON.map((row) => (
            <div
              key={row.stack}
              className="jarvis-settings-subcard"
              style={{
                padding: '15px',
                gap: '8px',
                borderColor: row.isPrimary ? 'rgba(249, 115, 22, 0.5)' : 'var(--border-color)',
                backgroundColor: row.isPrimary ? 'rgba(249, 115, 22, 0.06)' : 'var(--bg-primary)',
              }}
            >
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: row.isPrimary ? 'var(--accent-light)' : 'var(--text-muted)', textTransform: 'uppercase' }}>
                {row.recommendedRole}
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>{row.stack}</div>
              <ul style={{ margin: '2px 0 0', paddingLeft: '16px', fontSize: '0.77rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {row.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px' }}>
                <strong>Trade-off:</strong> {row.tradeoffs}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
