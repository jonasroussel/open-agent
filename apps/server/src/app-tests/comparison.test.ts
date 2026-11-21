import { describe, expect, test } from 'bun:test';

import type { CommandDto, ListCommandsResponse, ListConversationsResponse, SearchResponse } from '@open-agent/shared';
import type { UIMessage } from 'ai';

import {
  ADMIN,
  call,
  chat,
  errorOf,
  invite,
  open,
  plainAnalysis,
  rulesOf,
  signIn,
  state,
  textOfMessage,
  useApp,
  userMessage,
} from './harness.ts';

useApp();

const LEFT = 'left-conversation-id';
const RIGHT = 'right-conversation-id';
const PICKED = 'vendor/newer-model';

const sendTurn = (cookie: string, id: string, messages: UIMessage[], extra: Record<string, unknown> = {}) =>
  call('/api/chat', { method: 'POST', body: { id, messages, ...extra }, cookie });

/** Both threads' first message, sent at once as the client does. */
async function compare(cookie: string, text: string, command: CommandDto | null = null) {
  const message: UIMessage = {
    ...userMessage('m1', text),
    ...(command ? { metadata: { command: { id: command.id, name: command.name } } } : {}),
  };
  const responses = await Promise.all([
    sendTurn(cookie, LEFT, [message]),
    sendTurn(cookie, RIGHT, [message], { comparison: { with: LEFT, modelId: PICKED } }),
  ]);
  await Promise.all(responses.map((response) => response.text()));
  return responses;
}

const listOf = async (cookie: string) =>
  (await (await call('/api/conversations', { cookie })).json()) as ListConversationsResponse;

async function answerModels(conversationId: string): Promise<string[]> {
  return state.database('usage_events').where({ conversation_id: conversationId, purpose: 'answer' }).pluck('model');
}

/** How much each call of the model was set to think, in order. */
const thinkingOf = (modelId: string) =>
  state.thinking.filter((choice) => choice.modelId === modelId).map((choice) => choice.thinking);

