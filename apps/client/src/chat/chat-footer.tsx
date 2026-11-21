import type { CommandDto, LibraryFileDto } from '@open-agent/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { QUOTA_WARNING_PERCENT, quotaQuery, resetMonth } from '@/quota/quota-query.ts';

import { Composer } from './composer.tsx';

/** Under a conversation: what it says before the composer (`children`), the quota near its end, then the composer. */
export function ChatFooter({
  busy,
  waiting,
  placeholder,
  onSend,
  onStop,
  tools,
  sendBlocked,
  children,
}: {
  busy: boolean;
  waiting: boolean;
  placeholder: string;
  onSend: (text: string, files: LibraryFileDto[], command: CommandDto | null) => void;
  onStop: () => void;
  tools?: ReactNode;
  sendBlocked?: boolean;
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { data: quota } = useQuery(quotaQuery);
  const exhausted = quota?.exhausted === true;

  return (
    <div className='mx-auto w-full max-w-3xl px-4 pb-3'>
      {children}
      {quota && !quota.unlimited && !exhausted && quota.percentUsed >= QUOTA_WARNING_PERCENT && (
        <p className='text-muted-foreground mb-2 text-center text-sm'>
          {t('quota.nearLimit', { percent: quota.percentUsed })}
        </p>
      )}
      {exhausted ? (
        <p role='status' className='bg-muted rounded-2xl border px-4 py-5 text-center text-base'>
          {t('quota.exhausted', { month: resetMonth(quota, i18n.language) })}
        </p>
      ) : (
        <Composer
          busy={busy}
          waiting={waiting}
          onSend={onSend}
          onStop={onStop}
          placeholder={placeholder}
          tools={tools}
          sendBlocked={sendBlocked}
        />
      )}
    </div>
  );
}
