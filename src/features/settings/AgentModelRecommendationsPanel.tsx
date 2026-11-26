import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, CheckCircle2 } from 'lucide-react';
import {
  buildAgentModelRecommendations,
  isChatCapableModelId,
  type AgentRecommendationCategory,
} from '../../services/modelRecommendationEngine';
import { applyAgentModelRecommendations } from '../../services/api/models';
import { notify } from '../../shared/common/Toast';

interface AgentModelRecommendationsPanelProps {
  discoveredModels: string[];
  compact?: boolean;
  onSelectionChange?: (assignments: Array<{ role: string; model: string }>) => void;
  showApplyButton?: boolean;
}

/**
 * Analisa os modelos descobertos de uma chave de API, sugere o melhor modelo
 * por perfil de agente e pergunta ao usuário quais aplicar.
 */
export const AgentModelRecommendationsPanel: React.FC<AgentModelRecommendationsPanelProps> = ({
  discoveredModels,
  compact = false,
  onSelectionChange,
  showApplyButton = true,
}) => {
  const recommendations = useMemo(
    () => buildAgentModelRecommendations(discoveredModels),
    [discoveredModels]
  );

  const chatModels = useMemo(
    () =>
      Array.from(
        new Set(discoveredModels.map((m) => String(m || '').trim()).filter(isChatCapableModelId))
      ),
    [discoveredModels]
  );

  const [selectedModels, setSelectedModels] = useState<Record<AgentRecommendationCategory, string>>({
    voice: '',
    coding: '',
    reasoning: '',
    orchestration: '',
  });
  const [enabledCats, setEnabledCats] = useState<Record<AgentRecommendationCategory, boolean>>({
    voice: true,
    coding: true,
    reasoning: true,
    orchestration: true,
  });
  const [applying, setApplying] = useState(false);
  const [appliedCount, setAppliedCount] = useState<number | null>(null);

  useEffect(() => {
    if (recommendations.length === 0) return;
    const nextModels: Record<AgentRecommendationCategory, string> = {
      voice: '',
      coding: '',
      reasoning: '',
      orchestration: '',
    };
    for (const rec of recommendations) {
      nextModels[rec.category] = rec.recommendedModel;
    }
    setSelectedModels(nextModels);
    setAppliedCount(null);
  }, [recommendations]);

  const currentAssignments = useMemo(() => {
    const list: Array<{ role: string; model: string }> = [];
    for (const rec of recommendations) {
      if (!enabledCats[rec.category]) continue;
      const chosen = selectedModels[rec.category] || rec.recommendedModel;
      if (!chosen) continue;
      for (const role of rec.agentRoles) {
        list.push({ role, model: chosen });
      }
    }
    return list;
  }, [recommendations, enabledCats, selectedModels]);

  useEffect(() => {
    onSelectionChange?.(currentAssignments);
  }, [currentAssignments, onSelectionChange]);

  if (recommendations.length === 0) return null;

  const handleApply = async () => {
    if (currentAssignments.length === 0) return;
    setApplying(true);
    try {
      const res = await applyAgentModelRecommendations(currentAssignments);
      setAppliedCount(res.updated_count);
      notify(`Modelos recomendados aplicados a ${res.updated_count} agente(s).`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao aplicar recomendações.', 'error');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: compact ? '10px' : '12px 14px',
        borderRadius: '8px',
        background: 'rgba(249, 115, 22, 0.06)',
        border: '1px solid rgba(249, 115, 22, 0.25)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 700, color: '#fdba74' }}>
          <Sparkles size={14} />
          <span>Sugestão automática de modelos por Agente — deseja aplicar?</span>
        </div>
        {showApplyButton && (
          <button
            type="button"
            className="btn btn-primary btn-xs"
            disabled={applying || currentAssignments.length === 0}
            onClick={() => void handleApply()}
          >
            <CheckCircle2 size={12} />
            {applying
              ? 'Aplicando…'
              : appliedCount !== null
                ? `Aplicado (${appliedCount} agentes)`
                : 'Aplicar aos Agentes'}
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fit, minmax(260px, 1fr))', gap: '8px' }}>
        {recommendations.map((rec) => (
          <div
            key={rec.category}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              padding: '8px 10px',
              borderRadius: '6px',
              background: 'rgba(15, 23, 42, 0.55)',
              border: '1px solid rgba(148, 163, 184, 0.14)',
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={enabledCats[rec.category]}
                onChange={(e) =>
                  setEnabledCats((prev) => ({ ...prev, [rec.category]: e.target.checked }))
                }
              />
              <span>{rec.title}</span>
            </label>
            <span style={{ fontSize: '0.69rem', color: 'var(--text-muted)' }}>{rec.description}</span>
            <select
              className="jarvis-input"
              disabled={!enabledCats[rec.category]}
              value={selectedModels[rec.category] || rec.recommendedModel}
              onChange={(e) =>
                setSelectedModels((prev) => ({ ...prev, [rec.category]: e.target.value }))
              }
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', padding: '4px 6px' }}
            >
              {chatModels.map((m) => (
                <option key={m} value={m}>
                  {m === rec.recommendedModel ? `★ ${m} (Recomendado)` : m}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
};
