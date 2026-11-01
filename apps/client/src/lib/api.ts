import type { ApiError } from '@open-agent/shared';

export type ApiErrorCode = ApiError['error'] | 'network';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorCode };

/** JSON calls to our API. Errors come back as a code, never thrown, so each screen picks its translated message. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
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
