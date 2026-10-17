// Language manifest. Message text lives in template/i18n/<code>.json, one flat
// catalog per language; scripts/verify-i18n-contract.py keeps every catalog in
// step with the English source. Menu data is never translated.
export const SOURCE_LANGUAGE = 'en';

// Sorted by English name: the picker reads "English name · native name".
export const LANGUAGES = Object.freeze([
  {code: 'zh-Hans', name: 'Chinese (Simplified)', native: '简体中文'},
  {code: 'zh-Hant', name: 'Chinese (Traditional)', native: '繁體中文'},
  {code: 'da', name: 'Danish', native: 'Dansk'},
  {code: 'en', name: 'English', native: 'English'},
  {code: 'fr', name: 'French', native: 'Français'},
  {code: 'de', name: 'German', native: 'Deutsch'},
  {code: 'it', name: 'Italian', native: 'Italiano'},
  {code: 'ja', name: 'Japanese', native: '日本語'},
  {code: 'la', name: 'Latin', native: 'Latina'},
  {code: 'gsw', name: 'Swiss German', native: 'Schwiizertüütsch'},
].map(Object.freeze));
export const LANGUAGE_CODES = Object.freeze(LANGUAGES.map(language => language.code));

export function languageLabel(language) {
  return language.name === language.native ? language.name : language.name + ' · ' + language.native;
}

/** First supported language in the visitor's preference list (BCP 47 tags). */
export function matchLanguage(preferred) {
  for (const tag of Array.isArray(preferred) ? preferred : []) {
    const parts = String(tag).toLowerCase().split('-');
    const exact = LANGUAGES.find(language => language.code.toLowerCase() === parts.join('-'));
    if (exact) return exact.code;
    if (parts[0] === 'zh') return parts.some(part => ['hant', 'tw', 'hk', 'mo'].includes(part)) ? 'zh-Hant' : 'zh-Hans';
    const base = LANGUAGES.find(language => language.code === parts[0]);
    if (base) return base.code;
  }
  return SOURCE_LANGUAGE;
}
