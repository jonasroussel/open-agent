import { isLocale, type Locale } from '@open-agent/shared';
import { createInstance } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import { en, type Translation } from './en.ts';
import { fr } from './fr.ts';

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: { translation: Translation };
  }
}

export const i18n = createInstance();

i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

// Bundled resources: `init` is synchronous, the first render already has the strings.
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    supportedLngs: ['fr', 'en'],
    nonExplicitSupportedLngs: true,
    fallbackLng: 'fr',
    interpolation: { escapeValue: false },
  });

/** The language shown, sent with requests whose emails must use it. */
export function currentLocale(): Locale {
  return isLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'fr';
}
