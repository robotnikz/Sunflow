export type ThemeMode = 'system' | 'dark' | 'light';
export type LanguageMode = 'system' | 'en' | 'de';

const THEME_KEY = 'sunflow_theme_mode';
const LANGUAGE_KEY = 'sunflow_language_mode';

const THEME_EVENT = 'sunflow:theme';
const LANGUAGE_EVENT = 'sunflow:language';

type ResolvedTheme = 'dark' | 'light';
type ResolvedLanguage = 'en' | 'de';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore (private mode / disabled storage)
  }
}

export function getThemeMode(): ThemeMode {
  const raw = safeGet(THEME_KEY);
  if (raw === 'dark' || raw === 'light' || raw === 'system') return raw;
  return 'system';
}

export function getLanguageMode(): LanguageMode {
  const raw = safeGet(LANGUAGE_KEY);
  if (raw === 'en' || raw === 'de' || raw === 'system') return raw;
  // Keep existing behavior stable: default UI remains English unless user opts in.
  return 'en';
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'dark' || mode === 'light') return mode;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveLanguage(mode: LanguageMode): ResolvedLanguage {
  if (mode === 'en' || mode === 'de') return mode;
  const navLang = typeof navigator !== 'undefined' ? (navigator.language || '') : '';
  return navLang.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function applyThemeMode(mode: ThemeMode): void {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = resolved;
}

export function applyLanguageMode(mode: LanguageMode): void {
  const resolved = resolveLanguage(mode);
  document.documentElement.dataset.languageMode = mode;
  document.documentElement.lang = resolved;
}

export function setThemeMode(mode: ThemeMode): void {
  safeSet(THEME_KEY, mode);
  applyThemeMode(mode);
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function setLanguageMode(mode: LanguageMode): void {
  safeSet(LANGUAGE_KEY, mode);
  applyLanguageMode(mode);
  window.dispatchEvent(new Event(LANGUAGE_EVENT));
}

let themeMediaQuery: MediaQueryList | null = null;
let themeListenerInstalled = false;

export function initUiPreferences(): void {
  // Apply stored preferences immediately.
  applyThemeMode(getThemeMode());
  applyLanguageMode(getLanguageMode());

  // React to OS theme changes when in system mode.
  if (!themeListenerInstalled && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    themeListenerInstalled = true;
    themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const onChange = () => {
      if (getThemeMode() !== 'system') return;
      applyThemeMode('system');
      window.dispatchEvent(new Event(THEME_EVENT));
    };

    // Safari < 14 uses addListener
    if (typeof themeMediaQuery.addEventListener === 'function') {
      themeMediaQuery.addEventListener('change', onChange);
    } else if (typeof (themeMediaQuery as any).addListener === 'function') {
      (themeMediaQuery as any).addListener(onChange);
    }
  }
}

export function addThemeListener(fn: () => void): () => void {
  window.addEventListener(THEME_EVENT, fn);
  return () => window.removeEventListener(THEME_EVENT, fn);
}

export function addLanguageListener(fn: () => void): () => void {
  window.addEventListener(LANGUAGE_EVENT, fn);
  return () => window.removeEventListener(LANGUAGE_EVENT, fn);
}

