import type { LibraryFileDto } from '@open-agent/shared';

/** "1,2 Mo · 3 nov. 2026": the size the way people say it, and the day it was sent. */
export function fileDetails(file: LibraryFileDto, language: string): string {
  const size = new Intl.NumberFormat(language, {
    style: 'unit',
    unit: file.size >= 1024 * 1024 ? 'megabyte' : 'kilobyte',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(file.size >= 1024 * 1024 ? file.size / (1024 * 1024) : Math.max(1, file.size / 1024));
  const day = new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(file.createdAt));
  return `${size} · ${day}`;
}
