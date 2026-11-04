import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  ApiError,
  ChatMessage,
  ChangeEvent,
  ArtifactDto,
  ArtifactResponse,
  ArtifactVersionResponse,
  ListArtifactsResponse,
  ConversationDto,
  ConversationResponse,
  InviteUserResponse,
  ListAdminUsersResponse,
  AdminUserDto,
  QuotaResponse,
  OwnKeyResponse,
  RememberMessageResponse,
  SearchResponse,
  AdminSettingsResponse,
  ModelCapability,
  UploadFileResponse,
  ListConversationsResponse,
  ListMemoryRulesResponse,
  SessionResponse,
  ModelRole,
  MadeFileOutput,
  CommandDto,
  ListCommandsResponse,
} from '@open-agent/shared';
import { APICallError, simulateReadableStream, type UIMessage } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { Knex } from 'knex';

import { createApp } from './app.ts';
import { PageUnavailable, PlaceNotFound } from './application/ports/context-services.ts';
import { UnreadableDocument, type PdfPage } from './application/ports/document-reader.ts';
import type { SignInEmail } from './application/ports/mailer.ts';
import type { ModelCatalog, ModelInfo } from './application/ports/model-catalog.ts';
import type { WebSearchRequest } from './application/ports/web-search.ts';
import { AesSecretBox } from './infrastructure/crypto/aes-secret-box.ts';
import { createDatabase } from './infrastructure/database/connection.ts';
import { DiskFileStore } from './infrastructure/files/disk-file-store.ts';
import { OpenRouterModelCatalog } from './infrastructure/llm/openrouter-model-catalog.ts';

const ADMIN = 'admin@example.com';
const PUBLIC_URL = 'https://open-agent.example.com';
/** The development code; `config.ts` sets it to `null` in production. */
const DEV_CODE = '424242';
const DEFAULT_QUOTA = 5;

let database: Knex;
let server: Bun.Server<undefined>;
let sent: SignInEmail[];
let mailerDown: boolean;
const clock = { at: new Date('2026-11-01T10:00:00Z'), now: () => clock.at };
const advanceMinutes = (minutes: number) => (clock.at = new Date(clock.at.getTime() + minutes * 60_000));

const usage = {
  inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 8, text: 8, reasoning: undefined },
};
const ANSWER = 'Voici une lettre de résiliation.';

type Analysis = {
  route: string;
  clarifyingQuestion: string | null;
  clarifyingOptions: string[];
  rewrittenRequest: string | null;
  feedback: string | null;
  webSearch: boolean;
};
const plainAnalysis = (overrides: Partial<Analysis> = {}): Analysis => ({
  route: 'fast',
  clarifyingQuestion: null,
  clarifyingOptions: [],
  rewrittenRequest: null,
  feedback: null,
  webSearch: false,
  ...overrides,
});

/** What the pre-analysis answers in the current test; `null`: the call fails. */
let analysis: Analysis | null;
/** What the memory reconciler answers in the current test. */
let reconciliation: { operation: string; ruleId: number | null; text: string | null };
let models: Record<ModelRole, MockLanguageModelV4>;
/** The image model draws `DRAWN`; `false`: it only answers words, as when it declines. */
let imageDraws: boolean;
/** One white pixel: a real PNG, which a PDF can show. */
const DRAWN = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);
/** The searches the model made in the current test; `searchDown`: the search service fails. */
let searches: WebSearchRequest[];
let searchDown: boolean;
/** The own key each model call used, `null` for the app's; `keyAccepted`: what OpenRouter says of a key, `null`: down. */
let keysUsed: (string | null)[];
let keyAccepted: boolean | null;
/** OpenRouter refuses the users' own keys during the answer. */
let ownKeyRefused: boolean;
/** The one page the fake web answers, and the one town the fake weather knows. */
const PAGE = {
  url: 'https://example.org/bail',
  title: 'Le bail',
  text: 'Le préavis est de 3 mois, 1 mois en zone tendue.',
};
const FORECAST = {
  place: 'Nantes, Pays de la Loire, France',
  now: { sky: 'light rain', temperatureC: 9, feelsLikeC: 6, windKmh: 20 },
  days: [{ date: '2026-11-01', sky: 'light rain', minC: 6, maxC: 12, rainChance: 80, rainMm: 4 }],
};
const FOUND = {
  title: 'Prix des carburants',
  url: 'https://www.prix-carburants.gouv.fr/',
  content: 'Gazole : 1,62 € le litre en moyenne au 1er novembre 2026.',
  publishedAt: '2026-11-01',
};

/** Tool calls the fast model makes before it answers, one per call, in order: as a model deciding to use the canvas. */
let scriptedCalls: { toolName: string; input: unknown }[];

/** Answers, or calls a tool first: the search when it must, or the next scripted call. */
function answeringModel(cost: number) {
  return new MockLanguageModelV4({
    doStream: async (options) => {
      const scripted =
        options.toolChoice?.type === 'required'
          ? { toolName: 'web_search', input: { query: 'prix gazole France', recent: true } }
          : scriptedCalls.shift();
      return {
        stream: simulateReadableStream({
          chunks: [
            ...(scripted
              ? [
                  {
                    type: 'tool-call' as const,
                    toolCallId: `call-${crypto.randomUUID()}`,
                    toolName: scripted.toolName,
                    input: JSON.stringify(scripted.input),
                  },
                ]
              : [
                  { type: 'text-start' as const, id: 't1' },
                  { type: 'text-delta' as const, id: 't1', delta: 'Voici une lettre ' },
                  { type: 'text-delta' as const, id: 't1', delta: 'de résiliation.' },
                  { type: 'text-end' as const, id: 't1' },
                ]),
            {
              type: 'finish',
              finishReason: { unified: scripted ? 'tool-calls' : 'stop', raw: undefined },
              usage,
              providerMetadata: { openrouter: { usage: { cost } } },
            },
          ],
        }),
      };
    },
  });
}

