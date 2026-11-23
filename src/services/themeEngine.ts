export type ThemeMode = 'friendly_light' | 'obsidian' | 'soft_dusk' | 'oled' | 'auto';
export type ResolvedTheme = 'friendly_light' | 'obsidian' | 'soft_dusk' | 'oled';
export type AccentColor = 'orange' | 'indigo' | 'emerald' | 'blue' | 'rose';
export type UiDensity = 'comfortable' | 'balanced' | 'compact';

export interface ThemePreferences {
  themeMode: ThemeMode;
  accentColor: AccentColor;
  uiDensity: UiDensity;
  glassmorphism: boolean;
  smoothAnimations: boolean;
}

export interface ThemeOption {
  id: ThemeMode;
  name: string;
  shortLabel: string;
  desc: string;
  previewBg: string;
  previewCard: string;
  previewText: string;
  isLight: boolean;
}

export interface AccentOption {
  id: AccentColor;
  name: string;
  hex: string;
}

export const THEME_STORAGE_KEY = 'jarvis_dynamic_theme_v1';
export const THEME_CHANGED_EVENT = 'jarvis:theme-changed';

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  themeMode: 'friendly_light',
  accentColor: 'indigo',
  uiDensity: 'comfortable',
  glassmorphism: true,
  smoothAnimations: true,
};

export const THEME_CATALOG: ThemeOption[] = [
  {
    id: 'friendly_light',
    name: 'Claro Amigável (Recomendado)',
    shortLabel: 'Claro',
    desc: 'Superfície limpa em alabastro suave com cards brancos nítidos e leitura descansada.',
    previewBg: '#f6f8fc',
    previewCard: '#ffffff',
    previewText: '#0f172a',
    isLight: true,
  },
  {
    id: 'obsidian',
    name: 'Obsidian Studio',
    shortLabel: 'Obsidian',
    desc: 'Modo escuro refinado em ardósia profunda com contraste calibrado para foco.',
    previewBg: '#0b0d12',
    previewCard: '#141821',
    previewText: '#f1f5f9',
    isLight: false,
  },
  {
    id: 'soft_dusk',
    name: 'Grafite Suave',
    shortLabel: 'Grafite',
    desc: 'Cinza-grafite aconchegante com contraste mais macio para longas sessões.',
    previewBg: '#171a23',
    previewCard: '#202533',
    previewText: '#f1f5f9',
    isLight: false,
  },
  {
    id: 'oled',
    name: 'OLED Puro',
    shortLabel: 'OLED',
    desc: 'Preto absoluto para monitores OLED e contraste máximo noturno.',
    previewBg: '#000000',
    previewCard: '#0c0f15',
    previewText: '#f8fafc',
    isLight: false,
  },
  {
    id: 'auto',
    name: 'Automático do Sistema',
    shortLabel: 'Auto',
    desc: 'Acompanha automaticamente o tema Claro ou Escuro do seu sistema operacional.',
    previewBg: 'linear-gradient(135deg, #f6f8fc 50%, #0b0d12 50%)',
    previewCard: '#ffffff',
    previewText: '#0f172a',
    isLight: false,
  },
];

export const ACCENT_CATALOG: AccentOption[] = [
  { id: 'orange', name: 'Laranja JARVIS', hex: '#ea580c' },
  { id: 'indigo', name: 'Índigo Amigável', hex: '#4f46e5' },
  { id: 'blue', name: 'Azul Cobalto', hex: '#2563eb' },
  { id: 'emerald', name: 'Esmeralda', hex: '#059669' },
  { id: 'rose', name: 'Coral Suave', hex: '#e11d48' },
];

const VALID_THEMES = new Set<ThemeMode>(['friendly_light', 'obsidian', 'soft_dusk', 'oled', 'auto']);
const VALID_ACCENTS = new Set<AccentColor>(['orange', 'indigo', 'emerald', 'blue', 'rose']);
const VALID_DENSITIES = new Set<UiDensity>(['comfortable', 'balanced', 'compact']);

/**
 * Resolves `auto` against OS dark-mode preference into a concrete theme ID.
 */
export function resolveEffectiveTheme(themeMode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (themeMode === 'auto') {
    return prefersDark ? 'obsidian' : 'friendly_light';
  }
  return VALID_THEMES.has(themeMode) ? themeMode : 'friendly_light';
}

export function isLightTheme(resolved: ResolvedTheme): boolean {
  return resolved === 'friendly_light';
}

