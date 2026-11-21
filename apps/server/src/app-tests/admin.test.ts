import { describe, expect, test } from 'bun:test';

import type {
  ListAdminUsersResponse,
  AdminUserDto,
  OwnKeyResponse,
  AdminSettingsResponse,
  ListMemoryRulesResponse,
} from '@open-agent/shared';

import {
  ADMIN,
  DEFAULT_QUOTA,
  clock,
  call,
  signIn,
  invite,
  errorOf,
  userMessage,
  chat,
  open,
  CONVERSATION,
  quotaOf,
  rulesOf,
  state,
  useApp,
} from './harness.ts';

useApp();

function setKey(cookie: string, key: string) {
  return call('/api/own-key', { method: 'PUT', body: { key }, cookie });
}

async function settingsOf(cookie: string): Promise<AdminSettingsResponse> {
  return (await (await call('/api/admin/settings', { cookie })).json()) as AdminSettingsResponse;
}

/** How much the model's calls were set to think. */
const thinkingOf = (modelId: string) =>
  new Set(state.thinking.filter((choice) => choice.modelId === modelId).map((choice) => choice.thinking));

describe('admin settings', () => {
  test('the admin switches a role to another model, checked against OpenRouter, and the next answers use it', async () => {
    const cookie = await signIn(ADMIN);
    const setFast = (modelId: string) =>
      call('/api/admin/settings/models/fast', { method: 'PUT', body: { modelId }, cookie });

    expect(await errorOf(await setFast('vendor/unknown'))).toBe('model_not_found');
    expect(await errorOf(await setFast('vendor/text-only'))).toBe('model_unsuitable');
    expect((await setFast('vendor/newer-model')).status).toBe(200);
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Bonjour')]);
    const answer = await state.database('usage_events').where({ purpose: 'answer' }).first('model');
    expect(answer.model).toBe('vendor/newer-model');

    await setFast('fast-model');
    expect((await settingsOf(cookie)).models.fast).toBe('fast-model');
    expect(await state.database('settings').count({ count: '*' }).first()).toEqual({ count: 0 });
  });

  test('a model whose thinking cannot be turned off may answer everyday messages, thinking as little as it can, but not run the background calls', async () => {
    const cookie = await signIn(ADMIN);
    const setModel = (role: string) =>
      call(`/api/admin/settings/models/${role}`, {
        method: 'PUT',
        body: { modelId: 'vendor/always-thinking' },
        cookie,
      });

    expect(await errorOf(await setModel('background'))).toBe('model_unsuitable');
    expect((await setModel('fast')).status).toBe(200);
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Bonjour')]);
    const answer = await state.database('usage_events').where({ purpose: 'answer' }).first('model');
    expect(answer.model).toBe('vendor/always-thinking');
    expect(thinkingOf('vendor/always-thinking')).toEqual(new Set(['low']));
    expect(thinkingOf('background-model')).toEqual(new Set(['off']));
  });

  test('an edited prompt applies from the next message, the code still adds what depends on the conversation, and reset brings the default back', async () => {
    const cookie = await signIn(ADMIN);
    await call('/api/memory/rules', { method: 'POST', body: { text: 'Réponses courtes.' }, cookie });
    const setPrompt = (name: string, text: string | null) =>
      call(`/api/admin/settings/prompts/${name}`, { method: 'PUT', body: { text }, cookie });

    expect((await setPrompt('assistant', 'Tu es un assistant pirate.')).status).toBe(204);
    expect((await setPrompt('preAnalysis', 'Décide comment répondre, en JSON.')).status).toBe(204);
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Bonjour')]);
    const answer = JSON.stringify(state.models.fast.doStreamCalls[0]!.prompt);
    expect(answer).toContain('Tu es un assistant pirate.');
    expect(answer).not.toContain('Tu es Open Agent');
    expect(answer).toContain('Nous sommes le dimanche 1 novembre 2026');
    expect(answer).toContain('Réponses courtes.');
    const prompts = state.models.background.doGenerateCalls.map((generation) => JSON.stringify(generation.prompt));
    expect(prompts.some((prompt) => prompt.includes('Décide comment répondre, en JSON.'))).toBe(true);

    expect((await setPrompt('assistant', null)).status).toBe(204);
    const settings = await settingsOf(cookie);
    expect(settings.prompts.assistant).toBe(settings.defaultPrompts.assistant);
    expect(await errorOf(await setPrompt('assistant', '  '))).toBe('invalid_request');
    expect(await errorOf(await setPrompt('unknown', 'texte'))).toBe('invalid_request');
  });

  test("the admin reads and forgets a person's rules, and nobody else can", async () => {
    const adminCookie = await signIn(ADMIN);
    const { user: ana } = await invite(adminCookie, 'ana@example.com');
    const anaCookie = await signIn('ana@example.com');
    await call('/api/memory/rules', { method: 'POST', body: { text: 'Toujours en majuscules.' }, cookie: anaCookie });

    const listed = (await (
      await call(`/api/admin/users/${ana.id}/memory`, { cookie: adminCookie })
    ).json()) as ListMemoryRulesResponse;
    expect(listed.rules.map((rule) => rule.text)).toEqual(['Toujours en majuscules.']);
    const forget = (cookie: string) =>
      call(`/api/admin/users/${ana.id}/memory/${listed.rules[0]!.id}`, { method: 'DELETE', cookie });
    expect(await errorOf(await forget(anaCookie))).toBe('not_admin');
    expect((await forget(adminCookie)).status).toBe(204);

    expect(await rulesOf(anaCookie)).toEqual([]);
    const change = await state.database('memory_rule_changes').orderBy('id', 'desc').first('operation', 'source');
    expect(change).toEqual({ operation: 'delete', source: 'admin' });
    expect((await call('/api/admin/settings', { cookie: anaCookie })).status).toBe(403);
  });
});

