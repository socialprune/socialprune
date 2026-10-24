import en from '../i18n/en.json';
import de from '../i18n/de.json';

/** Pure catalog consumer shared by native main dialogs, with no React/runtime
 * bridge dependency. System-owned Windows dialog chrome is not translated. */
export function dialogLabels(locale: 'en' | 'de') {
  const messages = locale === 'de' ? de : en;
  return {
    importTitle: messages['desktop.dialog.importTitle'],
    importButton: messages['desktop.dialog.importButton'],
    zip: messages['desktop.dialog.zip'],
    restoreTitle: messages['desktop.dialog.restoreTitle'],
    restoreButton: messages['desktop.dialog.restoreButton'],
    exportTitle: messages['desktop.dialog.exportTitle'],
    exportButton: messages['desktop.dialog.exportButton'],
    json: messages['desktop.dialog.json'],
    stopMessage: messages['desktop.dialog.stopMessage'],
    stop: messages['desktop.stop'],
    cancel: messages['bulk.cancel'],
  };
}
