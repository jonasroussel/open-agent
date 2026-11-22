import { describe, expect, test } from 'bun:test';

import {
  ADMIN,
  ANSWER,
  CONVERSATION,
  answered,
  call,
  chat,
  invite,
  listen,
  open,
  plainAnalysis,
  say,
  sharedWithMarie,
  signIn,
  state,
  textOfMessage,
  toolResults,
  userMessage,
  useApp,
} from './harness.ts';

useApp();

const SHOPPING = {
  title: 'Courses',
  components: [
    { id: 'root', component: 'Column', children: ['list'] },
    {
      id: 'list',
      component: 'Checklist',
      items: [
        { id: 'eggs', label: 'Œufs' },
        { id: 'milk', label: 'Lait' },
      ],
      checked: { '@path': '/checked' },
    },
  ],
  dataModel: { checked: { eggs: true } },
};

const saveState = (cookie: string, messageId: string, toolCallId: string, dataModel: unknown) =>
  call(`/api/conversations/${CONVERSATION}/messages/${messageId}/surfaces/${toolCallId}`, {
    method: 'PUT',
    body: { dataModel },
    cookie,
  });

/** The admin's conversation, whose answer shows the shopping list: the message and the surface's ids. */
async function withShoppingList(cookie: string) {
  state.scriptedCalls = [{ toolName: 'show_ui', input: SHOPPING }];
  await chat(cookie, CONVERSATION, [userMessage('m1', 'Ma liste de courses pour samedi.')]);
  return shoppingListIn(cookie);
}

async function shoppingListIn(cookie: string) {
  const message = (await open(cookie, CONVERSATION)).messages.at(-1)!;
  const part = message.parts.find((candidate) => candidate.type === 'tool-show_ui')!;
  return { messageId: message.id, toolCallId: 'toolCallId' in part ? part.toolCallId : '' };
}

describe('show_ui', () => {
  test('the surface is saved with the answer, and its state is what the model reads at the next turn', async () => {
    const cookie = await signIn(ADMIN);
    const { messageId, toolCallId } = await withShoppingList(cookie);
    expect(await toolResults(cookie)).toEqual([
      { tool: 'show_ui', output: { dataModel: SHOPPING.dataModel }, error: undefined },
    ]);
    const { messages } = await open(cookie, CONVERSATION);
    expect(messages[1]!.parts).toContainEqual(expect.objectContaining({ type: 'tool-show_ui', input: SHOPPING }));
    expect(textOfMessage(messages[1]!)).toBe(ANSWER);

    const ticked = { checked: { eggs: true, milk: true } };
    expect((await saveState(cookie, messageId, toolCallId, ticked)).status).toBe(204);
    await chat(cookie, CONVERSATION, [
      ...(await open(cookie, CONVERSATION)).messages,
      userMessage('m3', 'Il manque quoi ?'),
    ]);
    expect(JSON.stringify(state.models.fast.doStreamCalls.at(-1)!.prompt)).toContain('"milk":true');
  });

  test('a surface that cannot be drawn makes the tool fail with what to fix', async () => {
    const cookie = await signIn(ADMIN);
    const broken = { components: [{ id: 'root', component: 'Column', children: ['ghost'] }] };
    state.scriptedCalls = [{ toolName: 'show_ui', input: broken }];
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Ma liste de courses.')]);
    const [result] = await toolResults(cookie);
    expect(result).toMatchObject({ tool: 'show_ui', output: undefined });
    expect(result!.error).toContain('"root" names a child "ghost" that does not exist.');
  });

  test('a binding key the model wrote with its quotes is saved as @path', async () => {
    const cookie = await signIn(ADMIN);
    const quoted = JSON.parse(JSON.stringify(SHOPPING).replace('"@path"', `"'@path'"`));
    state.scriptedCalls = [{ toolName: 'show_ui', input: quoted }];
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Ma liste de courses pour samedi.')]);

    expect(await toolResults(cookie)).toEqual([
      { tool: 'show_ui', output: { dataModel: SHOPPING.dataModel }, error: undefined },
    ]);
    const { messages } = await open(cookie, CONVERSATION);
    expect(messages[1]!.parts).toContainEqual(expect.objectContaining({ type: 'tool-show_ui', input: SHOPPING }));
  });
});

