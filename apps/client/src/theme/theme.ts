import { useSyncExternalStore } from 'react';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** Same key as the inline script of `index.html`, which applies the theme before the first paint. */
const STORAGE_KEY = 'theme';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function storedTheme(): Theme {
  const value = localStorage.getItem(STORAGE_KEY);
  return THEMES.includes(value as Theme) ? (value as Theme) : 'system';
}

function apply() {
  const theme = storedTheme();
  const dark = theme === 'dark' || (theme === 'system' && darkQuery.matches);
  document.documentElement.classList.toggle('dark', dark);
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
