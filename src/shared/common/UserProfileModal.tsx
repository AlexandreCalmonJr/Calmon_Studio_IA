import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import {
  Sparkles,
  Save,
  Trash2,
  Download,
  Database,
  User,
  Sliders,
  KeyRound,
  Cpu,
  Smartphone,
  ArrowUpRight,
} from 'lucide-react';
import { fetchUserProfileApi, saveUserProfileApi, createSystemBackup } from '../../api';
import { getAccountStorageKey } from '../../services/accountScope';
import { API_BASE } from '../../services/api/client';
import { notify } from './Toast';
import { ConfirmDialog } from './ConfirmDialog';
import {
  ASSISTANT_NAME_PRESETS,
  DEFAULT_ASSISTANT_NAME,
  WorkspaceExperienceMode,
  normalizeAssistantName,
  normalizeExperienceMode,
} from '../../services/assistantIdentity';
import { useAssistantIdentity } from '../../context/AssistantIdentityContext';

export interface UserProfileData {
  displayName: string;
  roleTitle: string;
  avatarIcon: string;
  seniorityLevel: 'junior' | 'mid' | 'senior' | 'architect';
  responseStyle: 'concise' | 'detailed' | 'educational';
  userBackground: string;
  responseGuidelines: string;
  huggingfaceToken: string;
  groqApiKey: string;
  geminiApiKey: string;
  assistantName?: string;
  assistantGreeting?: string;
  experienceMode?: WorkspaceExperienceMode;
}

const DEFAULT_PROFILE: UserProfileData = {
  displayName: 'Desenvolvedor',
  roleTitle: 'Engenheiro de Software',
  avatarIcon: '💻',
  seniorityLevel: 'senior',
  responseStyle: 'detailed',
  userBackground: 'Stack principal: Python, TypeScript, Flutter, Docker e SQLite.',
  responseGuidelines: 'Priorizar código limpo, tipagem estrita, arquitetura modular e segurança OWASP.',
  huggingfaceToken: '',
  groqApiKey: '',
  geminiApiKey: '',
  assistantName: DEFAULT_ASSISTANT_NAME,
  assistantGreeting: '',
  experienceMode: 'engineering',
};

export const USER_PROFILE_STORAGE_KEY = 'jarvis_user_profile_v1';

export function getUserProfile(): UserProfileData {
  try {
    const raw = localStorage.getItem(getAccountStorageKey(USER_PROFILE_STORAGE_KEY));
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_PROFILE,
        ...parsed,
        assistantName: normalizeAssistantName(parsed.assistantName),
        experienceMode: normalizeExperienceMode(parsed.experienceMode),
      };
    }
  } catch {}
  return DEFAULT_PROFILE;
}

export function saveUserProfile(data: UserProfileData): void {
  try {
    const safeProfile = {
      ...data,
      assistantName: normalizeAssistantName(data.assistantName),
      experienceMode: normalizeExperienceMode(data.experienceMode),
      huggingfaceToken: '',
      groqApiKey: '',
      geminiApiKey: '',
    };
    localStorage.setItem(getAccountStorageKey(USER_PROFILE_STORAGE_KEY), JSON.stringify(safeProfile));
  } catch {}
}

type ProfileTab = 'profile' | 'instructions' | 'keys' | 'engine' | 'data' | 'devices';

