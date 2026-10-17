import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LANGUAGES, LANGUAGE_CODES, SOURCE_LANGUAGE, languageLabel, matchLanguage} from '../template/i18n.mjs';

test('picker labels pair the English name with the native name, English once', () => {
  assert.deepEqual(LANGUAGES.map(languageLabel), [
    'Chinese (Simplified) · 简体中文', 'Chinese (Traditional) · 繁體中文', 'Danish · Dansk', 'English',
    'French · Français', 'German · Deutsch', 'Italian · Italiano', 'Japanese · 日本語', 'Latin · Latina',
    'Swiss German · Schwiizertüütsch',
  ]);
  assert.equal(SOURCE_LANGUAGE, 'en');
});
test('first visit follows the browser language list', () => {
  assert.equal(matchLanguage(['de-CH', 'en']), 'de', 'Swiss Standard German is German');
  assert.equal(matchLanguage(['gsw-CH']), 'gsw');
  assert.equal(matchLanguage(['zh-TW']), 'zh-Hant');
  assert.equal(matchLanguage(['zh-HK']), 'zh-Hant');
  assert.equal(matchLanguage(['zh-Hant-TW']), 'zh-Hant');
  assert.equal(matchLanguage(['zh-CN']), 'zh-Hans');
  assert.equal(matchLanguage(['zh']), 'zh-Hans');
  assert.equal(matchLanguage(['ja-JP']), 'ja');
  assert.equal(matchLanguage(['fr-CH']), 'fr');
  assert.equal(matchLanguage(['es-ES', 'it-CH']), 'it', 'unsupported languages are skipped');
  assert.equal(matchLanguage(['es-ES']), 'en');
  assert.equal(matchLanguage([]), 'en');
  assert.equal(matchLanguage(undefined), 'en');
  for (const code of LANGUAGE_CODES) assert.equal(matchLanguage([code]), code);
});
