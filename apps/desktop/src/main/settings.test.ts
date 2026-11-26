import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSettings, writeSettings, SettingsPatch } from './settings.js';
import { LANGUAGES, translations } from '../renderer/i18n.js';

test('settings: all 12 languages persist and have translations', () => {
  const prevHome = process.env['CAMELEON_HOME'];
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cameleon-settings-test-'));
  process.env['CAMELEON_HOME'] = tmpHome;

  try {
    // Default language should be 'en'
    const initial = readSettings();
    assert.equal(initial.language, 'en');

    for (const lang of LANGUAGES) {
      const parsed = SettingsPatch.parse({ language: lang.code });
      assert.equal(parsed.language, lang.code);

      const written = writeSettings({ language: lang.code });
      assert.equal(written.language, lang.code);

      const reloaded = readSettings();
      assert.equal(reloaded.language, lang.code);

      // Verify UI translations exist for core nav & settings keys
      const dict = translations[lang.code];
      assert.ok(dict, `Missing translations dictionary for ${lang.code}`);
      assert.ok(dict['nav.overview'], `Missing nav.overview for ${lang.code}`);
      assert.ok(dict['nav.settings'], `Missing nav.settings for ${lang.code}`);
      assert.ok(dict['settings.language'], `Missing settings.language for ${lang.code}`);
    }

    // Invalid language code must be rejected
    assert.throws(() => SettingsPatch.parse({ language: 'invalid-xx' }));
  } finally {
    if (prevHome === undefined) delete process.env['CAMELEON_HOME'];
    else process.env['CAMELEON_HOME'] = prevHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
