import { describe, expect, test } from 'bun:test';

import type { SearchResponse, UploadFileResponse } from '@open-agent/shared';

import {
  ADMIN,
  ANSWER,
  plainAnalysis,
  PAGE,
  FORECAST,
  FOUND,
  call,
  signIn,
  invite,
  userMessage,
  chat,
  open,
  CONVERSATION,
  textOfMessage,
  toolResults,
  upload,
  say,
  sharedWithMarie,
  state,
  useApp,
} from './harness.ts';

useApp();

const PRIVATE_TOOLS = ['search_conversations', 'read_conversation', 'list_files', 'read_file'];
/** The tools the model was offered at its latest call. */
const toolNames = () => (state.models.fast.doStreamCalls.at(-1)!.tools ?? []).map((tool) => tool.name);
const search = async (cookie: string, text: string) =>
  ((await (await call(`/api/search?q=${encodeURIComponent(text)}`, { cookie })).json()) as SearchResponse).results;

describe('search', () => {
  test("finds the user's own conversations by the start of words, accents aside, and follows edits", async () => {
    const cookie = await signIn(ADMIN);
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Ma Freebox ne capte plus, été comme hiver.')]);
    const [found] = await search(cookie, 'freeb ete');
    expect(found?.conversation.id).toBe(CONVERSATION);
    expect(found?.snippet.filter((part) => part.match).map((part) => part.text)).toEqual(['Freebox', 'été']);
    expect(await search(cookie, 'freebox télé')).toEqual([]);
    expect(await search(cookie, '   ')).toEqual([]);

    await invite(cookie, 'ana@example.com');
    expect(await search(await signIn('ana@example.com'), 'freebox')).toEqual([]);

    await chat(cookie, CONVERSATION, [userMessage('m1', 'Bonjour')]);
    expect(await search(cookie, 'freebox')).toEqual([]);
    expect((await call(`/api/search?q=${'a'.repeat(201)}`, { cookie })).status).toBe(400);
  });
});

