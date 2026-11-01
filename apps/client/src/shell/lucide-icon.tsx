import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic';
import type { ReactNode } from 'react';

const ICON_NAMES = new Set<string>(iconNames);

/** Loaded apart from the app: the list of Lucide's 2,000+ icons is too big for the first screen. */
export default function LucideIcon({ name, fallback }: { name: string; fallback: () => ReactNode }) {
  if (!ICON_NAMES.has(name)) return fallback();
  return <DynamicIcon name={name as IconName} fallback={fallback as () => null} />;
}
