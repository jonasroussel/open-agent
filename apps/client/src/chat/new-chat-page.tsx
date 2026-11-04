import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePageTitle } from '@/shell/page-title.tsx';

import { chatFor } from './chat-store.ts';
import { ChatView } from './chat-view.tsx';

/**
 * An empty conversation with its id already chosen: the first message is sent from here, then the address becomes the
 * conversation's while the same `Chat` keeps streaming. The top bar switches it to ephemeral before that.
 */
export function NewChatPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [id, setId] = useState(() => crypto.randomUUID());
  const [ephemeral, setEphemeral] = useState(false);
  // A `Chat` is ephemeral from its creation: switching starts another one.
  const switchEphemeral = useCallback((on: boolean) => {
    setEphemeral(on);
    setId(crypto.randomUUID());
  }, []);
  usePageTitle(ephemeral ? t('ephemeral.title') : t('app.newConversation'), {
    ephemeral,
    setEphemeral: switchEphemeral,
  });

  return (
    <ChatView
      key={id}
      chat={chatFor(id, [], { ephemeral })}
      ephemeral={ephemeral}
      onSend={() => void navigate({ to: '/c/$conversationId', params: { conversationId: id } })}
    />
  );
}
