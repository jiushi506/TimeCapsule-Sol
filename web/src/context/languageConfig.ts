export type Language = 'en' | 'zh' | 'ja' | 'ko' | 'pt-BR' | 'hi' | 'uk' | 'ru' | 'th';

export interface LanguageOption {
  code: Language;
  label: string;
  nativeName: string;
  shortLabel: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English', nativeName: 'English (US)', shortLabel: 'EN' },
  { code: 'zh', label: 'Chinese', nativeName: '简体中文', shortLabel: '中文' },
  { code: 'ja', label: 'Japanese', nativeName: '日本語', shortLabel: '日本語' },
  { code: 'ko', label: 'Korean', nativeName: '한국어', shortLabel: '한국어' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)', shortLabel: 'PT' },
  { code: 'hi', label: 'Hindi', nativeName: 'हिन्दी', shortLabel: 'HI' },
  { code: 'uk', label: 'Ukrainian', nativeName: 'Українська', shortLabel: 'UK' },
  { code: 'ru', label: 'Russian', nativeName: 'Русский', shortLabel: 'RU' },
  { code: 'th', label: 'Thai', nativeName: 'ไทย', shortLabel: 'TH' },
];
