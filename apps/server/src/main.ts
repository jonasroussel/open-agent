import type { ApiError } from '@open-agent/shared';

import { createApp } from './app.ts';
import { appVersion } from './infrastructure/app-version.ts';
import { config } from './infrastructure/config.ts';
import { OpenMeteoWeather } from './infrastructure/context/open-meteo-weather.ts';
import { ReadableWebPageReader } from './infrastructure/context/readable-web-page-reader.ts';
import { AesSecretBox } from './infrastructure/crypto/aes-secret-box.ts';
import { createDatabase } from './infrastructure/database/connection.ts';
import { DiskFileStore } from './infrastructure/files/disk-file-store.ts';
import { PopplerMammothReader } from './infrastructure/files/document-reader.ts';
import { OpenRouterKeyChecker, OpenRouterModelCatalog } from './infrastructure/llm/openrouter-model-catalog.ts';
import { OpenRouterModelDirectory } from './infrastructure/llm/openrouter-model-directory.ts';
import { ConsoleMailer } from './infrastructure/mail/console-mailer.ts';
import { PlunkMailer } from './infrastructure/mail/plunk-mailer.ts';
import { SystemClock } from './infrastructure/system-clock.ts';
import { FallbackWebSearch } from './infrastructure/web-search/fallback-web-search.ts';
import { SearxngSearch } from './infrastructure/web-search/searxng-search.ts';
import { TavilySearch } from './infrastructure/web-search/tavily-search.ts';
import { createStaticFiles } from './presentation/http/static-files.ts';

const database = createDatabase(config.databasePath);
const [, appliedMigrations] = await database.migrate.latest();
if (appliedMigrations.length > 0) console.log(`Applied migrations: ${appliedMigrations.join(', ')}`);

const version = await appVersion();
const mailer = config.plunkApiKey ? new PlunkMailer(config.plunkApiKey, config.mailFrom) : new ConsoleMailer();
if (!config.plunkApiKey) console.log('PLUNK_API_KEY is not set: sign-in emails go to this log.');
if (!config.adminEmail) console.log('ADMIN_EMAIL is not set: no admin is created at boot.');
if (!config.openRouterApiKey) console.log('OPENROUTER_API_KEY is not set: the chat cannot answer.');
if (config.devSignInCode) console.log(`Development: the code ${config.devSignInCode} signs in any invited user.`);
const models = new OpenRouterModelCatalog(config.openRouterApiKey);
const clock = new SystemClock();
const searchServices = [
  ...(config.tavilyApiKey ? [new TavilySearch(config.tavilyApiKey)] : []),
  ...(config.searxngUrl ? [new SearxngSearch(config.searxngUrl)] : []),
];
if (!config.tavilyApiKey) console.log('TAVILY_API_KEY is not set.');
if (!config.searxngUrl) console.log('SEARXNG_URL is not set.');
const webSearch = searchServices.length > 0 ? new FallbackWebSearch(searchServices, clock) : null;
if (!webSearch) console.log('No web search service: the model cannot search the web.');
const routes = await createApp(
  database,
  {
    clock,
    mailer,
    models,
    modelDirectory: new OpenRouterModelDirectory(),
    keyChecker: new OpenRouterKeyChecker(),
    secrets: new AesSecretBox(config.encryptionKey),
    webSearch,
    fileStore: new DiskFileStore(config.filesPath),
    documents: new PopplerMammothReader(),
    pages: new ReadableWebPageReader(),
    weather: new OpenMeteoWeather(),
  },
  {
    version,
    publicUrl: config.publicUrl,
    adminEmail: config.adminEmail,
    devSignInCode: config.devSignInCode,
    defaultMonthlyQuotaUsd: config.defaultMonthlyQuotaUsd,
    trustProxy: config.trustProxy,
    defaultModels: config.models,
  },
);
const staticFiles = config.clientDistPath ? createStaticFiles(config.clientDistPath) : null;

const server = Bun.serve({
  port: config.port,
  routes,
  // Unknown API paths stay JSON errors; everything else is the client, when it is served from here.
  fetch: (request) =>
    staticFiles && !new URL(request.url).pathname.startsWith('/api/')
      ? staticFiles(request)
      : Response.json({ error: 'not_found' } satisfies ApiError, { status: 404 }),
});

console.log(`Server listening on ${server.url}`);
console.log(`Version: ${version}`);
