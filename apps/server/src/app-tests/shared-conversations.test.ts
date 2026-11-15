import { describe, expect, test } from 'bun:test';

import type {
  AdminUserDto,
  SearchResponse,
  UploadFileResponse,
  ListConversationsResponse,
  SessionResponse,
  ListPeopleResponse,
} from '@open-agent/shared';
import type { UIMessage } from 'ai';

import {
  ADMIN,
  PUBLIC_URL,
  advanceMinutes,
  plainAnalysis,
  DRAWN,
  call,
  signIn,
  invite,
  errorOf,
  userMessage,
  chat,
  open,
  CONVERSATION,
  listen,
  MARIE,
  share,
  accept,
  say,
  withMarie,
  sharedWithMarie,
  upload,
  withFile,
  artifactsOf,
  saveArtifact,
  quotaOf,
  rulesOf,
  noticeOf,
  state,
  useApp,
} from './harness.ts';

useApp();

const leave = (cookie: string, userId: number) =>
  call(`/api/conversations/${CONVERSATION}/members/${userId}`, { method: 'DELETE', cookie });
const listOf = async (cookie: string) =>
  (await (await call('/api/conversations', { cookie })).json()) as ListConversationsResponse;
const sendTurn = (cookie: string, messages: UIMessage[]) =>
  call('/api/chat', { method: 'POST', body: { id: CONVERSATION, messages }, cookie });
const remember = (cookie: string, messageId: string) =>
  call('/api/memory/remember', { method: 'POST', body: { conversationId: CONVERSATION, messageId }, cookie });

