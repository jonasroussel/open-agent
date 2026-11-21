import type { Chat } from '@ai-sdk/react';
import type { ChatMessage, CommandDto, LibraryFileDto } from '@open-agent/shared';
import { MessageCircleDashed } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ConversationCanvas, useCanvas, useDocumentFollow } from '@/canvas/conversation-canvas.tsx';
import { BrandIcon } from '@/components/brand-icon.tsx';

import { ChatFooter } from './chat-footer.tsx';
import { Greeting } from './greeting.tsx';
import { MessageList } from './message-list.tsx';
import { useConversation } from './use-conversation.ts';

/**
 * A conversation: its messages, the composer under them, and the canvas beside them when a document is open (`?doc=`)
 * or being written. An ephemeral one says so, and remembers nothing. `onSend`: after a new message is sent from here.
 * `composerTools`: shown just left of the send button; `sendBlocked`: they are not ready for sending.
 */
export function ChatView({
  chat,
  ephemeral = false,
  onSend,
  composerTools,
  sendBlocked,
}: {
  chat: Chat<ChatMessage>;
  ephemeral?: boolean;
  onSend?: (text: string, files: LibraryFileDto[], command: CommandDto | null) => void;
  composerTools?: ReactNode;
  sendBlocked?: boolean;
}) {
  const { t } = useTranslation();
  const conversation = useConversation(chat);
  const { messages } = conversation;
  const { doc, openDocument } = useCanvas(chat.id);
  const follow = useDocumentFollow(messages, conversation.busy, openDocument);

  const send = (text: string, files: LibraryFileDto[], command: CommandDto | null) => {
    if (conversation.send(text, files, command)) onSend?.(text, files, command);
  };

  return (
    <div className='flex min-h-0 flex-1'>
      <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
        {messages.length === 0 && ephemeral && (
          <div className='flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center'>
            <div className='bg-muted flex size-14 items-center justify-center rounded-2xl'>
              <MessageCircleDashed className='size-7' />
            </div>
            <h2 className='text-2xl font-semibold'>{t('ephemeral.title')}</h2>
            <p className='text-muted-foreground max-w-md'>{t('ephemeral.description')}</p>
          </div>
        )}
        {messages.length === 0 && !ephemeral && (
          <div className='flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center'>
            <BrandIcon detailed className='size-16' />
            <Greeting />
          </div>
        )}
        {messages.length > 0 && (
          <MessageList conversation={conversation} editable rememberable={!ephemeral} onOpenDocument={openDocument} />
        )}
        <ChatFooter
          busy={conversation.busy}
          waiting={conversation.waitingFor !== null}
          placeholder={conversation.placeholder()}
          onSend={send}
          onStop={conversation.stop}
          tools={composerTools}
          sendBlocked={sendBlocked}
        >
          {ephemeral && messages.length > 0 && (
            <p className='text-muted-foreground mb-2 flex items-center justify-center gap-1.5 text-sm'>
              <MessageCircleDashed className='size-4' />
              {t('ephemeral.hint')}
            </p>
          )}
        </ChatFooter>
      </div>
      <ConversationCanvas doc={doc} follows={[follow]} openDocument={openDocument} />
    </div>
  );
}
