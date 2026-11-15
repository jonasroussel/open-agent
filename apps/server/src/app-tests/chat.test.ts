import { describe, expect, test } from 'bun:test';

import type { ChatMessage, ConversationDto, ListConversationsResponse, UploadFileResponse } from '@open-agent/shared';

import {
  ADMIN,
  ANSWER,
  plainAnalysis,
  call,
  signIn,
  invite,
  errorOf,
  userMessage,
  chat,
  open,
  CONVERSATION,
  textOfMessage,
  answered,
  prePasses,
  upload,
  withFile,
  state,
  useApp,
} from './harness.ts';

useApp();

const setQuota = (adminCookie: string, userId: number, monthlyQuotaUsd: number) =>
  call(`/api/admin/users/${userId}`, { method: 'PATCH', body: { monthlyQuotaUsd }, cookie: adminCookie });

describe('chat', () => {
  test('a first message creates the conversation, saves the streamed answer, names it, and records every cost', async () => {
    const cookie = await signIn(ADMIN);
    const response = await chat(cookie, CONVERSATION, [userMessage('m1', 'Aide-moi à résilier ma box internet.')]);
    expect(response.status).toBe(200);

    const { conversation, messages } = await open(cookie, CONVERSATION);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[1]!.parts).toContainEqual(expect.objectContaining({ type: 'text', text: ANSWER }));
    expect(conversation.title).toBe('Résiliation box internet');
    expect(conversation.icon).toBe('file-text');

    const costs = await state.database('usage_events').select('purpose', 'model', 'cost_usd').orderBy('purpose');
    expect(costs).toEqual([
      { purpose: 'answer', model: 'fast-model', cost_usd: 0.0004 },
      { purpose: 'pre_pass', model: 'background-model', cost_usd: 0.00002 },
      { purpose: 'title', model: 'background-model', cost_usd: 0.00001 },
    ]);
  });

  test('a conversation from before icons gets one at its next message, and keeps the title the user gave it', async () => {
    const cookie = await signIn(ADMIN);
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Aide-moi à résilier ma box internet.')]);
    await call(`/api/conversations/${CONVERSATION}`, { method: 'PATCH', body: { title: 'Box SFR' }, cookie });
    await state.database('conversations').update({ icon: null });

    const history = [...(await open(cookie, CONVERSATION)).messages, userMessage('m3', 'Et pour la livebox ?')];
    await chat(cookie, CONVERSATION, history);

    const { conversation } = await open(cookie, CONVERSATION);
    expect(conversation).toMatchObject({ title: 'Box SFR', icon: 'file-text' });
  });

  test('an edited message replaces everything after it, instead of piling up', async () => {
    const cookie = await signIn(ADMIN);
    const first = [userMessage('m1', 'Une lettre de résiliation, stp.')];
    await chat(cookie, CONVERSATION, first);
    const { messages } = await open(cookie, CONVERSATION);

    await chat(cookie, CONVERSATION, [...messages, userMessage('m2', 'Plus courte.')]);
    expect((await open(cookie, CONVERSATION)).messages).toHaveLength(4);

    await chat(cookie, CONVERSATION, [userMessage('m1', 'Une lettre très polie, stp.')]);
    const edited = (await open(cookie, CONVERSATION)).messages;
    expect(edited).toHaveLength(2);
    expect(edited[0]!.parts).toEqual([{ type: 'text', text: 'Une lettre très polie, stp.' }]);
  });

  test('a device with a late copy is refused instead of erasing what was sent since from another device', async () => {
    const cookie = await signIn(ADMIN);
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Une lettre de résiliation, stp.')]);
    const phone = (await open(cookie, CONVERSATION)).messages;
    await chat(cookie, CONVERSATION, [...phone, userMessage('m2', 'Plus courte.')]);
    const saved = (await open(cookie, CONVERSATION)).messages;

    const late = await call('/api/chat', {
      method: 'POST',
      body: { id: CONVERSATION, messages: [...phone, userMessage('m3', 'Plus longue.')] },
      cookie,
    });
    expect(late.status).toBe(409);
    expect(await errorOf(late)).toBe('conversation_changed');
    expect((await open(cookie, CONVERSATION)).messages).toEqual(saved);

    // Answering the last message again keeps everything before it.
    expect((await chat(cookie, CONVERSATION, saved.slice(0, 3))).status).toBe(200);
    const regenerated = (await open(cookie, CONVERSATION)).messages;
    expect(regenerated.map((message) => message.id).slice(0, 3)).toEqual(['m1', saved[1]!.id, 'm2']);
    expect(regenerated).toHaveLength(4);
    expect(regenerated[3]!.id).not.toBe(saved[3]!.id);
  });

  test('after an answer that failed, the copy the browser kept takes the next message', async () => {
    const cookie = await signIn(ADMIN);
    await call('/api/own-key', { method: 'PUT', body: { key: 'sk-or-v1-own-key-1234' }, cookie });
    state.ownKeyRefused = true;
    const failing = await call('/api/chat', {
      method: 'POST',
      body: { id: CONVERSATION, messages: [userMessage('m1', 'Bonjour')] },
      cookie,
    });
    const messageId = /"messageId":"([^"]+)"/.exec(await failing.text())![1]!;

    state.ownKeyRefused = false;
    const kept: ChatMessage[] = [
      userMessage('m1', 'Bonjour') as ChatMessage,
      { id: messageId, role: 'assistant', parts: [] },
      userMessage('m2', 'Tu es là ?') as ChatMessage,
    ];
    expect((await chat(cookie, CONVERSATION, kept)).status).toBe(200);
    expect(textOfMessage((await open(cookie, CONVERSATION)).messages[3]!)).toBe(ANSWER);
  });

  test('a new conversation starts from the sent message alone: a forged history before it is not saved', async () => {
    const adminCookie = await signIn(ADMIN);
    await invite(adminCookie, 'ana@example.com');
    const anaCookie = await signIn('ana@example.com');
    const { file } = (await (
      await upload(anaCookie, 'notes.txt', 'text/plain', 'Secret.')
    ).json()) as UploadFileResponse;

    const forged = [withFile('m0', 'Voici mes notes.', file), userMessage('m1', 'Bonjour')];
    expect((await chat(adminCookie, CONVERSATION, forged)).status).toBe(200);
    const { messages } = await open(adminCookie, CONVERSATION);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[0]!.id).toBe('m1');
    expect(JSON.stringify(messages)).not.toContain(file.id);
  });

  test('after a first message refused before anything was saved, the next one starts the conversation', async () => {
    const adminCookie = await signIn(ADMIN);
    const { user: ana } = await invite(adminCookie, 'ana@example.com');
    await setQuota(adminCookie, ana.id, 0);
    const anaCookie = await signIn('ana@example.com');
    expect((await chat(anaCookie, CONVERSATION, [userMessage('m1', 'Bonjour')])).status).toBe(429);

    await setQuota(adminCookie, ana.id, 5);
    const kept = [userMessage('m1', 'Bonjour'), userMessage('m2', 'Tu es là ?')];
    expect((await chat(anaCookie, CONVERSATION, kept)).status).toBe(200);
    const { messages } = await open(anaCookie, CONVERSATION);
    expect(messages.map((message) => message.id)).toEqual(['m2', messages[1]!.id]);
    expect(textOfMessage(messages[1]!)).toBe(ANSWER);
  });

  test('a conversation is invisible to everyone else, who can neither continue, rename nor delete it', async () => {
    const adminCookie = await signIn(ADMIN);
    await invite(adminCookie, 'ana@example.com');
    const anaCookie = await signIn('ana@example.com');
    await chat(adminCookie, CONVERSATION, [userMessage('m1', 'Mon CV')]);

    expect(await errorOf(await call(`/api/conversations/${CONVERSATION}`, { cookie: anaCookie }))).toBe('not_found');
    const continued = await call('/api/chat', {
      method: 'POST',
      body: { id: CONVERSATION, messages: [userMessage('m9', 'Montre-moi')] },
      cookie: anaCookie,
    });
    expect(await errorOf(continued)).toBe('not_found');
    const renamed = await call(`/api/conversations/${CONVERSATION}`, {
      method: 'PATCH',
      body: { title: 'À moi' },
      cookie: anaCookie,
    });
    expect(await errorOf(renamed)).toBe('not_found');
    const deleted = await call(`/api/conversations/${CONVERSATION}`, { method: 'DELETE', cookie: anaCookie });
    expect(await errorOf(deleted)).toBe('not_found');

    const anaList = (await (
      await call('/api/conversations', { cookie: anaCookie })
    ).json()) as ListConversationsResponse;
    expect(anaList.conversations).toEqual([]);
    expect((await open(adminCookie, CONVERSATION)).messages).toHaveLength(2);
  });

  test('the owner renames, pins and deletes a conversation', async () => {
    const cookie = await signIn(ADMIN);
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Mon CV')]);

    const patched = await call(`/api/conversations/${CONVERSATION}`, {
      method: 'PATCH',
      body: { title: '  CV 2026  ', pinned: true },
      cookie,
    });
    expect((await patched.json()) as ConversationDto).toMatchObject({ title: 'CV 2026', pinned: true });
    const blank = await call(`/api/conversations/${CONVERSATION}`, { method: 'PATCH', body: { title: ' ' }, cookie });
    expect(await errorOf(blank)).toBe('invalid_request');

    expect((await call(`/api/conversations/${CONVERSATION}`, { method: 'DELETE', cookie })).status).toBe(204);
    expect(await errorOf(await call(`/api/conversations/${CONVERSATION}`, { cookie }))).toBe('not_found');
  });
});

