export const LOCALES = ['fr', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}
