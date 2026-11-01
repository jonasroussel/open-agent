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

/** A piece of the text around what the search found; `match`: one of the searched words. */
export type SnippetPart = { text: string; match: boolean };

/** A conversation the search found, with the passage of its best matching message. */
export type SearchHit = { conversation: Conversation; snippet: SnippetPart[] };

/** Words of a search: at most 10, the rest is noise. */
export function searchTerms(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean).slice(0, 10);
}

/**
 * A passage as the person reads it: Markdown marks (`**`, `#`, table pipes and rules, backticks) and line breaks
 * become plain spaces; the space between two found words stays.
 */
export function cleanSnippet(parts: readonly SnippetPart[]): SnippetPart[] {
  const cleaned = parts
    .map((part) => ({ text: part.text.replace(/[*_`#|>]+|-{3,}/g, ' ').replace(/\s+/g, ' '), match: part.match }))
    .filter((part) => part.text);
  const first = cleaned[0];
  const last = cleaned.at(-1);
  if (first) first.text = first.text.trimStart();
  if (last) last.text = last.text.trimEnd();
  return cleaned.filter((part) => part.text);
}

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
