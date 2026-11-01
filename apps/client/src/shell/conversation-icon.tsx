import { MessageSquare, type LucideIcon } from 'lucide-react';
import { createElement, useEffect, useSyncExternalStore, type ReactElement } from 'react';

/** Loaded icons by name; `null`: a name Lucide does not have. */
const icons: Partial<Record<string, ReactElement | null>> = {};
const listeners = new Set<() => void>();

/**
 * Loads the icons the model chose with the titles. Each is its own small file; the map of Lucide's 2,000+ files is
 * itself too big for the first screen, hence the lazy import. A file that fails to load is tried again next time.
 */
export async function loadIcons(names: readonly string[]): Promise<void> {
  const missing = names.filter((name) => !(name in icons));
  if (missing.length === 0) return;
  const { default: imports } = await import('lucide-react/dynamicIconImports');
  await Promise.allSettled(
    missing.map(async (name) => {
      const load = imports[name as keyof typeof imports] as (() => Promise<{ default: LucideIcon }>) | undefined;
      icons[name] = load ? createElement((await load()).default) : null;
    }),
  );
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The icon of a conversation, drawn at once when `loadIcons` already has it (the loading screen waits for those of
 * the list); otherwise the default one stands in until it loads, and for a name Lucide does not have.
 */
export function ConversationIcon({ name }: { name: string | null }) {
  const icon = useSyncExternalStore(subscribe, () => (name ? icons[name] : null));

  useEffect(() => {
    if (name) void loadIcons([name]);
  }, [name]);

  return icon ?? <MessageSquare />;
}
