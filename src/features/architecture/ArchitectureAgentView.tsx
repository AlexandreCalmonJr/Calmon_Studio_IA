import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Compass,
  Cpu,
  FolderTree,
  Layers,
  Loader2,
  MessageSquare,
  Package,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  fetchArchitectureAnalysis,
  type ProjectArchitectureReport,
} from '../../services/api/packs';
import { PageHeader } from '../../shared/layout/PageHeader';

interface ArchitectureAgentViewProps {
  onAskArchitect: (prompt: string) => void;
  onNavigate: (tab: string) => void;
}

type SeverityFilter = 'all' | 'alta' | 'media' | 'baixa';

const CATEGORY_LABELS: Record<string, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  persistence: 'Persistência',
  agents: 'Agentes & Núcleos',
  security: 'Segurança',
};

const LAYER_BADGE_LABELS: Record<string, string> = {
  backend: 'Backend',
  frontend: 'Frontend',
  modulos_pacotes: 'Módulos & Pacotes',
  poliglota: 'Arquitetura Poliglota',
  testes: 'Testes & QA',
};

const SEVERITY_LABELS: Record<string, string> = {
  alta: 'Prioridade Alta',
  media: 'Prioridade Média',
  baixa: 'Melhoria Contínua',
};

const PILLAR_STATUS_LABELS: Record<string, string> = {
  ativo: 'Ativo em Produção',
  preparado: 'Contrato Preparado',
  planejado: 'Pronto p/ Expansão',
};

