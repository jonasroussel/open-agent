import type { ModelInfoDto } from '@open-agent/shared';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AlertMessage } from '@/components/alert-message.tsx';
import { Input } from '@/components/ui/input.tsx';
import { i18n } from '@/i18n/i18n.ts';
import { cn } from '@/lib/utils.ts';

import { adminModelsQuery } from './admin-settings-query.ts';

export function price(model: ModelInfoDto): string {
  if (model.inputPrice === null || model.outputPrice === null) return i18n.t('settings.variablePrice');
  const format = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 3 });
  return i18n.t('settings.price', { input: format.format(model.inputPrice), output: format.format(model.outputPrice) });
}

/** Routers, whose price depends on the model they pick, come after the priced models. */
function cost(model: ModelInfoDto): number {
  if (model.inputPrice === null || model.outputPrice === null) return Number.POSITIVE_INFINITY;
  return model.inputPrice + model.outputPrice;
}

/**
 * OpenRouter's models that pass `suitable`, cheapest first, with a search; `current` is marked. `children`: shown
 * between the search and the list.
 */
export function ModelList({
  suitable,
  current,
  disabled = false,
  onChoose,
  children,
}: {
  suitable: (model: ModelInfoDto) => boolean;
  current: string | null;
  disabled?: boolean;
  onChoose: (id: string) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const models = useQuery(adminModelsQuery);
  const [search, setSearch] = useState('');
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (models.data ?? [])
    .filter(suitable)
    .filter((model) => words.every((word) => `${model.id} ${model.name}`.toLowerCase().includes(word)))
    .toSorted((a, b) => (cost(a) === cost(b) ? 0 : cost(a) - cost(b)));

  return (
    <>
      <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('settings.search')} />
      {children}
      {models.isError && <AlertMessage text={t('errors.model_unavailable')} />}
      <ul className='-mx-2 grid max-h-96 gap-1 overflow-y-auto'>
        {shown.map((model) => (
          <li key={model.id}>
            <button
              type='button'
              disabled={disabled}
              onClick={() => onChoose(model.id)}
              className={cn(
                'hover:bg-muted flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left disabled:opacity-60',
                model.id === current && 'bg-secondary hover:bg-secondary',
              )}
            >
              <span className='grid min-w-0 flex-1'>
                <span className='truncate text-sm font-medium'>{model.name}</span>
                <span className='text-muted-foreground truncate font-mono text-xs'>{model.id}</span>
              </span>
              <span className='text-muted-foreground shrink-0 text-xs'>{price(model)}</span>
              {model.id === current && <Check className='text-primary size-4 shrink-0' />}
            </button>
          </li>
        ))}
        {models.data && shown.length === 0 && (
          <li className='text-muted-foreground px-2 py-6 text-center text-sm'>{t('settings.noModel')}</li>
        )}
      </ul>
    </>
  );
}
