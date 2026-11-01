import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { BrandIcon } from '@/components/brand-icon.tsx';

/** The signed-out pages: the brand above a plain card, on the sidebar's grey. */
export function AuthFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <main className='bg-sidebar flex min-h-dvh flex-col items-center justify-center gap-6 p-4'>
      <div className='flex flex-col items-center gap-2 text-center'>
        <div className='flex items-center gap-2 text-xl font-semibold'>
          <BrandIcon className='size-8' />
          {t('app.name')}
        </div>
        <p className='text-muted-foreground'>{t('signIn.tagline')}</p>
      </div>
      <div className='bg-card w-full max-w-md rounded-xl border p-6 shadow-sm sm:p-8'>{children}</div>
      <p className='text-muted-foreground text-sm'>{t('signIn.invitationOnly')}</p>
    </main>
  );
}
