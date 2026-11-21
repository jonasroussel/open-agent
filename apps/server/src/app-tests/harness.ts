import { afterEach, beforeEach, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  ApiError,
  ChatMessage,
  ChangeEvent,
  ArtifactDto,
  ListArtifactsResponse,
  ConversationResponse,
  InviteUserResponse,
  QuotaResponse,
  ModelCapability,
  UploadFileResponse,
  ListMemoryRulesResponse,
  ModelRole,
} from '@open-agent/shared';
import type { UIMessage } from 'ai';
import { APICallError, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { Knex } from 'knex';

import { createApp } from '../app.ts';
import type { DownloadedFile } from '../application/ports/context-services.ts';
import { NotAWebPage, PageUnavailable, PlaceNotFound } from '../application/ports/context-services.ts';
import type { PdfPage } from '../application/ports/document-reader.ts';
import { UnreadableDocument } from '../application/ports/document-reader.ts';
import type { ShareEmail, SignInEmail } from '../application/ports/mailer.ts';
import type { ModelCatalog, ModelInfo, Thinking } from '../application/ports/model-catalog.ts';
import type { WebSearchRequest } from '../application/ports/web-search.ts';
import { AesSecretBox } from '../infrastructure/crypto/aes-secret-box.ts';
import { createDatabase } from '../infrastructure/database/connection.ts';
import { DiskFileStore } from '../infrastructure/files/disk-file-store.ts';
import { PopplerMammothReader } from '../infrastructure/files/document-reader.ts';
import { OpenRouterModelCatalog } from '../infrastructure/llm/openrouter-model-catalog.ts';

export const ADMIN = 'admin@example.com';
export const PUBLIC_URL = 'https://open-agent.example.com';
/** The development code; `config.ts` sets it to `null` in production. */
export const DEV_CODE = '424242';
export const DEFAULT_QUOTA = 5;

type State = {
  database: Knex;
  server: Bun.Server<undefined>;
  sent: SignInEmail[];
  shares: ShareEmail[];
  mailerDown: boolean;
  /** What the pre-analysis answers in the current test; `null`: the call fails. */
  analysis: Analysis | null;
  /** What the memory reconciler answers in the current test. */
  reconciliation: { operation: string; ruleId: number | null; text: string | null };
  models: Record<ModelRole, MockLanguageModelV4>;
  /** The image model draws `DRAWN`; `false`: it only answers words, as when it declines. */
  imageDraws: boolean;
  /** The searches the model made in the current test; `searchDown`: the search service fails. */
  searches: WebSearchRequest[];
  searchDown: boolean;
  /** The own key each model call used, `null` for the app's; `keyAccepted`: what OpenRouter says of a key, `null`: down. */
  keysUsed: (string | null)[];
  /** How much each model call was set to think, in order. */
  thinking: { modelId: string; thinking: Thinking }[];
  keyAccepted: boolean | null;
  /** OpenRouter refuses the users' own keys during the answer. */
  ownKeyRefused: boolean;
  /** Tool calls the fast model makes before it answers, one per call, in order: as a model deciding to use the canvas. */
  scriptedCalls: { toolName: string; input: unknown }[];
  /** While set, the answering models wait for it before they write: an answer still being written. */
  answerHeld: Promise<void> | null;
  /** What the fake document reader finds in the next PDF; `null`: the PDF is broken; an error: what it throws. */
  pdfPages: PdfPage[] | null | Error;
  /** The files the fake web serves for download, by url; any other url answers 404. */
  downloads: Record<string, DownloadedFile>;
};

/** The app and its fakes for the current test, reset before each test by `useApp`. */
export const state = {} as State;

export const clock = { at: new Date('2026-11-01T10:00:00Z'), now: () => clock.at };
export const advanceMinutes = (minutes: number) => (clock.at = new Date(clock.at.getTime() + minutes * 60_000));

const usage = {
  inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 8, text: 8, reasoning: undefined },
};
export const ANSWER = 'Voici une lettre de résiliation.';