describe('context tools', () => {
  test("the model looks up the user's other conversations, their files and a page they named, and knows the time", async () => {
    const cookie = await signIn(ADMIN);
    await chat(cookie, 'other-conversation-id', [userMessage('m1', 'Le code du portail de la Freebox est 4721.')]);
    const notes = (await (
      await upload(cookie, 'notes.txt', 'text/plain', 'Rendez-vous chez le notaire le 12.')
    ).json()) as UploadFileResponse;
    state.scriptedCalls = [
      { toolName: 'search_conversations', input: { query: 'freebox portail' } },
      { toolName: 'read_conversation', input: { id: 'other-conversation-id' } },
      { toolName: 'list_files', input: {} },
      { toolName: 'read_file', input: { id: notes.file.id } },
      { toolName: 'read_web_page', input: { url: PAGE.url } },
    ];
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Rappelle-moi tout ça.')]);

    const [found, read, listed, file, page] = await toolResults(cookie);
    expect(found).toMatchObject({
      tool: 'search_conversations',
      output: { results: [{ id: 'other-conversation-id' }] },
    });
    expect(read!.output).toMatchObject({ id: 'other-conversation-id', shortened: false });
    expect(JSON.stringify(read!.output)).toContain('User: Le code du portail de la Freebox est 4721.');
    expect(listed!.output).toMatchObject({ files: [{ id: notes.file.id, name: 'notes.txt', kind: 'text' }] });
    expect(file!.output).toEqual({
      id: notes.file.id,
      name: 'notes.txt',
      text: 'Rendez-vous chez le notaire le 12.',
      hasPictures: false,
    });
    expect(page!.output).toEqual({ ...PAGE, shortened: false });

    // The second answer's first call: the time opens the user's message, for the model only.
    const lastMessage = JSON.stringify(state.models.fast.doStreamCalls[1]!.prompt.at(-1));
    expect(lastMessage).toContain(
      '[Maintenant : dimanche 1 novembre 2026 à 11:00, heure de Paris. Demain : lundi 2 novembre.]',
    );
    expect(lastMessage).toContain('Rappelle-moi tout ça.');
    expect(textOfMessage((await open(cookie, CONVERSATION)).messages[1]!)).toBe(ANSWER);
  });

  test("weather, exact calculations and dates come from the server, not the model's guess", async () => {
    const cookie = await signIn(ADMIN);
    state.scriptedCalls = [
      { toolName: 'weather', input: { place: 'Nantes', days: 1 } },
      { toolName: 'calculate', input: { expression: '1250 * 1.2 - 300' } },
      { toolName: 'days_between', input: { from: '2026-11-01', to: '2026-12-25' } },
      { toolName: 'date_plus_days', input: { date: '2026-11-01', days: 45 } },
    ];
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Météo, budget et dates ?')]);

    expect((await toolResults(cookie)).map(({ output }) => output)).toEqual([
      FORECAST,
      { expression: '1250 * 1.2 - 300', result: '1200' },
      { from: '2026-11-01', to: '2026-12-25', days: 54, fromWeekday: 'Sunday', toWeekday: 'Friday' },
      { date: '2026-11-01', days: 45, result: '2026-12-16', weekday: 'Wednesday' },
    ]);
  });

  test("someone else's conversation or file stays out of reach, and every failure reaches the model to say so", async () => {
    const adminCookie = await signIn(ADMIN);
    await invite(adminCookie, 'ana@example.com');
    const anaCookie = await signIn('ana@example.com');
    await chat(anaCookie, 'ana-conversation-id', [userMessage('m1', 'Mon secret.')]);
    const anaFile = (await (
      await upload(anaCookie, 'secret.txt', 'text/plain', 'Secret.')
    ).json()) as UploadFileResponse;
    state.scriptedCalls = [
      { toolName: 'read_conversation', input: { id: 'ana-conversation-id' } },
      { toolName: 'read_file', input: { id: anaFile.file.id } },
      { toolName: 'read_conversation', input: { id: CONVERSATION } },
      { toolName: 'weather', input: { place: 'Atlantis', days: 1 } },
      { toolName: 'calculate', input: { expression: '7 / 0' } },
    ];
    await chat(adminCookie, CONVERSATION, [userMessage('m1', 'Lis tout.')]);

    const results = await toolResults(adminCookie);
    expect(results.map(({ output }) => output)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(results.map(({ error }) => error)).toEqual([
      'No conversation with this id.',
      'No file with this id in the library.',
      'This is the current conversation: you already have it.',
      'No place named "Atlantis" was found.',
      'The result is not a number (a division by zero?).',
    ]);
    expect(JSON.stringify(await open(adminCookie, CONVERSATION))).not.toContain('Secret');
  });

  test("in a shared conversation, the model cannot look into the sender's other conversations or library", async () => {
    const { admin } = await sharedWithMarie();
    expect(toolNames()).toEqual(expect.arrayContaining(PRIVATE_TOOLS));

    await say(admin, userMessage('m3', 'Et le devis du plombier ?'));
    expect(toolNames().filter((name) => PRIVATE_TOOLS.includes(name))).toEqual([]);
    expect(toolNames()).toEqual(expect.arrayContaining(['read_web_page', 'weather', 'calculate']));
  });
});
describe('web search', () => {
  test('a request about current facts is answered from a web search, shown with its sources, and every step is counted', async () => {
    const cookie = await signIn(ADMIN);
    state.analysis = plainAnalysis({ webSearch: true });
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Combien coûte le gazole aujourd’hui ?')]);

    expect(state.searches).toEqual([{ query: 'prix gazole France', recent: true, locale: 'fr' }]);
    expect(JSON.stringify(state.models.fast.doStreamCalls[1]!.prompt)).toContain(FOUND.content);
    const { messages } = await open(cookie, CONVERSATION);
    expect(messages[1]!.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-web_search', state: 'output-available', output: { results: [FOUND] } }),
    );
    expect(textOfMessage(messages[1]!)).toBe(ANSWER);

    const costs = await state
      .database('usage_events')
      .whereIn('purpose', ['answer', 'web_search'])
      .select('purpose', 'model', 'cost_usd')
      .orderBy('id');
    expect(costs).toEqual([
      { purpose: 'web_search', model: 'tavily', cost_usd: 0 },
      { purpose: 'answer', model: 'fast-model', cost_usd: 0.0004 },
      { purpose: 'answer', model: 'fast-model', cost_usd: 0.0004 },
    ]);
  });

  test('when the search fails, the answer still comes and the failed search shows', async () => {
    const cookie = await signIn(ADMIN);
    state.analysis = plainAnalysis({ webSearch: true });
    state.searchDown = true;
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Combien coûte le gazole aujourd’hui ?')]);

    const { messages } = await open(cookie, CONVERSATION);
    expect(messages[1]!.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-web_search', state: 'output-error' }),
    );
    expect(textOfMessage(messages[1]!)).toBe(ANSWER);
  });
});
