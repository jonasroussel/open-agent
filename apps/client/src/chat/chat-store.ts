import { Chat } from '@ai-sdk/react';
import { API_ROUTES, type ChatMessage } from '@open-agent/shared';
import { DefaultChatTransport } from 'ai';

import { queryClient } from '@/lib/query-client.ts';
import { memoryRulesQuery } from '@/memory/memory-query.ts';
import { quotaQuery } from '@/quota/quota-query.ts';

import { conversationsQuery } from './conversations-query.ts';

const transport = new DefaultChatTransport<ChatMessage>({ api: API_ROUTES.chat });

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
