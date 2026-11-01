# Open Agent

A private AI chat app for family and friends, as simple as a regular chat but with a memory that learns how each
person likes to work. Invitation only; served at [open-agent.jonas.bzh](https://open-agent.jonas.bzh).

- **Memory**: a remark like "your answers are always too long" becomes a rule every later answer follows; each person
  reads, edits and forgets their rules.
- **Right model, no choice to make**: a quick pre-analysis picks a fast answer or one that thinks first, rewrites a
  hurried request, or asks one short question when it is truly ambiguous.
- **Web search** (Tavily, then our own SearXNG), **files and photos** read whole (PDF, Word, images), and a **canvas**
  for documents written with the model, with versions and Word export.
- **Search** in the history, **a monthly quota** per person in real cost, or **their own OpenRouter key**.
- **Admin**: invitations, quotas, the model of each role and the prompts, changed at runtime.

The full behavior, data model and configuration are in [SPEC.md](SPEC.md).

## Stack

Bun, Turborepo. `apps/server`: `Bun.serve`, hexagonal layers, SQLite with knex, the Vercel AI SDK on OpenRouter.
`apps/client`: Vite, React, TanStack Router and Query, Tailwind and shadcn/ui, French and English. `packages/shared`:
the API routes and types both sides use.

## Development

Needs Bun 1.4 and Docker (for SearXNG).

```sh
bun install
OPENROUTER_API_KEY=… ADMIN_EMAIL=you@example.com bun run dev
```

`bun run dev` starts SearXNG (`compose.yaml`, on `localhost:8888`), the server on port 3427 and Vite on
[localhost:5173](http://localhost:5173). Without `PLUNK_API_KEY`, sign-in links and codes go to the server log, and
the code `123456` signs in any invited address. `TAVILY_API_KEY` is optional.

```sh
bun run test        # server and shared tests
bun run typecheck
bun run lint
bun run format
```

## Deployment

One image serves the API and the built client on port 3427; a second one is SearXNG with our settings.

1. Create the stack once from [deploy/compose.yaml](deploy/compose.yaml) (e.g. in Portainer) and set its variables:
   `ADMIN_EMAIL`, `PLUNK_API_KEY`, `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, and two random secrets,
   `ENCRYPTION_KEY` and `SEARXNG_SECRET` (`openssl rand -base64 32`). Never change `ENCRYPTION_KEY` afterwards: it
   encrypts the users' own OpenRouter keys.
2. Then, for each release: `PORTAINER_API_KEY=… bun run deploy` builds both images, pushes them to
   `registry.jonas.bzh` and recreates the containers.

The `/data` volume holds the database and the users' files: back it up.
