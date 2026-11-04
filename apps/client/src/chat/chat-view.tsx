import { useChat, type Chat } from '@ai-sdk/react';
import {
  API_ROUTES,
  apiPath,
  OWN_KEY_REFUSED,
  type ApiError,
  type ChatMessage,
  type CommandDto,
  type LibraryFileDto,
  type MemoryNotice,
  type RememberMessageResponse,
} from '@open-agent/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowDown, MessageCircleDashed, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';

import { sessionQuery } from '@/auth/session.ts';
import { CanvasPanel } from '@/canvas/canvas-panel.tsx';
import { artifactQuery, liveDocumentOf, writtenDocumentOf } from '@/canvas/canvas-query.ts';
import { rememberOpenCanvas } from '@/canvas/open-canvas.ts';
import { BrandIcon } from '@/components/brand-icon.tsx';
import { Button } from '@/components/ui/button.tsx';
import { toFilePart } from '@/files/library.ts';
import { api } from '@/lib/api.ts';
import { memoryRulesQuery } from '@/memory/memory-query.ts';
import { QUOTA_WARNING_PERCENT, quotaQuery, resetMonth } from '@/quota/quota-query.ts';

import { useAnswering } from './answering-store.ts';
import { refreshChat } from './chat-store.ts';
import { Composer } from './composer.tsx';
import { conversationsQuery } from './conversations-query.ts';
import { Greeting } from './greeting.tsx';
import { AssistantMessage, PendingAnswer, type UndoOutcome, UserMessage } from './message-view.tsx';

/**
 * A conversation: its messages, kept scrolled to the newest while it streams, the composer under them, and the canvas
 * beside them when a document is open (`?doc=`) or being written. An ephemeral one says so, and remembers nothing.
 */
export function ChatView({
  chat,
  ephemeral = false,
  onSend,
}: {
  chat: Chat<ChatMessage>;
  ephemeral?: boolean;
  onSend?: () => void;
}) {
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

  // Shared, once someone joined: each writes their own messages, one answer at a time.
  const me = useQuery(sessionQuery).data?.id ?? null;
  const { data: list } = useQuery(conversationsQuery);
  const sharing = list?.conversations.find((conversation) => conversation.id === chat.id)?.sharing ?? null;
  const shared = sharing?.members.some((member) => member.status === 'member') ?? false;
  const answeringNow = useAnswering(chat.id);
  const waitingFor = shared && !busy ? answeringNow : null;
  const locked = busy || waitingFor !== null;
  // Messages from before the sharing are the owner's. Each shows under its writer's current name: the admin may have
  // renamed them since; someone who left keeps the name they had.
  const people = sharing ? [sharing.owner, ...sharing.members.map((member) => member.person)] : [];
  const authorOf = (message: ChatMessage) => {
    const author = message.metadata?.author ?? sharing?.owner ?? null;
    return people.find((person) => person.id === author?.id) ?? author;
  };
  const mine = (message: ChatMessage) => !shared || authorOf(message)?.id === me;
  const lastUserIndex = messages.findLastIndex((message) => message.role === 'user');
  // Answering again, or answering the assistant's questions, is for whoever sent the last message.
  const ownTurn = lastUserIndex === -1 || mine(messages[lastUserIndex]!);

  const errorCode = codeOf(error);
  const conflict = errorCode === 'conversation_busy' || errorCode === 'conversation_changed';
  // Someone else wrote meanwhile: the saved copy shows what they wrote, and the user sends theirs again.
  useEffect(() => {
    if (conflict) void refreshChat(chat.id);
  }, [conflict, chat.id]);

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
  // then unanswered. In a shared conversation, only the one it was asked to answers it.
  const myQuestion = ownTurn ? pendingQuestion : null;
  const send = (text: string, files: LibraryFileDto[], command: CommandDto | null) => {
    if (myQuestion && text && files.length === 0 && !command) return answer(myQuestion, text);
    clearError();
    const parts = files.map(toFilePart);
    const metadata = command ? { command: { id: command.id, name: command.name } } : undefined;
    void (text ? sendMessage({ text, files: parts, metadata }) : sendMessage({ files: parts, metadata }));
    onSend?.();
  };

  const placeholderOf = () => {
    if (waitingFor) {
      return waitingFor.id === me ? t('chat.answeringYou') : t('chat.answeringFor', { name: waitingFor.name });
    }
    return myQuestion ? t('chat.answerPlaceholder') : t('chat.placeholder');
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
            <BrandIcon className='size-14' />
            <Greeting />
          </div>
        )}
        {messages.length > 0 && (
          <StickToBottom className='relative min-h-0 flex-1' resize='instant' initial='instant'>
            <StickToBottom.Content className='mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6'>
              {messages.map((message, index) =>
                message.role === 'user' ? (
                  <UserMessage
                    key={message.id}
                    message={message}
                    author={mine(message) ? null : (authorOf(message)?.name ?? null)}
                    // Shared: only the sender's own last message, the answers after it are everyone's.
                    canEdit={!locked && mine(message) && (!shared || index === lastUserIndex)}
                    onEdit={(text) => {
                      clearError();
                      // The edited message keeps its files and its command.
                      const files = message.parts.filter((part) => part.type === 'file');
                      const { metadata } = message;
                      void (text
                        ? sendMessage({ text, files, metadata, messageId: message.id })
                        : sendMessage({ files, metadata, messageId: message.id }));
                    }}
                    onRemember={locked || ephemeral || !mine(message) ? null : () => rememberMessage(message.id)}
                    onUndoMemory={undoMemory}
                  />
                ) : (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    // From its first chunk: the server sends the answer's route before any word.
                    streaming={busy && index === lastIndex}
                    onRegenerate={!locked && ownTurn && index === lastIndex ? () => void regenerate() : null}
                    onUndoMemory={undoMemory}
                    onOpenDocument={openDocument}
                    onAnswer={!locked && ownTurn && index === lastIndex ? answer : null}
                  />
                ),
              )}
              {/* Only until the answer appears: then it takes the dots' place, instead of showing next to them. */}
              {(busy || waitingFor) && messages.at(-1)?.role === 'user' && <PendingAnswer />}
              {error && !exhausted && (
                <div className='flex items-center gap-3 pl-10'>
                  <p className='text-destructive text-sm'>{t(errorKeyOf(error, errorCode))}</p>
                  {!conflict && (
                    <Button variant='outline' size='sm' onClick={() => void regenerate()}>
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
        )}
        <div className='mx-auto w-full max-w-3xl px-4 pb-3'>
          {ephemeral && messages.length > 0 && (
            <p className='text-muted-foreground mb-2 flex items-center justify-center gap-1.5 text-sm'>
              <MessageCircleDashed className='size-4' />
              {t('ephemeral.hint')}
            </p>
          )}
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
              waiting={waitingFor !== null}
              onSend={send}
              onStop={() => void stop()}
              placeholder={placeholderOf()}
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

/** The server refuses a turn with `{ "error": code }`, which the chat transport keeps as the error's message. */
function codeOf(error: Error | undefined): ApiError['error'] | null {
  if (!error) return null;
  try {
    return (JSON.parse(error.message) as Partial<ApiError>).error ?? null;
  } catch {
    return null;
  }
}

function errorKeyOf(error: Error, code: ApiError['error'] | null) {
  if (code === 'conversation_busy') return 'errors.conversation_busy';
  if (code === 'conversation_changed') return 'errors.conversation_changed';
  return error.message === OWN_KEY_REFUSED ? 'chat.ownKeyRefused' : 'chat.failed';
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