describe('surface state', () => {
  test('any participant saves it; everyone hears of it; others, questions and unknown parts are refused', async () => {
    const { admin, marie } = await sharedWithMarie();
    state.scriptedCalls = [{ toolName: 'show_ui', input: SHOPPING }];
    await say(admin, userMessage('m3', 'Notre liste de courses.'));
    const { messageId, toolCallId } = await shoppingListIn(admin);
    const devices = await listen(admin);

    const ticked = { checked: { milk: true } };
    expect((await saveState(marie, messageId, toolCallId, ticked)).status).toBe(204);
    await devices.until((events) => events.some((event) => event.type === 'conversation'));
    await devices.hangUp();
    const saved = (await open(admin, CONVERSATION)).messages.at(-1)!;
    expect(saved.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-show_ui', output: { dataModel: ticked } }),
    );

    await invite(admin, 'paul@example.com');
    const paul = await signIn('paul@example.com');
    expect((await saveState(paul, messageId, toolCallId, ticked)).status).toBe(404);
    expect((await saveState(admin, messageId, 'unknown', ticked)).status).toBe(404);
    expect((await saveState(admin, messageId, toolCallId, ['not', 'an', 'object'])).status).toBe(400);
    expect((await saveState(admin, messageId, toolCallId, { big: 'x'.repeat(20_001) })).status).toBe(400);

    state.analysis = plainAnalysis({ clarifyingQuestion: 'Pour combien de personnes ?' });
    await say(admin, userMessage('m5', 'Et pour le dîner ?'));
    const question = await open(admin, CONVERSATION);
    const asked = question.messages.at(-1)!;
    const part = asked.parts.find((candidate) => candidate.type === 'tool-ask')!;
    const askId = 'toolCallId' in part ? part.toolCallId : '';
    expect((await saveState(admin, asked.id, askId, { answer: '4' })).status).toBe(400);
  });
});

describe('questions in a shared conversation', () => {
  test('only the person who was asked answers', async () => {
    const { admin, marie } = await sharedWithMarie();
    state.analysis = plainAnalysis({
      clarifyingQuestion: 'Quelle pièce ?',
      clarifyingOptions: ['Cuisine', 'Salle de bain'],
    });
    await say(admin, userMessage('m3', 'Il y a encore une fuite.'));
    const asked = (await open(marie, CONVERSATION)).messages;

    expect((await chat(marie, CONVERSATION, answered(asked, 'Cuisine'))).status).toBe(400);
    state.analysis = plainAnalysis();
    expect((await chat(admin, CONVERSATION, answered(asked, 'Cuisine'))).status).toBe(200);
    expect(textOfMessage((await open(admin, CONVERSATION)).messages.at(-1)!)).toBe(ANSWER);
  });
});

describe('migration 0021', () => {
  test('an old ask_user question becomes an ask surface, its answer an action', async () => {
    const cookie = await signIn(ADMIN);
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Résilie mon abonnement.')]);
    await state.database.migrate.down();
    const [row] = await state.database('messages').where({ role: 'assistant' }).select('id', 'content');
    const old = {
      ...JSON.parse(row.content),
      parts: [
        { type: 'step-start' },
        {
          type: 'tool-ask_user',
          toolCallId: 'ask-1',
          state: 'output-available',
          input: { question: 'Chez quel opérateur ?', options: ['Orange', 'SFR'] },
          output: { answer: 'SFR' },
        },
        {
          type: 'tool-ask_user',
          toolCallId: 'ask-2',
          state: 'input-available',
          input: { question: 'Depuis quand ?', options: [] },
        },
      ],
    };
    await state
      .database('messages')
      .where({ id: row.id })
      .update({ content: JSON.stringify(old) });
    await state.database.migrate.latest();

    const parts = (await open(cookie, CONVERSATION)).messages[1]!.parts;
    expect(JSON.stringify(parts)).not.toContain('ask_user');
    expect(parts[1]).toMatchObject({
      type: 'tool-ask',
      toolCallId: 'ask-1',
      state: 'output-available',
      output: { action: { name: 'send', context: { answer: 'SFR' } } },
    });
    expect(parts[1]).toHaveProperty('input.components.1', {
      id: 'question',
      component: 'Text',
      text: 'Chez quel opérateur ?',
    });
    expect(JSON.stringify(parts[1])).toContain('"ChoiceChips"');
    expect(parts[2]).toMatchObject({ type: 'tool-ask', state: 'input-available' });
    expect(JSON.stringify(parts[2])).not.toContain('"ChoiceChips"');
  });
});
