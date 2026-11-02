import { Chat } from '@ai-sdk/react';
import { API_ROUTES, apiPath, type ChatMessage, type ConversationResponse } from '@open-agent/shared';
import { DefaultChatTransport } from 'ai';

import { api } from '@/lib/api.ts';
import { queryClient } from '@/lib/query-client.ts';
import { memoryRulesQuery } from '@/memory/memory-query.ts';
import { quotaQuery } from '@/quota/quota-query.ts';

import { conversationsQuery } from './conversations-query.ts';

const transport = new DefaultChatTransport<ChatMessage>({ api: API_ROUTES.chat });

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

export function chatFor(id: string, messages: ChatMessage[] = []): Chat<ChatMessage> {
  let chat = chats.get(id);
  if (!chat) {
    chat = new Chat({
      id,
      messages,
      transport,
      generateId: () => crypto.randomUUID(),
      sendAutomaticallyWhen: questionsAnswered,
      // A new conversation got its title meanwhile, every answer moves its conversation to the top, may have changed
      // the memory, and spent some of the quota.
      onFinish: () => {
        void queryClient.invalidateQueries({ queryKey: conversationsQuery.queryKey });
        void queryClient.invalidateQueries({ queryKey: memoryRulesQuery.queryKey });
        void queryClient.invalidateQueries({ queryKey: quotaQuery.queryKey });
        // The model may have rewritten the open document.
        void queryClient.invalidateQueries({ queryKey: [API_ROUTES.artifact] });
      },
      // A refused message may be a used-up quota: the chat then says so instead of "failed".
      onError: () => void queryClient.invalidateQueries({ queryKey: quotaQuery.queryKey }),
    });
    chats.set(id, chat);
  }
  return chat;
}

export function hasChat(id: string): boolean {
  return chats.has(id);
}

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
 * The saved copy replaces a conversation kept here, after it changed on another device. A conversation deleted there
 * is forgotten; its page then finds it gone and leaves.
 */
export async function refreshChat(id: string): Promise<void> {
  const chat = chats.get(id);
  if (!chat || !idle(chat)) return;
  const result = await api<ConversationResponse>(apiPath(API_ROUTES.conversation, { conversationId: id }));
  if (!result.ok) {
    if (result.error === 'not_found') forgetChat(id);
    return;
  }
  // A message sent here meanwhile wins: its answer brings the saved copy.
  if (idle(chat)) chat.messages = result.data.messages;
}

export async function refreshAllChats(): Promise<void> {
  await Promise.all([...chats.keys()].map((id) => refreshChat(id)));
}
