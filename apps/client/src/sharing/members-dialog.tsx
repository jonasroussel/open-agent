import type { ConversationDto, PersonDto } from '@open-agent/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMatchRoute, useNavigate } from '@tanstack/react-router';
import { Check, LogOut, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sessionQuery } from '@/auth/session.ts';
import { forgetChat } from '@/chat/chat-store.ts';
import {
  conversationQuery,
  conversationsQuery,
  inviteToConversation,
  peopleQuery,
  removeFromConversation,
} from '@/chat/conversations-query.ts';
import { Avatar, AvatarFallback } from '@/components/ui/avatar.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { cn } from '@/lib/utils.ts';

/** A conversation the user no longer sees (deleted, left, declined): its page leaves, its `Chat` is forgotten. */
export function useDropConversation() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  return async (id: string) => {
    // Leave the page before forgetting its chat, so it never renders again without one.
    if (matchRoute({ to: '/c/$conversationId', params: { conversationId: id } })) await navigate({ to: '/' });
    forgetChat(id);
    queryClient.removeQueries({ queryKey: conversationQuery(id).queryKey });
    await queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
  };
}

export function PersonAvatar({ person }: { person: PersonDto }) {
  return (
    <Avatar size='sm'>
      <AvatarFallback>{person.name.charAt(0).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

/**
 * Who is in the conversation. Its owner invites people of the app and removes anyone; a member leaves. The owner of a
 * conversation not shared yet sees only the invitation part.
 */
export function MembersDialog({
  conversation,
  onClose,
}: {
  conversation: ConversationDto | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const drop = useDropConversation();
  const me = useQuery(sessionQuery).data;
  const sharing = conversation?.sharing ?? null;
  const owner = sharing === null || sharing.role === 'owner';
  const { data: people = [] } = useQuery({ ...peopleQuery, enabled: conversation !== null && owner });
  const [picked, setPicked] = useState<number[]>([]);
  const [failed, setFailed] = useState(false);
  const members = sharing?.members ?? [];
  const already = new Set(members.map((member) => member.person.id));
  const candidates = people.filter((person) => !already.has(person.id));
  const title = conversation?.title ?? t('conversations.untitled');

  function close() {
    setPicked([]);
    setFailed(false);
    onClose();
  }

  async function invite() {
    if (!conversation) return;
    const ok = await inviteToConversation(queryClient, conversation.id, picked);
    setFailed(!ok);
    if (ok) setPicked([]);
  }

  async function leave() {
    if (!conversation || !me) return;
    await removeFromConversation(queryClient, conversation.id, me.id);
    close();
    await drop(conversation.id);
  }

  const toggle = (id: number) =>
    setPicked((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));
  const nameOf = (person: PersonDto) => (person.id === me?.id ? t('sharing.you', { name: person.name }) : person.name);

  return (
    <Dialog open={conversation !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{owner ? t('sharing.title', { title }) : t('sharing.membersTitle')}</DialogTitle>
          <DialogDescription>{t('sharing.warning')}</DialogDescription>
        </DialogHeader>

        {sharing && (
          <ul className='grid gap-1'>
            <li className='flex items-center gap-3 py-1'>
              <PersonAvatar person={sharing.owner} />
              <span className='min-w-0 flex-1 truncate'>{nameOf(sharing.owner)}</span>
              <span className='text-muted-foreground text-sm'>{t('sharing.owner')}</span>
            </li>
            {members.map(({ person, status }) => (
              <li key={person.id} className='flex items-center gap-3 py-1'>
                <PersonAvatar person={person} />
                <span className='min-w-0 flex-1 truncate'>{nameOf(person)}</span>
                <span className='text-muted-foreground text-sm'>
                  {status === 'invited' ? t('sharing.invited') : t('sharing.member')}
                </span>
                {owner && (
                  <Button
                    variant='ghost'
                    size='icon'
                    className='size-7'
                    aria-label={t('sharing.remove', { name: person.name })}
                    onClick={() => void removeFromConversation(queryClient, conversation!.id, person.id)}
                  >
                    <X />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {owner && (
          <div className='grid gap-2'>
            <p className='text-sm font-medium'>{t('sharing.inviteLabel')}</p>
            {candidates.length === 0 ? (
              <p className='text-muted-foreground text-sm'>
                {people.length === 0 ? t('sharing.nobody') : t('sharing.everyoneIn')}
              </p>
            ) : (
              <ul className='grid max-h-56 gap-1 overflow-y-auto'>
                {candidates.map((person) => {
                  const chosen = picked.includes(person.id);
                  return (
                    <li key={person.id}>
                      <button
                        type='button'
                        aria-pressed={chosen}
                        onClick={() => toggle(person.id)}
                        className='hover:bg-muted flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left'
                      >
                        <PersonAvatar person={person} />
                        <span className='min-w-0 flex-1'>
                          <span className='block truncate'>{person.name}</span>
                          <span className='text-muted-foreground block truncate text-xs'>{person.email}</span>
                        </span>
                        <span
                          className={cn(
                            'flex size-5 items-center justify-center rounded-md border',
                            chosen && 'bg-primary border-primary text-primary-foreground',
                          )}
                        >
                          {chosen && <Check className='size-3.5' />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {failed && <p className='text-destructive text-sm'>{t('sharing.failed')}</p>}
          </div>
        )}

        <DialogFooter>
          {owner ? (
            <Button disabled={picked.length === 0} onClick={() => void invite()}>
              <UserPlus />
              {picked.length > 0 ? t('sharing.inviteCount', { count: picked.length }) : t('sharing.invite')}
            </Button>
          ) : (
            <Button variant='outline' className='text-destructive' onClick={() => void leave()}>
              <LogOut />
              {t('sharing.leave')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
