import { API_ROUTES, apiPath, MAX_CONVERSATION_TITLE_LENGTH, type ConversationDto } from '@open-agent/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useMatchRoute, useNavigate } from '@tanstack/react-router';
import { MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { forgetChat } from '@/chat/chat-store.ts';
import { conversationQuery, conversationsQuery, renameConversation } from '@/chat/conversations-query.ts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar.tsx';
import { i18n } from '@/i18n/i18n.ts';
import { api } from '@/lib/api.ts';

import { ConversationIcon } from './conversation-icon.tsx';

/** The user's conversations: pinned ones first, then the others, last updated first. */
export function ConversationList({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useTranslation();
  const { data: conversations = [] } = useQuery(conversationsQuery);
  const [renaming, setRenaming] = useState<ConversationDto | null>(null);
  const [deleting, setDeleting] = useState<ConversationDto | null>(null);
  const pinned = conversations.filter((conversation) => conversation.pinned);
  const others = conversations.filter((conversation) => !conversation.pinned);
  const actions = { onNavigate, onRename: setRenaming, onDelete: setDeleting };

  return (
    <>
      {pinned.length > 0 && <ConversationGroup label={t('conversations.pinned')} conversations={pinned} {...actions} />}
      <ConversationGroup label={t('app.conversations')} conversations={others} {...actions}>
        {conversations.length === 0 && (
          <p className='text-muted-foreground px-2 py-1 text-sm'>{t('app.noConversations')}</p>
        )}
      </ConversationGroup>
      <RenameDialog conversation={renaming} onClose={() => setRenaming(null)} />
      <DeleteDialog conversation={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

type GroupProps = {
  label: string;
  conversations: ConversationDto[];
  onNavigate: () => void;
  onRename: (conversation: ConversationDto) => void;
  onDelete: (conversation: ConversationDto) => void;
  children?: React.ReactNode;
};

function ConversationGroup({ label, conversations, onNavigate, onRename, onDelete, children }: GroupProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const matchRoute = useMatchRoute();

  async function setPinned(conversation: ConversationDto, pinned: boolean) {
    await api(apiPath(API_ROUTES.conversation, { conversationId: conversation.id }), {
      method: 'PATCH',
      body: { pinned },
    });
    await queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        {children}
        <SidebarMenu>
          {conversations.map((conversation) => (
            <SidebarMenuItem key={conversation.id}>
              <SidebarMenuButton
                asChild
                className='h-9 group-has-data-[sidebar=menu-action]/menu-item:pr-14'
                isActive={Boolean(
                  matchRoute({ to: '/c/$conversationId', params: { conversationId: conversation.id } }),
                )}
              >
                <Link to='/c/$conversationId' params={{ conversationId: conversation.id }} onClick={onNavigate}>
                  <ConversationIcon name={conversation.icon} />
                  <span className='truncate'>{conversation.title ?? t('conversations.untitled')}</span>
                </Link>
              </SidebarMenuButton>
              <span className='text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs group-hover/menu-item:hidden group-has-data-[state=open]/menu-item:hidden'>
                {timeOf(conversation.updatedAt)}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuAction showOnHover aria-label={t('conversations.actions')} className='top-2'>
                    <MoreHorizontal />
                  </SidebarMenuAction>
                </DropdownMenuTrigger>
                <DropdownMenuContent side='right' align='start' className='w-auto min-w-48'>
                  <DropdownMenuItem onSelect={() => onRename(conversation)}>
                    <Pencil />
                    {t('conversations.rename')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void setPinned(conversation, !conversation.pinned)}>
                    {conversation.pinned ? <PinOff /> : <Pin />}
                    {conversation.pinned ? t('conversations.unpin') : t('conversations.pin')}
                  </DropdownMenuItem>
                  <DropdownMenuItem variant='destructive' onSelect={() => onDelete(conversation)}>
                    <Trash2 />
                    {t('conversations.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** Today: the time, like Chatbox. Earlier: the day. */
function timeOf(iso: string): string {
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(
    i18n.language,
    today ? { timeStyle: 'short' } : { day: 'numeric', month: 'short' },
  ).format(date);
}

function RenameDialog({ conversation, onClose }: { conversation: ConversationDto | null; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!conversation || !title.trim()) return;
    await renameConversation(queryClient, conversation.id, title.trim());
    onClose();
  }

  return (
    <Dialog
      open={conversation !== null}
      onOpenChange={(open) => {
        if (open) return;
        onClose();
      }}
    >
      <DialogContent onOpenAutoFocus={() => setTitle(conversation?.title ?? '')} className='sm:max-w-md'>
        <form onSubmit={save} className='grid gap-4'>
          <DialogHeader>
            <DialogTitle>{t('conversations.renameTitle')}</DialogTitle>
          </DialogHeader>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={MAX_CONVERSATION_TITLE_LENGTH}
            autoFocus
          />
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              {t('conversations.cancel')}
            </Button>
            <Button type='submit' disabled={!title.trim()}>
              {t('conversations.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ conversation, onClose }: { conversation: ConversationDto | null; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();

  async function remove() {
    if (!conversation) return;
    const { id } = conversation;
    await api(apiPath(API_ROUTES.conversation, { conversationId: id }), { method: 'DELETE' });
    // Leave the page before forgetting its chat, so it never renders again without one.
    if (matchRoute({ to: '/c/$conversationId', params: { conversationId: id } })) await navigate({ to: '/' });
    forgetChat(id);
    queryClient.removeQueries({ queryKey: conversationQuery(id).queryKey });
    await queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
  }

  return (
    <AlertDialog open={conversation !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('conversations.deleteTitle', { title: conversation?.title ?? t('conversations.untitled') })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('conversations.deleteDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('conversations.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant='destructive' onClick={() => void remove()}>
            {t('conversations.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
