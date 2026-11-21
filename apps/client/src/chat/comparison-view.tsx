import type { Chat } from '@ai-sdk/react';
import type { ChatMessage, CommandDto, LibraryFileDto } from '@open-agent/shared';
import { Columns2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ConversationCanvas, useCanvas, useDocumentFollow } from '@/canvas/conversation-canvas.tsx';
import { cn } from '@/lib/utils.ts';

import { ChatFooter } from './chat-footer.tsx';
import { useModelName } from './comparison-switch.tsx';
import { MessageList } from './message-list.tsx';
import { useConversation, type Conversation } from './use-conversation.ts';

/**
 * A comparison, on its left conversation's page: the usual assistant on the left, the model the admin picked on the
 * right, each with its own history, and one composer sending every message to both. Editing a message is not offered:
 * it would make the two histories differ. Only the left one teaches the memory, so nothing is learned twice. On a phone
 * only the left one shows; both still get every message.
 */
export function ComparisonView({
  left,
  right,
  modelId,
}: {
  left: Chat<ChatMessage>;
  right: Chat<ChatMessage>;
  modelId: string;
}) {
  const { t } = useTranslation();
  const usual = useConversation(left);
  const compared = useConversation(right);
  const modelName = useModelName(modelId);
  const { doc, openDocument } = useCanvas(left.id);
  const usualFollow = useDocumentFollow(usual.messages, usual.busy, openDocument);
  const comparedFollow = useDocumentFollow(compared.messages, compared.busy, openDocument);
  const waitingFor = usual.waitingFor ?? compared.waitingFor;

  const send = (text: string, files: LibraryFileDto[], command: CommandDto | null) => {
    usual.send(text, files, command);
    compared.send(text, files, command);
  };
  const stop = () => {
    if (usual.busy) usual.stop();
    if (compared.busy) compared.stop();
  };
  // Whoever waits for an answer, or asks a question, says so; the typed text answers that column's question.
  const placeholder = (
    [usual, compared].find((conversation) => conversation.waitingFor) ??
    [usual, compared].find((conversation) => conversation.asking) ??
    usual
  ).placeholder();

  return (
    <div className='flex min-h-0 flex-1'>
      <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
        <p className='text-muted-foreground flex items-center justify-center gap-1.5 px-4 pt-2 text-center text-sm md:hidden'>
          <Columns2 className='size-4 shrink-0' />
          {t('comparison.mobileNote')}
        </p>
        <div className='flex min-h-0 flex-1'>
          <Column title={t('comparison.usual')} conversation={usual} rememberable onOpenDocument={openDocument} />
          <Column
            title={modelName ?? modelId}
            conversation={compared}
            rememberable={false}
            onOpenDocument={openDocument}
            className='hidden border-l md:flex'
          />
        </div>
        <ChatFooter
          busy={usual.busy || compared.busy}
          waiting={waitingFor !== null}
          placeholder={placeholder}
          onSend={send}
          onStop={stop}
        />
      </div>
      <ConversationCanvas doc={doc} follows={[usualFollow, comparedFollow]} openDocument={openDocument} />
    </div>
  );
}

function Column({
  title,
  conversation,
  rememberable,
  onOpenDocument,
  className,
}: {
  title: ReactNode;
  conversation: Conversation;
  rememberable: boolean;
  onOpenDocument: (id: string) => void;
  className?: string;
}) {
  return (
    <section className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}>
      <h2 className='text-muted-foreground hidden truncate px-4 pt-3 text-center text-sm font-medium md:block'>
        {title}
      </h2>
      {conversation.messages.length > 0 ? (
        <MessageList
          conversation={conversation}
          editable={false}
          rememberable={rememberable}
          onOpenDocument={onOpenDocument}
        />
      ) : (
        <div className='flex-1' />
      )}
    </section>
  );
}
