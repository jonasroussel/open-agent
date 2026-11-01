import type { Knex } from 'knex';

import { Artifacts } from './application/artifacts.ts';
import { Authentication } from './application/authentication.ts';
import { ChatTurns } from './application/chat-turns.ts';
import { Conversations } from './application/conversations.ts';
import { Library } from './application/library.ts';
import { MemoryReconciler } from './application/memory-reconciler.ts';
import { Memory } from './application/memory.ts';
import type { Clock } from './application/ports/clock.ts';
import type { DocumentReader } from './application/ports/document-reader.ts';
import type { FileStore } from './application/ports/file-store.ts';
import type { Mailer } from './application/ports/mailer.ts';
import type { ModelCatalog } from './application/ports/model-catalog.ts';
import type { WebSearch } from './application/ports/web-search.ts';
import { PreAnalysis } from './application/pre-analysis.ts';
import { Quotas } from './application/quotas.ts';
import { UsageRecorder } from './application/usage-recorder.ts';
import { UserAccess } from './application/user-access.ts';
import { SqliteArtifactRepository } from './infrastructure/database/sqlite-artifact-repository.ts';
import { SqliteConversationRepository } from './infrastructure/database/sqlite-conversation-repository.ts';
import { SqliteLibraryRepository } from './infrastructure/database/sqlite-library-repository.ts';
import { SqliteMemoryRepository } from './infrastructure/database/sqlite-memory-repository.ts';
import { SqliteSessionStore } from './infrastructure/database/sqlite-session-store.ts';
import { SqliteSignInRequestStore } from './infrastructure/database/sqlite-sign-in-request-store.ts';
import { SqliteUsageLedger } from './infrastructure/database/sqlite-usage-ledger.ts';
import { SqliteUserRepository } from './infrastructure/database/sqlite-user-repository.ts';
import { InMemoryLoginAttemptLimiter } from './infrastructure/in-memory-login-attempt-limiter.ts';
import { createRoutes } from './presentation/http/routes.ts';

const LIMIT_WINDOW_MS = 15 * 60 * 1000;
/** Emails per window: enough for typos and "I did not get it", too few to flood an inbox. */
const MAX_SIGN_IN_EMAILS = { email: 5, address: 20 };
/** Wrong codes per window: guessing one of a million codes stays hopeless. */
const MAX_WRONG_CODES = { email: 10, address: 30 };

export type AppOptions = {
  version: string;
  publicUrl: string;
  adminEmail: string | null;
  /** Development only; `null` in production. */
  devSignInCode: string | null;
  /** USD per calendar month for users whose quota the admin did not set. */
  defaultMonthlyQuotaUsd: number;
};

/**
 * Adapters from outside: `main.ts` gives the real ones, the HTTP tests fakes. Without `webSearch` the model cannot
 * search.
 */
export type AppAdapters = {
  clock: Clock;
  mailer: Mailer;
  models: ModelCatalog;
  webSearch: WebSearch | null;
  fileStore: FileStore;
  documents: DocumentReader;
};

/** Wires the application; the composition root for `main.ts` and the HTTP tests. */
export async function createApp(
  database: Knex,
  { clock, mailer, models, webSearch, fileStore, documents }: AppAdapters,
  options: AppOptions,
) {
  const users = new SqliteUserRepository(database);
  const sessions = new SqliteSessionStore(database);
  const signInRequests = new SqliteSignInRequestStore(database);
  const conversations = new SqliteConversationRepository(database);
  const userAccess = new UserAccess(users, sessions, signInRequests, mailer, clock, options.publicUrl);
  const ledger = new SqliteUsageLedger(database);
  const usage = new UsageRecorder(ledger, models, clock);
  const quotas = new Quotas(ledger, users, clock, options.defaultMonthlyQuotaUsd);
  const memory = new Memory(new SqliteMemoryRepository(database), conversations, clock);
  const library = new Library(new SqliteLibraryRepository(database), fileStore, documents, clock);
  const artifacts = new Artifacts(new SqliteArtifactRepository(database), clock);
  if (options.adminEmail) await userAccess.ensureAdmin(options.adminEmail);

  return createRoutes({
    version: options.version,
    authentication: new Authentication(
      users,
      sessions,
      signInRequests,
      mailer,
      new InMemoryLoginAttemptLimiter(LIMIT_WINDOW_MS, MAX_SIGN_IN_EMAILS),
      new InMemoryLoginAttemptLimiter(LIMIT_WINDOW_MS, MAX_WRONG_CODES),
      clock,
      options.publicUrl,
      options.devSignInCode,
    ),
    userAccess,
    conversations: new Conversations(conversations),
    memory,
    chatTurns: new ChatTurns(
      conversations,
      new PreAnalysis(models, usage),
      memory,
      new MemoryReconciler(models, usage),
      usage,
      quotas,
      library,
      artifacts,
      models,
      clock,
      webSearch,
    ),
    quotas,
    library,
    artifacts,
  });
}
