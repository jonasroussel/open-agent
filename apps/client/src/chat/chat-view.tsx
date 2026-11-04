import { useChat, type Chat } from '@ai-sdk/react';
import {
  API_ROUTES,
  apiPath,
  OWN_KEY_REFUSED,
  type ChatMessage,
  type CommandDto,
  type LibraryFileDto,
  type MemoryNotice,
  type RememberMessageResponse,
} from '@open-agent/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowDown, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';

import { CanvasPanel } from '@/canvas/canvas-panel.tsx';
import { artifactQuery, liveDocumentOf, writtenDocumentOf } from '@/canvas/canvas-query.ts';
import { rememberOpenCanvas } from '@/canvas/open-canvas.ts';
import { BrandIcon } from '@/components/brand-icon.tsx';
import { Button } from '@/components/ui/button.tsx';
import { toFilePart } from '@/files/library.ts';
import { api } from '@/lib/api.ts';
import { memoryRulesQuery } from '@/memory/memory-query.ts';
import { QUOTA_WARNING_PERCENT, quotaQuery, resetMonth } from '@/quota/quota-query.ts';

import { Composer } from './composer.tsx';
import { conversationsQuery } from './conversations-query.ts';
import { Greeting } from './greeting.tsx';
import { AssistantMessage, PendingAnswer, type UndoOutcome, UserMessage } from './message-view.tsx';

/**
 * A conversation: its messages, kept scrolled to the newest while it streams, the composer under them, and the canvas
 * beside them when a document is open (`?doc=`) or being written.
 */
