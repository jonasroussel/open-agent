const isProduction = Bun.env.NODE_ENV === 'production';

export const config = {
  port: Number(Bun.env.PORT ?? 3427),
  databasePath: Bun.env.DATABASE_PATH ?? 'data/open-agent.sqlite',
  /** The users' files, and the pictures read out of them. */
  filesPath: Bun.env.FILES_PATH ?? 'data/files',
  /** Built client (`apps/client/dist`) to serve next to the API, so one port is enough. Unset in development. */
  clientDistPath: Bun.env.CLIENT_DIST_PATH ?? null,
  /** Behind the reverse proxy: the client's address comes in `x-forwarded-for`, not from the socket. */
  trustProxy: Bun.env.TRUST_PROXY === '1',
  /** Where emailed links point: the Vite dev server in development. */
  publicUrl: Bun.env.PUBLIC_URL ?? (isProduction ? required('PUBLIC_URL') : 'http://localhost:5173'),
  /** Made admin at every boot: the first admin needs no invitation. */
  adminEmail: Bun.env.ADMIN_EMAIL || null,
  /** Never logged. Unset in development: emails go to the server log. */
  plunkApiKey: Bun.env.PLUNK_API_KEY || (isProduction ? required('PLUNK_API_KEY') : null),
  /** The sender; its domain (jonasroussel.com) is the one verified in Plunk. */
  mailFrom: Bun.env.MAIL_FROM ?? 'hello@jonasroussel.com',
  /** Signs any invited user in with this code, to test on other devices. Never in production, whatever the env. */
  devSignInCode: isProduction ? null : (Bun.env.DEV_SIGN_IN_CODE ?? '123456'),
  /** USD per calendar month for users whose quota the admin did not set. The user chose 5 $ on 2026-11-01. */
  defaultMonthlyQuotaUsd: Number(Bun.env.DEFAULT_MONTHLY_QUOTA_USD ?? 5),
  /** Never logged. Without it the chat answers that no model is available. */
  openRouterApiKey: Bun.env.OPENROUTER_API_KEY || (isProduction ? required('OPENROUTER_API_KEY') : null),
  /**
   * Never logged. Encrypts the users' own OpenRouter keys: changing it makes the kept keys unreadable, so they must be
   * entered again. Development data needs no secret.
   */
  encryptionKey: Bun.env.ENCRYPTION_KEY || (isProduction ? required('ENCRYPTION_KEY') : 'development'),
  /** OpenRouter model ids per role, until the admin page changes them. The user chose these on 2026-11-01 and 2026-11-03. */
  models: {
    fast: Bun.env.FAST_MODEL ?? 'deepseek/deepseek-v4.1-flash-1017',
    reasoning: Bun.env.REASONING_MODEL ?? 'deepseek/deepseek-v4.1-flash-1017',
    background: Bun.env.BACKGROUND_MODEL ?? 'deepseek/deepseek-v4.1-flash-1017',
    image: Bun.env.IMAGE_MODEL ?? 'google/gemini-3.1-flash-lite-image',
  },
  /** Never logged. Tavily's free plan: 1,000 searches a month; SearXNG takes over when they are used up. */
  tavilyApiKey: Bun.env.TAVILY_API_KEY || null,
  /** Our SearXNG container. In development `compose.yaml` runs it. Without Tavily nor SearXNG, the model cannot search. */
  searxngUrl: Bun.env.SEARXNG_URL || (isProduction ? null : 'http://localhost:8888'),
};

function required(name: string): never {
  throw new Error(`${name} must be set in production.`);
}
