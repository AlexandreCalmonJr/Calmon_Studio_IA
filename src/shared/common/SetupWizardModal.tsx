import React, { useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Cpu, RefreshCw, Server, ShieldCheck, Zap } from 'lucide-react';
import { Modal } from './Modal';
import { API_BASE } from '../../services/api/client';
import {
  applyAgentModelRecommendations,
  registerVaultKey,
  saveSessionProviderKey,
  testSessionProviderKey,
  type ExternalProviderSlug,
} from '../../services/api/models';
import { ProviderModelSelector } from '../../features/settings/ProviderModelSelector';
import { AgentModelRecommendationsPanel } from '../../features/settings/AgentModelRecommendationsPanel';

interface SetupWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCompleted?: () => void;
}

type CloudProvider = 'gemini' | 'openai' | 'groq' | 'deepseek' | 'anthropic' | 'openrouter' | 'xai' | 'custom';

const CLOUD_PRESETS: Record<CloudProvider, { model: string; baseUrl: string }> = {
  gemini: { model: 'gemini-2.5-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  openai: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  groq: { model: 'llama-3.3-70b-versatile', baseUrl: 'https://api.groq.com/openai/v1' },
  deepseek: { model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' },
  anthropic: { model: 'claude-3-5-haiku-20241022', baseUrl: 'https://api.anthropic.com/v1' },
  openrouter: { model: 'openai/gpt-4o-mini', baseUrl: 'https://openrouter.ai/api/v1' },
  xai: { model: 'grok-2-latest', baseUrl: 'https://api.x.ai/v1' },
  custom: { model: '', baseUrl: 'https://integrate.api.nvidia.com/v1' },
};

export const SetupWizardModal: React.FC<SetupWizardModalProps> = ({ isOpen, onClose, onCompleted }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<'cloud' | 'local'>('local');
  const [cloudProvider, setCloudProvider] = useState<CloudProvider>('gemini');
  const [cloudApiKey, setCloudApiKey] = useState('');
  const [cloudModel, setCloudModel] = useState(CLOUD_PRESETS.gemini.model);
  const [cloudBaseUrl, setCloudBaseUrl] = useState(CLOUD_PRESETS.gemini.baseUrl);

  const [saving, setSaving] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [environmentStatus, setEnvironmentStatus] = useState<any>(null);
  const [checkingEnvironment, setCheckingEnvironment] = useState(false);
  const [probingModels, setProbingModels] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [enabledModels, setEnabledModels] = useState<string[]>([]);
  const [probeMessage, setProbeMessage] = useState<string | null>(null);
  const [agentAssignments, setAgentAssignments] = useState<Array<{ role: string; model: string }>>([]);

  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setCheckingEnvironment(true);
    fetch(`${API_BASE}/system/onboarding`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Não foi possível consultar o estado do servidor.');
        return response.json();
      })
      .then((status) => { if (!cancelled) setEnvironmentStatus(status); })
      .catch((error) => { if (!cancelled) setFinishError(error.message || 'Falha ao verificar o ambiente.'); })
      .finally(() => { if (!cancelled) setCheckingEnvironment(false); });
    return () => { cancelled = true; };
  }, [isOpen]);

  const handleProviderChange = (provider: CloudProvider) => {
    setCloudProvider(provider);
    setCloudModel(CLOUD_PRESETS[provider].model);
    setCloudBaseUrl(CLOUD_PRESETS[provider].baseUrl);
    setDiscoveredModels([]);
    setEnabledModels([]);
    setProbeMessage(null);
  };

  const handleProbeModels = async () => {
    const apiKey = cloudApiKey.trim();
    if (!apiKey) {
      setFinishError('Cole sua chave de API antes de descobrir os modelos.');
      return;
    }
    if (cloudProvider === 'gemini') {
      setProbeMessage('Chave Gemini pronta para salvar.');
      return;
    }
    setProbingModels(true);
    setFinishError(null);
    setProbeMessage(null);
    try {
      const res = await testSessionProviderKey(cloudProvider as ExternalProviderSlug, {
        api_key: apiKey,
        base_url: cloudBaseUrl.trim() || undefined,
      });
      if (!res.ok) {
        setFinishError(res.message || 'Falha ao validar a chave de API.');
        return;
      }
      const list = res.models_detected || [];
      setDiscoveredModels(list);
      if (list.length > 0) {
        const initialDefault = cloudModel.trim() && list.includes(cloudModel.trim()) ? cloudModel.trim() : list[0];
        setCloudModel(initialDefault);
        setEnabledModels([initialDefault]);
      }
      setProbeMessage(res.message);
    } catch (e: any) {
      setFinishError(e?.message || 'Erro ao consultar modelos da chave.');
    } finally {
      setProbingModels(false);
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    setFinishError(null);
    try {
      if (mode === 'cloud') {
        const apiKey = cloudApiKey.trim();
        if (!apiKey) {
          throw new Error('Informe a chave de API do provedor escolhido.');
        }
        if (cloudProvider === 'gemini') {
          await registerVaultKey({
            key_id: 'account_primary',
            label: `${cloudProvider.toUpperCase()} — chave da minha conta`,
            provider: cloudProvider,
            api_key: apiKey,
            base_url: cloudBaseUrl.trim() || undefined,
            default_model: cloudModel.trim() || undefined,
            is_active: true,
            is_default: true,
            scope: 'account',
          });
        } else {
          await saveSessionProviderKey(cloudProvider as ExternalProviderSlug, {
            api_key: apiKey,
            base_url: cloudBaseUrl.trim() || undefined,
            default_model: cloudModel.trim() || enabledModels[0] || undefined,
            detected_models: discoveredModels,
            enabled_models: enabledModels.length > 0 ? enabledModels : cloudModel.trim() ? [cloudModel.trim()] : [],
            is_default: true,
          });
          if (agentAssignments.length > 0) {
            await applyAgentModelRecommendations(agentAssignments).catch(() => {});
          }
        }
        setCloudApiKey('');
      }
      const response = await fetch(`${API_BASE}/system/onboarding/complete`, { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('O servidor não confirmou a conclusão da configuração.');
      if (onCompleted) onCompleted();
      onClose();
    } catch (e: any) {
      setFinishError(e?.message || 'Não foi possível concluir a configuração.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const wizardFooter = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
      {step > 1 ? (
        <button
          type="button"
          onClick={() => setStep((s) => (s - 1) as any)}
          className="btn btn-secondary"
        >
          <ArrowLeft size={15} />
          <span>Voltar</span>
        </button>
      ) : (
        <div />
      )}

      {step < 3 ? (
        <button
          type="button"
          onClick={() => setStep((s) => (s + 1) as any)}
          className="btn btn-primary"
        >
          <span>Avançar</span>
          <ArrowRight size={15} />
        </button>
      ) : (
        <button
          type="button"
          onClick={handleFinish}
          disabled={saving}
          className="btn btn-primary"
        >
          {saving ? <RefreshCw size={15} className="spin" /> : <CheckCircle2 size={16} />}
          <span>Concluir e Iniciar Calmon Studio</span>
        </button>
      )}
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Assistente de Configuração Inicial"
      subtitle="Configure o modo Local ou Híbrido e conecte suas chaves de IA"
      icon={<Zap size={18} />}
      maxWidth="lg"
      footer={wizardFooter}
    >
      {/* Steps Progress Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          paddingBottom: '16px',
          marginBottom: '18px',
          borderBottom: '1px solid var(--border-subtle)',
          gap: '8px',
        }}
      >
        <div
          style={{
            flex: 1,
            height: '4px',
            borderRadius: '2px',
            backgroundColor: step >= 1 ? 'var(--accent-light)' : 'var(--border-subtle)',
            transition: 'background-color 0.3s',
          }}
        />
        <div
          style={{
            flex: 1,
            height: '4px',
            borderRadius: '2px',
            backgroundColor: step >= 2 ? 'var(--accent-light)' : 'var(--border-subtle)',
            transition: 'background-color 0.3s',
          }}
        />
        <div
          style={{
            flex: 1,
            height: '4px',
            borderRadius: '2px',
            backgroundColor: step >= 3 ? '#10b981' : 'var(--border-subtle)',
            transition: 'background-color 0.3s',
          }}
        />
      </div>

      {/* Body do Wizard */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* PASSO 1: Escolha do Modo */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
                  Passo 1: Como você deseja rodar a inteligência da Calmon IA?
                </h3>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0 }}>
                  O modo local fica disponível de imediato. O modo nuvem usa o Cofre Privado por Conta: a sua chave fica cifrada e isolada na sua conta.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                {/* Opção Nuvem Híbrida */}
                <div
                  onClick={() => setMode('cloud')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setMode('cloud');
                  }}
                  style={{
                    padding: '18px 20px',
                    borderRadius: '14px',
                    cursor: 'pointer',
                    backgroundColor: mode === 'cloud' ? 'var(--accent-glow)' : 'rgba(255, 255, 255, 0.03)',
                    border: mode === 'cloud' ? '2px solid var(--accent-light)' : '1px solid rgba(255, 255, 255, 0.08)',
                    boxShadow: mode === 'cloud' ? '0 8px 24px var(--accent-glow)' : 'none',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        backgroundColor: 'var(--accent-glow)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--accent-light)',
                      }}
                    >
                      <Zap size={20} />
                    </div>
                    <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>
                      Cofre por conta
                    </span>
                  </div>

                  <div>
                    <h4 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                      Modo Nuvem Híbrido
                    </h4>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.45', margin: 0 }}>
                      Conecte o seu provedor externo (Gemini, OpenAI, Groq, DeepSeek ou Anthropic). A chave fica cifrada no cofre privado da sua conta.
                    </p>
                  </div>

                  <div style={{ fontSize: '0.74rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CheckCircle2 size={13} />
                    <span>Chave cifrada e isolada na sua conta</span>
                  </div>
                </div>

                {/* Opção 100% Offline */}
                <div
                  onClick={() => setMode('local')}
                  style={{
                    padding: '18px 20px',
                    borderRadius: '14px',
                    cursor: 'pointer',
                    backgroundColor: mode === 'local' ? 'var(--accent-glow)' : 'rgba(255, 255, 255, 0.03)',
                    border: mode === 'local' ? '2px solid var(--accent-light)' : '1px solid rgba(255, 255, 255, 0.08)',
                    boxShadow: mode === 'local' ? '0 8px 24px var(--accent-glow)' : 'none',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        backgroundColor: 'var(--accent-glow)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--accent-light)',
                      }}
                    >
                      <Cpu size={20} />
                    </div>
                    <span className="badge badge-purple" style={{ fontSize: '0.7rem' }}>
                      100% Offline
                    </span>
                  </div>

                  <div>
                    <h4 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                      Modo Ollama Local
                    </h4>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.45', margin: 0 }}>
                      Execução estritamente no seu computador. Requer o daemon do Ollama instalado e cerca de 8 GB de RAM disponível para inferência local.
                    </p>
                  </div>

                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Server size={13} />
                    <span>Executa em localhost:11434</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* PASSO 2: Configuração dos Detalhes */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
                  {mode === 'cloud'
                    ? 'Passo 2: Escolha seu provedor e conecte sua Chave de API'
                    : 'Passo 2: Verificação do Ollama Local'}
                </h3>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0 }}>
                  {mode === 'cloud'
                    ? 'Recomendamos o Google Gemini para início imediato e sem custos.'
                    : 'Certifique-se de que o aplicativo Ollama está em execução no seu computador.'}
                </p>
              </div>

              <div className="glass-panel" style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <div><strong style={{ color: 'var(--text-primary)', fontSize: '.8rem' }}>Verificação do ambiente</strong><div style={{ color: 'var(--text-muted)', fontSize: '.72rem', marginTop: 4 }}>{checkingEnvironment ? 'A consultar o servidor…' : 'Estado recebido do backend'}</div></div>
                {[
                  ['Base de dados', environmentStatus?.database_available],
                  ['Modelo local', environmentStatus?.local_model_available],
                  ['Cofre cifrado', environmentStatus?.vault_encryption_ready],
                  ['Provider cloud', environmentStatus?.hybrid_provider_enabled],
                ].map(([label, ready]) => <div key={String(label)} style={{ fontSize: '.78rem', color: 'var(--text-secondary)' }}>{label}: <strong style={{ color: ready === true ? 'var(--success-color)' : ready === false ? 'var(--warning-color)' : 'var(--text-muted)' }}>{ready === true ? 'Disponível' : ready === false ? 'Não configurado' : 'A verificar'}</strong></div>)}
              </div>
              {mode === 'cloud' ? (
                <div
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    padding: '18px 20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Zap size={20} color="#fbbf24" />
                    <span style={{ fontSize: '0.94rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Cofre Privado por Conta
                    </span>
                  </div>

                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
                    A chave é gravada cifrada no cofre da sua conta e usada automaticamente nas suas inferências.
                    As chamadas externas continuam sujeitas à política de dados sensíveis e ao orçamento global.
                  </p>

                  <label style={{ display: 'grid', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Provedor
                    <select
                      value={cloudProvider}
                      onChange={(event) => handleProviderChange(event.target.value as CloudProvider)}
                      style={{ padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                    >
                      <option value="gemini">Google Gemini</option>
                      <option value="openai">OpenAI</option>
                      <option value="groq">Groq</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="xai">xAI (Grok)</option>
                      <option value="custom">NVIDIA NIM / Endpoint compatível (Custom)</option>
                    </select>
                  </label>

                  <label style={{ display: 'grid', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Chave de API
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={cloudApiKey}
                      onChange={(event) => setCloudApiKey(event.target.value)}
                      placeholder="A chave é enviada uma única vez e guardada cifrada"
                      style={{ padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                    />
                  </label>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                    <label style={{ display: 'grid', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Modelo predefinido
                      <input
                        value={cloudModel}
                        onChange={(event) => setCloudModel(event.target.value)}
                        placeholder="ex.: gemini-2.5-flash"
                        style={{ padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Base URL
                      <input
                        value={cloudBaseUrl}
                        onChange={(event) => setCloudBaseUrl(event.target.value)}
                        placeholder="https://api.provedor.com/v1"
                        style={{ padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                      />
                    </label>
                  </div>

                  {cloudProvider !== 'gemini' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={probingModels || !cloudApiKey.trim()}
                        onClick={() => void handleProbeModels()}
                      >
                        <RefreshCw size={14} className={probingModels ? 'animate-spin' : undefined} />
                        {probingModels ? 'Buscando catálogo…' : 'Testar & Descobrir Modelos'}
                      </button>
                      {probeMessage && (
                        <span style={{ fontSize: '0.76rem', color: '#4ade80' }}>{probeMessage}</span>
                      )}
                    </div>
                  )}

                  {discoveredModels.length > 0 && (
                    <>
                      <ProviderModelSelector
                        provider={cloudProvider}
                        discoveredModels={discoveredModels}
                        enabledModels={enabledModels}
                        defaultModel={cloudModel}
                        onChangeEnabledModels={setEnabledModels}
                        onSelectDefaultModel={setCloudModel}
                      />
                      {discoveredModels.length > 1 && (
                        <AgentModelRecommendationsPanel
                          discoveredModels={discoveredModels}
                          compact
                          showApplyButton={false}
                          onSelectionChange={setAgentAssignments}
                        />
                      )}
                    </>
                  )}

                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    Pode alterar, testar ou remover a chave mais tarde em Modelos → Cofre de Chaves. Nenhum segredo é devolvido ao navegador.
                  </span>
                </div>
              ) : (
                /* Modo Local: Instruções e Verificação */
                <div
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    padding: '18px 20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Cpu size={20} color="#34d399" />
                    <span style={{ fontSize: '0.94rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Modelos Locais Recomendados para o JARVIS
                    </span>
                  </div>

                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    O JARVIS utiliza o modelo leve <code>llama3.2:3b</code> para triagem de tarefas e o <code>qwen2.5-coder:7b</code> para desenvolvimento de código.
                  </div>

                  <div
                    style={{
                      backgroundColor: 'var(--bg-input)',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.78rem',
                      color: 'var(--accent-light)',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    ollama run llama3.2:3b
                  </div>

                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    A disponibilidade do provedor local deve ser confirmada no painel de modelos.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* PASSO 3: Confirmação e Segurança */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
                  Passo 3: Garantia de Segurança & Conclusão
                </h3>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0 }}>
                  Seu ambiente local é protegido pelo Núcleo de Políticas e Auditoria da Calmon IA.
                </p>
              </div>

              {/* Banner de Proteção DLP */}
              <div
                style={{
                  backgroundColor: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  borderRadius: '12px',
                  padding: '16px 18px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                }}
              >
                <ShieldCheck size={22} color="#10b981" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#34d399', margin: '0 0 4px' }}>
                    Políticas de Segurança da Calmon IA
                  </h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
                    As políticas de autenticação, permissões e auditoria podem ser consultadas no Security Center. No modo nuvem, a chave fica no Cofre Privado por Conta, cifrada em repouso e isolada das restantes contas.
                  </p>
                </div>
              </div>

              {/* Resumo */}
              <div
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  borderRadius: '10px',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'block' }}>
                    Modo Configurado:
                  </span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {mode === 'cloud' ? `Nuvem Híbrida (${cloudProvider})` : '100% Offline (Ollama)'}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'block' }}>
                    Especialistas Ativos:
                  </span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--accent-light)' }}>
                    Agentes disponíveis no servidor
                  </span>
                </div>
              </div>
            </div>
          )}
        {finishError && (
          <div className="jarvis-callout jarvis-callout--danger" role="alert" style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={15} />
            <span>{finishError}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};