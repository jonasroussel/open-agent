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
  type PersonDto,
  type RememberMessageResponse,
} from '@open-agent/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { sessionQuery } from '@/auth/session.ts';
import { toFilePart } from '@/files/library.ts';
import { api } from '@/lib/api.ts';
import { memoryRulesQuery } from '@/memory/memory-query.ts';
import { quotaQuery } from '@/quota/quota-query.ts';

import { useAnswering } from './answering-store.ts';
import { refreshChat, stopAnswer } from './chat-store.ts';
import { conversationsQuery } from './conversations-query.ts';
import type { UndoOutcome } from './message-view.tsx';

/** What the composer sends, as the `Chat` takes it. */
export function messageOf(text: string, files: LibraryFileDto[], command: CommandDto | null) {
  const parts = files.map(toFilePart);
  const metadata = command ? { command: { id: command.id, name: command.name } } : undefined;
  return text ? { text, files: parts, metadata } : { files: parts, metadata };
}

/** One conversation's state and the user's actions there, whatever shows it. */
export type Conversation = {
  messages: ChatMessage[];
  busy: boolean;
  /** The last turn failed: what to tell the user. */
  errorKey: 'errors.conversation_busy' | 'errors.conversation_changed' | 'chat.ownKeyRefused' | 'chat.failed' | null;
  /** Someone else wrote meanwhile: sending again, not retrying, is the way out. */
  conflict: boolean;
  shared: boolean;
  waitingFor: PersonDto | null;
  locked: boolean;
  ownTurn: boolean;
  /** A question of the last answer waits for this user's answer: what they type answers it. */
  asking: boolean;
  lastUserIndex: number;
  authorOf: (message: ChatMessage) => PersonDto | null;
  mine: (message: ChatMessage) => boolean;
  /** `false`: the text answered the waiting question, no new message was sent. */
  send: (text: string, files: LibraryFileDto[], command: CommandDto | null) => boolean;
  answer: (toolCallId: string, text: string) => void;
  edit: (message: ChatMessage, text: string) => void;
  regenerate: () => void;
  stop: () => void;
  placeholder: () => string;
  undoMemory: (notice: MemoryNotice) => Promise<UndoOutcome>;
  rememberMessage: (messageId: string) => Promise<MemoryNotice | null | 'failed'>;
};

/**
 * One conversation's behaviour, whatever shows it: its messages and status, who wrote what once shared, the question
 * waiting for an answer, and what the user does there (send, answer, regenerate, edit, remember, undo a memory change).
 */
export function useConversation(chat: Chat<ChatMessage>): Conversation {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { messages, status, error, sendMessage, regenerate, clearError, setMessages, addToolOutput } = useChat({
    chat,
  });
  const busy = status === 'submitted' || status === 'streaming';
  const pendingQuestion = pendingQuestionOf(messages.at(-1));

  // Shared, once someone joined: each writes their own messages, one answer at a time.
  const me = useQuery(sessionQuery).data?.id ?? null;
  const { data: list } = useQuery(conversationsQuery);
  const sharing = list?.conversations.find((conversation) => conversation.id === chat.id)?.sharing ?? null;
  const shared = sharing?.members.some((member) => member.status === 'member') ?? false;
  const answeringNow = useAnswering(chat.id);
  // An answer the server writes that this page does not follow: someone else's, or one sent from another device.
  const waitingFor = busy ? null : answeringNow;
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
    if (myQuestion && text && files.length === 0 && !command) {
      answer(myQuestion, text);
      return false;
    }
    clearError();
    void sendMessage(messageOf(text, files, command));
    return true;
  };

  /** The edited message keeps its files and its command; the answers after it are redone. */
  const edit = (message: ChatMessage, text: string) => {
    clearError();
    const files = message.parts.filter((part) => part.type === 'file');
    const { metadata } = message;
    void (text
      ? sendMessage({ text, files, metadata, messageId: message.id })
      : sendMessage({ files, metadata, messageId: message.id }));
  };

  const placeholder = () => {
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

  return {
    asking: myQuestion !== null,
    messages,
    busy,
    errorKey: error ? errorKeyOf(error, errorCode) : null,
    conflict,
    shared,
    waitingFor,
    locked,
    ownTurn,
    lastUserIndex,
    authorOf,
    mine,
    send,
    answer,
    edit,
    regenerate: () => void regenerate(),
    stop: () => stopAnswer(chat.id),
    placeholder,
    undoMemory,
    rememberMessage,
  };
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
