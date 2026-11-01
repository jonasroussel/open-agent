import { API_ROUTES, type OwnKeyResponse } from '@open-agent/shared';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { AlertMessage } from '@/components/alert-message.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { api, apiOrThrow, type ApiErrorCode } from '@/lib/api.ts';
import { quotaQuery } from '@/quota/quota-query.ts';

const ownKeyQuery = queryOptions({
  queryKey: [API_ROUTES.ownKey],
  queryFn: async () => (await apiOrThrow<OwnKeyResponse>(API_ROUTES.ownKey)).key,
});

/** Where a person creates an OpenRouter key. */
const KEYS_PAGE = 'https://openrouter.ai/settings/keys';

/** The person's own OpenRouter key: it pays for their messages, which then leave their quota alone. */
export function OwnKeyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const key = useQuery({ ...ownKeyQuery, enabled: open });
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const day = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' });

  async function changed(result: { ok: true } | { ok: false; error: ApiErrorCode }) {
    setPending(false);
    setError(result.ok ? null : result.error);
    if (result.ok) setDraft('');
    await queryClient.invalidateQueries({ queryKey: ownKeyQuery.queryKey });
    await queryClient.invalidateQueries({ queryKey: quotaQuery.queryKey });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setPending(true);
    await changed(await api(API_ROUTES.ownKey, { method: 'PUT', body: { key: draft } }));
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent onOpenAutoFocus={() => setError(null)} className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('ownKey.title')}</DialogTitle>
          <DialogDescription>{t('ownKey.description')}</DialogDescription>
        </DialogHeader>

        {key.data && (
          <div className='bg-muted/60 flex items-center gap-3 rounded-lg px-3 py-2.5'>
            <KeyRound className='text-primary size-4 shrink-0' />
            <span className='flex-1 text-sm'>
              {t('ownKey.current', { hint: key.data.hint, date: day.format(new Date(key.data.addedAt)) })}
            </span>
            <Button
              variant='ghost'
              size='sm'
              disabled={pending}
              onClick={async () => {
                setPending(true);
                await changed(await api(API_ROUTES.ownKey, { method: 'DELETE' }));
              }}
            >
              {t('ownKey.remove')}
            </Button>
          </div>
        )}

        <form onSubmit={save} className='grid gap-3'>
          <Input
            type='password'
            autoComplete='off'
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder='sk-or-v1-…'
            aria-label={t('ownKey.label')}
          />
          {error && <AlertMessage text={t(`errors.${error}`)} />}
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <a href={KEYS_PAGE} target='_blank' rel='noreferrer' className='text-primary text-sm hover:underline'>
              {t('ownKey.create')}
            </a>
            <Button type='submit' disabled={pending || !draft.trim()}>
              {key.data ? t('ownKey.replace') : t('ownKey.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
