import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePageTitle } from '@/shell/page-title.tsx';

import { chatFor } from './chat-store.ts';
import { ChatView } from './chat-view.tsx';

/**
 * An empty conversation with its id already chosen: the first message is sent from here, then the address becomes the
 * conversation's while the same `Chat` keeps streaming.
 */
export function NewChatPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [id] = useState(() => crypto.randomUUID());
  usePageTitle(t('app.newConversation'));

  return (
    <ChatView
      key={id}
      chat={chatFor(id)}
      onSend={() => void navigate({ to: '/c/$conversationId', params: { conversationId: id } })}
    />
  );
}
