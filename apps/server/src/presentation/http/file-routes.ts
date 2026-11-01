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
          return new Response(opened.bytes, {
            headers: {
              'content-type': opened.file.mediaType,
              'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(opened.file.name)}`,
              // Only images, PDFs, Word and plain text are stored; the browser must not guess anything else.
              'x-content-type-options': 'nosniff',
              // A file never changes under its id.
              'cache-control': 'private, max-age=31536000, immutable',
            },
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
          return new Response(preview.bytes, {
            headers: {
              'content-type': preview.mediaType,
              'x-content-type-options': 'nosniff',
              'cache-control': 'private, max-age=31536000, immutable',
            },
          });
        }),
    },
  };
}
