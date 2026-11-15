import { describe, expect, test } from 'bun:test';

import type { ChatMessage, UploadFileResponse, MadeFileOutput } from '@open-agent/shared';
import type { UIMessage } from 'ai';

import {
  ADMIN,
  DRAWN,
  accept,
  call,
  signIn,
  invite,
  errorOf,
  userMessage,
  chat,
  open,
  CONVERSATION,
  say,
  share,
  sharedWithMarie,
  toolResults,
  upload,
  withFile,
  withMarie,
  state,
  useApp,
} from './harness.ts';

useApp();

describe('making tools', () => {
  test("an image drawn from the user's attached photo lands in their library, in the shape asked, and is billed", async () => {
    const cookie = await signIn(ADMIN);
    const photo = (await (await upload(cookie, 'chat.png', 'image/png', DRAWN)).json()) as UploadFileResponse;
    state.scriptedCalls = [
      {
        toolName: 'generate_image',
        input: {
          prompt: 'The same cat with a red Christmas hat',
          aspect: '9:16',
          fileName: 'Chat de Noël',
          sourceImageIds: [photo.file.id],
        },
      },
    ];
    const message: ChatMessage = {
      id: 'm1',
      role: 'user',
      parts: [
        { type: 'file', mediaType: 'image/png', filename: 'chat.png', url: photo.file.url },
        { type: 'text', text: 'Mets-lui un bonnet de Noël.' },
      ],
    };
    await chat(cookie, CONVERSATION, [message]);

    // The model sees the id of what is attached, to draw from it.
    expect(JSON.stringify(state.models.fast.doStreamCalls[0]!.prompt)).toContain(`<file id=\\"${photo.file.id}\\"`);
    const [made] = await toolResults(cookie);
    const output = made!.output as MadeFileOutput;
    expect(output).toMatchObject({ name: 'Chat de Noël.png', kind: 'image', mediaType: 'image/png' });
    expect(new Uint8Array(await (await call(`/api/files/${output.id}`, { cookie })).arrayBuffer())).toEqual(DRAWN);

    const [drawing] = state.models.image.doGenerateCalls;
    expect(drawing!.providerOptions).toEqual({ openrouter: { image_config: { aspect_ratio: '9:16' } } });
    const content = drawing!.prompt.at(-1)!.content;
    expect(content).toContainEqual(expect.objectContaining({ type: 'file', mediaType: 'image/png' }));
    expect(content).toContainEqual({ type: 'text', text: 'The same cat with a red Christmas hat' });
    const billed = await state.database('usage_events').where({ purpose: 'image' }).select('model', 'cost_usd');
    expect(billed).toEqual([{ model: 'image-model', cost_usd: 0.0336 }]);
  });

  test('Excel, PDF, chart and QR code files are made on the server, kept in the library, and readable later', async () => {
    const cookie = await signIn(ADMIN);
    const photo = (await (await upload(cookie, 'logo.png', 'image/png', DRAWN)).json()) as UploadFileResponse;
    state.pdfPages = [{ text: 'Attestation', image: DRAWN }];
    state.scriptedCalls = [
      {
        toolName: 'create_spreadsheet',
        input: {
          fileName: 'Budget.xlsx',
          sheets: [
            {
              name: 'Budget',
              columns: [{ header: 'Poste' }, { header: 'Montant', format: 'euro' }],
              rows: [
                ['Loyer', 750],
                ['Total', '=SUM(B2:B2)'],
              ],
            },
          ],
        },
      },
      {
        toolName: 'create_pdf',
        input: { fileName: 'Attestation', markdown: `# Attestation\n\n![Logo](${photo.file.id})` },
      },
      {
        toolName: 'create_chart',
        input: {
          fileName: 'Dépenses',
          spec: {
            data: { values: [{ poste: 'Loyer', montant: 750 }] },
            mark: 'bar',
            encoding: { x: { field: 'poste', type: 'nominal' }, y: { field: 'montant', type: 'quantitative' } },
          },
        },
      },
      { toolName: 'create_qr_code', input: { fileName: 'Wi-Fi', text: 'WIFI:T:WPA;S:Maison;P:secret;;' } },
    ];
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Fais-moi tout ça.')]);

    const outputs = (await toolResults(cookie)).map(({ output }) => output as MadeFileOutput);
    expect(outputs.map(({ name, kind }) => [name, kind])).toEqual([
      ['Budget.xlsx', 'spreadsheet'],
      ['Attestation.pdf', 'pdf'],
      ['Dépenses.png', 'image'],
      ['Wi-Fi.png', 'image'],
    ]);
    const starts = await Promise.all(
      outputs.map(async ({ id }) => {
        const bytes = new Uint8Array(await (await call(`/api/files/${id}`, { cookie })).arrayBuffer());
        return new TextDecoder().decode(bytes.slice(0, 4));
      }),
    );
    expect(starts).toEqual(['PK\u0003\u0004', '%PDF', '\uFFFDPNG', '\uFFFDPNG']);

    state.scriptedCalls = [{ toolName: 'read_file', input: { id: outputs[0]!.id } }];
    await chat(cookie, 'second-conversation-id', [userMessage('m1', 'Relis le budget.')]);
    const [read] = await toolResults(cookie, 'second-conversation-id');
    expect(read!.output).toMatchObject({ name: 'Budget.xlsx', text: expect.stringContaining('=SUM(B2:B2)') });
  });

  test('what cannot be made reaches the model to say why, and an answer draws two images at most', async () => {
    const cookie = await signIn(ADMIN);
    const notes = (await (await upload(cookie, 'notes.txt', 'text/plain', 'Notes.')).json()) as UploadFileResponse;
    const draw = { prompt: 'A lighthouse', aspect: '16:9', fileName: 'Phare' };
    state.scriptedCalls = [
      { toolName: 'generate_image', input: { ...draw, sourceImageIds: [notes.file.id] } },
      { toolName: 'create_pdf', input: { fileName: 'Lettre', markdown: '![Logo](unknown-id)' } },
      {
        toolName: 'create_chart',
        input: { fileName: 'Courbe', spec: { data: { url: 'http://169.254.169.254/latest' }, mark: 'line' } },
      },
      // As DeepSeek did once: a call without its fields.
      { toolName: 'create_spreadsheet', input: {} },
    ];
    state.imageDraws = false;
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Essaie.')]);
    expect((await toolResults(cookie)).map(({ error }) => error)).toEqual([
      '"notes.txt" is not a JPEG, PNG or WebP picture: the image model cannot use it.',
      'No image with the id "unknown-id" in the user\'s library.',
      expect.stringContaining('takes its data inline (data.values): no URL'),
      expect.stringContaining('Invalid input for tool create_spreadsheet'),
    ]);

    state.scriptedCalls = [
      { toolName: 'generate_image', input: draw },
      { toolName: 'generate_image', input: draw },
      { toolName: 'generate_image', input: draw },
    ];
    await chat(cookie, 'second-conversation-id', [userMessage('m1', 'Trois phares.')]);
    expect((await toolResults(cookie, 'second-conversation-id')).map(({ error }) => error)).toEqual([
      'The image model drew nothing, saying: I cannot draw real people.',
      'The image model drew nothing, saying: I cannot draw real people.',
      'No more generate_image in this answer: tell the user to ask again for more.',
    ]);
  });
});