describe('quota', () => {
  test('a user who spent their monthly quota is stopped until midnight on the 1st in Paris', async () => {
    const adminCookie = await signIn(ADMIN);
    const { user: ana } = await invite(adminCookie, 'ana@example.com');
    // One first turn costs 0.00043 $ (answer, pre-pass, title); the next ones 0.00042 $.
    await call(`/api/admin/users/${ana.id}`, {
      method: 'PATCH',
      body: { monthlyQuotaUsd: 0.0008 },
      cookie: adminCookie,
    });
    const anaCookie = await signIn('ana@example.com');
    const first = [userMessage('m1', 'Bonjour')];

    expect((await chat(anaCookie, CONVERSATION, first)).status).toBe(200);
    expect(await quotaOf(anaCookie)).toMatchObject({ unlimited: false, percentUsed: 53, exhausted: false });
    const second = [...(await open(anaCookie, CONVERSATION)).messages, userMessage('m3', 'Et ensuite ?')];
    expect((await chat(anaCookie, CONVERSATION, second)).status).toBe(200);
    const third = [...(await open(anaCookie, CONVERSATION)).messages, userMessage('m5', 'Encore ?')];
    const refused = await chat(anaCookie, CONVERSATION, third);
    expect(refused.status).toBe(429);
    expect(await quotaOf(anaCookie)).toEqual({
      ownKey: false,
      unlimited: false,
      percentUsed: 100,
      exhausted: true,
      resetsAt: '2026-11-30T23:00:00.000Z',
    });

    clock.at = new Date('2026-11-30T23:00:00Z');
    expect((await chat(anaCookie, CONVERSATION, third)).status).toBe(200);
  });

  test('the admin sees what everyone spent this month and sets their quota; admins have no limit', async () => {
    const adminCookie = await signIn(ADMIN);
    const { user: ana } = await invite(adminCookie, 'ana@example.com');
    const anaCookie = await signIn('ana@example.com');
    await chat(anaCookie, CONVERSATION, [userMessage('m1', 'Bonjour')]);

    const { users } = (await (
      await call('/api/admin/users', { cookie: adminCookie })
    ).json()) as ListAdminUsersResponse;
    const anaRow = users.find((user) => user.id === ana.id)!;
    expect(anaRow.monthCostUsd).toBeCloseTo(0.00043);
    expect(anaRow.monthlyQuotaUsd).toBe(DEFAULT_QUOTA);
    expect(users.find((user) => user.email === ADMIN)!.monthlyQuotaUsd).toBeNull();
    expect(await quotaOf(adminCookie)).toMatchObject({ unlimited: true, exhausted: false });

    const update = (body: unknown, cookie = adminCookie) =>
      call(`/api/admin/users/${ana.id}`, { method: 'PATCH', body, cookie });
    const updated = (await (await update({ monthlyQuotaUsd: 10 })).json()) as AdminUserDto;
    expect(updated.monthlyQuotaUsd).toBe(10);
    expect(await errorOf(await update({ monthlyQuotaUsd: -1 }))).toBe('invalid_request');
    expect(await errorOf(await update({ monthlyQuotaUsd: 1000 }))).toBe('invalid_request');
    expect(await errorOf(await update({ monthlyQuotaUsd: 1000 }, anaCookie))).toBe('not_admin');
  });
});

