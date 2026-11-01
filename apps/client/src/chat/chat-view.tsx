import { useChat, type Chat } from '@ai-sdk/react';
import {
  API_ROUTES,
  apiPath,
  OWN_KEY_REFUSED,
  type ChatMessage,
  type LibraryFileDto,
  type MemoryNotice,
} from '@open-agent/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowDown, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';

import { CanvasPanel } from '@/canvas/canvas-panel.tsx';
import { artifactQuery, liveDocumentOf } from '@/canvas/canvas-query.ts';
import { BrandIcon } from '@/components/brand-icon.tsx';
import { Button } from '@/components/ui/button.tsx';
import { toFilePart } from '@/files/library.ts';
import { api } from '@/lib/api.ts';
import { memoryRulesQuery } from '@/memory/memory-query.ts';
import { QUOTA_WARNING_PERCENT, quotaQuery, resetMonth } from '@/quota/quota-query.ts';

import { Composer } from './composer.tsx';
import { conversationsQuery } from './conversations-query.ts';
import { AssistantMessage, PendingAnswer, type UndoOutcome, UserMessage } from './message-view.tsx';

/**
 * A conversation: its messages, kept scrolled to the newest while it streams, the composer under them, and the canvas
 * beside them when a document is open (`?doc=`) or being written.
 */
