import {
  ASK_REPLY_EVENT,
  MAX_ASK_ANSWER_LENGTH,
  dataModelIsValid,
  type A2uiComponent,
  type AskInput,
  type AskOutput,
  type JsonValue,
  type Locale,
} from '@open-agent/shared';

import type { ChatMessage } from './conversation.ts';

/**
 * A question to the user is an `ask` part: a small surface whose buttons answer it. Without an answer the turn stops;
 * the answer, `{ action }`, resumes the same message.
 */

type Part = ChatMessage['parts'][number];
type QuestionPart = Extract<Part, { type: 'tool-ask' }>;

function isQuestion(part: Part): part is QuestionPart {
  return part.type === 'tool-ask';
}

/** The event of the button of `questionSurface`; its context is `{ answer }`. */
export const QUESTION_SEND_EVENT = 'send';

const LABELS: Record<Locale, { send: string; other: string }> = {
  fr: { send: 'Envoyer', other: 'Une autre réponse…' },
  en: { send: 'Send', other: 'Another answer…' },
};

/**
 * A plain question, with answers to tap: the options and the field write the same answer, which the button sends.
 */
export function questionSurface(question: string, options: readonly string[], locale: Locale): AskInput {
  const answer = { '@path': '/answer' };
  const components: A2uiComponent[] = [
    {
      id: 'root',
      component: 'Column',
      children: ['question', ...(options.length > 0 ? ['options'] : []), 'other', 'send'],
    },
    { id: 'question', component: 'Text', text: question },
    ...(options.length > 0
      ? [
          {
            id: 'options',
            component: 'ChoiceChips' as const,
            options: options.map((option) => ({ value: option, label: option })),
            value: answer,
          },
        ]
      : []),
    { id: 'other', component: 'TextField', placeholder: LABELS[locale].other, value: answer },
    {
      id: 'send',
      component: 'Button',
      label: LABELS[locale].send,
      variant: 'primary',
      action: { event: { name: QUESTION_SEND_EVENT, context: { answer } } },
    },
  ];
  return { components, dataModel: { answer: '' } };
}

/** What the question says: its texts. */
export function questionTextOf(input: AskInput): string {
  return input.components
    .flatMap((component) => (component.component === 'Text' ? [component.text] : []))
    .join(' ')
    .trim();
}

function describe(value: JsonValue): string {
  if (value === null) return '';
  if (Array.isArray(value)) return value.map(describe).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    // A ticked list is an object of `true`s: the ticked ids are the answer.
    return Object.entries(value)
      .flatMap(([key, item]) => {
        if (item === true) return [key];
        const text = item === false ? '' : describe(item);
        return text ? [`${key} : ${text}`] : [];
      })
      .join(', ');
  }
  return String(value).trim();
}

/** The answer in words: what was chosen or typed, or the label of the button tapped. `null`: never answered. */
export function answerTextOf(input: AskInput, output: AskOutput): string | null {
  const { action } = output;
  if (!action) return null;
  const values = Object.values(action.context).map(describe).filter(Boolean);
  if (values.length > 0) return values.join(', ');
  const button = input.components.find(
    (component) => component.component === 'Button' && component.action?.event.name === action.name,
  );
  return button?.component === 'Button' ? button.label : action.name;
}

const eventsOf = (input: AskInput) =>
  input.components.flatMap((component) =>
    component.component === 'Button' && component.action ? [component.action.event.name] : [],
  );

/**
 * An answer the server takes: `null`, one of the question's events with its context, or the text typed instead
 * (`ASK_REPLY_EVENT`), never longer than `MAX_ASK_ANSWER_LENGTH`.
 */
function isAnswer(input: AskInput, output: unknown): boolean {
  if (typeof output !== 'object' || output === null || !('action' in output)) return false;
  const { action } = output as { action: unknown };
  if (action === null) return true;
  if (typeof action !== 'object') return false;
  const { name, context } = action as Record<string, unknown>;
  if (typeof name !== 'string' || !dataModelIsValid(context)) return false;
  if (JSON.stringify(context).length > MAX_ASK_ANSWER_LENGTH) return false;
  if (name === ASK_REPLY_EVENT) return typeof context.text === 'string' && context.text.trim() !== '';
  return eventsOf(input).includes(name);
}

/** Whether the message already asked the user something: one round of questions per answer, never more. */
export function hasAsked(message: ChatMessage): boolean {
  return message.parts.some(isQuestion);
}

/** Whether the message still waits for the user's answer. */
export function isWaitingForAnswer(message: ChatMessage): boolean {
  return message.parts.some((part) => isQuestion(part) && part.state === 'input-available');
}

/** The history ends with the user's answers to every question of the assistant's last message: it goes on there. */
export function answersQuestions(history: readonly ChatMessage[]): boolean {
  const last = history.at(-1);
  if (last?.role !== 'assistant') return false;
  const questions = last.parts.filter(isQuestion);
  return (
    questions.length > 0 &&
    questions.every((part) => part.state === 'output-available' && isAnswer(part.input, part.output))
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
            output: { action: null },
          }
        : part,
    ),
  }));
}
