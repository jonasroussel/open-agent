import type { ModelInfoDto } from '@open-agent/shared';
import { useQuery } from '@tanstack/react-query';
import { Columns2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { adminModelsQuery } from '@/admin/admin-settings-query.ts';
import { ModelList } from '@/admin/model-list.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx';
import { cn } from '@/lib/utils.ts';

/** The right thread answers with tools, like the usual assistant. */
const canCompare = (model: ModelInfoDto) => model.capabilities.includes('tools');

/** A model's name from OpenRouter's list, its id until the list is there or when the list no longer has it. */
export function useModelName(id: string | null): string | null {
  const { data: models } = useQuery({ ...adminModelsQuery, enabled: id !== null });
  if (id === null) return null;
  return models?.find((model) => model.id === id)?.name ?? id;
}

/**
 * In the composer of a new conversation, for the admin: compares the usual assistant with the model picked here, which
 * answers the same messages beside it.
 */
export function ComparisonSwitch({
  on,
  modelId,
  onToggle,
  onPick,
}: {
  on: boolean;
  modelId: string | null;
  onToggle: (on: boolean) => void;
  onPick: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const modelName = useModelName(on ? modelId : null);

  return (
    <>
      {on && (
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='max-w-48 shrink-0 rounded-full'
          title={modelId ?? undefined}
          onClick={() => setPicking(true)}
        >
          <span className='truncate'>{modelName ?? t('comparison.pickModel')}</span>
        </Button>
      )}
      <Button
        type='button'
        variant='ghost'
        size='sm'
        aria-pressed={on}
        onClick={() => {
          onToggle(!on);
          if (!on && modelId === null) setPicking(true);
        }}
        className={cn(
          'shrink-0 rounded-full',
          on
            ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80 dark:hover:bg-secondary/80'
            : 'text-muted-foreground',
        )}
      >
        <Columns2 />
        {t('comparison.switch')}
      </Button>
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className='sm:max-w-xl'>
          <DialogHeader>
            <DialogTitle>{t('comparison.pickTitle')}</DialogTitle>
            <DialogDescription>{t('comparison.pickDescription')}</DialogDescription>
          </DialogHeader>
          <ModelList
            suitable={canCompare}
            current={modelId}
            onChoose={(id) => {
              onPick(id);
              setPicking(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
