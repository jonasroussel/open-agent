import type { PersonDto } from '@open-agent/shared';
import { useSyncExternalStore } from 'react';

/** In a shared conversation, whose message the assistant is answering, as the saved copy last said. */
const answering = new Map<string, PersonDto | null>();
const listeners = new Set<() => void>();

export function setAnswering(conversationId: string, person: PersonDto | null): void {
  if ((answering.get(conversationId) ?? null)?.id === person?.id) return;
  answering.set(conversationId, person);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `null`: nobody's message is being answered there. */
export function useAnswering(conversationId: string): PersonDto | null {
  return useSyncExternalStore(subscribe, () => answering.get(conversationId) ?? null);
}
