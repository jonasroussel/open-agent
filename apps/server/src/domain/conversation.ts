import { MAX_ASK_ANSWER_LENGTH, type ChatMessage } from '@open-agent/shared';

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

type Part = ChatMessage['parts'][number];
type QuestionPart = Extract<Part, { type: 'tool-ask_user' }>;

function isQuestion(part: Part): part is QuestionPart {
  return part.type === 'tool-ask_user';
}

/** Whether the message already asked the user something: one round of questions per answer, never more. */
export function hasAsked(message: ChatMessage): boolean {
  return message.parts.some(isQuestion);
}

/**
 * The history ends with the user's answers to every question of the assistant's last message: the answer goes on in
 * that message. An answer is a short text, or `null` for none.
 */
export function answersQuestions(history: readonly ChatMessage[]): boolean {
  const last = history.at(-1);
  if (last?.role !== 'assistant') return false;
  const questions = last.parts.filter(isQuestion);
  return (
    questions.length > 0 &&
    questions.every(
      (part) =>
        part.state === 'output-available' &&
        (part.output.answer === null ||
          (typeof part.output.answer === 'string' &&
            part.output.answer.trim() !== '' &&
            part.output.answer.length <= MAX_ASK_ANSWER_LENGTH)),
    )
  );
}

/**
 * A question the user left unanswered (they wrote something else instead) gets `null`: the model must see an answer
 * to every question it asked.
 */
export function withAnsweredQuestions(history: readonly ChatMessage[]): ChatMessage[] {
  return history.map((message) => ({
    ...message,
    parts: message.parts.map((part): Part =>
      isQuestion(part) && part.state === 'input-available'
        ? {
            type: part.type,
            toolCallId: part.toolCallId,
            state: 'output-available',
            input: part.input,
            output: { answer: null },
          }
        : part,
    ),
  }));
}