describe('own key', () => {
  const ANA_KEY = 'sk-or-v1-ana-secret-1234';

  test("a person's own key pays for all their calls: no limit for them, nothing counted for the app", async () => {
    const adminCookie = await signIn(ADMIN);
    const { user: ana } = await invite(adminCookie, 'ana@example.com');
    await call(`/api/admin/users/${ana.id}`, { method: 'PATCH', body: { monthlyQuotaUsd: 0 }, cookie: adminCookie });
    const anaCookie = await signIn('ana@example.com');
    expect((await chat(anaCookie, CONVERSATION, [userMessage('m1', 'Bonjour')])).status).toBe(429);

    const saved = (await (await setKey(anaCookie, `  ${ANA_KEY} `)).json()) as OwnKeyResponse;
    expect(saved.key?.hint).toBe('1234');
    const row = await state.database('users').where({ id: ana.id }).first('own_key_sealed');
    expect(row.own_key_sealed).not.toContain('ana-secret');

    state.keysUsed = [];
    expect((await chat(anaCookie, CONVERSATION, [userMessage('m1', 'Bonjour')])).status).toBe(200);
    expect(state.keysUsed.length).toBeGreaterThanOrEqual(2);
    expect(new Set(state.keysUsed)).toEqual(new Set([ANA_KEY]));
    const events = await state.database('usage_events').where({ user_id: ana.id }).select('purpose', 'paid_by_user');
    expect(events.every((event) => event.paid_by_user === 1)).toBe(true);
    expect(await quotaOf(anaCookie)).toMatchObject({ ownKey: true, unlimited: true, exhausted: false });
    const { users } = (await (
      await call('/api/admin/users', { cookie: adminCookie })
    ).json()) as ListAdminUsersResponse;
    expect(users.find((user) => user.id === ana.id)).toMatchObject({
      ownKey: true,
      monthCostUsd: 0,
      monthlyQuotaUsd: 0,
    });

    state.keysUsed = [];
    await chat(adminCookie, 'admin-conversation', [userMessage('m1', 'Bonjour')]);
    expect(new Set(state.keysUsed)).toEqual(new Set([null]));

    expect((await call('/api/own-key', { method: 'DELETE', cookie: anaCookie })).status).toBe(204);
    expect(await (await call('/api/own-key', { cookie: anaCookie })).json()).toEqual({ key: null });
    const history = [...(await open(anaCookie, CONVERSATION)).messages, userMessage('m3', 'Encore ?')];
    expect((await chat(anaCookie, CONVERSATION, history)).status).toBe(429);
  });

  test('a key OpenRouter refuses is not kept, and one it refuses later says so in the conversation', async () => {
    const cookie = await signIn(ADMIN);
    state.keyAccepted = false;
    expect(await errorOf(await setKey(cookie, 'sk-or-v1-wrong'))).toBe('invalid_key');
    state.keyAccepted = null;
    expect(await errorOf(await setKey(cookie, 'sk-or-v1-wrong'))).toBe('key_check_failed');
    expect(await errorOf(await setKey(cookie, 'two words'))).toBe('invalid_request');
    expect(await (await call('/api/own-key', { cookie })).json()).toEqual({ key: null });

    state.keyAccepted = true;
    await setKey(cookie, ANA_KEY);
    state.ownKeyRefused = true;
    const response = await call('/api/chat', {
      method: 'POST',
      body: { id: CONVERSATION, messages: [userMessage('m1', 'Bonjour')] },
      cookie,
    });
    expect(await response.text()).toContain('"errorText":"own_key_refused"');
  });
});