describe('shared conversations', () => {
  test('an invited person reads nothing until they join, then reads the whole history and writes at their own cost', async () => {
    const { admin, marie, marieId } = await withMarie();
    const people = (await (await call('/api/people', { cookie: admin })).json()) as ListPeopleResponse;
    expect(people.people).toEqual([{ id: marieId, name: 'marie', email: MARIE }]);

    expect((await share(admin, [marieId])).status).toBe(204);
    expect(state.shares).toMatchObject([{ to: MARIE, from: 'admin', link: `${PUBLIC_URL}/c/${CONVERSATION}` }]);
    expect(await listOf(marie)).toMatchObject({
      conversations: [],
      invitations: [{ id: CONVERSATION, from: { name: 'admin' } }],
    });
    expect((await call(`/api/conversations/${CONVERSATION}`, { cookie: marie })).status).toBe(404);
    expect((await sendTurn(marie, [userMessage('x1', 'Coucou')])).status).toBe(404);

    expect((await accept(marie)).status).toBe(204);
    const opened = await open(marie, CONVERSATION);
    expect(opened.messages).toHaveLength(2);
    expect(opened.conversation.sharing).toMatchObject({
      role: 'member',
      owner: { name: 'admin' },
      members: [{ person: { name: 'marie' }, status: 'member' }],
    });
    expect((await quotaOf(marie)).percentUsed).toBe(0);

    const history = [...opened.messages, userMessage('m3', 'Et si le propriétaire ne répond pas ?')];
    expect((await chat(marie, CONVERSATION, history)).status).toBe(200);
    const { messages } = await open(admin, CONVERSATION);
    expect(messages.map((message) => message.metadata?.author?.name ?? null)).toEqual(['admin', null, 'marie', null]);
    expect((await quotaOf(marie)).percentUsed).toBe(42);
    const prompt = JSON.stringify(state.models.fast.doStreamCalls.at(-1)!.prompt);
    expect(prompt).toContain('[admin]');
    expect(prompt).toContain('[marie]');
    expect(prompt).toContain('partagée entre admin, marie');

    const found = (await (await call('/api/search?q=propriétaire', { cookie: marie })).json()) as SearchResponse;
    expect(found.results.map((result) => result.conversation.id)).toEqual([CONVERSATION]);
  });

  test('one answer at a time: the others see whose message it answers, and an outdated copy is refused', async () => {
    const { admin, marie } = await sharedWithMarie();
    const before = (await open(marie, CONVERSATION)).messages;
    const { promise, resolve } = Promise.withResolvers<void>();
    state.answerHeld = promise;
    const writing = await sendTurn(admin, [...before, userMessage('m3', 'Je préviens l’assurance ?')]);

    const meanwhile = await open(marie, CONVERSATION);
    expect(meanwhile.answering).toMatchObject({ name: 'admin' });
    expect(meanwhile.messages.at(-1)!.id).toBe('m3');
    expect(await errorOf(await sendTurn(marie, [...meanwhile.messages, userMessage('m4', 'Oui')]))).toBe(
      'conversation_busy',
    );
    resolve();
    await writing.text();
    expect((await open(marie, CONVERSATION)).answering).toBeNull();

    // Sent from her copy before the admin's message, hers would erase it.
    expect(await errorOf(await sendTurn(marie, [...before, userMessage('m4', 'Oui')]))).toBe('conversation_changed');
    // Nobody edits or answers again someone else's message.
    const saved = (await open(marie, CONVERSATION)).messages;
    expect((await sendTurn(marie, saved.slice(0, -1))).status).toBe(400);
    expect((await open(admin, CONVERSATION)).messages).toHaveLength(4);
  });

  test("members open the conversation's files and documents, and no other file of each other's", async () => {
    const { admin, marie } = await sharedWithMarie();
    const photo = (await (await upload(admin, 'fuite.png', 'image/png', DRAWN)).json()) as UploadFileResponse;
    const other = (await (await upload(admin, 'autre.png', 'image/png', DRAWN)).json()) as UploadFileResponse;
    await say(admin, withFile('m3', 'Voici la fuite.', photo.file));
    expect((await call(`/api/files/${photo.file.id}`, { cookie: marie })).status).toBe(200);
    expect((await call(`/api/files/${other.file.id}`, { cookie: marie })).status).toBe(404);

    state.scriptedCalls = [
      { toolName: 'create_document', input: { kind: 'document', title: 'Lettre', content: 'Brouillon' } },
    ];
    await say(marie, userMessage('m5', 'Écris la lettre au propriétaire, avec la photo.'));
    expect(JSON.stringify(state.models.fast.doStreamCalls.at(-1)!.prompt)).not.toContain(
      'a été supprimé de la bibliothèque',
    );
    const [letter] = await artifactsOf(admin);
    expect(letter).toMatchObject({ title: 'Lettre', version: 1 });
    expect((await saveArtifact(marie, letter!.id, 'Corrigée par Marie', 1)).status).toBe(200);
    expect((await artifactsOf(admin))[0]!.version).toBe(2);
  });

  test('the name the admin gives shows everywhere, on old messages too; an empty one gives the email back', async () => {
    const { admin, marie, marieId } = await sharedWithMarie();
    const rename = (name: unknown, cookie = admin) =>
      call(`/api/admin/users/${marieId}`, { method: 'PATCH', body: { name }, cookie });
    expect(((await (await rename('  Marie   Dupont ')).json()) as AdminUserDto).name).toBe('Marie Dupont');
    expect(await errorOf(await rename('x'.repeat(41)))).toBe('invalid_request');
    expect(await errorOf(await rename('Moi', marie))).toBe('not_admin');
    const session = (await (await call('/api/session', { cookie: marie })).json()) as SessionResponse;
    expect(session.user.name).toBe('Marie Dupont');
    expect((await listOf(admin)).conversations[0]!.sharing!.members[0]!.person.name).toBe('Marie Dupont');

    await say(marie, userMessage('m3', 'Je m’en occupe demain.'));
    await rename('Mamie');
    await say(admin, userMessage('m5', 'Merci !'));
    const prompt = JSON.stringify(state.models.fast.doStreamCalls.at(-1)!.prompt);
    expect(prompt).toContain('[Mamie]');
    expect(prompt).not.toContain('Marie Dupont');
    expect(prompt).toContain('partagée entre admin, Mamie');

    expect(((await (await rename('  ')).json()) as AdminUserDto).name).toBeNull();
    expect((await listOf(admin)).conversations[0]!.sharing!.members[0]!.person.name).toBe('marie');
  });

  test("the sender's memory stays theirs; pins are personal; a member leaves, the owner removes or deletes for all", async () => {
    const { admin, marie, marieId } = await sharedWithMarie();
    state.analysis = plainAnalysis({ feedback: 'Préfère des réponses courtes.' });
    state.reconciliation = { operation: 'add', ruleId: null, text: 'Réponses courtes.' };
    await say(marie, userMessage('m3', 'Réponds plus court, s’il te plaît.'));
    state.analysis = plainAnalysis();
    expect(noticeOf((await open(marie, CONVERSATION)).messages.at(-1)!)).toBeDefined();
    expect(noticeOf((await open(admin, CONVERSATION)).messages.at(-1)!)).toBeUndefined();
    expect(await rulesOf(admin)).toEqual([]);
    expect((await remember(admin, 'm3')).status).toBe(404);

    await call(`/api/conversations/${CONVERSATION}`, { method: 'PATCH', body: { pinned: true }, cookie: marie });
    expect((await listOf(marie)).conversations[0]!.pinned).toBe(true);
    expect((await listOf(admin)).conversations[0]!.pinned).toBe(false);
    expect((await call(`/api/conversations/${CONVERSATION}`, { method: 'DELETE', cookie: marie })).status).toBe(404);

    expect((await leave(marie, marieId)).status).toBe(204);
    expect((await call(`/api/conversations/${CONVERSATION}`, { cookie: marie })).status).toBe(404);
    expect((await listOf(admin)).conversations[0]!.sharing).toBeNull();
    await share(admin, [marieId]);
    await accept(marie);
    expect((await leave(admin, marieId)).status).toBe(204);
    expect((await call(`/api/conversations/${CONVERSATION}`, { cookie: marie })).status).toBe(404);

    await share(admin, [marieId]);
    await accept(marie);
    const marieDevice = await listen(marie);
    expect((await call(`/api/conversations/${CONVERSATION}`, { method: 'DELETE', cookie: admin })).status).toBe(204);
    await marieDevice.until((events) => events.some((event) => event.type === 'conversation'));
    await marieDevice.hangUp();
    expect(await listOf(marie)).toEqual({ conversations: [], invitations: [] });
  });
});