export const ArchitectureAgentView: React.FC<ArchitectureAgentViewProps> = ({
  onAskArchitect,
  onNavigate,
}) => {
  const [report, setReport] = useState<ProjectArchitectureReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [showTree, setShowTree] = useState(false);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchArchitectureAnalysis();
      setReport(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Falha ao analisar a estrutura real do projeto.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runAnalysis();
  }, [runAnalysis]);

  const filteredSuggestions = useMemo(() => {
    if (!report) return [];
    if (severityFilter === 'all') return report.suggestions;
    return report.suggestions.filter((s) => s.severity === severityFilter);
  }, [report, severityFilter]);

  const handleDiscussSuggestion = (title: string, rationale: string, paths: string[]) => {
    const prompt = [
      `@arquiteto Analise esta oportunidade arquitetural detectada no projeto:`,
      `• Item: ${title}`,
      `• Contexto: ${rationale}`,
      paths.length > 0 ? `• Arquivos envolvidos: ${paths.join(', ')}` : '',
      `Proponha uma ADR objetiva e um plano de refatoração em passos seguindo a arquitetura poliglota.`,
    ]
      .filter(Boolean)
      .join('\n');
    onAskArchitect(prompt);
  };

  return (
    <div className="jarvis-arch-page">
      <PageHeader
        icon={<Compass size={18} />}
        title="Diagnóstico Arquitetural & Plano Poliglota"
        subtitle="Inspeção real da estrutura do projeto, padrões implementados e recomendações de evolução."
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={loading}
              onClick={() => void runAnalysis()}
            >
              {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
              <span>{loading ? 'Analisando...' : 'Reanalisar'}</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                onAskArchitect(
                  '@arquiteto Gere um Blueprint C4 atualizado do repositório atual considerando os módulos instalados e a evolução para arquitetura poliglota.'
                )
              }
            >
              <MessageSquare size={14} />
              <span>Consultar @arquiteto</span>
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onNavigate('store')}
            >
              <Package size={14} />
              <span>Loja</span>
            </button>
          </div>
        }
      />

      {error && (
        <div className="jarvis-inline-alert is-error" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading && !report ? (
        <div className="jarvis-pack-loading">
          <Loader2 size={18} className="spin" />
          <span>Escaneando diretórios, camadas e padrões de projeto...</span>
        </div>
      ) : report ? (
        <>
          <section className="jarvis-arch-kpi-strip" aria-label="Métricas reais do repositório">
            <div className="jarvis-pack-stat">
              <span className="jarvis-pack-stat-label">Arquivos Escaneados</span>
              <strong className="jarvis-pack-stat-value tabular-nums">{report.totalFiles}</strong>
            </div>
            <div className="jarvis-pack-stat">
              <span className="jarvis-pack-stat-label">Arquivos de Código</span>
              <strong className="jarvis-pack-stat-value tabular-nums">
                {report.totalCodeFiles}
              </strong>
            </div>
            <div className="jarvis-pack-stat">
              <span className="jarvis-pack-stat-label">Suítes de Teste</span>
              <strong className="jarvis-pack-stat-value tabular-nums">
                {report.totalTestFiles}
              </strong>
            </div>
            <div className="jarvis-pack-stat">
              <span className="jarvis-pack-stat-label">Linhas Analisadas</span>
              <strong className="jarvis-pack-stat-value tabular-nums">
                {report.totalLines.toLocaleString('pt-BR')}
              </strong>
            </div>
          </section>

          <div className="jarvis-arch-two-col">
            {/* Camadas do Projeto */}
            <section className="jarvis-arch-panel" aria-labelledby="arch-layers-heading">
              <div className="jarvis-arch-panel-head">
                <div>
                  <h2 id="arch-layers-heading" className="jarvis-arch-panel-title">
                    <Layers size={16} />
                    <span>Distribuição por Camadas</span>
                  </h2>
                  <p className="jarvis-arch-panel-sub">
                    Proporção real de arquivos e linhas de código por responsabilidade arquitetural.
                  </p>
                </div>
              </div>

              <div className="jarvis-arch-layers-list">
                {report.layers.map((layer) => (
                  <div key={layer.id} className="jarvis-arch-layer-row">
                    <div className="jarvis-arch-layer-meta">
                      <strong>{layer.label}</strong>
                      <span className="mono tabular-nums jarvis-arch-layer-nums">
                        {layer.fileCount} arq. · {layer.lineCount.toLocaleString('pt-BR')} linhas ·{' '}
                        {layer.sharePct}%
                      </span>
                    </div>
                    <p className="jarvis-arch-layer-desc">{layer.description}</p>
                    <div
                      className="jarvis-arch-bar-track"
                      role="progressbar"
                      aria-valuenow={layer.sharePct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Participação da camada ${layer.label}`}
                    >
                      <div
                        className="jarvis-arch-bar-fill"
                        style={{ width: `${Math.max(4, Math.min(100, layer.sharePct))}%` }}
                      />
                    </div>
                    {layer.samplePaths.length > 0 && (
                      <div className="jarvis-arch-evidence-list mono">
                        {layer.samplePaths.slice(0, 3).join(' · ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Pilares da Arquitetura Poliglota */}
            <section className="jarvis-arch-panel" aria-labelledby="arch-polyglot-heading">
              <div className="jarvis-arch-panel-head">
                <div>
                  <h2 id="arch-polyglot-heading" className="jarvis-arch-panel-title">
                    <Compass size={16} />
                    <span>Plano de Arquitetura Poliglota</span>
                  </h2>
                  <p className="jarvis-arch-panel-sub">
                    Estado atual dos 4 runtimes do Cérebro Poliglota e fronteiras de acoplamento.
                  </p>
                </div>
              </div>

              <div className="jarvis-arch-pillars-list">
                {report.polyglotPillars.map((pillar) => (
                  <article key={pillar.id} className="jarvis-arch-pillar-card">
                    <div className="jarvis-arch-pillar-top">
                      <div>
                        <h3 className="jarvis-arch-pillar-name">{pillar.name}</h3>
                        <span className="mono jarvis-arch-pillar-runtime">{pillar.runtime}</span>
                      </div>
                      <span className={`jarvis-arch-status-label is-${pillar.status}`}>
                        {PILLAR_STATUS_LABELS[pillar.status] || pillar.status}
                      </span>
                    </div>
                    <p className="jarvis-arch-pillar-detail">{pillar.detail}</p>
                  </article>
                ))}
              </div>
            </section>
          </div>

          {/* Padrões de Projeto Detectados */}
          <section className="jarvis-arch-panel" aria-labelledby="arch-patterns-heading">
            <div className="jarvis-arch-panel-head">
              <div>
                <h2 id="arch-patterns-heading" className="jarvis-arch-panel-title">
                  <ShieldCheck size={16} />
                  <span>Padrões de Projeto Identificados ({report.patterns.length})</span>
                </h2>
                <p className="jarvis-arch-panel-sub">
                  Padrões detectados automaticamente com base nos módulos reais existentes no
                  repositório.
                </p>
              </div>
            </div>

            <div className="jarvis-arch-patterns-grid">
              {report.patterns.map((pattern) => (
                <article key={pattern.id} className="jarvis-arch-pattern-card">
                  <div className="jarvis-kicker-text">
                    <span>{CATEGORY_LABELS[pattern.category] || pattern.category}</span>
                    <span aria-hidden="true"> · </span>
                    <span className="jarvis-text-success">
                      Confiança {pattern.confidence === 'alta' ? 'Alta' : 'Média'}
                    </span>
                  </div>
                  <h3 className="jarvis-arch-pattern-title">{pattern.name}</h3>
                  <p className="jarvis-arch-pattern-summary">{pattern.summary}</p>
                  {pattern.evidencePaths.length > 0 && (
                    <div className="jarvis-arch-evidence-box mono">
                      {pattern.evidencePaths.map((ev) => (
                        <div key={ev} className="jarvis-arch-evidence-item">
                          {ev}
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>

          {/* Sugestões de Melhoria */}
          <section className="jarvis-arch-panel" aria-labelledby="arch-suggestions-heading">
            <div className="jarvis-arch-panel-head jarvis-arch-panel-head-row">
              <div>
                <h2 id="arch-suggestions-heading" className="jarvis-arch-panel-title">
                  <Sparkles size={16} />
                  <span>
                    Sugestões de Organização de Módulos & Pacotes ({filteredSuggestions.length})
                  </span>
                </h2>
                <p className="jarvis-arch-panel-sub">
                  Recomendações práticas para manter o código desacoplado, testável e pronto para
                  escalar.
                </p>
              </div>

              <div className="jarvis-pack-filter-bar" role="group" aria-label="Filtrar sugestões por prioridade">
                {(
                  [
                    { id: 'all', label: 'Todas' },
                    { id: 'alta', label: 'Alta' },
                    { id: 'media', label: 'Média' },
                    { id: 'baixa', label: 'Contínua' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`jarvis-pack-filter-btn ${severityFilter === opt.id ? 'is-active' : ''}`}
                    onClick={() => setSeverityFilter(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="jarvis-arch-suggestions-list">
              {filteredSuggestions.map((sug) => (
                <article key={sug.id} className="jarvis-arch-suggestion-card">
                  <div className="jarvis-arch-suggestion-head">
                    <div className="jarvis-kicker-text">
                      <span className={`jarvis-arch-sev is-${sug.severity}`}>
                        {SEVERITY_LABELS[sug.severity] || sug.severity}
                      </span>
                      <span aria-hidden="true"> · </span>
                      <span>{LAYER_BADGE_LABELS[sug.layer] || sug.layer}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() =>
                        handleDiscussSuggestion(sug.title, sug.rationale, sug.targetPaths)
                      }
                    >
                      <Cpu size={14} />
                      <span>Discutir com @arquiteto</span>
                      <ArrowRight size={14} />
                    </button>
                  </div>

                  <h3 className="jarvis-arch-suggestion-title">{sug.title}</h3>
                  <p className="jarvis-arch-suggestion-rationale">{sug.rationale}</p>

                  {sug.actionSteps.length > 0 && (
                    <ol className="jarvis-arch-steps">
                      {sug.actionSteps.map((step, index) => (
                        <li key={index}>{step}</li>
                      ))}
                    </ol>
                  )}

                  {sug.targetPaths.length > 0 && (
                    <div className="jarvis-arch-targets mono">
                      Alvos: {sug.targetPaths.join(' · ')}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>

          {/* Mapa de Diretórios e Maiores Arquivos */}
          <section className="jarvis-arch-panel" aria-labelledby="arch-tree-heading">
            <div className="jarvis-arch-panel-head jarvis-arch-panel-head-row">
              <div>
                <h2 id="arch-tree-heading" className="jarvis-arch-panel-title">
                  <FolderTree size={16} />
                  <span>Mapa de Diretórios & Maiores Arquivos</span>
                </h2>
                <p className="jarvis-arch-panel-sub">
                  Raiz inspecionada: <span className="mono">{report.rootName}</span> · Atualizado em{' '}
                  <span className="mono">
                    {new Date(report.analyzedAt).toLocaleTimeString('pt-BR')}
                  </span>
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-expanded={showTree}
                onClick={() => setShowTree((prev) => !prev)}
              >
                <span>{showTree ? 'Ocultar mapa detalhado' : 'Expandir mapa detalhado'}</span>
              </button>
            </div>

            {showTree && (
              <div className="jarvis-arch-two-col">
                <div>
                  <h3 className="jarvis-pack-spec-label">Diretórios com mais arquivos</h3>
                  <ul className="jarvis-arch-compact-list">
                    {report.directories.slice(0, 14).map((dir) => (
                      <li key={dir.path} className="jarvis-arch-compact-row">
                        <span className="mono">{dir.path}</span>
                        <span className="mono tabular-nums jarvis-muted-item">
                          {dir.fileCount} arq. ({dir.extensions.slice(0, 3).join(', ')})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="jarvis-pack-spec-label">Maiores arquivos (candidatos a fatiamento)</h3>
                  <ul className="jarvis-arch-compact-list">
                    {report.largestFiles.slice(0, 10).map((file) => (
                      <li key={file.path} className="jarvis-arch-compact-row">
                        <span className="mono">{file.path}</span>
                        <span className="mono tabular-nums jarvis-muted-item">
                          {file.lines.toLocaleString('pt-BR')} linhas
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
};
