import { API_ROUTES, type ListLibraryFilesResponse, type UploadFileResponse } from '@open-agent/shared';
import type { BunRequest } from 'bun';

import type { Library } from '../../application/library.ts';
import type { User } from '../../domain/user.ts';
import { error } from './http.ts';
import { toLibraryFileDto } from './presenters.ts';

export type FileHttpDependencies = {
  signedInUser: (request: BunRequest) => Promise<User | null>;
  library: Library;
};

const UPLOAD_STATUS = {
  file_too_large: 413,
  file_type_unsupported: 415,
  file_unreadable: 422,
  file_too_long: 422,
} as const;

/**
 * A file never changes under its id, but who may read it does: on a shared computer, a file must not stay readable from
 * the browser's cache after sign-out, its deletion or its reader leaving the conversation. Each use asks again, and a
 * `304` spares sending the bytes. A part is sent when asked (`range`): Safari plays a recording or a video only so.
 */
function revalidated(request: BunRequest, tag: string, body: Uint8Array, headers: Record<string, string>): Response {
  const etag = `"${tag}"`;
  const cacheHeaders = { etag, 'cache-control': 'private, no-cache', 'accept-ranges': 'bytes' };
  const known = (request.headers.get('if-none-match') ?? '')
    .split(',')
    .map((value) => value.trim().replace(/^W\//, ''));
  if (known.includes(etag)) return new Response(null, { status: 304, headers: cacheHeaders });
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range')?.trim() ?? '');
  if (!range || (!range[1] && !range[2])) return new Response(body, { headers: { ...headers, ...cacheHeaders } });
  // `bytes=-500`: the last 500 bytes.
  const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
  if (start > end) {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${body.length}` } });
  }
  return new Response(body.subarray(start, end + 1), {
    status: 206,
    headers: { ...headers, ...cacheHeaders, 'content-range': `bytes ${start}-${end}/${body.length}` },
  });
}

export function createFileRoutes({ signedInUser, library }: FileHttpDependencies) {
  const withUser = async (request: BunRequest, handle: (user: User) => Promise<Response>) => {
    const user = await signedInUser(request);
    return user ? handle(user) : error('not_signed_in', 401);
  };

  return {
    [API_ROUTES.files]: {
      GET: (request: BunRequest) =>
        withUser(request, async (user) => {
          const files = await library.list(user);
          return Response.json({ files: files.map(toLibraryFileDto) } satisfies ListLibraryFilesResponse);
        }),
      POST: (request: BunRequest) =>
        withUser(request, async (user) => {
          const form = await request.formData().catch(() => null);
          const file = form?.get('file');
          if (!(file instanceof File)) return error('invalid_request', 400);
          const result = await library.upload(user, {
            name: file.name,
            mediaType: file.type,
            bytes: new Uint8Array(await file.arrayBuffer()),
          });
          if (!result.ok) return error(result.reason, UPLOAD_STATUS[result.reason]);
          return Response.json({ file: toLibraryFileDto(result.file) } satisfies UploadFileResponse, { status: 201 });
        }),
    },

    [API_ROUTES.file]: {
      GET: (request: BunRequest<typeof API_ROUTES.file>) =>
        withUser(request, async (user) => {
          const opened = await library.open(user, request.params.fileId);
          if (!opened) return error('not_found', 404);
          return revalidated(request, opened.file.id, opened.bytes, {
            'content-type': opened.file.mediaType,
            'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(opened.file.name)}`,
            // Only images, PDFs, Word, Excel, recordings, videos and plain text are stored; the browser must not guess.
            'x-content-type-options': 'nosniff',
          });
        }),
      DELETE: (request: BunRequest<typeof API_ROUTES.file>) =>
        withUser(request, async (user) =>
          (await library.delete(user, request.params.fileId))
            ? new Response(null, { status: 204 })
            : error('not_found', 404),
        ),
    },

    [API_ROUTES.filePreview]: {
      GET: (request: BunRequest<typeof API_ROUTES.filePreview>) =>
        withUser(request, async (user) => {
          const preview = await library.preview(user, request.params.fileId);
          if (!preview) return error('not_found', 404);
          return revalidated(request, `${request.params.fileId}-preview`, preview.bytes, {
            'content-type': preview.mediaType,
            'x-content-type-options': 'nosniff',
          });
        }),
    },
  };
}
