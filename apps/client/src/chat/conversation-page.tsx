import type { Chat } from '@ai-sdk/react';
import type { ChatMessage, ComparisonDto } from '@open-agent/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useParams } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { InvitationView } from '@/sharing/invitation-view.tsx';
import { usePageTitle } from '@/shell/page-title.tsx';

import { chatFor, comparisonOf, hasChat, isEphemeral } from './chat-store.ts';
import { ChatView } from './chat-view.tsx';
import { ComparisonView } from './comparison-view.tsx';
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

  // Just started from the empty page, or already opened: the `Chat` in memory is the freshest copy.
  const inMemory = hasChat(conversationId);
  const opened = useQuery({ ...conversationQuery(conversationId), enabled: !inMemory });
  // Read from the caches `list` and `opened` watch, and from this tab for a comparison just started.
  const comparison = comparisonOf(conversationId);

  // Ephemeral: known only to this page, never renamed nor shared. A comparison is never shared either.
  const ephemeral = isEphemeral(conversationId);
  const plain = !invitation && !ephemeral;
  let title = listed?.title ?? invitation?.title ?? t('conversations.untitled');
  if (ephemeral) title = t('ephemeral.title');
  usePageTitle(title, {
    rename: plain ? rename : undefined,
    conversationId: plain && !comparison ? conversationId : undefined,
    ephemeral,
  });
  // Shown once, as Markdown: plain text first, then Markdown, changed the height and scrolled the page.
  const markdownReady = useMarkdownReady();

  let left = inMemory ? chatFor(conversationId) : null;
  if (!left) {
    // Invited, not joined yet: the conversation stays closed until they join.
    if (opened.isError) return invitation ? <InvitationView invitation={invitation} /> : <Navigate to='/' replace />;
    if (!opened.data || !markdownReady) return null;
    left = chatFor(conversationId, opened.data.messages, { answering: opened.data.answering });
  }
  if (!comparison) return <ChatView key={conversationId} chat={left} />;
  return <ComparisonPage key={conversationId} left={left} comparison={comparison} />;
}

/** A comparison: its right thread comes from memory, or from the server once. */
function ComparisonPage({ left, comparison }: { left: Chat<ChatMessage>; comparison: ComparisonDto }) {
  const rightId = comparison.conversationId;
  const inMemory = hasChat(rightId);
  const opened = useQuery({ ...conversationQuery(rightId), enabled: !inMemory });

  if (inMemory) return <ComparisonView left={left} right={chatFor(rightId)} modelId={comparison.modelId} />;
  // The right thread is gone: the left one stays a conversation of its own.
  if (opened.isError) return <ChatView chat={left} />;
  if (!opened.data) return null;
  const right = chatFor(rightId, opened.data.messages, { answering: opened.data.answering });
  return <ComparisonView left={left} right={right} modelId={comparison.modelId} />;
}