/** OpenRouter's catalog for its cost reading; the models themselves answer canned text, as OpenRouter would send it. */
function fakeModels(): ModelCatalog {
  models = {
    fast: answeringModel(0.0004),
    reasoning: answeringModel(0.0007),
    // The reconciler's prompt starts with the remark, the naming one asks to name a conversation; the rest is the
    // pre-analysis.
    background: new MockLanguageModelV4({
      doGenerate: async (options) => {
        const prompt = JSON.stringify(options.prompt);
        const forMemory = prompt.includes('Remark:');
        const forTitle = prompt.includes('Name a conversation');
        if (!forMemory && !forTitle && !analysis) throw new Error('provider down');
        let text = JSON.stringify(analysis);
        if (forMemory) text = JSON.stringify(reconciliation);
        if (forTitle) {
          text = JSON.stringify({ language: 'French', title: '« Résiliation box internet. »', icon: 'File-Text ' });
        }
        return {
          content: [{ type: 'text', text }],
          finishReason: { unified: 'stop', raw: undefined },
          usage,
          warnings: [],
          providerMetadata: { openrouter: { usage: { cost: forTitle ? 0.00001 : 0.00002 } } },
        };
      },
    }),
    image: new MockLanguageModelV4({
      doGenerate: async () => ({
        content: imageDraws
          ? [{ type: 'file', mediaType: 'image/png', data: { type: 'data', data: DRAWN } }]
          : [{ type: 'text', text: 'I cannot draw real people.' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
        providerMetadata: { openrouter: { usage: { cost: 0.0336 } } },
      }),
    }),
  };
  const openRouter = new OpenRouterModelCatalog(null);
  return {
    choose: (role, modelId, ownKey) => {
      keysUsed.push(ownKey);
      const model = ownKey && ownKeyRefused ? refusingModel() : models[role];
      return { model, modelId, paidByUser: ownKey !== null };
    },
    costOf: (metadata) => openRouter.costOf(metadata),
  };
}

/** OpenRouter's answer to a key without credit. */
function refuseKey(): never {
  throw new APICallError({
    message: 'Insufficient credits',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 402,
    isRetryable: false,
  });
}

function refusingModel() {
  return new MockLanguageModelV4({ doStream: async () => refuseKey(), doGenerate: async () => refuseKey() });
}

function setKey(cookie: string, key: string) {
  return call('/api/own-key', { method: 'PUT', body: { key }, cookie });
}

/** The models OpenRouter offers in the tests: those of the environment, a newer one, one blind to pictures, one that draws. */
const MODEL_LIST: ModelInfo[] = [
  ...(['fast-model', 'reasoning-model', 'background-model'] as const).map((id) => ({
    id,
    name: id,
    capabilities: ['text', 'image', 'tools', 'reasoning', 'thinking_off', 'structured_outputs'] as ModelCapability[],
    inputPrice: 0.15,
    outputPrice: 0.6,
  })),
  {
    id: 'vendor/newer-model',
    name: 'Newer',
    capabilities: ['text', 'image', 'tools', 'thinking_off'],
    inputPrice: 0.1,
    outputPrice: 0.4,
  },
  {
    id: 'vendor/text-only',
    name: 'Text only',
    capabilities: ['text', 'tools', 'thinking_off'],
    inputPrice: 0.05,
    outputPrice: 0.2,
  },
  {
    id: 'image-model',
    name: 'Draws',
    capabilities: ['text', 'image', 'image_output'],
    inputPrice: 0.25,
    outputPrice: 1.5,
  },
];

/** What the fake document reader finds in the next PDF; `null`: the PDF is broken. */
let pdfPages: PdfPage[] | null;
let filesFolder: string;

beforeEach(async () => {
  clock.at = new Date('2026-11-01T10:00:00Z');
  analysis = plainAnalysis();
  reconciliation = { operation: 'none', ruleId: null, text: null };
  searches = [];
  searchDown = false;
  scriptedCalls = [];
  keysUsed = [];
  keyAccepted = true;
  ownKeyRefused = false;
  sent = [];
  mailerDown = false;
  pdfPages = [];
  imageDraws = true;
  filesFolder = mkdtempSync(join(tmpdir(), 'open-agent-files-'));
  database = createDatabase(':memory:');
  await database.migrate.latest();
  const mailer = {
    sendSignIn: async (email: SignInEmail) => {
      if (mailerDown) throw new Error('down');
      sent.push(email);
    },
  };
  server = Bun.serve({
    port: 0,
    routes: await createApp(
      database,
      {
        clock,
        mailer,
        models: fakeModels(),
        modelDirectory: { list: async () => MODEL_LIST },
        keyChecker: {
          accepts: async () => {
            if (keyAccepted === null) throw new Error('OpenRouter answered 503');
            return keyAccepted;
          },
        },
        secrets: new AesSecretBox('test secret'),
        webSearch: {
          search: async (request) => {
            searches.push(request);
            if (searchDown) throw new Error('Tavily answered 500');
            return { provider: 'tavily', results: [FOUND] };
          },
        },
        fileStore: new DiskFileStore(filesFolder),
        documents: {
          readPdf: async () => {
            if (!pdfPages) throw new UnreadableDocument('broken');
            return pdfPages;
          },
          readWord: async () => [],
          readSpreadsheet: async () => 'Sheet "Budget":\n1 | Poste | Montant\n2 | Loyer | 750\n3 | Total | =SUM(B2:B2)',
        },
        pages: {
          read: async (url) => {
            if (url !== PAGE.url) throw new PageUnavailable('The page answered 404.');
            return PAGE;
          },
        },
        weather: {
          forecast: async (place) => {
            if (place !== 'Nantes') throw new PlaceNotFound(`No place named "${place}" was found.`);
            return FORECAST;
          },
        },
      },
      {
        version: 'test',
        publicUrl: PUBLIC_URL,
        adminEmail: ADMIN,
        devSignInCode: DEV_CODE,
        defaultMonthlyQuotaUsd: DEFAULT_QUOTA,
        defaultModels: {
          fast: 'fast-model',
          reasoning: 'reasoning-model',
          background: 'background-model',
          image: 'image-model',
        },
        trustProxy: false,
      },
    ),
    fetch: () => new Response(null, { status: 404 }),
  });
});

afterEach(async () => {
  await server.stop(true);
  await database.destroy();
  rmSync(filesFolder, { recursive: true, force: true });
});

function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  return fetch(new URL(path, server.url), {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const requestSignIn = (email: string) =>
  call('/api/sign-in/requests', { method: 'POST', body: { email, locale: 'fr' } });

const tokenOf = (email: SignInEmail) => new URL(email.link).searchParams.get('token')!;

const sessionCookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;

async function signIn(email: string): Promise<string> {
  expect((await requestSignIn(email)).status).toBe(204);
  const response = await call('/api/sign-in/token', { method: 'POST', body: { token: tokenOf(sent.at(-1)!) } });
  expect(response.status).toBe(200);
  return sessionCookie(response);
}

async function invite(adminCookie: string, email: string): Promise<InviteUserResponse> {
  const response = await call('/api/admin/users', {
    method: 'POST',
    body: { email, locale: 'en' },
    cookie: adminCookie,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as InviteUserResponse;
}

async function errorOf(response: Response): Promise<ApiError['error']> {
  return ((await response.json()) as ApiError).error;
}

describe('sign-in by email', () => {
  test('the emailed link opens a session that lasts until sign-out', async () => {
    const cookie = await signIn('  Admin@Example.com ');

    expect(sent[0]!.link.startsWith(`${PUBLIC_URL}/sign-in/verify?token=`)).toBe(true);
    const session = (await (await call('/api/session', { cookie })).json()) as SessionResponse;
    expect(session.user).toMatchObject({ email: ADMIN, role: 'admin' });

    expect((await call('/api/session', { method: 'DELETE', cookie })).status).toBe(204);
    expect(await errorOf(await call('/api/session', { cookie }))).toBe('not_signed_in');
  });

  test('a link works once, and only for 15 minutes', async () => {
    await requestSignIn(ADMIN);
    const token = tokenOf(sent[0]!);
    expect((await call('/api/sign-in/token', { method: 'POST', body: { token } })).status).toBe(200);
    expect(await errorOf(await call('/api/sign-in/token', { method: 'POST', body: { token } }))).toBe(
      'invalid_sign_in',
    );

    await requestSignIn(ADMIN);
    advanceMinutes(16);
    const late = await call('/api/sign-in/token', { method: 'POST', body: { token: tokenOf(sent[1]!) } });
    expect(await errorOf(late)).toBe('invalid_sign_in');
  });

  test('the code from the same email signs in on a device that cannot open the link', async () => {
    await requestSignIn(ADMIN);
    const response = await call('/api/sign-in/code', {
      method: 'POST',
      body: { email: ADMIN, code: ` ${sent[0]!.code} ` },
    });
    expect(response.status).toBe(200);
    expect((await call('/api/session', { cookie: sessionCookie(response) })).status).toBe(200);
  });

  test('the development code signs in any invited user without an email, and never an uninvited one', async () => {
    const response = await call('/api/sign-in/code', { method: 'POST', body: { email: ADMIN, code: DEV_CODE } });
    expect(response.status).toBe(200);
    expect((await call('/api/session', { cookie: sessionCookie(response) })).status).toBe(200);

    const stranger = await call('/api/sign-in/code', {
      method: 'POST',
      body: { email: 'stranger@example.com', code: DEV_CODE },
    });
    expect(await errorOf(stranger)).toBe('invalid_sign_in');
  });

  test('wrong codes are blocked before a code can be guessed, even the right one', async () => {
    await requestSignIn(ADMIN);
    const wrong = sent[0]!.code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await call('/api/sign-in/code', { method: 'POST', body: { email: ADMIN, code: wrong } });
      expect(await errorOf(response)).toBe('invalid_sign_in');
    }
    const right = await call('/api/sign-in/code', { method: 'POST', body: { email: ADMIN, code: sent[0]!.code } });
    expect(await errorOf(right)).toBe('too_many_attempts');
  });

  test('an address that is not invited gets the same answer, and no email', async () => {
    expect((await requestSignIn('stranger@example.com')).status).toBe(204);
    expect(sent).toHaveLength(0);
  });

  test('too many emails to one address are refused', async () => {
    for (let attempt = 0; attempt < 5; attempt++) expect((await requestSignIn(ADMIN)).status).toBe(204);
    expect(await errorOf(await requestSignIn(ADMIN))).toBe('too_many_attempts');
    expect(sent).toHaveLength(5);
  });

  test('an email the provider refuses is reported, not silently lost', async () => {
    mailerDown = true;
    expect(await errorOf(await requestSignIn(ADMIN))).toBe('email_failed');
  });
});

describe('invitations', () => {
  test('an invitation has a 7-day link without a code, and the invited person can then sign in alone', async () => {
    const adminCookie = await signIn(ADMIN);
    const { user } = await invite(adminCookie, 'Ana@Example.com');
    expect(user).toMatchObject({ email: 'ana@example.com', role: 'user', status: 'invited' });

    const invitation = sent.at(-1)!;
    expect(invitation).toMatchObject({ to: 'ana@example.com', kind: 'invitation', code: null, locale: 'en' });
    advanceMinutes(6 * 24 * 60);
    const response = await call('/api/sign-in/token', { method: 'POST', body: { token: tokenOf(invitation) } });
    expect(response.status).toBe(200);

    const list = (await (await call('/api/admin/users', { cookie: adminCookie })).json()) as ListAdminUsersResponse;
    expect(list.users.map((listed) => [listed.email, listed.status])).toEqual([
      [ADMIN, 'active'],
      ['ana@example.com', 'active'],
    ]);
  });

  test('only an admin sees and manages the users', async () => {
    const adminCookie = await signIn(ADMIN);
    await invite(adminCookie, 'ana@example.com');
    const anaCookie = await signIn('ana@example.com');

    expect(await errorOf(await call('/api/admin/users', { cookie: anaCookie }))).toBe('not_admin');
    expect(await errorOf(await call('/api/admin/users'))).toBe('not_signed_in');
    const inviting = await call('/api/admin/users', {
      method: 'POST',
      body: { email: 'eve@example.com', locale: 'fr' },
      cookie: anaCookie,
    });
    expect(await errorOf(inviting)).toBe('not_admin');
  });

  test('revoking ends every session at once and stops new sign-ins; inviting again restores the access', async () => {
    const adminCookie = await signIn(ADMIN);
    const { user } = await invite(adminCookie, 'ana@example.com');
    const anaCookie = await signIn('ana@example.com');
    await requestSignIn('ana@example.com');
    const pendingToken = tokenOf(sent.at(-1)!);

    expect((await call(`/api/admin/users/${user.id}`, { method: 'DELETE', cookie: adminCookie })).status).toBe(204);
    expect(await errorOf(await call('/api/session', { cookie: anaCookie }))).toBe('not_signed_in');
    const pending = await call('/api/sign-in/token', { method: 'POST', body: { token: pendingToken } });
    expect(await errorOf(pending)).toBe('invalid_sign_in');
    const emailsBefore = sent.length;
    await requestSignIn('ana@example.com');
    expect(sent).toHaveLength(emailsBefore);

    expect((await invite(adminCookie, 'ana@example.com')).user.status).toBe('active');
    await signIn('ana@example.com');
  });

  test('an admin cannot revoke themselves, so the app always keeps one', async () => {
    const adminCookie = await signIn(ADMIN);
    const session = (await (await call('/api/session', { cookie: adminCookie })).json()) as SessionResponse;
    const response = await call(`/api/admin/users/${session.user.id}`, { method: 'DELETE', cookie: adminCookie });
    expect(await errorOf(response)).toBe('cannot_revoke_self');
  });
});

const userMessage = (id: string, text: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] });

/** Sends a turn and reads the whole stream, as the browser does. */
async function chat(cookie: string, id: string, messages: UIMessage[]): Promise<Response> {
  const response = await call('/api/chat', { method: 'POST', body: { id, messages }, cookie });
  await response.text();
  return response;
}

async function open(cookie: string, id: string): Promise<ConversationResponse> {
  return (await (await call(`/api/conversations/${id}`, { cookie })).json()) as ConversationResponse;
}

const CONVERSATION = '6f1c2a9e-3b7d-4c51-9a0e-1d2f3a4b5c6d';

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

    const costs = await database('usage_events').select('purpose', 'model', 'cost_usd').orderBy('purpose');
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
    await database('conversations').update({ icon: null });

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

const textOfMessage = (message: UIMessage) =>
  message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');

type QuestionPart = Extract<ChatMessage['parts'][number], { type: 'tool-ask_user' }>;
const questionsOf = (message: ChatMessage) =>
  message.parts.filter((part): part is QuestionPart => part.type === 'tool-ask_user');

/** The history the client sends back once the user answered the questions of the last message. */
function answered(history: ChatMessage[], answer: string | null): ChatMessage[] {
  const last = history.at(-1)!;
  const parts = last.parts.map((part) =>
    part.type === 'tool-ask_user' && part.state === 'input-available'
      ? { ...part, state: 'output-available' as const, output: { answer } }
      : part,
  );
  return [...history.slice(0, -1), { ...last, parts }];
}

/** The pre-analyses made so far: the background model also names conversations. */
const prePasses = () =>
  models.background.doGenerateCalls
    .map((generation) => JSON.stringify(generation.prompt))
    .filter((prompt) => prompt.includes('Latest user message'));

describe('questions to the user', () => {
  test('an ambiguous request gets one question with answers to tap; the answer resumes the same message, with no second question', async () => {
    const cookie = await signIn(ADMIN);
    analysis = plainAnalysis({
      clarifyingQuestion: 'Chez quel opérateur êtes-vous ?',
      clarifyingOptions: ['Orange', ' SFR ', 'SFR', 'Free', 'Bouygues', 'Autre'],
    });
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Résilie mon abonnement.')]);

    const asked = (await open(cookie, CONVERSATION)).messages;
    expect(models.fast.doStreamCalls).toHaveLength(0);
    expect(asked[1]!.metadata).toEqual({ route: 'clarify' });
    expect(questionsOf(asked[1]!)).toMatchObject([
      {
        state: 'input-available',
        input: { question: 'Chez quel opérateur êtes-vous ?', options: ['Orange', 'SFR', 'Free', 'Bouygues'] },
      },
    ]);

    analysis = plainAnalysis({ clarifyingQuestion: 'Et depuis quand ?' });
    await chat(cookie, CONVERSATION, answered(asked, 'SFR'));
    const done = (await open(cookie, CONVERSATION)).messages;
    expect(done).toHaveLength(2);
    expect(done[1]!.id).toBe(asked[1]!.id);
    expect(done[1]!.metadata).toEqual({ route: 'fast' });
    expect(textOfMessage(done[1]!)).toBe(ANSWER);
    expect(prePasses().at(-1)).toContain('[Answer: SFR]');
    expect(prePasses().at(-1)).toContain('clarifyingQuestion must be null now');
    expect(JSON.stringify(models.fast.doStreamCalls[0]!.prompt)).toContain('SFR');
  });

  test('the model may stop to ask once; the answer goes on in the same message, and a second question is answered for it', async () => {
    const cookie = await signIn(ADMIN);
    scriptedCalls = [{ toolName: 'ask_user', input: { question: 'Mer ou montagne ?', options: ['Mer', 'Montagne'] } }];
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Propose-moi un week-end.')]);

    const asked = (await open(cookie, CONVERSATION)).messages;
    expect(models.fast.doStreamCalls).toHaveLength(1);
    expect(questionsOf(asked[1]!)).toMatchObject([
      { state: 'input-available', input: { question: 'Mer ou montagne ?' } },
    ]);
    expect(textOfMessage(asked[1]!)).toBe('');

    scriptedCalls = [{ toolName: 'ask_user', input: { question: 'Hôtel ou gîte ?', options: [] } }];
    await chat(cookie, CONVERSATION, answered(asked, 'Mer'));
    const done = (await open(cookie, CONVERSATION)).messages;
    expect(done).toHaveLength(2);
    expect(questionsOf(done[1]!).map((part) => part.output)).toEqual([{ answer: 'Mer' }, { answer: null }]);
    expect(textOfMessage(done[1]!)).toBe(ANSWER);
    expect(models.fast.doStreamCalls).toHaveLength(3);
    expect(JSON.stringify(models.fast.doStreamCalls[1]!.prompt)).toContain('"answer":"Mer"');
    expect(prePasses()).toHaveLength(1);
  });

  test('a question left unanswered never blocks the conversation, and only answered questions resume a message', async () => {
    const cookie = await signIn(ADMIN);
    scriptedCalls = [{ toolName: 'ask_user', input: { question: 'Mer ou montagne ?', options: ['Mer', 'Montagne'] } }];
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Propose-moi un week-end.')]);
    const asked = (await open(cookie, CONVERSATION)).messages;

    expect((await chat(cookie, CONVERSATION, asked)).status).toBe(400);
    expect((await chat(cookie, CONVERSATION, answered(asked, 'x'.repeat(4001)))).status).toBe(400);

    const moved = [...asked, userMessage('m3', 'Finalement, une sortie au cinéma.')];
    expect((await chat(cookie, CONVERSATION, moved)).status).toBe(200);
    expect(JSON.stringify(models.fast.doStreamCalls[1]!.prompt)).toContain('"answer":null');
    expect(textOfMessage((await open(cookie, CONVERSATION)).messages[3]!)).toBe(ANSWER);
  });
});

/** A device listening to `/api/events`: what it heard so far, and a way to hang up. */
async function listen(cookie: string) {
  const hangUp = new AbortController();
  const response = await fetch(new URL('/api/events', server.url), { headers: { cookie }, signal: hangUp.signal });
  const heard: ChangeEvent[] = [];
  // `until` callers, woken at each event to look again.
  const waiters: (() => void)[] = [];
  const decoder = new TextDecoder();
  let buffer = '';
  const reading = (async () => {
    try {
      for await (const chunk of response.body!) {
        buffer += decoder.decode(chunk, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop()!;
        for (const block of blocks) if (block.startsWith('data: ')) heard.push(JSON.parse(block.slice(6)));
        for (const wake of waiters.splice(0)) wake();
      }
    } catch {
      // Hung up.
    }
  })();
  return {
    heard,
    /** Events travel on their own: resolves once what was heard satisfies `enough`. */
    until: async (enough: (events: ChangeEvent[]) => boolean) => {
      while (!enough(heard)) {
        const { promise, resolve } = Promise.withResolvers<void>();
        waiters.push(resolve);
        await promise;
      }
    },
    hangUp: async () => {
      hangUp.abort();
      await reading;
    },
  };
}

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
    await computer.until((events) => events.filter((event) => event.type === 'conversation').length >= 2);
    await computer.hangUp();
    await ana.hangUp();

    // The answer saved, then the deletion; the title is named in the background, its event comes at any time.
    const conversationEvents = computer.heard.filter((event) => event.type === 'conversation');
    expect(conversationEvents).toEqual([
      { type: 'conversation', id: CONVERSATION },
      { type: 'conversation', id: CONVERSATION },
    ]);
    expect(computer.heard).toContainEqual({ type: 'memory' });
    expect(computer.heard).toContainEqual({ type: 'conversations' });
    expect(ana.heard).toEqual([]);
    expect((await call('/api/events')).status).toBe(401);
  });
});

