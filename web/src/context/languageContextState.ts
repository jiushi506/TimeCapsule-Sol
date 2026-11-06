import { createContext, useContext } from 'react';
import type { Language, LanguageOption } from './languageConfig';

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  languages: LanguageOption[];
  currentLanguage: LanguageOption;
  t: (key: string) => string;
}

// Keep the context identity outside the provider's translation hot-update boundary.
export const LanguageContext = createContext<LanguageContextValue | null>(null);

export const useLanguage = (): LanguageContextValue => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within a LanguageProvider');
  return context;
};
