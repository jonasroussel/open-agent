import { MessageCircleDashed } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils.ts';

/** On a new conversation, in the top bar: makes it ephemeral, or back to a normal one. */
export function EphemeralSwitch({ on, set }: { on: boolean; set: (on: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Button
      variant='ghost'
      size='sm'
      aria-pressed={on}
      onClick={() => set(!on)}
      className={cn(
        'ml-auto',
        on
          ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80 dark:hover:bg-secondary/80'
          : 'text-muted-foreground',
      )}
    >
      <MessageCircleDashed />
      {t('ephemeral.switch')}
    </Button>
  );
}

/** In the top bar of an ephemeral conversation. */
export function EphemeralBadge() {
  const { t } = useTranslation();
  return (
    <span className='text-muted-foreground ml-auto flex items-center gap-1.5 px-2 text-sm'>
      <MessageCircleDashed className='size-4' />
      {t('ephemeral.switch')}
    </span>
  );
}
