import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { usePageTitle } from '@/shell/page-title.tsx';

import { chatFor, hasChat } from './chat-store.ts';
import { ChatView } from './chat-view.tsx';
import { conversationQuery, conversationsQuery } from './conversations-query.ts';

export function ConversationPage() {
  const { t } = useTranslation();
  const { conversationId } = useParams({ from: '/app/c/$conversationId' });
  const { data: conversations } = useQuery(conversationsQuery);
  const listed = conversations?.find((conversation) => conversation.id === conversationId);
  usePageTitle(listed?.title ?? t('conversations.untitled'));

  // Just started from the empty page, or already opened: the `Chat` in memory is the freshest copy.
  const inMemory = hasChat(conversationId);
  const opened = useQuery({ ...conversationQuery(conversationId), enabled: !inMemory });

  if (inMemory) return <ChatView key={conversationId} chat={chatFor(conversationId)} />;
  if (opened.isError) return <Navigate to='/' replace />;
  if (!opened.data) return null;
  return <ChatView key={conversationId} chat={chatFor(conversationId, opened.data.messages)} />;
}
