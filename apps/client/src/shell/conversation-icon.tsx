import { MessageSquare } from 'lucide-react';
import { lazy, Suspense } from 'react';

const LucideIcon = lazy(() => import('./lucide-icon.tsx'));

const defaultIcon = () => <MessageSquare />;

/**
 * The icon the model chose with the title. Each icon is its own small file, loaded the first time it shows; the
 * default one stands in while it loads, and for a name Lucide does not have.
 */
export function ConversationIcon({ name }: { name: string | null }) {
  if (!name) return defaultIcon();
  return (
    <Suspense fallback={defaultIcon()}>
      <LucideIcon name={name} fallback={defaultIcon} />
    </Suspense>
  );
}
