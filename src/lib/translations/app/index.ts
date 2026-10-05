import { translations as enTranslations } from './en';
import { translations as deTranslations } from './de';
import { translations as frTranslations } from './fr';
import { translations as esTranslations } from './es';
import { translations as koTranslations } from './ko';

export const appTranslations = {
  en: enTranslations.en,
  de: deTranslations.de,
  fr: frTranslations.fr,
  es: esTranslations.es,
  ko: koTranslations.ko,
};

export type AppLanguage = keyof typeof appTranslations;
export const supportedAppLanguages: AppLanguage[] = ['en', 'de', 'fr', 'es', 'ko'];

// Get entire translation object for a specific language
export function getTranslations(language: AppLanguage = 'en') {
  return appTranslations[language] || appTranslations.en;
}