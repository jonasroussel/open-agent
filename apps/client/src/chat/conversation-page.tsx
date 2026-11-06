import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useParams } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { InvitationView } from '@/sharing/invitation-view.tsx';
import { usePageTitle } from '@/shell/page-title.tsx';

import { chatFor, hasChat, isEphemeral } from './chat-store.ts';
import { ChatView } from './chat-view.tsx';
import { conversationQuery, conversationsQuery, renameConversation } from './conversations-query.ts';
import { useMarkdownReady } from './markdown-loader.ts';

export function ConversationPage() {
  const { t } = useTranslation();
  const { conversationId } = useParams({ from: '/app/c/$conversationId' });
  const { data: list } = useQuery(conversationsQuery);
  const listed = list?.conversations.find((conversation) => conversation.id === conversationId);
  const invitation = list?.invitations.find((invited) => invited.id === conversationId);
  const queryClient = useQueryClient();
  const rename = useCallback(
    (title: string) => renameConversation(queryClient, conversationId, title),
    [queryClient, conversationId],
  );
  // Ephemeral: known only to this page, never renamed nor shared.
  const ephemeral = isEphemeral(conversationId);
  const plain = !invitation && !ephemeral;
  let title = listed?.title ?? invitation?.title ?? t('conversations.untitled');
  if (ephemeral) title = t('ephemeral.title');
  usePageTitle(title, {
    rename: plain ? rename : undefined,
    conversationId: plain ? conversationId : undefined,
    ephemeral,
  });

  // Just started from the empty page, or already opened: the `Chat` in memory is the freshest copy.
  const inMemory = hasChat(conversationId);
  const opened = useQuery({ ...conversationQuery(conversationId), enabled: !inMemory });
  // Shown once, as Markdown: plain text first, then Markdown, changed the height and scrolled the page.
  const markdownReady = useMarkdownReady();

  if (inMemory) return <ChatView key={conversationId} chat={chatFor(conversationId)} ephemeral={ephemeral} />;
  // Invited, not joined yet: the conversation stays closed until they join.
  if (opened.isError) return invitation ? <InvitationView invitation={invitation} /> : <Navigate to='/' replace />;
  if (!opened.data || !markdownReady) return null;
  const chat = chatFor(conversationId, opened.data.messages, { answering: opened.data.answering });
  return <ChatView key={conversationId} chat={chat} />;
}
