import { useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { RotateCw } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { BrandIcon } from '@/components/brand-icon.tsx';
import { Button } from '@/components/ui/button.tsx';

/** The session check failed (server down, no network): offer to try again instead of a blank page. */
export function RootError({ error }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  // Any error of a page lands here too: the console keeps the real cause.
  useEffect(() => console.error(error), [error]);
  return (
    <main className='mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 p-6 text-center'>
      <BrandIcon className='size-14' />
      <p className='text-lg'>{t('errors.network')}</p>
      <Button size='lg' onClick={() => void router.invalidate()}>
        <RotateCw />
        {t('app.retry')}
      </Button>
    </main>
  );
}
