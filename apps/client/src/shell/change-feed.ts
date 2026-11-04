import { API_ROUTES, type ChangeEvent } from '@open-agent/shared';
import { useEffect } from 'react';

import { artifactQuery } from '@/canvas/canvas-query.ts';
import { refreshAllChats, refreshChat } from '@/chat/chat-store.ts';
import { conversationQuery, conversationsQuery } from '@/chat/conversations-query.ts';
import { commandsQuery } from '@/commands/commands-query.ts';
import { libraryFilesQuery } from '@/files/library.ts';
import { queryClient } from '@/lib/query-client.ts';
import { memoryRulesQuery } from '@/memory/memory-query.ts';
import { quotaQuery } from '@/quota/quota-query.ts';

/** The conversation list's key is the start of each conversation's: `exact` keeps those out. */
const listOnly = { queryKey: conversationsQuery.queryKey, exact: true };

async function apply(change: ChangeEvent): Promise<void> {
  switch (change.type) {
    case 'conversation':
      void queryClient.invalidateQueries(listOnly);
      void queryClient.invalidateQueries({ queryKey: quotaQuery.queryKey });
      // A conversation not open here is read again when opened.
      queryClient.removeQueries({ queryKey: conversationQuery(change.id).queryKey });
      await refreshChat(change.id);
      return;
    case 'conversations':
      return void queryClient.invalidateQueries(listOnly);
    case 'memory':
      return void queryClient.invalidateQueries({ queryKey: memoryRulesQuery.queryKey });
    case 'files':
      return void queryClient.invalidateQueries({ queryKey: libraryFilesQuery.queryKey });
    case 'commands':
      return void queryClient.invalidateQueries({ queryKey: commandsQuery.queryKey });
    case 'artifact':
      return void queryClient.invalidateQueries({ queryKey: artifactQuery(change.id).queryKey });
  }
}

/**
 * Listens to `/api/events` while signed in: what changed on another device shows here without reloading. The browser
 * reconnects by itself (a phone waking up, the network coming back); changes missed meanwhile are caught up by
 * reloading everything once.
 */
export function useChangeFeed(): void {
  useEffect(() => {
    const source = new EventSource(API_ROUTES.events);
    let opened = false;
    source.addEventListener('open', () => {
      if (opened) {
        void queryClient.invalidateQueries();
        void refreshAllChats();
      }
      opened = true;
    });
    source.addEventListener(
      'message',
      (event: MessageEvent<string>) => void apply(JSON.parse(event.data) as ChangeEvent),
    );
    return () => source.close();
  }, []);
}
