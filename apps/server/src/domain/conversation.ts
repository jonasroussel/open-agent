import type { ChatMessage } from '@open-agent/shared';

export type { ChatMessage };

export type Conversation = {
  id: string;
  userId: number;
  /** `null` until the background model names it, after the first answer. */
  title: string | null;
  /** A Lucide icon name chosen with the title, e.g. `fuel`; `null` until then. The client checks it exists. */
  icon: string | null;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** A title the model gave: one line, without the quotes models like to add, and never longer than a sidebar row. */
export function cleanTitle(raw: string): string | null {
  const title = raw
    .split('\n')[0]!
    .replace(/^["'«“\s]+|["'»”.\s]+$/g, '')
    .trim();
  return title ? title.slice(0, 80) : null;
}

/** An icon name the model gave, in Lucide's kebab-case (`train-front`); anything else is dropped. */
export function cleanIcon(raw: string): string | null {
  const icon = raw.trim().toLowerCase();
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(icon) && icon.length <= 40 ? icon : null;
}

/**
 * At most one question back in a row: after the user answered a clarifying question, the assistant answers, even if
 * the request is still not perfectly clear. Asking again would feel like an interrogation.
 */
export function mayAskToClarify(history: readonly ChatMessage[]): boolean {
  const lastAnswer = history.findLast((message) => message.role === 'assistant');
  return lastAnswer?.metadata?.route !== 'clarify';
}
