import type { ApiError } from '@open-agent/shared';

/** The part of Bun's server the routes use. `timeout(request, 0)` keeps a long answer stream from being cut. */
export type ServerHandle = {
  requestIP(request: Request): { address: string } | null;
  timeout(request: Request, seconds: number): void;
};

export function error(code: ApiError['error'], status: number): Response {
  return Response.json({ error: code } satisfies ApiError, { status });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Behind a reverse proxy, the original protocol comes in a header. */
export function isHttps(request: Request): boolean {
  return new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
}

/**
 * The person's address, for the sign-in limits. Behind the reverse proxy every request comes from its own address, so
 * the original one is read from the header it sets; otherwise everyone would share one bucket. The proxy appends the
 * address it saw: the entries before it are whatever the client sent.
 */
export function clientAddress(request: Request, server: ServerHandle, trustProxy: boolean): string {
  const forwarded = trustProxy ? request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() : undefined;
  return forwarded || server.requestIP(request)?.address || 'unknown';
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type Handler = (request: Request, server: ServerHandle) => Response | Promise<Response>;

/**
 * `SameSite=Lax` still sends the session cookie from a sibling subdomain (same site), so a change from a page of
 * another origin is refused. Browsers name that origin; scripts send no `Origin` and no stolen cookie.
 */
export function refuseForeignOrigins<Routes extends Record<string, object>>(routes: Routes, publicUrl: string): Routes {
  const appOrigin = new URL(publicUrl).origin;
  const guard =
    (handler: Handler): Handler =>
    (request, server) => {
      const origin = request.headers.get('origin');
      if (origin && origin !== appOrigin && !SAFE_METHODS.has(request.method)) return error('invalid_request', 403);
      return handler(request, server);
    };
  return Object.fromEntries(
    Object.entries(routes).map(([path, methods]) => [
      path,
      Object.fromEntries(Object.entries(methods as Record<string, Handler>).map(([method, h]) => [method, guard(h)])),
    ]),
  ) as Routes;
}
