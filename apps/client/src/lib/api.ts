import type { ApiError } from '@open-agent/shared';

import { sessionQuery } from '@/auth/session.ts';

import { queryClient } from './query-client.ts';

export type ApiErrorCode = ApiError['error'] | 'network';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorCode };

/**
 * Every call to our API goes through here: a session that ended meanwhile (signed out on another device, revoked,
 * expired) sends an open app to the sign-in page. A full load, so nothing of the person stays in memory.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 401 && queryClient.getQueryData(sessionQuery.queryKey)) {
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as ApiError | null;
    if (body?.error === 'not_signed_in') {
      queryClient.setQueryData(sessionQuery.queryKey, null);
      window.location.assign('/sign-in');
    }
  }
  return response;
}

/** JSON calls to our API. Errors come back as a code, never thrown, so each screen picks its translated message. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; keepalive?: boolean } = {},
): Promise<ApiResult<T>> {
  try {
    const response = await apiFetch(path, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      keepalive: init.keepalive,
    });
    if (response.status === 204) return { ok: true, data: undefined as T };
    const body: unknown = await response.json();
    return response.ok ? { ok: true, data: body as T } : { ok: false, error: (body as ApiError).error };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** For TanStack Query, which needs a thrown error to show the failure. */
export class ApiFailure extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode) {
    super(code);
    this.code = code;
  }
}

export async function apiOrThrow<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const result = await api<T>(path, init);
  if (!result.ok) throw new ApiFailure(result.error);
  return result.data;
}