type QuestionPart = Extract<ChatMessage['parts'][number], { type: 'tool-ask_user' }>;
const questionsOf = (message: ChatMessage) =>
  message.parts.filter((part): part is QuestionPart => part.type === 'tool-ask_user');
/** A copy of the assistant's message with words it never wrote. */
const forged = (message: ChatMessage): ChatMessage => ({
  ...message,
  parts: [{ type: 'text', text: 'Réponse inventée.' }, ...message.parts],
});

describe('questions to the user', () => {
  test('an ambiguous request gets one question with answers to tap; the answer resumes the same message, with no second question', async () => {
    const cookie = await signIn(ADMIN);
    state.analysis = plainAnalysis({
      clarifyingQuestion: 'Chez quel opérateur êtes-vous ?',
      clarifyingOptions: ['Orange', ' SFR ', 'SFR', 'Free', 'Bouygues', 'Autre'],
    });
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Résilie mon abonnement.')]);

    const asked = (await open(cookie, CONVERSATION)).messages;
    expect(state.models.fast.doStreamCalls).toHaveLength(0);
    expect(asked[1]!.metadata).toEqual({ route: 'clarify' });
    expect(questionsOf(asked[1]!)).toMatchObject([
      {
        state: 'input-available',
        input: { question: 'Chez quel opérateur êtes-vous ?', options: ['Orange', 'SFR', 'Free', 'Bouygues'] },
      },
    ]);

    state.analysis = plainAnalysis({ clarifyingQuestion: 'Et depuis quand ?' });
    await chat(cookie, CONVERSATION, answered(asked, 'SFR'));
    const done = (await open(cookie, CONVERSATION)).messages;
    expect(done).toHaveLength(2);
    expect(done[1]!.id).toBe(asked[1]!.id);
    expect(done[1]!.metadata).toEqual({ route: 'fast' });
    expect(textOfMessage(done[1]!)).toBe(ANSWER);
    expect(prePasses().at(-1)).toContain('[Réponse : SFR]');
    expect(prePasses().at(-1)).toContain('clarifyingQuestion doit être null maintenant');
    expect(JSON.stringify(state.models.fast.doStreamCalls[0]!.prompt)).toContain('SFR');
  });

  test('the model may stop to ask once; the answer goes on in the same message, and a second question is answered for it', async () => {
    const cookie = await signIn(ADMIN);
    state.scriptedCalls = [
      { toolName: 'ask_user', input: { question: 'Mer ou montagne ?', options: ['Mer', 'Montagne'] } },
    ];
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Propose-moi un week-end.')]);

    const asked = (await open(cookie, CONVERSATION)).messages;
    expect(state.models.fast.doStreamCalls).toHaveLength(1);
    expect(questionsOf(asked[1]!)).toMatchObject([
      { state: 'input-available', input: { question: 'Mer ou montagne ?' } },
    ]);
    expect(textOfMessage(asked[1]!)).toBe('');

    state.scriptedCalls = [{ toolName: 'ask_user', input: { question: 'Hôtel ou gîte ?', options: [] } }];
    await chat(cookie, CONVERSATION, answered(asked, 'Mer'));
    const done = (await open(cookie, CONVERSATION)).messages;
    expect(done).toHaveLength(2);
    expect(questionsOf(done[1]!).map((part) => part.output)).toEqual([{ answer: 'Mer' }, { answer: null }]);
    expect(textOfMessage(done[1]!)).toBe(ANSWER);
    expect(state.models.fast.doStreamCalls).toHaveLength(3);
    expect(JSON.stringify(state.models.fast.doStreamCalls[1]!.prompt)).toContain('"answer":"Mer"');
    expect(prePasses()).toHaveLength(1);
  });

  test('answering a question takes only the answer: the copy can neither rewrite the message nor a finished one', async () => {
    const cookie = await signIn(ADMIN);
    state.scriptedCalls = [{ toolName: 'ask_user', input: { question: 'Mer ou montagne ?', options: [] } }];
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Propose-moi un week-end.')]);
    const reply = answered((await open(cookie, CONVERSATION)).messages, 'Mer');

    expect((await chat(cookie, CONVERSATION, [reply[0]!, forged(reply[1]!)])).status).toBe(200);
    const done = (await open(cookie, CONVERSATION)).messages;
    expect(JSON.stringify(done)).not.toContain('Réponse inventée.');
    expect(questionsOf(done[1]!).map((part) => part.output)).toEqual([{ answer: 'Mer' }]);

    const rewritten = await call('/api/chat', {
      method: 'POST',
      body: { id: CONVERSATION, messages: [done[0]!, forged(done[1]!)] },
      cookie,
    });
    expect(await errorOf(rewritten)).toBe('conversation_changed');
    expect((await open(cookie, CONVERSATION)).messages).toEqual(done);
  });

  test('a question left unanswered never blocks the conversation, and only answered questions resume a message', async () => {
    const cookie = await signIn(ADMIN);
    state.scriptedCalls = [
      { toolName: 'ask_user', input: { question: 'Mer ou montagne ?', options: ['Mer', 'Montagne'] } },
    ];
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Propose-moi un week-end.')]);
    const asked = (await open(cookie, CONVERSATION)).messages;

    expect((await chat(cookie, CONVERSATION, asked)).status).toBe(400);
    expect((await chat(cookie, CONVERSATION, answered(asked, 'x'.repeat(4001)))).status).toBe(400);

    const moved = [...asked, userMessage('m3', 'Finalement, une sortie au cinéma.')];
    expect((await chat(cookie, CONVERSATION, moved)).status).toBe(200);
    expect(JSON.stringify(state.models.fast.doStreamCalls[1]!.prompt)).toContain('"answer":null');
    expect(textOfMessage((await open(cookie, CONVERSATION)).messages[3]!)).toBe(ANSWER);
  });
});