describe('comparison', () => {
  test('both threads answer the same message, each with its model, and each continues its own history', async () => {
    const cookie = await signIn(ADMIN);
    const command = (await (
      await call('/api/commands', { method: 'POST', body: { name: 'lettre', prompt: 'Écris une lettre.' }, cookie })
    ).json()) as CommandDto;
    const responses = await compare(cookie, 'Écris une lettre de résiliation.', command);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await answerModels(LEFT)).toEqual(['fast-model']);
    expect(await answerModels(RIGHT)).toEqual([PICKED]);
    // Sent to both threads, the command ran once.
    const commands = ((await (await call('/api/commands', { cookie })).json()) as ListCommandsResponse).commands;
    expect(commands.map((listed) => listed.uses)).toEqual([1]);

    // The picked model cannot think: on the reasoning route it answers as on the fast one.
    state.analysis = plainAnalysis({ route: 'reasoning' });
    const left = await open(cookie, LEFT);
    const right = await open(cookie, RIGHT);
    await chat(cookie, LEFT, [...left.messages, userMessage('m3', 'Plus court.')]);
    await chat(cookie, RIGHT, [...right.messages, userMessage('m3', 'Plus formel.')]);
    expect(thinkingOf('reasoning-model')).toEqual(['medium']);
    expect(thinkingOf(PICKED)).toEqual(['off', 'off']);
    expect(await answerModels(LEFT)).toEqual(['fast-model', 'reasoning-model']);
    expect(await answerModels(RIGHT)).toEqual([PICKED, PICKED]);

    const rightAfter = await open(cookie, RIGHT);
    expect(rightAfter.conversation.comparison).toBeNull();
    expect(rightAfter.messages.map((message) => textOfMessage(message))).toEqual([
      'Écris une lettre de résiliation.',
      'Voici une lettre de résiliation.',
      'Plus formel.',
      'Voici une lettre de résiliation.',
    ]);
    expect((await open(cookie, LEFT)).messages.map((message) => textOfMessage(message))).toContain('Plus court.');
  });

  test('only the left conversation is listed, with its right thread; search skips the right; deleting the left deletes both', async () => {
    const cookie = await signIn(ADMIN);
    const { user: ana } = await invite(cookie, 'ana@example.com');
    await compare(cookie, 'Ma Freebox ne capte plus.');
    const share = (id: string) =>
      call(`/api/conversations/${id}/members`, { method: 'POST', body: { userIds: [ana.id] }, cookie });

    const { conversations } = await listOf(cookie);
    expect(conversations.map(({ id, comparison }) => ({ id, comparison }))).toEqual([
      { id: LEFT, comparison: { conversationId: RIGHT, modelId: PICKED } },
    ]);
    expect((await open(cookie, LEFT)).conversation.comparison).toEqual({ conversationId: RIGHT, modelId: PICKED });
    const found = (await (await call('/api/search?q=Freebox', { cookie })).json()) as SearchResponse;
    expect(found.results.map((result) => result.conversation.id)).toEqual([LEFT]);
    expect((await share(RIGHT)).status).toBe(400);
    expect((await share(LEFT)).status).toBe(400);

    expect((await call(`/api/conversations/${LEFT}`, { method: 'DELETE', cookie })).status).toBe(204);
    expect((await call(`/api/conversations/${RIGHT}`, { cookie })).status).toBe(404);
    expect(await state.database('messages').where({ conversation_id: RIGHT })).toEqual([]);
  });

  test('refused for anyone but the admin, a model without tools, a conversation of someone else, or an ephemeral one', async () => {
    const admin = await signIn(ADMIN);
    await invite(admin, 'ana@example.com');
    const ana = await signIn('ana@example.com');
    await chat(ana, 'ana-conversation-id', [userMessage('a1', 'Bonjour')]);
    const message = [userMessage('m1', 'Bonjour')];
    const refusals = [
      await sendTurn(ana, RIGHT, message, { comparison: { with: LEFT, modelId: PICKED } }),
      await sendTurn(admin, RIGHT, message, { comparison: { with: LEFT, modelId: 'image-model' } }),
      await sendTurn(admin, RIGHT, message, { comparison: { with: 'ana-conversation-id', modelId: PICKED } }),
      await sendTurn(admin, RIGHT, message, { comparison: { with: LEFT, modelId: PICKED }, ephemeral: true }),
    ];
    for (const response of refusals) {
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toBe('invalid_request');
    }
    expect(await state.database('conversations').where({ id: RIGHT })).toEqual([]);
  });

  test('a picked model whose thinking cannot be turned off thinks as little as it can on the fast route', async () => {
    const cookie = await signIn(ADMIN);
    const message = [userMessage('m1', 'Bonjour')];
    await (await sendTurn(cookie, LEFT, message)).text();
    const response = await sendTurn(cookie, RIGHT, message, {
      comparison: { with: LEFT, modelId: 'vendor/always-thinking' },
    });
    await response.text();
    expect(response.status).toBe(200);
    expect(thinkingOf('vendor/always-thinking')).toEqual(['low']);
    expect(await answerModels(RIGHT)).toEqual(['vendor/always-thinking']);
  });

  test('a remark in the right thread teaches the memory nothing; the same in the left one does', async () => {
    const cookie = await signIn(ADMIN);
    state.analysis = plainAnalysis({ feedback: 'Préfère le vouvoiement.' });
    state.reconciliation = { operation: 'add', ruleId: null, text: 'Vouvoyer.' };
    const message = userMessage('m1', 'Vouvoie-moi.');

    const right = await sendTurn(cookie, RIGHT, [message], { comparison: { with: LEFT, modelId: PICKED } });
    await right.text();
    expect(await rulesOf(cookie)).toEqual([]);
    const remembered = await call('/api/memory/remember', {
      method: 'POST',
      body: { conversationId: RIGHT, messageId: 'm1' },
      cookie,
    });
    expect(remembered.status).toBe(404);

    await chat(cookie, LEFT, [message]);
    expect((await rulesOf(cookie)).map((rule) => rule.text)).toEqual(['Vouvoyer.']);
  });
});