/**
 * Sanitizes untrusted stored or imported theme preferences.
 */
export function sanitizeThemePreferences(raw: unknown): ThemePreferences {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawTheme = String(input.themeMode || '') as ThemeMode;
  // Support legacy 'graphite' id gracefully
  const normalizedTheme: ThemeMode =
    rawTheme === ('graphite' as ThemeMode)
      ? 'soft_dusk'
      : VALID_THEMES.has(rawTheme)
        ? rawTheme
        : DEFAULT_THEME_PREFERENCES.themeMode;

  const rawAccent = String(input.accentColor || '') as AccentColor;
  // Support legacy 'purple' id gracefully
  const normalizedAccent: AccentColor =
    rawAccent === ('purple' as AccentColor)
      ? 'indigo'
      : VALID_ACCENTS.has(rawAccent)
        ? rawAccent
        : DEFAULT_THEME_PREFERENCES.accentColor;

  const rawDensity = String(input.uiDensity || '') as UiDensity;
  const normalizedDensity: UiDensity = VALID_DENSITIES.has(rawDensity)
    ? rawDensity
    : DEFAULT_THEME_PREFERENCES.uiDensity;

  return {
    themeMode: normalizedTheme,
    accentColor: normalizedAccent,
    uiDensity: normalizedDensity,
    glassmorphism:
      typeof input.glassmorphism === 'boolean'
        ? input.glassmorphism
        : DEFAULT_THEME_PREFERENCES.glassmorphism,
    smoothAnimations:
      typeof input.smoothAnimations === 'boolean'
        ? input.smoothAnimations
        : DEFAULT_THEME_PREFERENCES.smoothAnimations,
  };
}

/**
 * Cycles the top-bar quick theme toggle cleanly: Claro -> Obsidian -> Auto -> Claro.
 */
export function getNextQuickTheme(current: ThemeMode): ThemeMode {
  if (current === 'friendly_light') return 'obsidian';
  if (current === 'obsidian' || current === 'soft_dusk' || current === 'oled') return 'auto';
  return 'friendly_light';
}

export function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function loadThemePreferences(): ThemePreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_THEME_PREFERENCES };
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_THEME_PREFERENCES };
    return sanitizeThemePreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_THEME_PREFERENCES };
  }
}

export function applyThemeToDocument(
  prefs: ThemePreferences,
  prefersDark: boolean = getSystemPrefersDark()
): ResolvedTheme {
  const resolved = resolveEffectiveTheme(prefs.themeMode, prefersDark);
  if (typeof document !== 'undefined' && document.documentElement) {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.themeMode = prefs.themeMode;
    root.dataset.accent = prefs.accentColor;
    root.dataset.density = prefs.uiDensity;
    root.dataset.glass = prefs.glassmorphism ? 'on' : 'off';
    root.dataset.reducedMotion = prefs.smoothAnimations ? 'false' : 'true';
    root.style.colorScheme = isLightTheme(resolved) ? 'light' : 'dark';
  }
  return resolved;
}

export function saveAndApplyThemePreferences(
  patch: Partial<ThemePreferences>
): { preferences: ThemePreferences; resolved: ResolvedTheme } {
  const merged = sanitizeThemePreferences({
    ...loadThemePreferences(),
    ...patch,
  });

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // Ignore storage quota errors in private contexts
    }
  }

  const resolved = applyThemeToDocument(merged);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(THEME_CHANGED_EVENT, {
        detail: { preferences: merged, resolved },
      })
    );
  }

  return { preferences: merged, resolved };
}

let mediaListenerInstalled = false;

/**
 * Bootstraps theme attributes synchronously before React mounts and binds
 * live OS color-scheme updates when themeMode === 'auto'.
 */
export function initDynamicTheme(): { preferences: ThemePreferences; resolved: ResolvedTheme } {
  const preferences = loadThemePreferences();
  const resolved = applyThemeToDocument(preferences);

  if (
    !mediaListenerInstalled &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
  ) {
    mediaListenerInstalled = true;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSchemeChange = (event: MediaQueryListEvent) => {
      const current = loadThemePreferences();
      if (current.themeMode === 'auto') {
        const nextResolved = applyThemeToDocument(current, event.matches);
        window.dispatchEvent(
          new CustomEvent(THEME_CHANGED_EVENT, {
            detail: { preferences: current, resolved: nextResolved },
          })
        );
      }
    };
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onSchemeChange);
    }
  }

  return { preferences, resolved };
}