describe('ephemeral conversations', () => {
  test('outside the history: listed and found nowhere, never learned from nor shared, gone a day after being left', async () => {
    const cookie = await signIn(ADMIN);
    const { user: ana } = await invite(cookie, 'ana@example.com');
    await call('/api/memory/rules', { method: 'POST', body: { text: 'Réponses courtes.' }, cookie });
    await chat(cookie, 'kept-conversation-id', [userMessage('k1', 'Bonjour')]);
    state.analysis = plainAnalysis({ feedback: 'Préfère le tutoiement.' });
    state.reconciliation = { operation: 'add', ruleId: null, text: 'Tutoyer.' };
    const first = [userMessage('m1', 'Ma Freebox ne capte plus.')];
    const response = await call('/api/chat', {
      method: 'POST',
      body: { id: CONVERSATION, messages: first, ephemeral: true },
      cookie,
    });
    await response.text();
    state.analysis = plainAnalysis();

    // It follows the memory and teaches it nothing.
    expect(JSON.stringify(state.models.fast.doStreamCalls.at(-1)!.prompt)).toContain('Réponses courtes.');
    expect((await rulesOf(cookie)).map((rule) => rule.text)).toEqual(['Réponses courtes.']);
    const opened = await open(cookie, CONVERSATION);
    expect(opened.messages).toHaveLength(2);
    expect((await remember(cookie, 'm1')).status).toBe(404);
    expect((await share(cookie, [ana.id])).status).toBe(400);

    // Its next messages keep it ephemeral, whatever the browser says.
    await chat(cookie, CONVERSATION, [...opened.messages, userMessage('m3', 'Et maintenant ?')]);
    expect((await listOf(cookie)).conversations.map((conversation) => conversation.id)).toEqual([
      'kept-conversation-id',
    ]);
    const found = (await (await call('/api/search?q=Freebox', { cookie })).json()) as SearchResponse;
    expect(found.results).toEqual([]);

    // Its page closed without a word: a day later it is gone, the other conversations stay.
    advanceMinutes(24 * 60 + 1);
    expect((await listOf(cookie)).conversations).toHaveLength(1);
    expect((await call(`/api/conversations/${CONVERSATION}`, { cookie })).status).toBe(404);
  });
});