export function ChatView({ chat, onSend }: { chat: Chat<ChatMessage>; onSend?: () => void }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { messages, status, error, sendMessage, regenerate, stop, clearError, setMessages } = useChat({ chat });
  const busy = status === 'submitted' || status === 'streaming';
  const lastIndex = messages.length - 1;
  const { data: quota } = useQuery(quotaQuery);
  const exhausted = quota?.exhausted === true;

  // The server creates the conversation when the answer starts: show it in the sidebar then. The `Chat` refreshes the
  // list again when the answer ends (`chat-store.ts`).
  useEffect(() => {
    if (status === 'streaming') void queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
  }, [status, queryClient]);

  const send = (text: string, files: LibraryFileDto[]) => {
    clearError();
    const parts = files.map(toFilePart);
    void (text ? sendMessage({ text, files: parts }) : sendMessage({ files: parts }));
    onSend?.();
  };

  /**
   * The server marks the notice in the saved conversation; the same is done here, without reloading it. A rule edited
   * since cannot be undone, and the notice then says so.
   */
  const undoMemory = async (notice: MemoryNotice): Promise<UndoOutcome> => {
    const result = await api(apiPath(API_ROUTES.memoryChangeUndo, { changeId: notice.changeId }), { method: 'POST' });
    if (!result.ok) return result.error === 'memory_changed' ? 'changed' : 'unchanged';
    setMessages((current) =>
      current.map((message) => ({
        ...message,
        parts: message.parts.map((part) =>
          part.type === 'data-memory' && part.data.changeId === notice.changeId
            ? { ...part, data: { ...part.data, undone: true } }
            : part,
        ),
      })),
    );
    void queryClient.invalidateQueries({ queryKey: memoryRulesQuery.queryKey });
    return 'undone';
  };

  const navigate = useNavigate();
  const { doc } = useSearch({ strict: false }) as { doc?: string };
  const answering = busy ? messages.at(-1) : undefined;
  const live = liveDocumentOf(answering);
  // Closing the canvas while the model writes keeps it closed for that answer only.
  const [closedDuring, setClosedDuring] = useState<string | null>(null);
  const liveClosed = answering !== undefined && closedDuring === answering.id;
  // A document written during this answer opens once saved; one only seen in the history does not.
  const followLive = useRef(false);
  const openDocument = useCallback(
    (id: string | null) =>
      void navigate({ to: '/c/$conversationId', params: { conversationId: chat.id }, search: id ? { doc: id } : {} }),
    [navigate, chat.id],
  );

  useEffect(() => {
    if (live && !liveClosed) followLive.current = true;
  }, [live, liveClosed]);
  const written = lastWrittenDocument(messages.at(-1));
  useEffect(() => {
    if (!written || !followLive.current) return;
    followLive.current = false;
    void queryClient.invalidateQueries({ queryKey: artifactQuery(written).queryKey });
    openDocument(written);
  }, [written, queryClient, openDocument]);

  const closeCanvas = () => {
    followLive.current = false;
    if (answering) setClosedDuring(answering.id);
    openDocument(null);
  };
  const canvasOpen = (live !== null && !liveClosed) || doc !== undefined;

  return (
    <div className='flex min-h-0 flex-1'>
      <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
        {messages.length === 0 ? (
          <div className='flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center'>
            <BrandIcon className='size-14' />
            <h2 className='text-2xl font-semibold tracking-tight'>{t('home.greeting')}</h2>
            <p className='text-muted-foreground text-lg'>{t('home.prompt')}</p>
          </div>
        ) : (
          <StickToBottom className='relative min-h-0 flex-1' resize='smooth' initial='instant'>
            <StickToBottom.Content className='mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6'>
              {messages.map((message, index) =>
                message.role === 'user' ? (
                  <UserMessage
                    key={message.id}
                    message={message}
                    canEdit={!busy}
                    onEdit={(text) => {
                      clearError();
                      // The edited message keeps its files.
                      const files = message.parts.filter((part) => part.type === 'file');
                      void (text
                        ? sendMessage({ text, files, messageId: message.id })
                        : sendMessage({ files, messageId: message.id }));
                    }}
                  />
                ) : (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    // From its first chunk: the server sends the answer's route before any word.
                    streaming={busy && index === lastIndex}
                    onRegenerate={!busy && index === lastIndex ? () => void regenerate() : null}
                    onUndoMemory={undoMemory}
                    onOpenDocument={openDocument}
                  />
                ),
              )}
              {/* Only until the answer appears: then it takes the dots' place, instead of showing next to them. */}
              {busy && messages.at(-1)?.role === 'user' && <PendingAnswer />}
              {error && !exhausted && (
                <div className='flex items-center gap-3 pl-10'>
                  <p className='text-destructive text-sm'>
                    {error.message === OWN_KEY_REFUSED ? t('chat.ownKeyRefused') : t('chat.failed')}
                  </p>
                  <Button variant='outline' size='sm' onClick={() => void regenerate()}>
                    <RotateCcw />
                    {t('app.retry')}
                  </Button>
                </div>
              )}
            </StickToBottom.Content>
            <ScrollToBottom />
          </StickToBottom>
        )}
        <div className='mx-auto w-full max-w-3xl px-4 pb-3'>
          {quota && !quota.unlimited && !exhausted && quota.percentUsed >= QUOTA_WARNING_PERCENT && (
            <p className='text-muted-foreground mb-2 text-center text-sm'>
              {t('quota.nearLimit', { percent: quota.percentUsed })}
            </p>
          )}
          {exhausted ? (
            <p role='status' className='bg-muted rounded-2xl border px-4 py-5 text-center text-base'>
              {t('quota.exhausted', { month: resetMonth(quota, i18n.language) })}
            </p>
          ) : (
            <Composer busy={busy} onSend={send} onStop={() => void stop()} />
          )}
          <p className='text-muted-foreground mt-2 text-center text-xs'>{t('chat.disclaimer')}</p>
        </div>
      </div>
      {canvasOpen && <CanvasPanel documentId={doc ?? null} live={liveClosed ? null : live} onClose={closeCanvas} />}
    </div>
  );
}

/** The document saved by the last tool call of an answer, once saved. */
function lastWrittenDocument(message: ChatMessage | undefined): string | null {
  if (message?.role !== 'assistant') return null;
  const part = message.parts.findLast(
    (candidate) => candidate.type === 'tool-create_document' || candidate.type === 'tool-update_document',
  );
  return part?.state === 'output-available' ? part.output.id : null;
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
