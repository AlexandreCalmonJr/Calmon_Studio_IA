import { getAccountStorageKey } from './accountScope';
import {
  DEFAULT_ASSISTANT_NAME,
  WorkspaceExperienceMode,
  normalizeAssistantName,
  normalizeExperienceMode,
} from './assistantIdentity';

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
  displayName: 'Usuário',
  roleTitle: 'Uso Pessoal & Produtividade',
  avatarIcon: '🙂',
  seniorityLevel: 'mid',
  responseStyle: 'concise',
  userBackground: '',
  responseGuidelines: 'Responder em português claro, objetivo e fácil de seguir.',
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
