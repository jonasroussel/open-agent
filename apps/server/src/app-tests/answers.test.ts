import { describe, expect, test } from 'bun:test';

import {
  ADMIN,
  ANSWER,
  call,
  signIn,
  invite,
  errorOf,
  userMessage,
  chat,
  open,
  CONVERSATION,
  textOfMessage,
  listen,
  state,
  useApp,
} from './harness.ts';

useApp();

describe('changes between devices', () => {
  test("a user's other devices hear of every change to their data, and nobody else does", async () => {
    const phone = await signIn(ADMIN);
    const computer = await listen(await signIn(ADMIN));
    await invite(phone, 'ana@example.com');
    const ana = await listen(await signIn('ana@example.com'));

    await chat(phone, CONVERSATION, [userMessage('m1', 'Bonjour')]);
    await call('/api/memory/rules', { method: 'POST', body: { text: 'Réponses courtes.' }, cookie: phone });
    await call(`/api/conversations/${CONVERSATION}`, { method: 'PATCH', body: { pinned: true }, cookie: phone });
    await call(`/api/conversations/${CONVERSATION}`, { method: 'DELETE', cookie: phone });
    await computer.until((events) => events.filter((event) => event.type === 'conversation').length >= 3);
    await computer.hangUp();
    await ana.hangUp();

    // The message saved as it is sent, the answer saved, then the deletion; the title is named in the background, its
    // event comes at any time.
    const conversationEvents = computer.heard.filter((event) => event.type === 'conversation');
    expect(conversationEvents).toEqual([
      { type: 'conversation', id: CONVERSATION },
      { type: 'conversation', id: CONVERSATION },
      { type: 'conversation', id: CONVERSATION },
    ]);
    expect(computer.heard).toContainEqual({ type: 'memory' });
    expect(computer.heard).toContainEqual({ type: 'conversations' });
    expect(ana.heard).toEqual([]);
    expect((await call('/api/events')).status).toBe(401);
  });
});

const followAnswer = (cookie: string, method = 'GET') => call(`/api/chat/${CONVERSATION}/stream`, { method, cookie });

describe('answers the server owns', () => {
  test('a browser that leaves stops nothing: the answer is written and saved, and comes back from its start', async () => {
    const cookie = await signIn(ADMIN);
    const { promise, resolve } = Promise.withResolvers<void>();
    state.answerHeld = promise;
    const leaving = new AbortController();
    await fetch(new URL('/api/chat', state.server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ id: CONVERSATION, messages: [userMessage('m1', 'Aide-moi à résilier ma box.')] }),
      signal: leaving.signal,
    });
    leaving.abort();

    // Back on the page: the message is saved, the answer is being written, one at a time.
    const opened = await open(cookie, CONVERSATION);
    expect(opened.messages.map((message) => message.id)).toEqual(['m1']);
    expect(opened.answering).toMatchObject({ name: 'admin' });
    const again = [...opened.messages, userMessage('m2', 'Alors ?')];
    const busy = await call('/api/chat', { method: 'POST', body: { id: CONVERSATION, messages: again }, cookie });
    expect(await errorOf(busy)).toBe('conversation_busy');
    await invite(cookie, 'ana@example.com');
    expect((await followAnswer(await signIn('ana@example.com'))).status).toBe(404);

    const following = await followAnswer(cookie);
    resolve();
    const replayed = await following.text();
    expect(replayed).toContain('"type":"start"');
    expect(replayed).toContain('de résiliation.');

    const saved = await open(cookie, CONVERSATION);
    expect(saved.answering).toBeNull();
    expect(textOfMessage(saved.messages.at(-1)!)).toBe(ANSWER);
    expect((await followAnswer(cookie)).status).toBe(204);
  });

  test("only the user's Stop ends their answer early; the conversation then takes a new message", async () => {
    const cookie = await signIn(ADMIN);
    const { promise, resolve } = Promise.withResolvers<void>();
    state.answerHeld = promise;
    const writing = await call('/api/chat', {
      method: 'POST',
      body: { id: CONVERSATION, messages: [userMessage('m1', 'Raconte une longue histoire.')] },
      cookie,
    });
    expect((await followAnswer(cookie, 'DELETE')).status).toBe(204);
    resolve();
    await writing.text();

    const { messages, answering } = await open(cookie, CONVERSATION);
    expect(answering).toBeNull();
    expect(messages[0]!.id).toBe('m1');
    state.answerHeld = null;
    expect((await chat(cookie, CONVERSATION, [...messages, userMessage('m3', 'Plus court.')])).status).toBe(200);
    expect(textOfMessage((await open(cookie, CONVERSATION)).messages.at(-1)!)).toBe(ANSWER);
  });

  test('one person writes at most three answers at once: the quota is checked before each, not during', async () => {
    const cookie = await signIn(ADMIN);
    const { promise, resolve } = Promise.withResolvers<void>();
    state.answerHeld = promise;
    const send = (id: string) =>
      call('/api/chat', { method: 'POST', body: { id, messages: [userMessage('m1', 'Bonjour')] }, cookie });
    const writing = await Promise.all(['conversation-1', 'conversation-2', 'conversation-3'].map(send));

    expect(await errorOf(await send('conversation-4'))).toBe('conversation_busy');
    resolve();
    await Promise.all(writing.map((response) => response.text()));
    expect((await chat(cookie, 'conversation-4', [userMessage('m1', 'Bonjour')])).status).toBe(200);
  });
});
