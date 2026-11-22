import { isLocale, type AskInput, type AskOutput } from '@open-agent/shared';
import type { Knex } from 'knex';

import { QUESTION_SEND_EVENT, answerTextOf, questionSurface, questionTextOf } from '../../../domain/questions.ts';

type Row = { conversation_id: string; id: string; content: string; locale: string };
type StoredPart = { type: string; input?: unknown; output?: unknown; [key: string]: unknown };
type StoredMessage = { parts: StoredPart[] };
/** As the app saved them, with the types `AskUserInput` and `AskUserOutput` had. */
type OldQuestionPart = StoredPart & {
  input?: { question: string; options: string[] };
  output?: { answer: string | null };
};

const rowsHolding = (knex: Knex, type: string): Promise<Row[]> =>
  knex('messages')
    .join('conversations', 'conversations.id', 'messages.conversation_id')
    .join('users', 'users.id', 'conversations.user_id')
    .where('messages.content', 'like', `%"${type}"%`)
    .select('messages.conversation_id', 'messages.id', 'messages.content', 'users.locale');

async function rewrite(knex: Knex, type: string, change: (part: StoredPart, row: Row) => StoredPart): Promise<void> {
  for (const row of await rowsHolding(knex, type)) {
    const message = JSON.parse(row.content) as StoredMessage;
    const parts = message.parts.map((part) => (part.type === type ? change(part, row) : part));
    await knex('messages')
      .where({ conversation_id: row.conversation_id, id: row.id })
      .update({ content: JSON.stringify({ ...message, parts }) });
  }
}

/**
 * Questions became generative UI: every `ask_user` part (`{ question, options }`, answered `{ answer }`) is rewritten as
 * the `ask` surface the pre-analysis now writes, answered with the same words, so only one way of drawing them remains.
 */
export async function up(knex: Knex): Promise<void> {
  await rewrite(knex, 'tool-ask_user', (part, row) => {
    const old = part as OldQuestionPart;
    const changed: StoredPart = {
      ...part,
      type: 'tool-ask',
      input:
        old.input && questionSurface(old.input.question, old.input.options, isLocale(row.locale) ? row.locale : 'fr'),
    };
    if (old.output) {
      const { answer } = old.output;
      changed.output = {
        action: answer === null ? null : { name: QUESTION_SEND_EVENT, context: { answer } },
      } satisfies AskOutput;
    }
    return changed;
  });
}

export async function down(knex: Knex): Promise<void> {
  await rewrite(knex, 'tool-ask', (part) => {
    const input = part.input as AskInput;
    const chips = input.components.find((component) => component.component === 'ChoiceChips');
    const changed: StoredPart = {
      ...part,
      type: 'tool-ask_user',
      input: {
        question: questionTextOf(input),
        options: chips?.component === 'ChoiceChips' ? chips.options.map((option) => option.label) : [],
      },
    };
    if (part.output !== undefined) changed.output = { answer: answerTextOf(input, part.output as AskOutput) };
    return changed;
  });
}
