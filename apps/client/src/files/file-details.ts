import type { LibraryFileDto } from '@open-agent/shared';

/** "1,2 Mo · 3 nov. 2026": the size the way people say it, and the day it was sent. */
export function fileDetails(file: LibraryFileDto, language: string): string {
  const day = new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(file.createdAt));
  return `${fileSize(file.size, language)} · ${day}`;
}

/** "1,2 Mo", "36 ko". */
export function fileSize(size: number, language: string): string {
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: size >= 1024 * 1024 ? 'megabyte' : 'kilobyte',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(size >= 1024 * 1024 ? size / (1024 * 1024) : Math.max(1, size / 1024));
}