describe('pre-analysis', () => {
  test('a request that needs thinking is answered by the reasoning model, and the answer says so', async () => {
    const cookie = await signIn(ADMIN);
    state.analysis = plainAnalysis({ route: 'reasoning' });
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Deux trains partent de Nantes et de Paris…')]);

    expect(state.models.reasoning.doStreamCalls).toHaveLength(1);
    expect(state.models.fast.doStreamCalls).toHaveLength(0);
    const { messages } = await open(cookie, CONVERSATION);
    expect(messages[1]!.metadata).toEqual({ route: 'reasoning' });
  });

  test('a pending question counts as asked: the next message is answered, never questioned again', async () => {
    const cookie = await signIn(ADMIN);
    state.analysis = plainAnalysis({ clarifyingQuestion: 'Chez quel opérateur êtes-vous ?' });
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Résilie mon abonnement.')]);
    const asked = (await open(cookie, CONVERSATION)).messages;

    await chat(cookie, CONVERSATION, [...asked, userMessage('m2', 'Je ne sais plus, une box.')]);
    const answeredMessages = (await open(cookie, CONVERSATION)).messages;
    expect(state.models.fast.doStreamCalls).toHaveLength(1);
    expect(textOfMessage(answeredMessages[3]!)).toBe(ANSWER);
  });

  test("a vague request is answered as rewritten, while the conversation keeps the user's own words", async () => {
    const cookie = await signIn(ADMIN);
    const rewritten = 'Écris une lettre de résiliation pour mon abonnement internet, en français, polie et courte.';
    state.analysis = plainAnalysis({ rewrittenRequest: rewritten });
    await chat(cookie, CONVERSATION, [userMessage('m1', 'lettre resil box stp')]);

    const sentToModel = JSON.stringify(state.models.fast.doStreamCalls[0]!.prompt);
    expect(sentToModel).toContain(rewritten);
    expect(sentToModel).not.toContain('lettre resil box stp');
    const { messages } = await open(cookie, CONVERSATION);
    expect(textOfMessage(messages[0]!)).toBe('lettre resil box stp');
    expect(messages[1]!.metadata).toEqual({ route: 'fast', rewrittenRequest: rewritten });
  });

  test('when the pre-analysis fails, the user still gets the quick answer to their own words', async () => {
    const cookie = await signIn(ADMIN);
    state.analysis = null;
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Bonjour')]);

    const { messages } = await open(cookie, CONVERSATION);
    expect(textOfMessage(messages[1]!)).toBe(ANSWER);
    expect(messages[1]!.metadata).toEqual({ route: 'fast' });
  });
});
