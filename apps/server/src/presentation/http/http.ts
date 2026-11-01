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

export function clientAddress(request: Request, server: ServerHandle): string {
  return server.requestIP(request)?.address ?? 'unknown';
}
