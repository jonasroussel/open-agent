import { describe, expect, test } from 'bun:test';

import type { RememberMessageResponse } from '@open-agent/shared';

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
  rulesOf,
  noticeOf,
  state,
  useApp,
} from './harness.ts';

useApp();

const remember = (cookie: string, messageId: string) =>
  call('/api/memory/remember', { method: 'POST', body: { conversationId: CONVERSATION, messageId }, cookie });

describe('memory', () => {
  test('a lasting remark becomes a rule, shown under its answer, and the next answers follow it', async () => {
    const cookie = await signIn(ADMIN);
    state.analysis = plainAnalysis({ feedback: 'Préfère des réponses courtes.' });
    state.reconciliation = { operation: 'add', ruleId: null, text: 'Réponses courtes.' };
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Tes réponses sont toujours trop longues.')]);

    const [rule] = await rulesOf(cookie);
    expect(rule!.text).toBe('Réponses courtes.');
    const { messages } = await open(cookie, CONVERSATION);
    expect(textOfMessage(messages[1]!)).toBe(ANSWER);
    expect(noticeOf(messages[1]!)).toMatchObject({
      data: { operation: 'add', before: null, after: 'Réponses courtes.', undone: false },
    });

    state.analysis = plainAnalysis();
    await chat(cookie, CONVERSATION, [...messages, userMessage('m2', 'Une recette de crêpes ?')]);
    expect(JSON.stringify(state.models.fast.doStreamCalls[1]!.prompt)).toContain('Réponses courtes.');
  });

  test('a contrary remark rewrites the rule instead of adding a second one', async () => {
    const cookie = await signIn(ADMIN);
    await call('/api/memory/rules', { method: 'POST', body: { text: 'Réponses courtes.' }, cookie });
    const [rule] = await rulesOf(cookie);
    state.analysis = plainAnalysis({ feedback: 'Préfère des réponses détaillées.' });
    state.reconciliation = { operation: 'update', ruleId: rule!.id, text: 'Réponses détaillées.' };
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Finalement, détaille plus tes réponses.')]);

    expect(await rulesOf(cookie)).toEqual([{ id: rule!.id, text: 'Réponses détaillées.' }]);
    const { messages } = await open(cookie, CONVERSATION);
    expect(noticeOf(messages[1]!)).toMatchObject({
      data: { operation: 'update', before: 'Réponses courtes.', after: 'Réponses détaillées.' },
    });
  });

  test('"Remember" on a message keeps what lasts in it, even when its analysis kept nothing, and can be undone', async () => {
    const cookie = await signIn(ADMIN);
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Merci, mais on habite à Nantes !')]);
    expect(await rulesOf(cookie)).toEqual([]);
    state.reconciliation = { operation: 'add', ruleId: null, text: 'Habite à Nantes.' };
    const { notice } = (await (await remember(cookie, 'm1')).json()) as RememberMessageResponse;
    expect(notice).toMatchObject({ operation: 'add', before: null, after: 'Habite à Nantes.', undone: false });
    expect((await rulesOf(cookie)).map((rule) => rule.text)).toEqual(['Habite à Nantes.']);
    const asked = state.models.background.doGenerateCalls.map((generation) => JSON.stringify(generation)).at(-1);
    expect(asked).toContain('Merci, mais on habite à Nantes !');
    expect(asked).toContain('a demandé de retenir ce message');

    expect((await call(`/api/memory/changes/${notice!.changeId}/undo`, { method: 'POST', cookie })).status).toBe(204);
    expect(await rulesOf(cookie)).toEqual([]);

    const answer = (await open(cookie, CONVERSATION)).messages[1]!;
    expect(await errorOf(await remember(cookie, answer.id))).toBe('not_found');
    await invite(cookie, 'ana@example.com');
    expect(await errorOf(await remember(await signIn('ana@example.com'), 'm1'))).toBe('not_found');
  });

  test('undo puts the rule back and marks the notice, but not once the rule changed again', async () => {
    const cookie = await signIn(ADMIN);
    state.analysis = plainAnalysis({ feedback: 'Vouvoyer.' });
    state.reconciliation = { operation: 'add', ruleId: null, text: 'Vouvoyer l’utilisateur.' };
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Arrête de me tutoyer.')]);
    const notice = noticeOf((await open(cookie, CONVERSATION)).messages[1]!) as { data: { changeId: number } };

    expect((await call(`/api/memory/changes/${notice.data.changeId}/undo`, { method: 'POST', cookie })).status).toBe(
      204,
    );
    expect(await rulesOf(cookie)).toEqual([]);
    expect(noticeOf((await open(cookie, CONVERSATION)).messages[1]!)).toMatchObject({ data: { undone: true } });
    const twice = await call(`/api/memory/changes/${notice.data.changeId}/undo`, { method: 'POST', cookie });
    expect(await errorOf(twice)).toBe('memory_changed');

    await chat(cookie, 'second-conversation', [userMessage('m1', 'Arrête de me tutoyer.')]);
    const second = noticeOf((await open(cookie, 'second-conversation')).messages[1]!) as { data: { changeId: number } };
    const [rule] = await rulesOf(cookie);
    await call(`/api/memory/rules/${rule!.id}`, { method: 'PATCH', body: { text: 'Vouvoyer, toujours.' }, cookie });
    const stale = await call(`/api/memory/changes/${second.data.changeId}/undo`, { method: 'POST', cookie });
    expect(await errorOf(stale)).toBe('memory_changed');
    expect(await rulesOf(cookie)).toEqual([{ id: rule!.id, text: 'Vouvoyer, toujours.' }]);
  });

  test('a reconciliation that does not hold changes nothing, and the answer still comes', async () => {
    const cookie = await signIn(ADMIN);
    state.analysis = plainAnalysis({ feedback: 'Pas de listes.' });
    state.reconciliation = { operation: 'update', ruleId: 999, text: 'Pas de listes.' };
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Ne me mets plus de listes.')]);

    expect(await rulesOf(cookie)).toEqual([]);
    const { messages } = await open(cookie, CONVERSATION);
    expect(textOfMessage(messages[1]!)).toBe(ANSWER);
    expect(noticeOf(messages[1]!)).toBeUndefined();
  });

  test('the memory page adds, edits and forgets rules, never touches anyone else’s, and stops at 50', async () => {
    const adminCookie = await signIn(ADMIN);
    await invite(adminCookie, 'ana@example.com');
    const anaCookie = await signIn('ana@example.com');

    const added = await call('/api/memory/rules', {
      method: 'POST',
      body: { text: '  Pas   de jargon. ' },
      cookie: adminCookie,
    });
    const rule = (await added.json()) as { id: number; text: string };
    expect(rule.text).toBe('Pas de jargon.');
    const edited = await call(`/api/memory/rules/${rule.id}`, {
      method: 'PATCH',
      body: { text: 'Pas de jargon technique.' },
      cookie: adminCookie,
    });
    expect(edited.status).toBe(200);

    const foreignEdit = await call(`/api/memory/rules/${rule.id}`, {
      method: 'PATCH',
      body: { text: 'À moi.' },
      cookie: anaCookie,
    });
    expect(await errorOf(foreignEdit)).toBe('not_found');
    expect(await errorOf(await call(`/api/memory/rules/${rule.id}`, { method: 'DELETE', cookie: anaCookie }))).toBe(
      'not_found',
    );
    expect(await rulesOf(anaCookie)).toEqual([]);

    expect((await call(`/api/memory/rules/${rule.id}`, { method: 'DELETE', cookie: adminCookie })).status).toBe(204);
    expect(await rulesOf(adminCookie)).toEqual([]);

    for (let index = 0; index < 50; index++) {
      await call('/api/memory/rules', { method: 'POST', body: { text: `Règle ${index}` }, cookie: adminCookie });
    }
    const full = await call('/api/memory/rules', {
      method: 'POST',
      body: { text: 'Une de trop' },
      cookie: adminCookie,
    });
    expect(await errorOf(full)).toBe('memory_full');
  });
});