type Analysis = {
  route: string;
  clarifyingQuestion: string | null;
  clarifyingOptions: string[];
  rewrittenRequest: string | null;
  feedback: string | null;
  webSearch: boolean;
};
export const plainAnalysis = (overrides: Partial<Analysis> = {}): Analysis => ({
  route: 'fast',
  clarifyingQuestion: null,
  clarifyingOptions: [],
  rewrittenRequest: null,
  feedback: null,
  webSearch: false,
  ...overrides,
});
/** One white pixel: a real PNG, which a PDF can show. */
export const DRAWN = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);
/** The one page the fake web answers, and the one town the fake weather knows. */
export const PAGE = {
  url: 'https://example.org/bail',
  title: 'Le bail',
  text: 'Le préavis est de 3 mois, 1 mois en zone tendue.',
};
export const FORECAST = {
  place: 'Nantes, Pays de la Loire, France',
  now: { sky: 'light rain', temperatureC: 9, feelsLikeC: 6, windKmh: 20 },
  days: [{ date: '2026-11-01', sky: 'light rain', minC: 6, maxC: 12, rainChance: 80, rainMm: 4 }],
};
export const FOUND = {
  title: 'Prix des carburants',
  url: 'https://www.prix-carburants.gouv.fr/',
  content: 'Gazole : 1,62 € le litre en moyenne au 1er novembre 2026.',
  publishedAt: '2026-11-01',
};

