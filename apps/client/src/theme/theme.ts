import { useSyncExternalStore } from 'react';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** Same key as the inline script of `index.html`, which applies the theme before the first paint. */
const STORAGE_KEY = 'theme';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
/** The browser's bar around the app, as the sidebar frame; same values as the inline script of `index.html`. */
const BAR_COLORS = { light: '#f5f7f9', dark: '#0f1112' };
const listeners = new Set<() => void>();

function storedTheme(): Theme {
  const value = localStorage.getItem(STORAGE_KEY);
  return THEMES.includes(value as Theme) ? (value as Theme) : 'system';
}

function apply() {
  const theme = storedTheme();
  const dark = theme === 'dark' || (theme === 'system' && darkQuery.matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content = dark
    ? BAR_COLORS.dark
    : BAR_COLORS.light;
  for (const listener of listeners) listener();
}

// `system` follows the device when it switches between day and night.
darkQuery.addEventListener('change', apply);

export function setTheme(theme: Theme) {
  if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, theme);
  apply();
}

export function useTheme(): Theme {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, storedTheme);
}
