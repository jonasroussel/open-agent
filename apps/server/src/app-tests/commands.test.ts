import { describe, expect, test } from 'bun:test';

import type { ChatMessage, CommandDto, ListCommandsResponse } from '@open-agent/shared';

import {
  ADMIN,
  call,
  signIn,
  invite,
  errorOf,
  userMessage,
  chat,
  open,
  CONVERSATION,
  textOfMessage,
  prePasses,
  plainAnalysis,
  say,
  sharedWithMarie,
  toolResults,
  state,
  useApp,
} from './harness.ts';

useApp();

const ranCommand = (id: string, command: CommandDto, text: string): ChatMessage => ({
  id,
  role: 'user',
  metadata: { command: { id: command.id, name: command.name } },
  parts: [{ type: 'text', text }],
});
const addCommand = (cookie: string, name: string, prompt: string) =>
  call('/api/commands', { method: 'POST', body: { name, prompt }, cookie });
const listCommands = async (cookie: string) =>
  ((await (await call('/api/commands', { cookie })).json()) as ListCommandsResponse).commands;

const orderOf = async (cookie: string) => (await listCommands(cookie)).map((command) => command.name);

describe('commands', () => {
  test('a user keeps their own commands under names they can type after a slash', async () => {
    const cookie = await signIn(ADMIN);
    const created = (await (await addCommand(cookie, '/Corriger', 'Corrige les fautes.')).json()) as CommandDto;
    expect(created).toMatchObject({ name: 'corriger', prompt: 'Corrige les fautes.', uses: 0 });

    expect(await errorOf(await addCommand(cookie, 'corriger', 'Autre chose.'))).toBe('command_name_taken');
    expect(await errorOf(await addCommand(cookie, '3 points', 'Résume.'))).toBe('invalid_request');
    expect(await errorOf(await addCommand(cookie, 'resumer', '   '))).toBe('invalid_request');

    const renamed = await call(`/api/commands/${created.id}`, {
      method: 'PATCH',
      body: { name: 'orthographe', prompt: 'Corrige les fautes, sans changer le style.' },
      cookie,
    });
    expect(await renamed.json()).toMatchObject({
      name: 'orthographe',
      prompt: 'Corrige les fautes, sans changer le style.',
    });

    await invite(cookie, 'ana@example.com');
    const ana = await signIn('ana@example.com');
    expect(await listCommands(ana)).toEqual([]);
    expect((await call(`/api/commands/${created.id}`, { method: 'DELETE', cookie: ana })).status).toBe(404);
    expect((await call(`/api/commands/${created.id}`, { method: 'DELETE', cookie })).status).toBe(204);
    expect(await listCommands(cookie)).toEqual([]);
  });

  test('a new command comes first, and the user orders them as they like', async () => {
    const cookie = await signIn(ADMIN);
    const ids: Record<string, string> = {};
    for (const name of ['corriger', 'resumer', 'traduire']) {
      ids[name] = ((await (await addCommand(cookie, name, 'Fais-le.')).json()) as CommandDto).id;
    }
    expect(await orderOf(cookie)).toEqual(['traduire', 'resumer', 'corriger']);

    const reorder = (body: unknown, as = cookie) => call('/api/commands/order', { method: 'PUT', body, cookie: as });
    expect((await reorder({ ids: [ids.corriger, ids.traduire, ids.resumer] })).status).toBe(204);
    expect(await orderOf(cookie)).toEqual(['corriger', 'traduire', 'resumer']);

    // Every command once, and only the user's own: anything else would lose or duplicate one.
    expect((await reorder({ ids: [ids.corriger, ids.traduire] })).status).toBe(400);
    expect((await reorder({ ids: [ids.corriger, ids.corriger, ids.resumer] })).status).toBe(400);
    await invite(cookie, 'ana@example.com');
    const ana = await signIn('ana@example.com');
    await addCommand(ana, 'poli', 'Rends-le poli.');
    expect((await reorder({ ids: [ids.corriger] }, ana)).status).toBe(400);

    await addCommand(cookie, 'plus-court', 'Raccourcis.');
    expect(await orderOf(cookie)).toEqual(['plus-court', 'corriger', 'traduire', 'resumer']);
  });

  test("a message running a command gives the model the command's prompt, while the conversation keeps the badge", async () => {
    const cookie = await signIn(ADMIN);
    const command = (await (await addCommand(cookie, 'corriger', 'Corrige les fautes du texte.')).json()) as CommandDto;
    const ran = ranCommand('m1', command, 'Je suis aller au marcher.');
    await chat(cookie, CONVERSATION, [ran]);

    const sent = JSON.stringify(state.models.fast.doStreamCalls[0]!.prompt.at(-1));
    expect(sent).toContain('Corrige les fautes du texte.');
    expect(sent.indexOf('Corrige les fautes du texte.')).toBeLessThan(sent.indexOf('Je suis aller au marcher.'));
    expect(prePasses().at(-1)).toContain('Corrige les fautes du texte.');

    const { messages } = await open(cookie, CONVERSATION);
    expect(messages[0]!.metadata).toEqual({
      command: { id: command.id, name: 'corriger' },
      author: { id: 1, name: 'admin', email: ADMIN },
    });
    expect(textOfMessage(messages[0]!)).toBe('Je suis aller au marcher.');
    expect((await listCommands(cookie))[0]!.uses).toBe(1);

    // Deleted since: the old message still reads, said as such.
    await call(`/api/commands/${command.id}`, { method: 'DELETE', cookie });
    await chat(cookie, CONVERSATION, [...messages, userMessage('m3', 'Merci.')]);
    expect(JSON.stringify(state.models.fast.doStreamCalls.at(-1)!.prompt)).toContain('/corriger, supprimée depuis');
  });

  test("a rewritten request keeps the command's prompt before it", async () => {
    const cookie = await signIn(ADMIN);
    const command = (await (await addCommand(cookie, 'corriger', 'Corrige les fautes du texte.')).json()) as CommandDto;
    const rewritten = 'Corrige la phrase « je suis aller au marcher ».';
    state.analysis = plainAnalysis({ rewrittenRequest: rewritten });
    await chat(cookie, CONVERSATION, [ranCommand('m1', command, 'je suis aller au marcher')]);

    const sent = JSON.stringify(state.models.fast.doStreamCalls[0]!.prompt.at(-1));
    expect(sent).toContain('Corrige les fautes du texte.');
    expect(sent.indexOf('Corrige les fautes du texte.')).toBeLessThan(sent.indexOf(rewritten));
  });

  test("in a shared conversation, each message runs its own writer's command", async () => {
    const { admin, marie } = await sharedWithMarie();
    const command = (await (await addCommand(admin, 'corriger', 'Corrige les fautes du texte.')).json()) as CommandDto;
    await say(admin, ranCommand('m3', command, 'je suis aller au marcher'));
    await say(marie, userMessage('m5', 'Merci !'));

    const prompt = JSON.stringify(state.models.fast.doStreamCalls.at(-1)!.prompt);
    expect(prompt).toContain('Corrige les fautes du texte.');
    expect(prompt).not.toContain('supprimée depuis');
  });

  test('the model saves a command from the request, and rewrites it by its name', async () => {
    const cookie = await signIn(ADMIN);
    state.scriptedCalls = [{ toolName: 'save_command', input: { name: 'Corriger', prompt: 'Corrige les fautes.' } }];
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Fais-moi une commande pour corriger mes textes.')]);
    state.scriptedCalls = [
      { toolName: 'save_command', input: { name: 'corriger', prompt: 'Corrige les fautes, garde le style.' } },
      { toolName: 'save_command', input: { name: '!!!', prompt: 'x' } },
    ];
    await chat(cookie, 'second-conversation-id', [userMessage('m1', 'Change ma commande corriger.')]);

    const [created] = await toolResults(cookie);
    const [rewritten, refused] = await toolResults(cookie, 'second-conversation-id');
    expect(created!.output).toMatchObject({ name: 'corriger', created: true });
    expect(rewritten!.output).toMatchObject({ name: 'corriger', created: false });
    expect(refused!.error).toContain('lowercase letters');
    expect((await listCommands(cookie)).map(({ name, prompt }) => ({ name, prompt }))).toEqual([
      { name: 'corriger', prompt: 'Corrige les fautes, garde le style.' },
    ]);
    // The model knows the names, to rewrite one when asked.
    expect(state.models.fast.doStreamCalls.at(-1)!.prompt[0]!.content).toContain('/corriger');
  });
});