/** Answers, or calls a tool first: the search when it must, or the next scripted call. */
function answeringModel(cost: number) {
  return new MockLanguageModelV4({
    doStream: async (options) => {
      await state.answerHeld;
      const scripted =
        options.toolChoice?.type === 'required'
          ? { toolName: 'web_search', input: { query: 'prix gazole France', recent: true } }
          : state.scriptedCalls.shift();
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
  state.models = {
    fast: answeringModel(0.0004),
    reasoning: answeringModel(0.0007),
    // The reconciler's prompt starts with the remark, the naming one asks to name a conversation; the rest is the
    // pre-analysis.
    background: new MockLanguageModelV4({
      doGenerate: async (options) => {
        const prompt = JSON.stringify(options.prompt);
        const forMemory = prompt.includes('Remarque :');
        const forTitle = prompt.includes('Nomme une conversation');
        if (!forMemory && !forTitle && !state.analysis) throw new Error('provider down');
        let text = JSON.stringify(state.analysis);
        if (forMemory) text = JSON.stringify(state.reconciliation);
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
        content: state.imageDraws
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
    choose: (role, modelId, ownKey, thinking) => {
      state.keysUsed.push(ownKey);
      state.thinking.push({ modelId, thinking });
      const model = ownKey && state.ownKeyRefused ? refusingModel() : state.models[role];
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

/** The models OpenRouter offers in the tests: those of the environment (which hear, watch and read PDFs, as Gemini
 * does), a newer one, one blind to pictures, one whose thinking cannot be turned off, one that draws. */
const MODEL_LIST: ModelInfo[] = [
  ...(['fast-model', 'reasoning-model', 'background-model'] as const).map((id) => ({
    id,
    name: id,
    capabilities: [
      'text',
      'image',
      'audio',
      'video',
      'file',
      'tools',
      'reasoning',
      'thinking_off',
      'structured_outputs',
    ] as ModelCapability[],
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
    id: 'vendor/always-thinking',
    name: 'Always thinking',
    capabilities: ['text', 'image', 'tools', 'reasoning'],
    inputPrice: 0.2,
    outputPrice: 0.8,
  },
  {
    id: 'image-model',
    name: 'Draws',
    capabilities: ['text', 'image', 'image_output'],
    inputPrice: 0.25,
    outputPrice: 1.5,
  },
];

/** Registers the app's setup and teardown: each test file calls it once at its top level. */
export function useApp() {
  let filesFolder: string;

  beforeEach(async () => {
    clock.at = new Date('2026-11-01T10:00:00Z');
    state.analysis = plainAnalysis();
    state.reconciliation = { operation: 'none', ruleId: null, text: null };
    state.searches = [];
    state.searchDown = false;
    state.scriptedCalls = [];
    state.answerHeld = null;
    state.keysUsed = [];
    state.thinking = [];
    state.keyAccepted = true;
    state.ownKeyRefused = false;
    state.sent = [];
    state.shares = [];
    state.mailerDown = false;
    state.pdfPages = [];
    state.downloads = {};
    state.imageDraws = true;
    filesFolder = mkdtempSync(join(tmpdir(), 'open-agent-files-'));
    state.database = createDatabase(':memory:');
    await state.database.migrate.latest();
    const mailer = {
      sendSignIn: async (email: SignInEmail) => {
        if (state.mailerDown) throw new Error('down');
        state.sent.push(email);
      },
      sendShare: async (email: ShareEmail) => {
        state.shares.push(email);
      },
    };
    state.server = Bun.serve({
      port: 0,
      routes: await createApp(
        state.database,
        {
          clock,
          mailer,
          models: fakeModels(),
          modelDirectory: { list: async () => MODEL_LIST },
          keyChecker: {
            accepts: async () => {
              if (state.keyAccepted === null) throw new Error('OpenRouter answered 503');
              return state.keyAccepted;
            },
          },
          secrets: new AesSecretBox('test secret'),
          webSearch: {
            search: async (request) => {
              state.searches.push(request);
              if (state.searchDown) throw new Error('Tavily answered 500');
              return { provider: 'tavily', results: [FOUND] };
            },
          },
          fileStore: new DiskFileStore(filesFolder),
          documents: {
            readPdf: async () => {
              if (!state.pdfPages) throw new UnreadableDocument('broken');
              if (state.pdfPages instanceof Error) throw state.pdfPages;
              return state.pdfPages;
            },
            readWord: async () => [],
            convertAudio: (bytes) => new PopplerMammothReader().convertAudio(bytes),
            readSpreadsheet: async () =>
              'Sheet "Budget":\n1 | Poste | Montant\n2 | Loyer | 750\n3 | Total | =SUM(B2:B2)',
          },
          pages: {
            read: async (url) => {
              if (url.endsWith('.pdf')) throw new NotAWebPage('application/pdf');
              if (url !== PAGE.url) throw new PageUnavailable('The page answered 404.');
              return PAGE;
            },
          },
          downloads: {
            download: async (url) => {
              const file = state.downloads[url];
              if (!file) throw new PageUnavailable('The file answered 404.');
              return file;
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
    await state.server.stop(true);
    await state.database.destroy();
    rmSync(filesFolder, { recursive: true, force: true });
  });
}

export function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  return fetch(new URL(path, state.server.url), {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export const requestSignIn = (email: string) =>
  call('/api/sign-in/requests', { method: 'POST', body: { email, locale: 'fr' } });

export const tokenOf = (email: SignInEmail) => new URL(email.link).searchParams.get('token')!;

export const sessionCookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;

export async function signIn(email: string): Promise<string> {
  expect((await requestSignIn(email)).status).toBe(204);
  const response = await call('/api/sign-in/token', { method: 'POST', body: { token: tokenOf(state.sent.at(-1)!) } });
  expect(response.status).toBe(200);
  return sessionCookie(response);
}

export async function invite(adminCookie: string, email: string): Promise<InviteUserResponse> {
  const response = await call('/api/admin/users', {
    method: 'POST',
    body: { email, locale: 'en' },
    cookie: adminCookie,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as InviteUserResponse;
}

export async function errorOf(response: Response): Promise<ApiError['error']> {
  return ((await response.json()) as ApiError).error;
}

export const userMessage = (id: string, text: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
});

/** Sends a turn and reads the whole stream, as the browser does. */
export async function chat(cookie: string, id: string, messages: UIMessage[]): Promise<Response> {
  const response = await call('/api/chat', { method: 'POST', body: { id, messages }, cookie });
  await response.text();
  return response;
}

export async function open(cookie: string, id: string): Promise<ConversationResponse> {
  return (await (await call(`/api/conversations/${id}`, { cookie })).json()) as ConversationResponse;
}

export const CONVERSATION = '6f1c2a9e-3b7d-4c51-9a0e-1d2f3a4b5c6d';

export const textOfMessage = (message: UIMessage) =>
  message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');

/** The history the client sends back once the user answered the questions of the last message. */
export function answered(history: ChatMessage[], answer: string | null): ChatMessage[] {
  const last = history.at(-1)!;
  const parts = last.parts.map((part) =>
    part.type === 'tool-ask_user' && part.state === 'input-available'
      ? { ...part, state: 'output-available' as const, output: { answer } }
      : part,
  );
  return [...history.slice(0, -1), { ...last, parts }];
}

/** The pre-analyses made so far: the background model also names conversations. */
export const prePasses = () =>
  state.models.background.doGenerateCalls
    .map((generation) => JSON.stringify(generation.prompt))
    .filter((prompt) => prompt.includes('Dernier message de l'));

/** A device listening to `/api/events`: what it heard so far, and a way to hang up. */
export async function listen(cookie: string) {
  const hangUp = new AbortController();
  const response = await fetch(new URL('/api/events', state.server.url), {
    headers: { cookie },
    signal: hangUp.signal,
  });
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

export const MARIE = 'marie@example.com';

export const share = (cookie: string, userIds: number[]) =>
  call(`/api/conversations/${CONVERSATION}/members`, { method: 'POST', body: { userIds }, cookie });
export const accept = (cookie: string) => call(`/api/conversations/${CONVERSATION}/join`, { method: 'POST', cookie });
/** A new message after the saved history, as a browser up to date sends it. */
export async function say(cookie: string, message: UIMessage): Promise<Response> {
  return chat(cookie, CONVERSATION, [...(await open(cookie, CONVERSATION)).messages, message]);
}

/** Marie, with her own small quota, invited by the admin; the admin asked one question before sharing. */
export async function withMarie() {
  const admin = await signIn(ADMIN);
  const { user } = await invite(admin, MARIE);
  await call(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { monthlyQuotaUsd: 0.001 }, cookie: admin });
  const marie = await signIn(MARIE);
  await chat(admin, CONVERSATION, [userMessage('m1', 'Que faire pour une fuite d’eau chez moi ?')]);
  return { admin, marie, marieId: user.id };
}

export async function sharedWithMarie() {
  const people = await withMarie();
  expect((await share(people.admin, [people.marieId])).status).toBe(204);
  expect((await accept(people.marie)).status).toBe(204);
  return people;
}

/** What each tool call of the answer gave: its output, or the error the model got. A call with an invalid input is saved as a `dynamic-tool`. */
export async function toolResults(cookie: string, conversationId = CONVERSATION) {
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

export async function upload(
  cookie: string,
  name: string,
  type: string,
  bytes: Uint8Array | string,
): Promise<Response> {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type }));
  return fetch(new URL('/api/files', state.server.url), { method: 'POST', body: form, headers: { cookie } });
}

export const withFile = (id: string, text: string, file: UploadFileResponse['file']): UIMessage => ({
  id,
  role: 'user',
  parts: [
    { type: 'file', mediaType: file.mediaType, filename: file.name, url: file.url },
    { type: 'text', text },
  ],
});

export async function artifactsOf(cookie: string): Promise<ArtifactDto[]> {
  return (
    (await (await call(`/api/conversations/${CONVERSATION}/artifacts`, { cookie })).json()) as ListArtifactsResponse
  ).artifacts;
}

export const saveArtifact = (cookie: string, id: string, content: string, baseVersion: number) =>
  call(`/api/artifacts/${id}/versions`, { method: 'POST', body: { content, baseVersion }, cookie });

export async function quotaOf(cookie: string): Promise<QuotaResponse> {
  return (await (await call('/api/quota', { cookie })).json()) as QuotaResponse;
}

export async function rulesOf(cookie: string): Promise<{ id: number; text: string }[]> {
  const body = (await (await call('/api/memory/rules', { cookie })).json()) as ListMemoryRulesResponse;
  return body.rules.map(({ id, text }) => ({ id, text }));
}

export const noticeOf = (message: UIMessage) => message.parts.find((part) => part.type === 'data-memory');
