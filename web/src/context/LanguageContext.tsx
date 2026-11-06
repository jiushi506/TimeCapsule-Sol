import React, { useCallback, useEffect, useState, ReactNode } from 'react';
import { Language, LanguageOption, SUPPORTED_LANGUAGES } from './languageConfig';
import { englishTranslations, loadTranslations } from './locales';
import { LanguageContext } from './languageContextState';
export { useLanguage } from './languageContextState';
export { englishTranslations };

export type { Language, LanguageOption };
export { SUPPORTED_LANGUAGES };

const htmlLangByLanguage: Record<Language, string> = {
  en: 'en',
  zh: 'zh-Hans',
  ja: 'ja',
  ko: 'ko',
  'pt-BR': 'pt-BR',
  hi: 'hi',
  uk: 'uk',
  ru: 'ru',
  th: 'th',
};

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('timecapsule_lang') as Language;
      if (SUPPORTED_LANGUAGES.some((item) => item.code === saved)) return saved;
      return 'en';
    } catch {
      return 'en';
    }
  });
  const [dictionary, setDictionary] = useState<Record<string, string>>(englishTranslations);

  useEffect(() => {
    let active = true;
    void loadTranslations(language)
      .then((loaded) => {
        if (active) setDictionary(loaded);
      })
      .catch((error) => {
        console.error(`Failed to load ${language} translations:`, error);
      });
    return () => {
      active = false;
    };
  }, [language]);

  const setLanguage = (lang: Language) => {
    setDictionary(englishTranslations);
    setLanguageState(lang);
    try {
      localStorage.setItem('timecapsule_lang', lang);
    } catch (error) {
      console.error('Failed to save language preference:', error);
    }
  };

  const currentLanguage =
    SUPPORTED_LANGUAGES.find((item) => item.code === language) || SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    document.documentElement.lang = htmlLangByLanguage[language];
  }, [language]);

  const t = useCallback((key: string): string => {
    return dictionary[key] || englishTranslations[key] || key;
  }, [dictionary]);

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        languages: SUPPORTED_LANGUAGES,
        currentLanguage,
        t,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};
