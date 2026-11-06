import { Chat } from '@ai-sdk/react';
import { API_ROUTES, apiPath, type ChatMessage, type ConversationResponse, type PersonDto } from '@open-agent/shared';
import { DefaultChatTransport } from 'ai';

import { sessionQuery } from '@/auth/session.ts';
import { commandsQuery } from '@/commands/commands-query.ts';
import { libraryFilesQuery } from '@/files/library.ts';
import { api } from '@/lib/api.ts';
import { queryClient } from '@/lib/query-client.ts';
import { memoryRulesQuery } from '@/memory/memory-query.ts';
import { quotaQuery } from '@/quota/quota-query.ts';

import { setAnswering } from './answering-store.ts';
import { conversationsQuery } from './conversations-query.ts';

const transport = new DefaultChatTransport<ChatMessage>({ api: API_ROUTES.chat });
/** The server creates the conversation ephemeral; its later messages stay so whatever is sent. */
const ephemeralTransport = new DefaultChatTransport<ChatMessage>({ api: API_ROUTES.chat, body: { ephemeral: true } });

/**
 * The user answered every question that ended the last answer: the server goes on from there. Only the last step
 * counts, so an answer that went on after its question is never sent again.
 */
function questionsAnswered({ messages }: { messages: ChatMessage[] }): boolean {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return false;
  const lastStep = last.parts.slice(last.parts.findLastIndex((part) => part.type === 'step-start') + 1);
  const questions = lastStep.filter((part) => part.type === 'tool-ask_user');
  return questions.length > 0 && questions.every((part) => part.state === 'output-available');
}

/**
 * One `Chat` per conversation, kept across page changes: the first message is sent from the empty page and keeps
 * streaming after the address changes to the conversation's own, and going back to a conversation shows it at once.
 */
const chats = new Map<string, Chat<ChatMessage>>();
/** Ephemeral conversations, known only here: their page left, they are deleted (`discardEphemeral`). */
const ephemeralIds = new Set<string>();

/**
 * `answering`: whose message the server is answering there, from the saved copy: when it is the user's, the page
 * follows that answer from its start (`/api/chat/:id/stream`).
 */
export function chatFor(
  id: string,
  messages: ChatMessage[] = [],
  { ephemeral = false, answering = null }: { ephemeral?: boolean; answering?: PersonDto | null } = {},
): Chat<ChatMessage> {
  let chat = chats.get(id);
  if (!chat) {
    if (ephemeral) ephemeralIds.add(id);
    chat = new Chat({
      id,
      messages,
      transport: ephemeral ? ephemeralTransport : transport,
      generateId: () => crypto.randomUUID(),
      sendAutomaticallyWhen: questionsAnswered,
      // A new conversation got its title meanwhile, every answer moves its conversation to the top, may have changed
      // the memory, saved a command or made files, and spent some of the quota. Done here at once, not only through
      // `/api/events`: the device that asked must not wait for, or depend on, that stream.
      onFinish: () => {
        // Its answer is written: the conversation takes a new message.
        setAnswering(id, null);
        void queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
        void queryClient.invalidateQueries({ queryKey: memoryRulesQuery.queryKey });
        void queryClient.invalidateQueries({ queryKey: commandsQuery.queryKey });
        void queryClient.invalidateQueries({ queryKey: libraryFilesQuery.queryKey });
        void queryClient.invalidateQueries({ queryKey: quotaQuery.queryKey });
        // The model may have rewritten the open document.
        void queryClient.invalidateQueries({ queryKey: [API_ROUTES.artifact] });
      },
      // A refused message may be a used-up quota: the chat then says so instead of "failed".
      onError: () => void queryClient.invalidateQueries({ queryKey: quotaQuery.queryKey }),
    });
    chats.set(id, chat);
    followIfMine(chat, answering);
  }
  return chat;
}

/** The server goes on writing an answer whatever the page does: the user's own is followed again here. */
function followIfMine(chat: Chat<ChatMessage>, answering: PersonDto | null): void {
  const me = queryClient.getQueryData(sessionQuery.queryKey)?.id;
  if (answering && answering.id === me) void chat.resumeStream();
}

/** The Stop button: the server ends the answer and saves it as it is; leaving the page would stop nothing. */
export function stopAnswer(id: string): void {
  void chats.get(id)?.stop();
  void api(apiPath(API_ROUTES.chatStream, { conversationId: id }), { method: 'DELETE' });
}

export function hasChat(id: string): boolean {
  return chats.has(id);
}

export function isEphemeral(id: string): boolean {
  return ephemeralIds.has(id);
}

/**
 * An ephemeral conversation whose page is left: gone here, and on the server, even while the tab closes (`keepalive`).
 * One never sent to exists only here.
 */
export function discardEphemeral(id: string): void {
  if (!ephemeralIds.delete(id)) return;
  const sent = (chats.get(id)?.messages.length ?? 0) > 0;
  forgetChat(id);
  if (sent) {
    void fetch(apiPath(API_ROUTES.conversation, { conversationId: id }), { method: 'DELETE', keepalive: true });
  }
}

// Closing or reloading the tab leaves the page too. The server deletes those it never heard of a day later.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const id of ephemeralIds) discardEphemeral(id);
  });
}

/** Leaves the server's answer alone: it goes on, and is saved. */
export function forgetChat(id: string): void {
  void chats.get(id)?.stop();
  chats.delete(id);
}

/** Signing out: the previous person's conversations must not come back for the next one. */
export function forgetAllChats(): void {
  for (const id of chats.keys()) forgetChat(id);
}

/** Waiting for nothing: an answer on its way would arrive by itself, and must not be cut short. */
function idle(chat: Chat<ChatMessage>): boolean {
  return chat.status === 'ready' || chat.status === 'error';
}

/**
 * The saved copy replaces a conversation kept here, after it changed on another device or, shared, by someone else;
 * an answer to the user still being written is followed again. A conversation deleted there, or left, is forgotten;
 * its page then finds it gone and leaves.
 */
export async function refreshChat(id: string): Promise<void> {
  const chat = chats.get(id);
  if (!chat || !idle(chat)) return;
  const result = await api<ConversationResponse>(apiPath(API_ROUTES.conversation, { conversationId: id }));
  if (!result.ok) {
    if (result.error === 'not_found') forgetChat(id);
    return;
  }
  setAnswering(id, result.data.answering);
  // A message sent here meanwhile wins: its answer brings the saved copy.
  if (!idle(chat)) return;
  chat.messages = result.data.messages;
  followIfMine(chat, result.data.answering);
}

// The connection to the answer broke (a phone put away, the network gone): coming back follows it again.
if (typeof window !== 'undefined') {
  const resumeBroken = () => {
    for (const [id, chat] of chats) if (chat.status === 'error') void refreshChat(id);
  };
  window.addEventListener('online', resumeBroken);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumeBroken();
  });
}

export async function refreshAllChats(): Promise<void> {
  await Promise.all([...chats.keys()].map((id) => refreshChat(id)));
}
