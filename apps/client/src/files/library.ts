import {
  API_ROUTES,
  type ApiError,
  type LibraryFileDto,
  type ListLibraryFilesResponse,
  type UploadFileResponse,
} from '@open-agent/shared';
import { queryOptions } from '@tanstack/react-query';
import type { FileUIPart } from 'ai';

import { apiOrThrow, type ApiResult } from '@/lib/api.ts';

export const libraryFilesQuery = queryOptions({
  queryKey: [API_ROUTES.files],
  queryFn: async () => (await apiOrThrow<ListLibraryFilesResponse>(API_ROUTES.files)).files,
});

/** Photos are sent at most this wide or tall: small print stays readable, and a phone uploads them fast. */
const MAX_PHOTO_SIDE = 2048;
const SMALL_PHOTO_BYTES = 1.5 * 1024 * 1024;

export async function uploadFile(file: File): Promise<ApiResult<LibraryFileDto>> {
  const form = new FormData();
  form.append('file', await preparePhoto(file));
  try {
    const response = await fetch(API_ROUTES.files, { method: 'POST', body: form });
    const body: unknown = await response.json();
    if (!response.ok) return { ok: false, error: (body as ApiError).error };
    return { ok: true, data: (body as UploadFileResponse).file };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** How a message points to a file of the library. */
export function toFilePart(file: LibraryFileDto): FileUIPart {
  return { type: 'file', mediaType: file.mediaType, filename: file.name, url: file.url };
}

/**
 * A big photo becomes a JPEG of at most `MAX_PHOTO_SIDE` pixels, turned the right way up. An image the browser cannot
 * open (HEIC in Chrome) goes as it is, and the server says it is not supported.
 */
async function preparePhoto(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= SMALL_PHOTO_BYTES) {
    bitmap.close();
    return file;
  }
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
}