/** The pictures of a model call: each one is something the model sees, not just reads about. */
const picturesSent = (prompt: unknown) =>
  (prompt as { role: string; content: string | { type: string; mediaType?: string }[] }[])
    .flatMap((message) => (typeof message.content === 'string' ? [] : message.content))
    .filter((part) => part.type === 'file' && part.mediaType === 'image/jpeg').length;

async function uploaded(cookie: string, name: string, type: string, bytes: Uint8Array | string) {
  return ((await (await upload(cookie, name, type, bytes)).json()) as UploadFileResponse).file;
}

/** A request again for what the browser keeps under `etag`, as it does with `cache-control: no-cache`. */
function revalidate(url: string, etag: string, cookie?: string) {
  return fetch(new URL(url, state.server.url), { headers: { 'if-none-match': etag, ...(cookie ? { cookie } : {}) } });
}

describe('files', () => {
  test('a PDF reaches the model whole, text and picture of every page, at every answer', async () => {
    const cookie = await signIn(ADMIN);
    state.pdfPages = [
      { text: 'Facture 2026-114, total 89 €', image: new Uint8Array([0xff, 0xd8, 1]) },
      { text: '', image: new Uint8Array([0xff, 0xd8, 2]) },
    ];
    const response = await upload(cookie, 'facture.pdf', 'application/pdf', '%PDF-1.7 fake');
    expect(response.status).toBe(201);
    const { file } = (await response.json()) as UploadFileResponse;
    expect(file).toMatchObject({ name: 'facture.pdf', kind: 'pdf', mediaType: 'application/pdf' });
    // "My files" shows a PDF by its first page.
    const preview = await call(file.previewUrl!, { cookie });
    expect([...new Uint8Array(await preview.arrayBuffer())]).toEqual([0xff, 0xd8, 1]);

    await chat(cookie, CONVERSATION, [withFile('m1', 'Le total est bon ?', file)]);
    const history = [...(await open(cookie, CONVERSATION)).messages, userMessage('m3', 'Et la date ?')];
    await chat(cookie, CONVERSATION, history);

    for (const answer of state.models.fast.doStreamCalls) {
      const prompt = JSON.stringify(answer.prompt);
      expect(prompt).toContain('Facture 2026-114, total 89 €');
      expect(prompt).toContain('Page 2 of 2');
      expect(picturesSent(answer.prompt)).toBe(2);
    }
    const preAnalysis = state.models.background.doGenerateCalls.find((generation) =>
      JSON.stringify(generation.prompt).includes('Dernier message de l'),
    );
    expect(JSON.stringify(preAnalysis!.prompt)).toContain('[Pièces jointes : facture.pdf]');
  });

  test('a file is only for its owner: anyone else neither opens it nor attaches it to a message', async () => {
    const adminCookie = await signIn(ADMIN);
    await invite(adminCookie, 'ana@example.com');
    const anaCookie = await signIn('ana@example.com');
    const { file } = (await (
      await upload(adminCookie, 'notes.txt', 'text/plain', 'Code du portail : 4721')
    ).json()) as UploadFileResponse;

    const opened = await call(file.url, { cookie: adminCookie });
    expect(await opened.text()).toBe('Code du portail : 4721');
    expect(opened.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await call(file.url, { cookie: anaCookie })).status).toBe(404);

    expect((await chat(anaCookie, CONVERSATION, [withFile('m1', 'Que dit ce fichier ?', file)])).status).toBe(400);
    expect(state.models.fast.doStreamCalls).toHaveLength(0);
  });

  test('a deleted file leaves the conversations, which then tell the model it is gone', async () => {
    const cookie = await signIn(ADMIN);
    const { file } = (await (
      await upload(cookie, 'notes.txt', 'text/plain', 'Code du portail : 4721')
    ).json()) as UploadFileResponse;
    await chat(cookie, CONVERSATION, [withFile('m1', 'Garde ça en tête.', file)]);

    expect((await call(file.url, { method: 'DELETE', cookie })).status).toBe(204);
    expect((await (await call('/api/files', { cookie })).json()) as unknown).toEqual({ files: [] });
    const history = [...(await open(cookie, CONVERSATION)).messages, userMessage('m3', 'Quel est le code ?')];
    await chat(cookie, CONVERSATION, history);
    const prompt = JSON.stringify(state.models.fast.doStreamCalls[1]!.prompt);
    expect(prompt).not.toContain('4721');
    expect(prompt).toContain('« notes.txt » a été supprimé de la bibliothèque');
  });

  test('what cannot be read whole is refused at upload, never read in part', async () => {
    const cookie = await signIn(ADMIN);
    expect(await errorOf(await upload(cookie, 'page.html', 'text/html', '<p>hi</p>'))).toBe('file_type_unsupported');
    expect(await errorOf(await upload(cookie, 'big.txt', 'text/plain', new Uint8Array(21 * 1024 * 1024)))).toBe(
      'file_too_large',
    );
    expect(await errorOf(await upload(cookie, 'long.txt', 'text/plain', 'mot '.repeat(500_000)))).toBe('file_too_long');
    state.pdfPages = null;
    expect(await errorOf(await upload(cookie, 'locked.pdf', 'application/pdf', '%PDF'))).toBe('file_unreadable');
    expect((await (await call('/api/files', { cookie })).json()) as unknown).toEqual({ files: [] });
  });

  test('a message may only attach files of the library', async () => {
    const cookie = await signIn(ADMIN);
    const forged: UIMessage = {
      id: 'm1',
      role: 'user',
      parts: [
        { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,iVBORw0KGgo=' },
        { type: 'text', text: 'Regarde' },
      ],
    };
    expect((await chat(cookie, CONVERSATION, [forged])).status).toBe(400);
  });

  test('once a conversation is shared, the files the model listed, read or drew from stay their owner’s; those attached or made there open for all', async () => {
    const { admin, marie, marieId } = await withMarie();
    const cv = await uploaded(admin, 'cv.txt', 'text/plain', 'Jean Dupont, comptable');
    const holiday = await uploaded(admin, 'vacances.png', 'image/png', DRAWN);
    const leak = await uploaded(admin, 'fuite.png', 'image/png', DRAWN);
    state.scriptedCalls = [
      { toolName: 'list_files', input: {} },
      { toolName: 'read_file', input: { id: cv.id } },
    ];
    await say(admin, userMessage('m3', 'Reprends mon CV de mes fichiers.'));
    expect((await toolResults(admin)).map(({ error }) => error)).toEqual([undefined, undefined]);
    expect((await share(admin, [marieId])).status).toBe(204);
    expect((await accept(marie)).status).toBe(204);

    state.scriptedCalls = [
      {
        toolName: 'generate_image',
        input: { prompt: 'A leaking pipe', aspect: '16:9', fileName: 'Fuite', sourceImageIds: [holiday.id] },
      },
    ];
    await say(admin, withFile('m5', 'Dessine la fuite.', leak));

    expect(JSON.stringify((await open(marie, CONVERSATION)).messages)).toContain(cv.id);
    const made = (await toolResults(admin))[0]!.output as MadeFileOutput;
    const status = async (id: string) => (await call(`/api/files/${id}`, { cookie: marie })).status;
    expect(await Promise.all([cv.id, holiday.id, leak.id, made.id].map(status))).toEqual([404, 404, 200, 200]);
  });

  test("a member may not attach someone else's file until it was sent in the conversation", async () => {
    const { admin, marie } = await sharedWithMarie();
    const notes = await uploaded(admin, 'notes.txt', 'text/plain', 'Code du portail : 4721');
    expect((await say(marie, withFile('m3', 'Que dit ce fichier ?', notes))).status).toBe(400);
    expect(JSON.stringify(state.models.fast.doStreamCalls)).not.toContain('4721');

    await say(admin, withFile('m3', 'Voici mes notes.', notes));
    expect((await say(marie, withFile('m5', 'Quel est le code ?', notes))).status).toBe(200);
  });

  test('a file opened before is asked again at each use: unchanged it is not sent again, and gone after sign-out or deletion', async () => {
    const cookie = await signIn(ADMIN);
    const other = await signIn(ADMIN);
    state.pdfPages = [{ text: 'Facture', image: new Uint8Array([0xff, 0xd8, 1]) }];
    const file = await uploaded(cookie, 'facture.pdf', 'application/pdf', '%PDF-1.7 fake');
    const opened = await Promise.all([file.url, file.previewUrl!].map((url) => call(url, { cookie })));
    // Without `no-cache`, the browser would show its copy without asking.
    expect(opened.map((response) => response.headers.get('cache-control'))).toEqual([
      'private, no-cache',
      'private, no-cache',
    ]);
    const [fileTag, previewTag] = opened.map((response) => response.headers.get('etag')!);

    expect((await revalidate(file.url, fileTag!, cookie)).status).toBe(304);
    expect((await revalidate(file.previewUrl!, previewTag!, cookie)).status).toBe(304);
    // Each has its own tag: the browser never shows the preview for the file.
    expect((await revalidate(file.url, previewTag!, cookie)).status).toBe(200);

    expect((await call('/api/session', { method: 'DELETE', cookie: other })).status).toBe(204);
    expect((await revalidate(file.url, fileTag!, other)).status).toBe(401);
    expect((await call(file.url, { method: 'DELETE', cookie })).status).toBe(204);
    expect((await revalidate(file.url, fileTag!, cookie)).status).toBe(404);
    expect((await revalidate(file.previewUrl!, previewTag!, cookie)).status).toBe(404);
  });
});
