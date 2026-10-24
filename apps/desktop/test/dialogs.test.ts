import { expect, test } from 'vitest';
import {
  dialogLocale,
  dialogLabels,
  openDialogOptions,
  saveDialogOptions,
} from '../src/main/dialogs.ts';
import { mkdtemp, rm, writeFile, readFile, link } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readLanguage, writeLanguage } from '../src/main/language.ts';
test('main dialog copy follows chosen app language and strict fallback, not a translated renderer payload', () => {
  expect(dialogLocale('de', 'en-US')).toBe('de');
  expect(dialogLocale('en', 'de-DE')).toBe('en');
  expect(dialogLocale('generated', 'de-AT')).toBe('de');
  expect(openDialogOptions('importExport', 'de')).toMatchObject({
    title: 'Plattformexport öffnen',
    buttonLabel: 'Importieren',
    filters: [{ extensions: ['zip'] }],
    properties: ['openFile', 'multiSelections'],
  });
  expect(openDialogOptions('backupRestore', 'en')).toMatchObject({
    title: 'Restore SocialPrune backup',
    buttonLabel: 'Restore',
  });
  expect(saveDialogOptions('de')).toMatchObject({
    buttonLabel: 'Exportieren',
    defaultPath: 'socialprune-backup.json',
    properties: ['showOverwriteConfirmation'],
  });
  expect(dialogLabels('de')).toMatchObject({
    stop: 'Stopp',
    cancel: 'Abbrechen',
    stopMessage:
      'Ein Lauf ist aktiv. Soll SocialPrune ihn stoppen und sich schließen?',
  });
});

test('main remembers only a bounded en/de preference for startup before a document can load', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-main-language-'));
  try {
    expect(await readLanguage(root, 'de-AT')).toBe('de');
    await writeLanguage(root, 'en');
    expect(await readLanguage(root, 'de-DE')).toBe('en');
    await writeLanguage(root, 'de');
    expect(await readLanguage(root, 'en-US')).toBe('de');
    await writeFile(
      join(root, 'ui-language.json'),
      JSON.stringify({ path: 'generated' }),
    );
    expect(await readLanguage(root, 'en-US')).toBe('en');
    await writeFile(join(root, 'ui-language.json'), 'x'.repeat(65));
    expect(await readLanguage(root, 'en-US')).toBe('en');
    await rm(join(root, 'ui-language.json'));
    const external = join(root, 'generated-other.json');
    await writeFile(external, '"en"');
    await link(external, join(root, 'ui-language.json'));
    expect(await readLanguage(root, 'de-DE')).toBe('de');
    await writeLanguage(root, 'de');
    expect(await readFile(external, 'utf8')).toBe('"en"');
    expect(await readLanguage(root, 'en-US')).toBe('de');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
