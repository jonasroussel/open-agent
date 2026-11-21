import type { CommandDto, LibraryFileDto } from '@open-agent/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sessionQuery } from '@/auth/session.ts';
import { useIsMobile } from '@/hooks/use-mobile.ts';
import { usePageTitle } from '@/shell/page-title.tsx';

import { chatFor, startComparison } from './chat-store.ts';
import { ChatView } from './chat-view.tsx';
import { ComparisonSwitch } from './comparison-switch.tsx';
import { messageOf } from './use-conversation.ts';

/** The model last compared with, offered again next time. */
const COMPARISON_MODEL_KEY = 'comparison-model';

/**
 * An empty conversation with its id already chosen: the first message is sent from here, then the address becomes the
 * conversation's while the same `Chat` keeps streaming. The top bar switches it to ephemeral before that. The admin
 * may instead compare it with another model (not on a phone): the same message then starts a second conversation,
 * its right thread, answered by that model.
 */
export function NewChatPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [id, setId] = useState(() => crypto.randomUUID());
  const [ephemeral, setEphemeral] = useState(false);
  const admin = useQuery(sessionQuery).data?.role === 'admin';
  const mobile = useIsMobile();
  const canCompare = admin && !ephemeral && !mobile;
  const [comparing, setComparing] = useState(false);
  const [comparisonModel, setComparisonModel] = useState(() => localStorage.getItem(COMPARISON_MODEL_KEY));
  const comparison = canCompare && comparing;
  // A `Chat` is ephemeral from its creation: switching starts another one.
  const switchEphemeral = useCallback((on: boolean) => {
    setEphemeral(on);
    setId(crypto.randomUUID());
  }, []);
  usePageTitle(ephemeral ? t('ephemeral.title') : t('app.newConversation'), {
    ephemeral,
    setEphemeral: comparison ? undefined : switchEphemeral,
  });

  const pickModel = (modelId: string) => {
    setComparisonModel(modelId);
    localStorage.setItem(COMPARISON_MODEL_KEY, modelId);
  };

  const sent = (text: string, files: LibraryFileDto[], command: CommandDto | null) => {
    if (comparison && comparisonModel) {
      const right = startComparison(id, crypto.randomUUID(), comparisonModel);
      void right.sendMessage(messageOf(text, files, command));
    }
    void navigate({ to: '/c/$conversationId', params: { conversationId: id } });
  };

  return (
    <ChatView
      key={id}
      chat={chatFor(id, [], { ephemeral })}
      ephemeral={ephemeral}
      onSend={sent}
      composerTools={
        canCompare && (
          <ComparisonSwitch on={comparing} modelId={comparisonModel} onToggle={setComparing} onPick={pickModel} />
        )
      }
      sendBlocked={comparison && comparisonModel === null}
    />
  );
}
