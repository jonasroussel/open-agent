import type { InvitationDto } from '@open-agent/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sessionQuery } from '@/auth/session.ts';
import { conversationQuery, joinConversation, removeFromConversation } from '@/chat/conversations-query.ts';
import { Button } from '@/components/ui/button.tsx';
import { ConversationIcon } from '@/shell/conversation-icon.tsx';

/** A shared conversation the user was invited to, opened from the email or the sidebar: join or decline it. */
export function InvitationView({ invitation }: { invitation: InvitationDto }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const title = invitation.title ?? t('conversations.untitled');

  async function join() {
    const ok = await joinConversation(queryClient, invitation.id);
    setFailed(!ok);
    // The page was refused while invited: it opens now.
    if (ok) await queryClient.resetQueries({ queryKey: conversationQuery(invitation.id).queryKey });
  }

  async function decline() {
    const me = queryClient.getQueryData(sessionQuery.queryKey);
    if (me) await removeFromConversation(queryClient, invitation.id, me.id);
    await navigate({ to: '/' });
  }

  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-5 p-6 text-center'>
      <div className='bg-muted flex size-14 items-center justify-center rounded-2xl'>
        <ConversationIcon name={invitation.icon} />
      </div>
      <div className='grid max-w-md gap-2'>
        <h2 className='text-lg font-semibold'>{t('sharing.invitationTitle', { name: invitation.from.name, title })}</h2>
        <p className='text-muted-foreground'>{t('sharing.invitationDescription')}</p>
      </div>
      <div className='flex gap-2'>
        <Button variant='outline' onClick={() => void decline()}>
          <X />
          {t('sharing.decline')}
        </Button>
        <Button onClick={() => void join()}>
          <Check />
          {t('sharing.join')}
        </Button>
      </div>
      {failed && <p className='text-destructive text-sm'>{t('sharing.failed')}</p>}
    </div>
  );
}
