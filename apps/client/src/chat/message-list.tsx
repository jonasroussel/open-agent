import { useQuery } from '@tanstack/react-query';
import { ArrowDown, RotateCcw } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';

import { Button } from '@/components/ui/button.tsx';
import { quotaQuery } from '@/quota/quota-query.ts';

import { AssistantMessage, PendingAnswer, UserMessage } from './message-view.tsx';
import type { Conversation } from './use-conversation.ts';

/**
 * A conversation's messages, kept scrolled to the newest while it streams, with its error under them. `editable`: the
 * user's messages can be edited; `rememberable`: the memory may learn from them.
 */
export function MessageList({
  conversation,
  editable,
  rememberable,
  onOpenDocument,
}: {
  conversation: Conversation;
  editable: boolean;
  rememberable: boolean;
  onOpenDocument: (id: string) => void;
}) {
  const { t } = useTranslation();
  const exhausted = useQuery(quotaQuery).data?.exhausted === true;
  const { messages, busy, locked, ownTurn, shared, lastUserIndex, mine, authorOf, errorKey } = conversation;
  const lastIndex = messages.length - 1;

  return (
    <StickToBottom className='relative min-h-0 flex-1' resize='instant' initial='instant'>
      <StickToBottom.Content className='mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6'>
        {messages.map((message, index) =>
          message.role === 'user' ? (
            <UserMessage
              key={message.id}
              message={message}
              author={mine(message) ? null : (authorOf(message)?.name ?? null)}
              // Shared: only the sender's own last message, the answers after it are everyone's.
              canEdit={editable && !locked && mine(message) && (!shared || index === lastUserIndex)}
              onEdit={(text) => conversation.edit(message, text)}
              onRemember={
                locked || !rememberable || !mine(message) ? null : () => conversation.rememberMessage(message.id)
              }
              onUndoMemory={conversation.undoMemory}
            />
          ) : (
            <AssistantMessage
              key={message.id}
              message={message}
              // From its first chunk: the server sends the answer's route before any word.
              streaming={busy && index === lastIndex}
              onRegenerate={!locked && ownTurn && index === lastIndex ? conversation.regenerate : null}
              onUndoMemory={conversation.undoMemory}
              onOpenDocument={onOpenDocument}
              onAnswer={!locked && ownTurn && index === lastIndex ? conversation.answer : null}
            />
          ),
        )}
        {/* Only until the answer appears: then it takes the dots' place, instead of showing next to them. */}
        {(busy || conversation.waitingFor) && messages.at(-1)?.role === 'user' && <PendingAnswer />}
        {errorKey && !exhausted && (
          <div className='flex items-center gap-3 md:pl-10'>
            <p className='text-destructive text-sm'>{t(errorKey)}</p>
            {!conversation.conflict && (
              <Button variant='outline' size='sm' onClick={conversation.regenerate}>
                <RotateCcw />
                {t('app.retry')}
              </Button>
            )}
          </div>
        )}
      </StickToBottom.Content>
      <ScrollToBottom />
      <KeepAtBottom />
    </StickToBottom>
  );
}

/**
 * While the view is held at the bottom, it follows each new line in the same frame. The library scrolls one frame
 * after a resize, even when instant, so every line of a streamed answer showed a frame or two late.
 */
function KeepAtBottom() {
  const { contentRef, scrollRef, state } = useStickToBottomContext();

  useEffect(() => {
    const content = contentRef.current;
    const scroller = scrollRef.current;
    if (!content || !scroller) return;
    const observer = new ResizeObserver(() => {
      if (state.isAtBottom && !state.escapedFromLock) scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [contentRef, scrollRef, state]);

  return null;
}

function ScrollToBottom() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <Button
      variant='outline'
      size='icon'
      className='bg-background absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-sm'
      onClick={() => void scrollToBottom()}
    >
      <ArrowDown />
    </Button>
  );
}