const PROFILE_TABS: Array<{ id: ProfileTab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'profile', label: 'Identidade', icon: User },
  { id: 'instructions', label: 'Instruções', icon: Sliders },
  { id: 'keys', label: 'Chaves', icon: KeyRound },
  { id: 'engine', label: 'Motor Local', icon: Cpu },
  { id: 'data', label: 'Backup', icon: Database },
  { id: 'devices', label: 'Dispositivos', icon: Smartphone },
];

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (tab: string) => void;
  onOpenSetupWizard?: () => void;
  onProfileUpdated?: (profile: UserProfileData) => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onOpenSetupWizard,
  onProfileUpdated,
}) => {
  const identity = useAssistantIdentity();
  const [activeTab, setActiveTab] = useState<ProfileTab>('profile');
  const [profile, setProfile] = useState<UserProfileData>(() => ({
    ...getUserProfile(),
    assistantName: identity.assistantName,
    experienceMode: identity.experienceMode,
  }));
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canEditProfile, setCanEditProfile] = useState(false);
  const [experienceMode, setExperienceMode] = useState<WorkspaceExperienceMode>(identity.experienceMode);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsAdmin(false);
    setCanEditProfile(false);
    fetch(`${API_BASE}/auth/me`, { credentials: 'include' })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((principal) => {
        if (!cancelled) {
          const human = principal?.kind === 'human';
          setIsAdmin(human && principal?.role === 'admin');
          setCanEditProfile(human && (principal?.role === 'admin' || principal?.role === 'developer'));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsAdmin(false);
          setCanEditProfile(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const base = {
      ...getUserProfile(),
      assistantName: identity.assistantName,
      experienceMode: identity.experienceMode,
    };
    setProfile(base);
    setExperienceMode(identity.experienceMode);
    setLoadingProfile(true);
    setSavedSuccess(false);

    fetchUserProfileApi()
      .then((dbProfile) => {
        if (cancelled || !dbProfile) return;
        const merged: UserProfileData = {
          ...base,
          ...dbProfile,
          assistantName: normalizeAssistantName(dbProfile.assistantName || base.assistantName),
          experienceMode: normalizeExperienceMode(dbProfile.experienceMode || base.experienceMode),
        };
        setProfile(merged);
        setExperienceMode(merged.experienceMode || 'engineering');
        saveUserProfile(merged);
      })
      .catch(() => {
        if (!cancelled) setProfile(base);
      })
      .finally(() => {
        if (!cancelled) setLoadingProfile(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, identity.assistantName, identity.experienceMode]);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canEditProfile || saving) return;
    setSaving(true);
    const nextProfile: UserProfileData = {
      ...profile,
      assistantName: normalizeAssistantName(profile.assistantName),
      experienceMode,
    };
    try {
      await identity.updateIdentityProfile(nextProfile);
      await saveUserProfileApi(nextProfile);
      saveUserProfile(nextProfile);
      setSavedSuccess(true);
      notify(`Preferências salvas para ${nextProfile.assistantName}.`, 'success');
      onProfileUpdated?.(nextProfile);
      window.setTimeout(() => setSavedSuccess(false), 2500);
    } catch {
      saveUserProfile(nextProfile);
      onProfileUpdated?.(nextProfile);
      setSavedSuccess(false);
      notify(
        'Preferências guardadas localmente neste navegador.',
        'info',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleBackupDatabase = async () => {
    if (!isAdmin) return;
    setBackingUp(true);
    try {
      await createSystemBackup();
      notify('Backup do sistema criado com sucesso.', 'success');
    } catch (e: any) {
      notify(`Erro ao gerar backup: ${e.message}`, 'error');
    } finally {
      setBackingUp(false);
    }
  };

  const handleClearHistory = () => {
    setConfirmClearOpen(true);
  };

  const confirmClearHistory = () => {
    try {
      const accountSuffix = getAccountStorageKey('__scope_probe__').slice('__scope_probe__'.length);
      const fixedKeys = new Set([
        getAccountStorageKey('jarvis_chat_messages_v1'),
        getAccountStorageKey('jarvis_chat_session_id_v1'),
        getAccountStorageKey('jarvis_sessions_catalog_v1'),
      ]);
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key && (fixedKeys.has(key) || (key.startsWith('jarvis_session_messages_') && key.endsWith(accountSuffix)))) {
          localStorage.removeItem(key);
        }
      }
    } catch {
      notify('O navegador não permitiu limpar o armazenamento local.', 'error');
      return;
    }
    setConfirmClearOpen(false);
    notify('Histórico local desta conta limpo com sucesso.', 'info');
    setTimeout(() => window.location.reload(), 600);
  };

  const handleExportData = () => {
    try {
      const messages = localStorage.getItem(getAccountStorageKey('jarvis_chat_messages_v1')) || '[]';
      const blob = new Blob([messages], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jarvis_chat_export_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      notify('Conversa atual exportada.', 'success');
    } catch (e: any) {
      notify(`Erro ao exportar dados: ${e.message}`, 'error');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Perfil e Preferências da Conta"
      maxWidth="lg"
    >
      {/* Navegação entre Abas do Perfil */}
      <div className="jarvis-profile-tabs" role="tablist" aria-label="Seções do perfil">
        {PROFILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`jarvis-segmented-btn ${isActive ? 'is-active' : ''}`}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {savedSuccess && (
        <div className="jarvis-callout jarvis-callout--success" style={{ marginBottom: '16px' }} role="status">
          Preferências sincronizadas com o banco de dados e núcleo do JARVIS.
        </div>
      )}

      {/* Aba: Identidade & Experiência */}
      {activeTab === 'profile' && (
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="jarvis-settings-subcard" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label
                htmlFor="profile-assistant-name"
                style={{
                  fontSize: '0.86rem',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  display: 'block',
                  marginBottom: '4px',
                }}
              >
                Nome do seu Assistente Principal
              </label>
              <p style={{ fontSize: '0.77rem', color: 'var(--text-secondary)', margin: '0 0 10px 0', lineHeight: 1.45 }}>
                O padrão é JARVIS, mas cada pessoa pode batizar o assistente como preferir (ex.: João, Maria, Luna). O nome atualiza toda a interface em tempo real.
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                {ASSISTANT_NAME_PRESETS.map((preset) => {
                  const isSelected = normalizeAssistantName(profile.assistantName) === preset.name;
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => setProfile((prev) => ({ ...prev, assistantName: preset.name }))}
                      className={`btn btn-xs ${isSelected ? 'btn-secondary is-active' : 'btn-ghost'}`}
                    >
                      {preset.name}
                    </button>
                  );
                })}
              </div>
              <input
                id="profile-assistant-name"
                type="text"
                maxLength={40}
                value={profile.assistantName || DEFAULT_ASSISTANT_NAME}
                onChange={(e) => setProfile({ ...profile, assistantName: e.target.value })}
                className="jarvis-input"
                placeholder="Ex: JARVIS, João ou Maria"
              />
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
              <label
                style={{
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  display: 'block',
                  marginBottom: '4px',
                }}
              >
                Modo da Interface
              </label>
              <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', margin: '0 0 10px 0', lineHeight: 1.45 }}>
                Escolha entre uma experiência limpa para rotina/estudos ou o painel técnico completo de engenharia.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '8px' }}>
                {[
                  {
                    id: 'simple' as const,
                    label: 'Modo Simples (Pessoal & Estudos)',
                    desc: 'Menu enxuto: Início, Conversar, Meus Agentes, Fluxos, Tarefas e Cadernos.',
                  },
                  {
                    id: 'engineering' as const,
                    label: 'Modo Completo (Engenharia & Segurança)',
                    desc: 'Acesso total a Coding Agent, Estúdios, Aprovações, Governança e Logs.',
                  },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    aria-pressed={experienceMode === mode.id}
                    onClick={() => {
                      setExperienceMode(mode.id);
                      setProfile((prev) => ({ ...prev, experienceMode: mode.id }));
                      void identity.setExperienceMode(mode.id);
                    }}
                    className={`jarvis-choice-card ${experienceMode === mode.id ? 'is-active' : ''}`}
                  >
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>{mode.label}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.38 }}>{mode.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {!canEditProfile && (
            <div role="status" className="jarvis-callout">
              Perfil em modo de consulta. A edição exige a permissão <code>profile:write</code>.
            </div>
          )}

          <fieldset
            disabled={!canEditProfile}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '14px' }}
          >
            <div className="user-profile-avatar-section">
              <label className="user-profile-field-label">Ícone do perfil</label>
              <div className="user-profile-avatar-options" role="group" aria-label="Escolher ícone do perfil">
                {['💻', '🧑‍💻', '👨‍💼', '👩‍💻', '🛠️', '🧠', '🚀', '🤖'].map((avatar) => (
                  <button
                    key={avatar}
                    type="button"
                    className={`user-profile-avatar-option ${profile.avatarIcon === avatar ? 'is-active' : ''}`}
                    aria-label={`Selecionar ícone ${avatar}`}
                    aria-pressed={profile.avatarIcon === avatar}
                    onClick={() => setProfile({ ...profile, avatarIcon: avatar })}
                  >
                    {avatar}
                  </button>
                ))}
              </div>
            </div>

            <div className="user-profile-grid">
              <div>
                <label className="user-profile-field-label" htmlFor="profile-display-name">
                  Nome de Exibição
                </label>
                <input
                  id="profile-display-name"
                  type="text"
                  value={profile.displayName}
                  onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
                  className="jarvis-input"
                  placeholder="Ex: Carlos Silva"
                  required
                />
              </div>

              <div>
                <label className="user-profile-field-label" htmlFor="profile-role-title">
                  Cargo / Especialidade Técnica
                </label>
                <input
                  id="profile-role-title"
                  type="text"
                  value={profile.roleTitle}
                  onChange={(e) => setProfile({ ...profile, roleTitle: e.target.value })}
                  className="jarvis-input"
                  placeholder="Ex: Desenvolvedor Fullstack"
                  required
                />
              </div>
            </div>

            <div className="user-profile-grid">
              <div>
                <label className="user-profile-field-label" htmlFor="profile-seniority">
                  Nível de Senioridade
                </label>
                <select
                  id="profile-seniority"
                  value={profile.seniorityLevel}
                  onChange={(e) => setProfile({ ...profile, seniorityLevel: e.target.value as any })}
                  className="jarvis-select"
                >
                  <option value="junior">Estudante / Júnior (Explicações didáticas)</option>
                  <option value="mid">Pleno (Código limpo, padrões e testes)</option>
                  <option value="senior">Sênior / Tech Lead (Respostas avançadas e concisas)</option>
                  <option value="architect">Arquiteto de Software (Escalabilidade e ADR)</option>
                </select>
              </div>

              <div>
                <label className="user-profile-field-label" htmlFor="profile-response-style">
                  Estilo de Resposta do JARVIS
                </label>
                <select
                  id="profile-response-style"
                  value={profile.responseStyle}
                  onChange={(e) => setProfile({ ...profile, responseStyle: e.target.value as any })}
                  className="jarvis-select"
                >
                  <option value="concise">Direto ao Ponto (Mais rápido, foco no essencial)</option>
                  <option value="detailed">Técnico & Completo (Código completo com testes)</option>
                  <option value="educational">Educacional & Explicativo (Passo a passo didático)</option>
                </select>
              </div>
            </div>
          </fieldset>

          {canEditProfile && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
              <button type="submit" disabled={saving || loadingProfile} className="btn btn-primary btn-sm">
                <Save size={14} />
                <span>{saving ? 'Salvando…' : 'Salvar Perfil'}</span>
              </button>
            </div>
          )}
        </form>
      )}

      {/* Aba: Instruções Personalizadas */}
      {activeTab === 'instructions' && (
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {!canEditProfile && (
            <div role="status" className="jarvis-callout">
              Instruções personalizadas em modo de consulta. A edição exige a permissão <code>profile:write</code>.
            </div>
          )}

          <fieldset
            disabled={!canEditProfile}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}
          >
            <div>
              <label
                htmlFor="profile-user-background"
                style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}
              >
                O que o JARVIS deve saber sobre você para fornecer respostas melhores?
              </label>
              <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '0 0 8px 0' }}>
                Ex: Suas linguagens preferidas, frameworks que você utiliza no dia a dia, projetos em andamento.
              </p>
              <textarea
                id="profile-user-background"
                rows={3}
                value={profile.userBackground}
                onChange={(e) => setProfile({ ...profile, userBackground: e.target.value })}
                className="jarvis-textarea"
                style={{ resize: 'vertical' }}
                placeholder="Ex: Trabalho principalmente com Python (FastAPI), Flutter para mobile e PostgreSQL."
              />
            </div>

            <div>
              <label
                htmlFor="profile-response-guidelines"
                style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}
              >
                Como você gostaria que o JARVIS respondesse e formatasse o código?
              </label>
              <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '0 0 8px 0' }}>
                Ex: Padrões arquiteturais favoritos (Clean Architecture, SOLID, BLoC), comentários ou testes unitários.
              </p>
              <textarea
                id="profile-response-guidelines"
                rows={3}
                value={profile.responseGuidelines}
                onChange={(e) => setProfile({ ...profile, responseGuidelines: e.target.value })}
                className="jarvis-textarea"
                style={{ resize: 'vertical' }}
                placeholder="Ex: Sempre forneça código completo pronto para copiar. Use tipagem estrita no TypeScript."
              />
            </div>
          </fieldset>

          {canEditProfile && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
              <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
                <Save size={14} />
                <span>{saving ? 'Salvando…' : 'Salvar Instruções'}</span>
              </button>
            </div>
          )}
        </form>
      )}

      {/* Aba: Cofre de Chaves */}
      {activeTab === 'keys' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="jarvis-callout jarvis-callout--warning" role="status">
            <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
              Gerenciamento centralizado no Cofre de Chaves
            </strong>
            As credenciais de provedores em nuvem são armazenadas de forma cifrada no módulo{' '}
            <strong style={{ color: 'var(--text-primary)' }}>Gestor de Modelos</strong>. Nunca insira tokens ou senhas
            nas instruções personalizadas.
          </div>

          {onNavigate && (
            <div className="jarvis-settings-subcard">
              <div className="jarvis-setting-row">
                <div className="jarvis-setting-row__info">
                  <div className="jarvis-setting-row__title">Cofre de Chaves & Provedores</div>
                  <div className="jarvis-setting-row__desc">
                    Configure chaves da OpenAI, Anthropic, Gemini, Groq ou OpenRouter e valide conectividade.
                  </div>
                </div>
                <div className="jarvis-setting-row__control">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onNavigate('models');
                    }}
                    className="btn btn-primary btn-sm"
                  >
                    <KeyRound size={14} />
                    <span>Abrir Gestor de Modelos</span>
                    <ArrowUpRight size={13} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Aba: Motor & Setup */}
      {activeTab === 'engine' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="jarvis-callout jarvis-callout--info">
            <div className="jarvis-setting-row">
              <div className="jarvis-setting-row__info">
                <div
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: 'var(--accent-light)',
                    marginBottom: '4px',
                  }}
                >
                  Configuração centralizada
                </div>
                <strong style={{ fontSize: '0.92rem', color: 'var(--text-primary)', display: 'block' }}>
                  Preferências de execução e modelos
                </strong>
                <p style={{ fontSize: '0.79rem', color: 'var(--text-secondary)', margin: '4px 0 0 0', lineHeight: 1.48 }}>
                  A seleção efetiva de modelos e provedores é controlada pelo Gestor de Modelos e pelas políticas de execução.
                </p>
              </div>

              {onOpenSetupWizard && (
                <div className="jarvis-setting-row__control">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenSetupWizard();
                    }}
                    className="btn btn-primary btn-sm"
                  >
                    <Sparkles size={14} />
                    <span>Abrir Assistente de Setup</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="jarvis-settings-subcard">
            <div className="jarvis-setting-row__title" style={{ marginBottom: '4px' }}>
              Privacidade e políticas de dados
            </div>
            <div className="jarvis-setting-row__desc">
              A proteção de dados depende das políticas e integrações efetivamente ativas. Consulte Segurança e o Gestor de Modelos para verificar os controles disponíveis nesta instalação.
            </div>
          </div>
        </div>
      )}

      {/* Aba: Dados & Backup */}
      {activeTab === 'data' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {isAdmin && (
            <div className="jarvis-settings-subcard">
              <div className="jarvis-setting-row">
                <div className="jarvis-setting-row__info">
                  <div className="jarvis-setting-row__title">Backup do sistema</div>
                  <div className="jarvis-setting-row__desc">
                    Gera uma cópia do banco de dados SQLite do servidor. Disponível apenas para administradores.
                  </div>
                </div>
                <div className="jarvis-setting-row__control">
                  <button
                    type="button"
                    onClick={handleBackupDatabase}
                    disabled={backingUp}
                    className="btn btn-secondary btn-sm"
                  >
                    <Database size={14} color="var(--accent-light)" />
                    <span>{backingUp ? 'Gerando Backup...' : 'Criar Backup SQLite'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="jarvis-settings-subcard">
            <div className="jarvis-setting-row">
              <div className="jarvis-setting-row__info">
                <div className="jarvis-setting-row__title">Exportar Conversa Atual</div>
                <div className="jarvis-setting-row__desc">
                  Exporta as mensagens da conversa atual guardadas neste navegador em formato JSON.
                </div>
              </div>
              <div className="jarvis-setting-row__control">
                <button type="button" onClick={handleExportData} className="btn btn-secondary btn-sm">
                  <Download size={14} />
                  <span>Exportar JSON</span>
                </button>
              </div>
            </div>
          </div>

          <div className="jarvis-callout jarvis-callout--danger">
            <div className="jarvis-setting-row">
              <div className="jarvis-setting-row__info">
                <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#f87171' }}>
                  Limpar Histórico Local
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
                  Apaga o histórico de conversas e o catálogo de sessões guardados neste navegador para esta conta.
                </div>
              </div>
              <div className="jarvis-setting-row__control">
                <button type="button" onClick={handleClearHistory} className="btn btn-danger btn-sm">
                  <Trash2 size={14} />
                  <span>Limpar Dados</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Aba: Dispositivos Móveis & Acessos */}
      {activeTab === 'devices' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <h4 style={{ fontSize: '0.96rem', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>
              Conexão com App Mobile / Android
            </h4>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.48 }}>
              Conecte seu smartphone Android ao JARVIS Hub para enviar comandos de voz e receber notificações sincronizadas.
            </p>
          </div>

          <div className="jarvis-settings-subcard">
            <div className="jarvis-setting-row">
              <div className="jarvis-setting-row__info">
                <div className="jarvis-setting-row__title">Emparelhar Celular Android</div>
                <div className="jarvis-setting-row__desc">
                  Gera um token exclusivo para a sua conta, isolado dos dados de outros usuários.
                </div>
              </div>
              <div className="jarvis-setting-row__control">
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('jarvis:open-android-pairing'));
                    onClose();
                  }}
                  className="btn btn-primary btn-sm"
                >
                  <Smartphone size={14} />
                  <span>Conectar Android</span>
                </button>
              </div>
            </div>
          </div>

          <div className="jarvis-settings-subcard">
            <div className="jarvis-setting-row">
              <div className="jarvis-setting-row__info">
                <div className="jarvis-setting-row__title">Gestão de Acessos & Usuários</div>
                <div className="jarvis-setting-row__desc">
                  Gerencie contas, tokens de administrador e permissões de acesso ao servidor.
                </div>
              </div>
              <div className="jarvis-setting-row__control">
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('jarvis:open-access-management'));
                    onClose();
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  <span>Gerir Acessos</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmClearOpen}
        title="Limpar histórico local"
        description="Tem certeza de que deseja apagar todo o histórico de conversas locais? Esta ação não pode ser desfeita."
        confirmLabel="Apagar histórico"
        tone="danger"
        onConfirm={confirmClearHistory}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </Modal>
  );
};
