import React, { useMemo, useState } from 'react';
import { Check, Search, Star } from 'lucide-react';

interface ProviderModelSelectorProps {
  provider: string;
  discoveredModels: string[];
  enabledModels: string[];
  defaultModel: string;
  onChangeEnabledModels: (next: string[]) => void;
  onSelectDefaultModel: (modelId: string) => void;
}

/**
 * Seletor estilo OpenCode para filtrar, habilitar múltiplos modelos descobertos
 * a partir da chave de API e definir o modelo padrão do provedor.
 */
export const ProviderModelSelector: React.FC<ProviderModelSelectorProps> = ({
  provider,
  discoveredModels,
  enabledModels,
  defaultModel,
  onChangeEnabledModels,
  onSelectDefaultModel,
}) => {
  const [query, setQuery] = useState('');

  const uniqueModels = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const m of discoveredModels) {
      const clean = String(m || '').trim();
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      list.push(clean);
    }
    return list;
  }, [discoveredModels]);

  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return uniqueModels;
    return uniqueModels.filter((m) => m.toLowerCase().includes(q));
  }, [uniqueModels, query]);

  const enabledSet = useMemo(() => new Set(enabledModels), [enabledModels]);

  if (uniqueModels.length === 0) return null;

  const toggleModel = (modelId: string) => {
    if (enabledSet.has(modelId)) {
      onChangeEnabledModels(enabledModels.filter((m) => m !== modelId));
    } else {
      onChangeEnabledModels([...enabledModels, modelId]);
    }
  };

  return (
    <div
      data-testid={`provider-model-selector-${provider}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '10px 12px',
        borderRadius: '8px',
        background: 'rgba(15, 23, 42, 0.45)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Modelos descobertos ({enabledModels.length}/{uniqueModels.length} habilitados)
        </span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={() => onChangeEnabledModels(filteredModels.length > 0 ? Array.from(new Set([...enabledModels, ...filteredModels])) : uniqueModels)}
          >
            Selecionar {query.trim() ? 'filtrados' : 'todos'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={() => onChangeEnabledModels([])}
          >
            Limpar
          </button>
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <Search
          size={13}
          style={{
            position: 'absolute',
            left: '9px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
            pointerEvents: 'none',
          }}
        />
        <input
          type="text"
          className="jarvis-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrar modelos (ex: gpt-4o, claude, llama, qwen)..."
          style={{ paddingLeft: '28px', fontSize: '0.76rem', width: '100%' }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          maxHeight: '210px',
          overflowY: 'auto',
          paddingRight: '2px',
        }}
      >
        {filteredModels.length === 0 ? (
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', padding: '6px 4px' }}>
            Nenhum modelo encontrado para "{query}".
          </div>
        ) : (
          filteredModels.map((modelId) => {
            const isChecked = enabledSet.has(modelId);
            const isDefault = defaultModel === modelId;
            return (
              <div
                key={modelId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '5px 8px',
                  borderRadius: '6px',
                  background: isChecked ? 'rgba(249, 115, 22, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                  border: isChecked
                    ? '1px solid rgba(249, 115, 22, 0.35)'
                    : '1px solid rgba(148, 163, 184, 0.12)',
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleModel(modelId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flex: 1,
                    minWidth: 0,
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    padding: 0,
                  }}
                >
                  <span
                    style={{
                      width: '15px',
                      height: '15px',
                      borderRadius: '4px',
                      display: 'inline-grid',
                      placeItems: 'center',
                      flexShrink: 0,
                      background: isChecked ? '#f97316' : 'transparent',
                      border: isChecked ? '1px solid #f97316' : '1px solid var(--text-muted)',
                      color: '#fff',
                    }}
                  >
                    {isChecked && <Check size={11} />}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.73rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {modelId}
                  </span>
                </button>

                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={() => {
                    onSelectDefaultModel(modelId);
                    if (!isChecked) {
                      onChangeEnabledModels([...enabledModels, modelId]);
                    }
                  }}
                  title="Definir como modelo padrão"
                  style={{
                    fontSize: '0.68rem',
                    padding: '2px 7px',
                    color: isDefault ? '#fdba74' : undefined,
                    borderColor: isDefault ? 'rgba(249, 115, 22, 0.5)' : undefined,
                  }}
                >
                  <Star size={11} />
                  {isDefault ? 'Padrão' : 'Usar padrão'}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
