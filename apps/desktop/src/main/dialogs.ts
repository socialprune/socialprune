import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import { dialogLabels } from '../../../web/src/desktop/dialog-messages.ts';
export { dialogLabels } from '../../../web/src/desktop/dialog-messages.ts';

export type DialogLocale = 'en' | 'de';
export function dialogLocale(value: unknown, fallback: string): DialogLocale {
  return value === 'en' || value === 'de'
    ? value
    : fallback.toLowerCase().startsWith('de')
      ? 'de'
      : 'en';
}
export function openDialogOptions(
  type: 'importExport' | 'backupRestore',
  locale: DialogLocale,
): OpenDialogOptions {
  const copy = dialogLabels(locale),
    importing = type === 'importExport';
  return {
    title: importing ? copy.importTitle : copy.restoreTitle,
    buttonLabel: importing ? copy.importButton : copy.restoreButton,
    filters: [
      {
        name: importing ? copy.zip : copy.json,
        extensions: [importing ? 'zip' : 'json'],
      },
    ],
    properties: importing ? ['openFile', 'multiSelections'] : ['openFile'],
  };
}
export function saveDialogOptions(locale: DialogLocale): SaveDialogOptions {
  const copy = dialogLabels(locale);
  return {
    title: copy.exportTitle,
    buttonLabel: copy.exportButton,
    filters: [{ name: copy.json, extensions: ['json'] }],
    defaultPath: 'socialprune-backup.json',
    properties: ['showOverwriteConfirmation'],
  };
}
