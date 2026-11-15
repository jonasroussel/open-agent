import { describe, expect, test } from 'bun:test';

import type { ArtifactResponse, ArtifactVersionResponse } from '@open-agent/shared';

import {
  ADMIN,
  advanceMinutes,
  call,
  signIn,
  invite,
  errorOf,
  userMessage,
  chat,
  open,
  CONVERSATION,
  artifactsOf,
  saveArtifact,
  say,
  sharedWithMarie,
  state,
  useApp,
} from './harness.ts';

useApp();

describe('canvas', () => {
  test("the model writes a document, then rewrites its latest version, the user's own edits included", async () => {
    const cookie = await signIn(ADMIN);
    state.scriptedCalls = [
      {
        toolName: 'create_document',
        input: { kind: 'document', title: '# Lettre de résiliation', content: 'Brouillon du modèle' },
      },
    ];
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Écris une lettre de résiliation.')]);
    const [letter] = await artifactsOf(cookie);
    expect(letter).toMatchObject({ title: 'Lettre de résiliation', kind: 'document', version: 1 });
    expect((await saveArtifact(cookie, letter!.id, 'Version corrigée à la main', 1)).status).toBe(200);

    state.scriptedCalls = [
      { toolName: 'update_document', input: { id: letter!.id, content: 'Version finale du modèle' } },
    ];
    const history = [...(await open(cookie, CONVERSATION)).messages, userMessage('m3', 'Ajoute la date.')];
    await chat(cookie, CONVERSATION, history);

    // The second answer's first call: the latest version, the user's, is in the instructions; the draft is gone, and
    // the past call keeps no content the model could copy into a new version.
    const prompt = JSON.stringify(state.models.fast.doStreamCalls[2]!.prompt);
    expect(prompt).toContain('Version corrigée à la main');
    expect(prompt).not.toContain('Brouillon du modèle');
    const pastCall = state.models.fast.doStreamCalls[2]!.prompt.flatMap((message) =>
      message.role === 'assistant' ? message.content : [],
    ).find((part) => part.type === 'tool-call');
    expect(pastCall).toMatchObject({ toolName: 'create_document', input: { kind: 'document' } });
    expect(pastCall).not.toHaveProperty('input.content');
    const opened = (await (await call(`/api/artifacts/${letter!.id}`, { cookie })).json()) as ArtifactResponse;
    expect(opened.content).toBe('Version finale du modèle');
    expect(opened.versions.map(({ number, author }) => [number, author])).toEqual([
      [3, 'model'],
      [2, 'user'],
      [1, 'model'],
    ]);
    const first = (await (
      await call(`/api/artifacts/${letter!.id}/versions/1`, { cookie })
    ).json()) as ArtifactVersionResponse;
    expect(first.content).toBe('Brouillon du modèle');
  });

  test("the user's saves in one sitting make one version, and a save over a newer version is refused", async () => {
    const cookie = await signIn(ADMIN);
    state.scriptedCalls = [{ toolName: 'create_document', input: { kind: 'document', title: 'CV', content: 'v1' } }];
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Fais mon CV.')]);
    const [cv] = await artifactsOf(cookie);

    await saveArtifact(cookie, cv!.id, 'v2, début', 1);
    advanceMinutes(5);
    await saveArtifact(cookie, cv!.id, 'v2, fin', 2);
    expect((await artifactsOf(cookie))[0]!.version).toBe(2);
    advanceMinutes(11);
    await saveArtifact(cookie, cv!.id, 'v3', 2);
    expect((await artifactsOf(cookie))[0]!.version).toBe(3);

    expect(await errorOf(await saveArtifact(cookie, cv!.id, 'écrase', 2))).toBe('artifact_changed');
    const opened = (await (await call(`/api/artifacts/${cv!.id}`, { cookie })).json()) as ArtifactResponse;
    expect(opened.content).toBe('v3');
  });

  test("in a shared conversation, a member's save never overwrites another member's text from the same sitting", async () => {
    const { admin, marie } = await sharedWithMarie();
    state.scriptedCalls = [
      { toolName: 'create_document', input: { kind: 'document', title: 'Lettre', content: 'v1' } },
    ];
    await say(admin, userMessage('m3', 'Écris la lettre au propriétaire.'));
    const [letter] = await artifactsOf(admin);

    expect((await saveArtifact(admin, letter!.id, 'Texte de l’admin', 1)).status).toBe(200);
    advanceMinutes(1);
    expect((await saveArtifact(marie, letter!.id, 'Texte de Marie', 2)).status).toBe(200);
    expect(await errorOf(await saveArtifact(admin, letter!.id, 'Texte de l’admin, suite', 2))).toBe('artifact_changed');

    const opened = (await (await call(`/api/artifacts/${letter!.id}`, { cookie: admin })).json()) as ArtifactResponse;
    expect(opened).toMatchObject({ content: 'Texte de Marie', artifact: { version: 3 } });
    const previous = (await (
      await call(`/api/artifacts/${letter!.id}/versions/2`, { cookie: admin })
    ).json()) as ArtifactVersionResponse;
    expect(previous.content).toBe('Texte de l’admin');
  });

  test('bringing back an old version is a new version the model is told about, so it does not redo what was undone', async () => {
    const cookie = await signIn(ADMIN);
    state.scriptedCalls = [
      { toolName: 'create_document', input: { kind: 'document', title: 'CV', content: 'CV court' } },
    ];
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Fais mon CV.')]);
    const [cv] = await artifactsOf(cookie);
    state.scriptedCalls = [{ toolName: 'update_document', input: { id: cv!.id, content: 'CV long avec loisirs' } }];
    const history = [...(await open(cookie, CONVERSATION)).messages, userMessage('m3', 'Ajoute mes loisirs.')];
    await chat(cookie, CONVERSATION, history);

    const restore = (content: string, restoredFrom: number) =>
      call(`/api/artifacts/${cv!.id}/versions`, {
        method: 'POST',
        body: { content, baseVersion: 2, restoredFrom },
        cookie,
      });
    expect(await errorOf(await restore('autre chose', 1))).toBe('invalid_request');
    expect(await errorOf(await restore('CV court', 2))).toBe('invalid_request');
    expect((await restore('CV court', 1)).status).toBe(200);

    const opened = (await (await call(`/api/artifacts/${cv!.id}`, { cookie })).json()) as ArtifactResponse;
    expect(opened.content).toBe('CV court');
    expect(opened.versions[0]).toMatchObject({ number: 3, author: 'user', restoredFrom: 1 });

    const next = [...(await open(cookie, CONVERSATION)).messages, userMessage('m5', 'Merci.')];
    await chat(cookie, CONVERSATION, next);
    const prompt = state.models.fast.doStreamCalls.at(-1)!.prompt;
    expect(JSON.stringify(prompt)).toContain('version=\\"3\\" restored-from=\\"1\\"');
    expect(JSON.stringify(prompt.at(-1))).toContain('à la version 1, volontairement');
    expect(JSON.stringify(prompt.at(-1))).toContain('Merci.');
  });

  test("a document is only its owner's: nobody else reads it, edits it, or has the model rewrite it", async () => {
    const adminCookie = await signIn(ADMIN);
    state.scriptedCalls = [
      { toolName: 'create_document', input: { kind: 'html', title: 'Jeu', content: '<p>secret</p>' } },
    ];
    await chat(adminCookie, CONVERSATION, [userMessage('m1', 'Fais un jeu.')]);
    const [game] = await artifactsOf(adminCookie);
    await invite(adminCookie, 'ana@example.com');
    const anaCookie = await signIn('ana@example.com');

    expect((await call(`/api/artifacts/${game!.id}`, { cookie: anaCookie })).status).toBe(404);
    expect((await saveArtifact(anaCookie, game!.id, '<p>pirate</p>', 1)).status).toBe(404);
    state.scriptedCalls = [{ toolName: 'update_document', input: { id: game!.id, content: '<p>pirate</p>' } }];
    await chat(anaCookie, 'other-conversation-id', [userMessage('m1', 'Modifie le jeu.')]);

    const opened = (await (
      await call(`/api/artifacts/${game!.id}`, { cookie: adminCookie })
    ).json()) as ArtifactResponse;
    expect(opened).toMatchObject({ content: '<p>secret</p>', artifact: { version: 1 } });
  });
});
