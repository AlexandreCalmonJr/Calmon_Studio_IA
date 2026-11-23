import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_THEME_PREFERENCES,
  resolveEffectiveTheme,
  sanitizeThemePreferences,
  getNextQuickTheme,
  isLightTheme,
} from './themeEngine';

test('resolveEffectiveTheme resolves auto against OS dark preference', () => {
  assert.equal(resolveEffectiveTheme('auto', true), 'obsidian');
  assert.equal(resolveEffectiveTheme('auto', false), 'friendly_light');
  assert.equal(resolveEffectiveTheme('friendly_light', true), 'friendly_light');
  assert.equal(resolveEffectiveTheme('oled', false), 'oled');
});

test('sanitizeThemePreferences validates inputs and maps legacy values cleanly', () => {
  const clean = sanitizeThemePreferences({
    themeMode: 'graphite',
    accentColor: 'purple',
    uiDensity: 'compact',
    glassmorphism: false,
    smoothAnimations: false,
  });
  assert.deepEqual(clean, {
    themeMode: 'soft_dusk',
    accentColor: 'indigo',
    uiDensity: 'compact',
    glassmorphism: false,
    smoothAnimations: false,
  });

  const fallback = sanitizeThemePreferences({
    themeMode: 'invalid_theme',
    accentColor: 'neon_green',
    uiDensity: 'giant',
  });
  assert.deepEqual(fallback, DEFAULT_THEME_PREFERENCES);
});

test('getNextQuickTheme cycles Claro -> Obsidian -> Auto -> Claro', () => {
  assert.equal(getNextQuickTheme('friendly_light'), 'obsidian');
  assert.equal(getNextQuickTheme('obsidian'), 'auto');
  assert.equal(getNextQuickTheme('soft_dusk'), 'auto');
  assert.equal(getNextQuickTheme('auto'), 'friendly_light');
});

test('isLightTheme distinguishes friendly_light from dark themes', () => {
  assert.equal(isLightTheme('friendly_light'), true);
  assert.equal(isLightTheme('obsidian'), false);
  assert.equal(isLightTheme('soft_dusk'), false);
  assert.equal(isLightTheme('oled'), false);
});
