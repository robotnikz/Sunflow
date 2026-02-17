export type ThemeMode = 'system' | 'dark' | 'light';

const THEME_KEY = 'sunflow_theme_mode';

const THEME_EVENT = 'sunflow:theme';

type ResolvedTheme = 'dark' | 'light';

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

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'dark' || mode === 'light') return mode;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyThemeMode(mode: ThemeMode): void {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = resolved;
}

export function setThemeMode(mode: ThemeMode): void {
  safeSet(THEME_KEY, mode);
  applyThemeMode(mode);
  window.dispatchEvent(new Event(THEME_EVENT));
}

let themeMediaQuery: MediaQueryList | null = null;
let themeListenerInstalled = false;

export function initUiPreferences(): void {
  // Apply stored preferences immediately.
  applyThemeMode(getThemeMode());

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