describe('search', () => {
  test("finds the user's own conversations by the start of words, accents aside, and follows edits", async () => {
    const cookie = await signIn(ADMIN);
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Ma Freebox ne capte plus, été comme hiver.')]);
    const search = async (who: string, text: string) =>
      ((await (await call(`/api/search?q=${encodeURIComponent(text)}`, { cookie: who })).json()) as SearchResponse)
        .results;

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

/** What each tool call of the answer gave: its output, or the error the model got. A call with an invalid input is saved as a `dynamic-tool`. */
async function toolResults(cookie: string, conversationId = CONVERSATION) {
  const { messages } = await open(cookie, conversationId);
  return messages.at(-1)!.parts.flatMap((part) => {
    if (part.type === 'dynamic-tool') return [{ tool: part.toolName, output: undefined, error: part.errorText }];
    if (!part.type.startsWith('tool-') || !('state' in part)) return [];
    return [
      {
        tool: part.type.slice(5),
        output: 'output' in part ? part.output : undefined,
        error: 'errorText' in part ? part.errorText : undefined,
      },
    ];
  });
}

describe('context tools', () => {
  test("the model looks up the user's other conversations, their files and a page they named, and knows the time", async () => {
    const cookie = await signIn(ADMIN);
    await chat(cookie, 'other-conversation-id', [userMessage('m1', 'Le code du portail de la Freebox est 4721.')]);
    const notes = (await (
      await upload(cookie, 'notes.txt', 'text/plain', 'Rendez-vous chez le notaire le 12.')
    ).json()) as UploadFileResponse;
    scriptedCalls = [
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
    const lastMessage = JSON.stringify(models.fast.doStreamCalls[1]!.prompt.at(-1));
    expect(lastMessage).toContain('[Now: Sunday, 1 November 2026 at 11:00, Paris time.]');
    expect(lastMessage).toContain('Rappelle-moi tout ça.');
    expect(textOfMessage((await open(cookie, CONVERSATION)).messages[1]!)).toBe(ANSWER);
  });

  test("weather, exact calculations and dates come from the server, not the model's guess", async () => {
    const cookie = await signIn(ADMIN);
    scriptedCalls = [
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
    scriptedCalls = [
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
});

describe('making tools', () => {
  test("an image drawn from the user's attached photo lands in their library, in the shape asked, and is billed", async () => {
    const cookie = await signIn(ADMIN);
    const photo = (await (await upload(cookie, 'chat.png', 'image/png', DRAWN)).json()) as UploadFileResponse;
    scriptedCalls = [
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
    expect(JSON.stringify(models.fast.doStreamCalls[0]!.prompt)).toContain(`<file id=\\"${photo.file.id}\\"`);
    const [made] = await toolResults(cookie);
    const output = made!.output as MadeFileOutput;
    expect(output).toMatchObject({ name: 'Chat de Noël.png', kind: 'image', mediaType: 'image/png' });
    expect(new Uint8Array(await (await call(`/api/files/${output.id}`, { cookie })).arrayBuffer())).toEqual(DRAWN);

    const [drawing] = models.image.doGenerateCalls;
    expect(drawing!.providerOptions).toEqual({ openrouter: { image_config: { aspect_ratio: '9:16' } } });
    const content = drawing!.prompt.at(-1)!.content;
    expect(content).toContainEqual(expect.objectContaining({ type: 'file', mediaType: 'image/png' }));
    expect(content).toContainEqual({ type: 'text', text: 'The same cat with a red Christmas hat' });
    const billed = await database('usage_events').where({ purpose: 'image' }).select('model', 'cost_usd');
    expect(billed).toEqual([{ model: 'image-model', cost_usd: 0.0336 }]);
  });

  test('Excel, PDF, chart and QR code files are made on the server, kept in the library, and readable later', async () => {
    const cookie = await signIn(ADMIN);
    const photo = (await (await upload(cookie, 'logo.png', 'image/png', DRAWN)).json()) as UploadFileResponse;
    pdfPages = [{ text: 'Attestation', image: DRAWN }];
    scriptedCalls = [
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

    scriptedCalls = [{ toolName: 'read_file', input: { id: outputs[0]!.id } }];
    await chat(cookie, 'second-conversation-id', [userMessage('m1', 'Relis le budget.')]);
    const [read] = await toolResults(cookie, 'second-conversation-id');
    expect(read!.output).toMatchObject({ name: 'Budget.xlsx', text: expect.stringContaining('=SUM(B2:B2)') });
  });

  test('what cannot be made reaches the model to say why, and an answer draws two images at most', async () => {
    const cookie = await signIn(ADMIN);
    const notes = (await (await upload(cookie, 'notes.txt', 'text/plain', 'Notes.')).json()) as UploadFileResponse;
    const draw = { prompt: 'A lighthouse', aspect: '16:9', fileName: 'Phare' };
    scriptedCalls = [
      { toolName: 'generate_image', input: { ...draw, sourceImageIds: [notes.file.id] } },
      { toolName: 'create_pdf', input: { fileName: 'Lettre', markdown: '![Logo](unknown-id)' } },
      {
        toolName: 'create_chart',
        input: { fileName: 'Courbe', spec: { data: { url: 'http://169.254.169.254/latest' }, mark: 'line' } },
      },
      // As DeepSeek did once: a call without its fields.
      { toolName: 'create_spreadsheet', input: {} },
    ];
    imageDraws = false;
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Essaie.')]);
    expect((await toolResults(cookie)).map(({ error }) => error)).toEqual([
      '"notes.txt" is not a JPEG, PNG or WebP picture: the image model cannot use it.',
      'No image with the id "unknown-id" in the user\'s library.',
      'A chart takes its data inline (data.values), never from a URL.',
      expect.stringContaining('Invalid input for tool create_spreadsheet'),
    ]);

    scriptedCalls = [
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
    const ran: ChatMessage = {
      id: 'm1',
      role: 'user',
      metadata: { command: { id: command.id, name: 'corriger' } },
      parts: [{ type: 'text', text: 'Je suis aller au marcher.' }],
    };
    await chat(cookie, CONVERSATION, [ran]);

    const sent = JSON.stringify(models.fast.doStreamCalls[0]!.prompt.at(-1));
    expect(sent).toContain('Corrige les fautes du texte.');
    expect(sent.indexOf('Corrige les fautes du texte.')).toBeLessThan(sent.indexOf('Je suis aller au marcher.'));
    expect(prePasses().at(-1)).toContain('Corrige les fautes du texte.');

    const { messages } = await open(cookie, CONVERSATION);
    expect(messages[0]!.metadata).toEqual({ command: { id: command.id, name: 'corriger' } });
    expect(textOfMessage(messages[0]!)).toBe('Je suis aller au marcher.');
    expect((await listCommands(cookie))[0]!.uses).toBe(1);

    // Deleted since: the old message still reads, said as such.
    await call(`/api/commands/${command.id}`, { method: 'DELETE', cookie });
    await chat(cookie, CONVERSATION, [...messages, userMessage('m3', 'Merci.')]);
    expect(JSON.stringify(models.fast.doStreamCalls.at(-1)!.prompt)).toContain('/corriger, deleted since');
  });

  test('the model saves a command from the request, and rewrites it by its name', async () => {
    const cookie = await signIn(ADMIN);
    scriptedCalls = [{ toolName: 'save_command', input: { name: 'Corriger', prompt: 'Corrige les fautes.' } }];
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Fais-moi une commande pour corriger mes textes.')]);
    scriptedCalls = [
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
    expect(models.fast.doStreamCalls.at(-1)!.prompt[0]!.content).toContain('/corriger');
  });
});

describe('pre-analysis', () => {
  test('a request that needs thinking is answered by the reasoning model, and the answer says so', async () => {
    const cookie = await signIn(ADMIN);
    analysis = plainAnalysis({ route: 'reasoning' });
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Deux trains partent de Nantes et de Paris…')]);

    expect(models.reasoning.doStreamCalls).toHaveLength(1);
    expect(models.fast.doStreamCalls).toHaveLength(0);
    const { messages } = await open(cookie, CONVERSATION);
    expect(messages[1]!.metadata).toEqual({ route: 'reasoning' });
  });

  test('a pending question counts as asked: the next message is answered, never questioned again', async () => {
    const cookie = await signIn(ADMIN);
    analysis = plainAnalysis({ clarifyingQuestion: 'Chez quel opérateur êtes-vous ?' });
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Résilie mon abonnement.')]);
    const asked = (await open(cookie, CONVERSATION)).messages;

    await chat(cookie, CONVERSATION, [...asked, userMessage('m2', 'Je ne sais plus, une box.')]);
    const answeredMessages = (await open(cookie, CONVERSATION)).messages;
    expect(models.fast.doStreamCalls).toHaveLength(1);
    expect(textOfMessage(answeredMessages[3]!)).toBe(ANSWER);
  });

  test("a vague request is answered as rewritten, while the conversation keeps the user's own words", async () => {
    const cookie = await signIn(ADMIN);
    const rewritten = 'Écris une lettre de résiliation pour mon abonnement internet, en français, polie et courte.';
    analysis = plainAnalysis({ rewrittenRequest: rewritten });
    await chat(cookie, CONVERSATION, [userMessage('m1', 'lettre resil box stp')]);

    const sentToModel = JSON.stringify(models.fast.doStreamCalls[0]!.prompt);
    expect(sentToModel).toContain(rewritten);
    expect(sentToModel).not.toContain('lettre resil box stp');
    const { messages } = await open(cookie, CONVERSATION);
    expect(textOfMessage(messages[0]!)).toBe('lettre resil box stp');
    expect(messages[1]!.metadata).toEqual({ route: 'fast', rewrittenRequest: rewritten });
  });

  test('when the pre-analysis fails, the user still gets the quick answer to their own words', async () => {
    const cookie = await signIn(ADMIN);
    analysis = null;
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Bonjour')]);

    const { messages } = await open(cookie, CONVERSATION);
    expect(textOfMessage(messages[1]!)).toBe(ANSWER);
    expect(messages[1]!.metadata).toEqual({ route: 'fast' });
  });
});

async function upload(cookie: string, name: string, type: string, bytes: Uint8Array | string): Promise<Response> {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type }));
  return fetch(new URL('/api/files', server.url), { method: 'POST', body: form, headers: { cookie } });
}

const withFile = (id: string, text: string, file: UploadFileResponse['file']): UIMessage => ({
  id,
  role: 'user',
  parts: [
    { type: 'file', mediaType: file.mediaType, filename: file.name, url: file.url },
    { type: 'text', text },
  ],
});

/** The pictures of a model call: each one is something the model sees, not just reads about. */
const picturesSent = (prompt: unknown) =>
  (prompt as { role: string; content: string | { type: string; mediaType?: string }[] }[])
    .flatMap((message) => (typeof message.content === 'string' ? [] : message.content))
    .filter((part) => part.type === 'file' && part.mediaType === 'image/jpeg').length;

describe('files', () => {
  test('a PDF reaches the model whole, text and picture of every page, at every answer', async () => {
    const cookie = await signIn(ADMIN);
    pdfPages = [
      { text: 'Facture 2026-114, total 89 €', image: new Uint8Array([0xff, 0xd8, 1]) },
      { text: '', image: new Uint8Array([0xff, 0xd8, 2]) },
    ];
    const uploaded = await upload(cookie, 'facture.pdf', 'application/pdf', '%PDF-1.7 fake');
    expect(uploaded.status).toBe(201);
    const { file } = (await uploaded.json()) as UploadFileResponse;
    expect(file).toMatchObject({ name: 'facture.pdf', kind: 'pdf', mediaType: 'application/pdf' });
    // "My files" shows a PDF by its first page.
    const preview = await call(file.previewUrl!, { cookie });
    expect([...new Uint8Array(await preview.arrayBuffer())]).toEqual([0xff, 0xd8, 1]);

    await chat(cookie, CONVERSATION, [withFile('m1', 'Le total est bon ?', file)]);
    const history = [...(await open(cookie, CONVERSATION)).messages, userMessage('m3', 'Et la date ?')];
    await chat(cookie, CONVERSATION, history);

    for (const answer of models.fast.doStreamCalls) {
      const prompt = JSON.stringify(answer.prompt);
      expect(prompt).toContain('Facture 2026-114, total 89 €');
      expect(prompt).toContain('Page 2 of 2');
      expect(picturesSent(answer.prompt)).toBe(2);
    }
    const preAnalysis = models.background.doGenerateCalls.find((generation) =>
      JSON.stringify(generation.prompt).includes('Latest user message'),
    );
    expect(JSON.stringify(preAnalysis!.prompt)).toContain('[Attached: facture.pdf]');
  });

  test('a file is only for its owner: anyone else neither opens it nor shows it to the model', async () => {
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

    await chat(anaCookie, CONVERSATION, [withFile('m1', 'Que dit ce fichier ?', file)]);
    const prompt = JSON.stringify(models.fast.doStreamCalls[0]!.prompt);
    expect(prompt).not.toContain('4721');
    expect(prompt).toContain('was deleted from the library');
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
    const prompt = JSON.stringify(models.fast.doStreamCalls[1]!.prompt);
    expect(prompt).not.toContain('4721');
    expect(prompt).toContain('notes.txt\\" was deleted from the library');
  });

  test('what cannot be read whole is refused at upload, never read in part', async () => {
    const cookie = await signIn(ADMIN);
    expect(await errorOf(await upload(cookie, 'page.html', 'text/html', '<p>hi</p>'))).toBe('file_type_unsupported');
    expect(await errorOf(await upload(cookie, 'big.txt', 'text/plain', new Uint8Array(21 * 1024 * 1024)))).toBe(
      'file_too_large',
    );
    expect(await errorOf(await upload(cookie, 'long.txt', 'text/plain', 'mot '.repeat(500_000)))).toBe('file_too_long');
    pdfPages = null;
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
});

async function artifactsOf(cookie: string): Promise<ArtifactDto[]> {
  return (
    (await (await call(`/api/conversations/${CONVERSATION}/artifacts`, { cookie })).json()) as ListArtifactsResponse
  ).artifacts;
}

const saveArtifact = (cookie: string, id: string, content: string, baseVersion: number) =>
  call(`/api/artifacts/${id}/versions`, { method: 'POST', body: { content, baseVersion }, cookie });

describe('canvas', () => {
  test("the model writes a document, then rewrites its latest version, the user's own edits included", async () => {
    const cookie = await signIn(ADMIN);
    scriptedCalls = [
      {
        toolName: 'create_document',
        input: { kind: 'document', title: '# Lettre de résiliation', content: 'Brouillon du modèle' },
      },
    ];
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Écris une lettre de résiliation.')]);
    const [letter] = await artifactsOf(cookie);
    expect(letter).toMatchObject({ title: 'Lettre de résiliation', kind: 'document', version: 1 });
    expect((await saveArtifact(cookie, letter!.id, 'Version corrigée à la main', 1)).status).toBe(200);

    scriptedCalls = [{ toolName: 'update_document', input: { id: letter!.id, content: 'Version finale du modèle' } }];
    const history = [...(await open(cookie, CONVERSATION)).messages, userMessage('m3', 'Ajoute la date.')];
    await chat(cookie, CONVERSATION, history);

    // The second answer's first call: the latest version, the user's, is in the instructions; the draft is gone, and
    // the past call keeps no content the model could copy into a new version.
    const prompt = JSON.stringify(models.fast.doStreamCalls[2]!.prompt);
    expect(prompt).toContain('Version corrigée à la main');
    expect(prompt).not.toContain('Brouillon du modèle');
    const pastCall = models.fast.doStreamCalls[2]!.prompt.flatMap((message) =>
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
    scriptedCalls = [{ toolName: 'create_document', input: { kind: 'document', title: 'CV', content: 'v1' } }];
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

  test('bringing back an old version is a new version the model is told about, so it does not redo what was undone', async () => {
    const cookie = await signIn(ADMIN);
    scriptedCalls = [{ toolName: 'create_document', input: { kind: 'document', title: 'CV', content: 'CV court' } }];
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Fais mon CV.')]);
    const [cv] = await artifactsOf(cookie);
    scriptedCalls = [{ toolName: 'update_document', input: { id: cv!.id, content: 'CV long avec loisirs' } }];
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
    const prompt = models.fast.doStreamCalls.at(-1)!.prompt;
    expect(JSON.stringify(prompt)).toContain('version=\\"3\\" restored-from=\\"1\\"');
    expect(JSON.stringify(prompt.at(-1))).toContain('back to version 1, on purpose');
    expect(JSON.stringify(prompt.at(-1))).toContain('Merci.');
  });

  test("a document is only its owner's: nobody else reads it, edits it, or has the model rewrite it", async () => {
    const adminCookie = await signIn(ADMIN);
    scriptedCalls = [{ toolName: 'create_document', input: { kind: 'html', title: 'Jeu', content: '<p>secret</p>' } }];
    await chat(adminCookie, CONVERSATION, [userMessage('m1', 'Fais un jeu.')]);
    const [game] = await artifactsOf(adminCookie);
    await invite(adminCookie, 'ana@example.com');
    const anaCookie = await signIn('ana@example.com');

    expect((await call(`/api/artifacts/${game!.id}`, { cookie: anaCookie })).status).toBe(404);
    expect((await saveArtifact(anaCookie, game!.id, '<p>pirate</p>', 1)).status).toBe(404);
    scriptedCalls = [{ toolName: 'update_document', input: { id: game!.id, content: '<p>pirate</p>' } }];
    await chat(anaCookie, 'other-conversation-id', [userMessage('m1', 'Modifie le jeu.')]);

    const opened = (await (
      await call(`/api/artifacts/${game!.id}`, { cookie: adminCookie })
    ).json()) as ArtifactResponse;
    expect(opened).toMatchObject({ content: '<p>secret</p>', artifact: { version: 1 } });
  });
});

async function settingsOf(cookie: string): Promise<AdminSettingsResponse> {
  return (await (await call('/api/admin/settings', { cookie })).json()) as AdminSettingsResponse;
}

describe('admin settings', () => {
  test('the admin switches a role to another model, checked against OpenRouter, and the next answers use it', async () => {
    const cookie = await signIn(ADMIN);
    const setFast = (modelId: string) =>
      call('/api/admin/settings/models/fast', { method: 'PUT', body: { modelId }, cookie });

    expect(await errorOf(await setFast('vendor/unknown'))).toBe('model_not_found');
    expect(await errorOf(await setFast('vendor/text-only'))).toBe('model_unsuitable');
    expect((await setFast('vendor/newer-model')).status).toBe(200);
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Bonjour')]);
    const answer = await database('usage_events').where({ purpose: 'answer' }).first('model');
    expect(answer.model).toBe('vendor/newer-model');

    await setFast('fast-model');
    expect((await settingsOf(cookie)).models.fast).toBe('fast-model');
    expect(await database('settings').count({ count: '*' }).first()).toEqual({ count: 0 });
  });

  test('an edited prompt applies from the next message, the code still adds what depends on the conversation, and reset brings the default back', async () => {
    const cookie = await signIn(ADMIN);
    await call('/api/memory/rules', { method: 'POST', body: { text: 'Réponses courtes.' }, cookie });
    const setPrompt = (name: string, text: string | null) =>
      call(`/api/admin/settings/prompts/${name}`, { method: 'PUT', body: { text }, cookie });

    expect((await setPrompt('assistant', 'Tu es un assistant pirate.')).status).toBe(204);
    expect((await setPrompt('preAnalysis', 'Décide comment répondre, en JSON.')).status).toBe(204);
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Bonjour')]);
    const answer = JSON.stringify(models.fast.doStreamCalls[0]!.prompt);
    expect(answer).toContain('Tu es un assistant pirate.');
    expect(answer).not.toContain('You are Open Agent');
    expect(answer).toContain('Today is Sunday, 1 November 2026');
    expect(answer).toContain('Réponses courtes.');
    const prompts = models.background.doGenerateCalls.map((generation) => JSON.stringify(generation.prompt));
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
    const change = await database('memory_rule_changes').orderBy('id', 'desc').first('operation', 'source');
    expect(change).toEqual({ operation: 'delete', source: 'admin' });
    expect((await call('/api/admin/settings', { cookie: anaCookie })).status).toBe(403);
  });
});

async function quotaOf(cookie: string): Promise<QuotaResponse> {
  return (await (await call('/api/quota', { cookie })).json()) as QuotaResponse;
}

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
    const row = await database('users').where({ id: ana.id }).first('own_key_sealed');
    expect(row.own_key_sealed).not.toContain('ana-secret');

    keysUsed = [];
    expect((await chat(anaCookie, CONVERSATION, [userMessage('m1', 'Bonjour')])).status).toBe(200);
    expect(keysUsed.length).toBeGreaterThanOrEqual(2);
    expect(new Set(keysUsed)).toEqual(new Set([ANA_KEY]));
    const events = await database('usage_events').where({ user_id: ana.id }).select('purpose', 'paid_by_user');
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

    keysUsed = [];
    await chat(adminCookie, 'admin-conversation', [userMessage('m1', 'Bonjour')]);
    expect(new Set(keysUsed)).toEqual(new Set([null]));

    expect((await call('/api/own-key', { method: 'DELETE', cookie: anaCookie })).status).toBe(204);
    expect(await (await call('/api/own-key', { cookie: anaCookie })).json()).toEqual({ key: null });
    const history = [...(await open(anaCookie, CONVERSATION)).messages, userMessage('m3', 'Encore ?')];
    expect((await chat(anaCookie, CONVERSATION, history)).status).toBe(429);
  });

  test('a key OpenRouter refuses is not kept, and one it refuses later says so in the conversation', async () => {
    const cookie = await signIn(ADMIN);
    keyAccepted = false;
    expect(await errorOf(await setKey(cookie, 'sk-or-v1-wrong'))).toBe('invalid_key');
    keyAccepted = null;
    expect(await errorOf(await setKey(cookie, 'sk-or-v1-wrong'))).toBe('key_check_failed');
    expect(await errorOf(await setKey(cookie, 'two words'))).toBe('invalid_request');
    expect(await (await call('/api/own-key', { cookie })).json()).toEqual({ key: null });

    keyAccepted = true;
    await setKey(cookie, ANA_KEY);
    ownKeyRefused = true;
    const response = await call('/api/chat', {
      method: 'POST',
      body: { id: CONVERSATION, messages: [userMessage('m1', 'Bonjour')] },
      cookie,
    });
    expect(await response.text()).toContain('"errorText":"own_key_refused"');
  });
});
describe('web search', () => {
  test('a request about current facts is answered from a web search, shown with its sources, and every step is counted', async () => {
    const cookie = await signIn(ADMIN);
    analysis = plainAnalysis({ webSearch: true });
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Combien coûte le gazole aujourd’hui ?')]);

    expect(searches).toEqual([{ query: 'prix gazole France', recent: true, locale: 'fr' }]);
    expect(JSON.stringify(models.fast.doStreamCalls[1]!.prompt)).toContain(FOUND.content);
    const { messages } = await open(cookie, CONVERSATION);
    expect(messages[1]!.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-web_search', state: 'output-available', output: { results: [FOUND] } }),
    );
    expect(textOfMessage(messages[1]!)).toBe(ANSWER);

    const costs = await database('usage_events')
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
    analysis = plainAnalysis({ webSearch: true });
    searchDown = true;
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Combien coûte le gazole aujourd’hui ?')]);

    const { messages } = await open(cookie, CONVERSATION);
    expect(messages[1]!.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-web_search', state: 'output-error' }),
    );
    expect(textOfMessage(messages[1]!)).toBe(ANSWER);
  });
});

async function rulesOf(cookie: string): Promise<{ id: number; text: string }[]> {
  const body = (await (await call('/api/memory/rules', { cookie })).json()) as ListMemoryRulesResponse;
  return body.rules.map(({ id, text }) => ({ id, text }));
}

const noticeOf = (message: UIMessage) => message.parts.find((part) => part.type === 'data-memory');

describe('memory', () => {
  test('a lasting remark becomes a rule, shown under its answer, and the next answers follow it', async () => {
    const cookie = await signIn(ADMIN);
    analysis = plainAnalysis({ feedback: 'Préfère des réponses courtes.' });
    reconciliation = { operation: 'add', ruleId: null, text: 'Réponses courtes.' };
    await chat(cookie, CONVERSATION, [userMessage('m1', 'Tes réponses sont toujours trop longues.')]);

    const [rule] = await rulesOf(cookie);
    expect(rule!.text).toBe('Réponses courtes.');
    const { messages } = await open(cookie, CONVERSATION);
    expect(textOfMessage(messages[1]!)).toBe(ANSWER);
    expect(noticeOf(messages[1]!)).toMatchObject({
      data: { operation: 'add', before: null, after: 'Réponses courtes.', undone: false },
    });

    analysis = plainAnalysis();
    await chat(cookie, CONVERSATION, [...messages, userMessage('m2', 'Une recette de crêpes ?')]);
    expect(JSON.stringify(models.fast.doStreamCalls[1]!.prompt)).toContain('Réponses courtes.');
  });

  test('a contrary remark rewrites the rule instead of adding a second one', async () => {
    const cookie = await signIn(ADMIN);
    await call('/api/memory/rules', { method: 'POST', body: { text: 'Réponses courtes.' }, cookie });
    const [rule] = await rulesOf(cookie);
    analysis = plainAnalysis({ feedback: 'Préfère des réponses détaillées.' });
    reconciliation = { operation: 'update', ruleId: rule!.id, text: 'Réponses détaillées.' };
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
    const remember = (who: string, messageId: string) =>
      call('/api/memory/remember', { method: 'POST', body: { conversationId: CONVERSATION, messageId }, cookie: who });

    reconciliation = { operation: 'add', ruleId: null, text: 'Habite à Nantes.' };
    const { notice } = (await (await remember(cookie, 'm1')).json()) as RememberMessageResponse;
    expect(notice).toMatchObject({ operation: 'add', before: null, after: 'Habite à Nantes.', undone: false });
    expect((await rulesOf(cookie)).map((rule) => rule.text)).toEqual(['Habite à Nantes.']);
    const asked = models.background.doGenerateCalls.map((generation) => JSON.stringify(generation)).at(-1);
    expect(asked).toContain('Merci, mais on habite à Nantes !');
    expect(asked).toContain('The user asked to remember this message');

    expect((await call(`/api/memory/changes/${notice!.changeId}/undo`, { method: 'POST', cookie })).status).toBe(204);
    expect(await rulesOf(cookie)).toEqual([]);

    const answer = (await open(cookie, CONVERSATION)).messages[1]!;
    expect(await errorOf(await remember(cookie, answer.id))).toBe('not_found');
    await invite(cookie, 'ana@example.com');
    expect(await errorOf(await remember(await signIn('ana@example.com'), 'm1'))).toBe('not_found');
  });

  test('undo puts the rule back and marks the notice, but not once the rule changed again', async () => {
    const cookie = await signIn(ADMIN);
    analysis = plainAnalysis({ feedback: 'Vouvoyer.' });
    reconciliation = { operation: 'add', ruleId: null, text: 'Vouvoyer l’utilisateur.' };
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
    analysis = plainAnalysis({ feedback: 'Pas de listes.' });
    reconciliation = { operation: 'update', ruleId: 999, text: 'Pas de listes.' };
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