export function ChatView({ chat, onSend }: { chat: Chat<ChatMessage>; onSend?: () => void }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { messages, status, error, sendMessage, regenerate, stop, clearError, setMessages, addToolOutput } = useChat({
    chat,
  });
  const busy = status === 'submitted' || status === 'streaming';
  const lastIndex = messages.length - 1;
  const { data: quota } = useQuery(quotaQuery);
  const exhausted = quota?.exhausted === true;
  const pendingQuestion = pendingQuestionOf(messages.at(-1));

  // The server creates the conversation when the answer starts: show it in the sidebar then. The `Chat` refreshes the
  // list again when the answer ends (`chat-store.ts`).
  useEffect(() => {
    if (status === 'streaming') void queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
  }, [status, queryClient]);

  /** The `Chat` sends the answers once every question of the message has one (`chat-store.ts`). */
  const answer = (toolCallId: string, text: string) => {
    clearError();
    void addToolOutput({ tool: 'ask_user', toolCallId, output: { answer: text } });
  };

  // While a question waits, what the user types answers it; files or a command make it a new message, the question
  // then unanswered.
  const send = (text: string, files: LibraryFileDto[], command: CommandDto | null) => {
    if (pendingQuestion && text && files.length === 0 && !command) return answer(pendingQuestion, text);
    clearError();
    const parts = files.map(toFilePart);
    const metadata = command ? { command: { id: command.id, name: command.name } } : undefined;
    void (text ? sendMessage({ text, files: parts, metadata }) : sendMessage({ files: parts, metadata }));
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

  /** "Remember" on one of the user's messages; the notice shows beside it. */
  const rememberMessage = async (messageId: string): Promise<MemoryNotice | null | 'failed'> => {
    const result = await api<RememberMessageResponse>(API_ROUTES.memoryRemember, {
      method: 'POST',
      body: { conversationId: chat.id, messageId },
    });
    void queryClient.invalidateQueries({ queryKey: memoryRulesQuery.queryKey });
    void queryClient.invalidateQueries({ queryKey: quotaQuery.queryKey });
    return result.ok ? result.data.notice : 'failed';
  };

  const navigate = useNavigate();
  const { doc } = useSearch({ strict: false }) as { doc?: string };
  // Opening, switching or closing the document, here or by the model: remembered for when the user comes back.
  useEffect(() => rememberOpenCanvas(chat.id, doc ?? null), [chat.id, doc]);
  const answering = busy ? messages.at(-1) : undefined;
  const writing = liveDocumentOf(answering);
  // Closing the canvas while the model writes keeps it closed for that answer only.
  const [closedDuring, setClosedDuring] = useState<string | null>(null);
  const liveClosed = answering !== undefined && closedDuring === answering.id;
  // A document written during this answer opens once saved; one only seen in the history does not.
  const followLive = useRef(false);
  // From the end of the writing until its saved version is loaded, the canvas keeps the document as written: closing
  // for a frame, then "Loading…", flashed on a phone.
  const [handingOff, setHandingOff] = useState(false);
  const openDocument = useCallback(
    (id: string | null) =>
      void navigate({ to: '/c/$conversationId', params: { conversationId: chat.id }, search: id ? { doc: id } : {} }),
    [navigate, chat.id],
  );

  // Set while rendering: the panel must hold the document from the very render the writing ends in.
  if (writing && !liveClosed && !handingOff) setHandingOff(true);
  useEffect(() => {
    if (writing && !liveClosed) followLive.current = true;
  }, [writing, liveClosed]);
  const written = writtenDocumentOf(messages.at(-1));
  const writtenId = written?.id ?? null;
  useEffect(() => {
    if (!writtenId || !followLive.current) return;
    followLive.current = false;
    void queryClient.invalidateQueries({ queryKey: artifactQuery(writtenId).queryKey });
    openDocument(writtenId);
  }, [writtenId, queryClient, openDocument]);
  const liveSaved = useCallback(() => setHandingOff(false), []);

  const closeCanvas = () => {
    followLive.current = false;
    setHandingOff(false);
    if (answering) setClosedDuring(answering.id);
    openDocument(null);
  };
  const live = (writing && !liveClosed ? writing : null) ?? (handingOff ? written : null);
  const canvasOpen = live !== null || doc !== undefined;

  return (
    <div className='flex min-h-0 flex-1'>
      <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
        {messages.length === 0 ? (
          <div className='flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center'>
            <BrandIcon className='size-14' />
            <Greeting />
          </div>
        ) : (
          <StickToBottom className='relative min-h-0 flex-1' resize='instant' initial='instant'>
            <StickToBottom.Content className='mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6'>
              {messages.map((message, index) =>
                message.role === 'user' ? (
                  <UserMessage
                    key={message.id}
                    message={message}
                    canEdit={!busy}
                    onEdit={(text) => {
                      clearError();
                      // The edited message keeps its files and its command.
                      const files = message.parts.filter((part) => part.type === 'file');
                      const { metadata } = message;
                      void (text
                        ? sendMessage({ text, files, metadata, messageId: message.id })
                        : sendMessage({ files, metadata, messageId: message.id }));
                    }}
                    onRemember={busy ? null : () => rememberMessage(message.id)}
                    onUndoMemory={undoMemory}
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
                    onAnswer={!busy && index === lastIndex ? answer : null}
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
            <KeepAtBottom />
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
            <Composer
              busy={busy}
              onSend={send}
              onStop={() => void stop()}
              placeholder={pendingQuestion ? t('chat.answerPlaceholder') : t('chat.placeholder')}
            />
          )}
        </div>
      </div>
      {canvasOpen && (
        <CanvasPanel documentId={doc ?? live?.id ?? null} live={live} onLiveSaved={liveSaved} onClose={closeCanvas} />
      )}
    </div>
  );
}

/** The first question of the last answer still waiting for the user's answer. */
function pendingQuestionOf(message: ChatMessage | undefined): string | null {
  if (message?.role !== 'assistant') return null;
  const part = message.parts.find(
    (candidate) => candidate.type === 'tool-ask_user' && candidate.state === 'input-available',
  );
  return part?.type === 'tool-ask_user' ? part.toolCallId : null;
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
