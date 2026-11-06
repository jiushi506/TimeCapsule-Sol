import type { Language } from '../languageConfig';
import { translations as englishTranslations } from '../languageDictionaries/en';

export { englishTranslations };

const languageLoaders: Record<Language, () => Promise<Record<string, string>>> = {
  en: async () => englishTranslations,
  zh: async () => (await import('../languageDictionaries/zh')).translations,
  ja: async () => (await import('../languageDictionaries/ja')).translations,
  ko: async () => (await import('../languageDictionaries/ko')).translations,
  'pt-BR': async () => (await import('../languageDictionaries/ptBR')).translations,
  hi: async () => (await import('../languageDictionaries/hi')).translations,
  uk: async () => (await import('../languageDictionaries/uk')).translations,
  ru: async () => (await import('../languageDictionaries/ru')).translations,
  th: async () => (await import('../languageDictionaries/th')).translations,
};

export const loadTranslations = (language: Language): Promise<Record<string, string>> =>
  languageLoaders[language]();
