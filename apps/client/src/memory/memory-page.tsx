import { API_ROUTES, apiPath, MAX_MEMORY_RULE_LENGTH, type MemoryRuleDto } from '@open-agent/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { AlertMessage } from '@/components/alert-message.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { api, type ApiErrorCode } from '@/lib/api.ts';
import { usePageTitle } from '@/shell/page-title.tsx';

import { memoryRulesQuery } from './memory-query.ts';

/** "My memories": every rule the assistant follows, to read, add, rewrite or forget. */
export function MemoryPage() {
  const { t } = useTranslation();
  usePageTitle(t('memory.title'));
  const queryClient = useQueryClient();
  const rules = useQuery(memoryRulesQuery);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<ApiErrorCode | null>(null);

  async function changed(result: { ok: true } | { ok: false; error: ApiErrorCode }) {
    setError(result.ok ? null : result.error);
    await queryClient.invalidateQueries({ queryKey: memoryRulesQuery.queryKey });
    return result.ok;
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    if (await changed(await api(API_ROUTES.memoryRules, { method: 'POST', body: { text: draft } }))) setDraft('');
  }

  return (
    <div className='mx-auto grid w-full max-w-3xl gap-6 px-4 pt-6 pb-12 md:px-8'>
      <p className='text-muted-foreground'>{t('memory.description')}</p>

      <form onSubmit={add} className='flex gap-2'>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('memory.addPlaceholder')}
          aria-label={t('memory.addPlaceholder')}
          maxLength={MAX_MEMORY_RULE_LENGTH}
          className='h-10 px-3 text-base'
        />
        <Button type='submit' size='lg' disabled={!draft.trim()}>
          <Plus />
          {t('memory.add')}
        </Button>
      </form>
      {error && <AlertMessage text={t(`errors.${error}`)} />}

      {rules.isError && <AlertMessage text={t('errors.network')} />}
      {rules.data?.length === 0 && (
        <div className='text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center'>
          <BookmarkCheck className='size-6' />
          <p>{t('memory.empty')}</p>
        </div>
      )}
      {rules.data && rules.data.length > 0 && (
        <ul className='divide-y rounded-lg border'>
          {rules.data.map((rule) => (
            <RuleRow key={rule.id} rule={rule} onChanged={changed} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RuleRow({
  rule,
  onChanged,
}: {
  rule: MemoryRuleDto;
  onChanged: (result: { ok: true } | { ok: false; error: ApiErrorCode }) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const path = apiPath(API_ROUTES.memoryRule, { ruleId: rule.id });

  async function save(event: FormEvent) {
    event.preventDefault();
    if (draft === null || !draft.trim()) return;
    if (await onChanged(await api(path, { method: 'PATCH', body: { text: draft } }))) setDraft(null);
  }

  if (draft !== null) {
    return (
      <li className='p-3'>
        <form onSubmit={save} className='flex flex-wrap gap-2'>
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_MEMORY_RULE_LENGTH}
            className='h-10 min-w-0 flex-1 px-3 text-base'
            autoFocus
          />
          <Button type='button' variant='ghost' onClick={() => setDraft(null)}>
            {t('memory.cancel')}
          </Button>
          <Button type='submit' disabled={!draft.trim()}>
            {t('memory.save')}
          </Button>
        </form>
      </li>
    );
  }

  return (
    <li className='hover:bg-muted/60 flex items-center gap-3 px-4 py-3'>
      <BookmarkCheck className='text-secondary-foreground size-4 shrink-0' />
      <span className='min-w-0 flex-1'>{rule.text}</span>
      <Button
        variant='ghost'
        size='icon'
        aria-label={t('memory.edit')}
        title={t('memory.edit')}
        onClick={() => setDraft(rule.text)}
      >
        <Pencil />
      </Button>
      <Button
        variant='ghost'
        size='icon'
        aria-label={t('memory.forget')}
        title={t('memory.forget')}
        onClick={() => void api(path, { method: 'DELETE' }).then(onChanged)}
      >
        <Trash2 />
      </Button>
    </li>
  );
}
