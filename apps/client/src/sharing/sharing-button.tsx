import { useQuery } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { conversationsQuery } from '@/chat/conversations-query.ts';
import { AvatarGroup } from '@/components/ui/avatar.tsx';
import { Button } from '@/components/ui/button.tsx';

import { MembersDialog, PersonAvatar } from './members-dialog.tsx';

/** In the top bar: who is in the conversation, or "Share" for its owner while nobody else is. */
export function SharingButton({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation();
  const { data: list } = useQuery(conversationsQuery);
  const [open, setOpen] = useState(false);
  // A new conversation exists once its first answer starts.
  const conversation = list?.conversations.find((listed) => listed.id === conversationId);
  if (!conversation) return null;
  const sharing = conversation.sharing;
  const everyone = sharing
    ? [sharing.owner, ...sharing.members.filter((member) => member.status === 'member').map((member) => member.person)]
    : [];

  return (
    <>
      {sharing ? (
        <Button variant='ghost' size='sm' className='ml-auto' onClick={() => setOpen(true)}>
          <AvatarGroup>
            {everyone.slice(0, 3).map((person) => (
              <PersonAvatar key={person.id} person={person} />
            ))}
          </AvatarGroup>
          {t('sharing.members')}
        </Button>
      ) : (
        <Button variant='ghost' size='sm' className='text-muted-foreground ml-auto' onClick={() => setOpen(true)}>
          <UserPlus />
          {t('sharing.share')}
        </Button>
      )}
      <MembersDialog conversation={open ? conversation : null} onClose={() => setOpen(false)} />
    </>
  );
}
