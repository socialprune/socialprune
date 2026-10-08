import type { GuideFact, PlatformGuide } from '@socialprune/core/guide/types';

// Public EN and DE help GETs returned HTTP 400 on this date, without a
// readable page or redirect. Do not infer Accounts Center paths from planning.
const source = {
  url: 'https://help.instagram.com/181231772500920/',
  publisher: 'Meta',
  title: 'Page title unavailable (HTTP 400)',
};
const fact = (id: string, en: string, de: string): GuideFact => ({
  id: `instagram.${id}`,
  text: { en, de },
  source,
  retrievedOn: '2026-10-08',
  verifiedOn: null,
});

export const instagramGuide: PlatformGuide<'instagram'> = {
  platform: 'instagram',
  startUrl: fact(
    'start',
    'The public Instagram help page returned HTTP 400 when we tried to read it. The export request page and menu path are not confirmed. Open Instagram help yourself for the current instructions.',
    'Die öffentliche Instagram-Hilfeseite gab beim Leseversuch HTTP 400 zurück. Die Seite zum Anfordern des Exports und der Menüpfad sind nicht bestätigt. Öffne die Instagram-Hilfe selbst für die aktuellen Schritte.',
  ),
  steps: [
    fact(
      'request',
      'We could not read the English or German instructions. Instagram’s current button names and request steps are missing here; follow the help page in your own browser.',
      'Wir konnten die englische und die deutsche Anleitung nicht lesen. Die aktuellen Schaltflächennamen und Schritte von Instagram fehlen hier. Folge der Hilfeseite in deinem eigenen Browser.',
    ),
    fact(
      'delivery',
      'We have not confirmed how Instagram tells you an export is ready, or whether it can arrive in several parts.',
      'Wir haben nicht bestätigt, wie Instagram dich über einen fertigen Export informiert oder ob er in mehreren Teilen kommen kann.',
    ),
  ],
  options: [
    fact(
      'format',
      'SocialPrune needs JSON, not HTML, for Instagram comments. Choose JSON if offered. We could not confirm the current option names from Instagram help.',
      'SocialPrune braucht JSON statt HTML für Instagram-Kommentare. Wähle JSON, falls es angeboten wird. Die aktuellen Optionsnamen ließen sich in der Instagram-Hilfe nicht bestätigen.',
    ),
    fact(
      'range',
      'For a review of all your old comments, request the whole time range if offered. Instagram’s current option name is not confirmed.',
      'Für eine Durchsicht aller alten Kommentare brauchst du den gesamten Zeitraum, falls diese Auswahl angeboten wird. Der aktuelle Optionsname von Instagram ist nicht bestätigt.',
    ),
    fact(
      'media',
      'SocialPrune does not show export media. Choose the lowest media quality if offered; Instagram’s current choices are not confirmed.',
      'SocialPrune zeigt keine Medien aus dem Export. Wähle die niedrigste Medienqualität, falls sie angeboten wird. Die aktuellen Auswahlmöglichkeiten von Instagram sind nicht bestätigt.',
    ),
  ],
  waiting: {
    ...fact(
      'waiting',
      'We could not read Meta’s statement about the Instagram waiting time. No duration is confirmed here. The calendar date you choose is a reminder, not an estimate from Meta.',
      'Wir konnten die Angabe von Meta zur Instagram-Wartezeit nicht lesen. Hier ist keine Dauer bestätigt. Dein gewählter Kalendertermin ist eine Erinnerung, keine Zeitangabe von Meta.',
    ),
    typicalDays: null,
  },
  downloadWindow: {
    ...fact(
      'download-window',
      'The Instagram download-link expiry could not be confirmed. Check the date shown with your export when it becomes available.',
      'Die Gültigkeit des Instagram-Downloadlinks ließ sich nicht bestätigen. Prüfe das Datum, das bei deinem fertigen Export steht.',
    ),
    days: null,
  },
  htmlExportHint: fact(
    'html',
    'If SocialPrune identifies an HTML export, request another export in JSON format. The HTML version cannot be read here. Instagram’s current request steps could not be confirmed.',
    'Wenn SocialPrune einen HTML-Export erkennt, fordere einen neuen Export im JSON-Format an. Die HTML-Version lässt sich hier nicht einlesen. Die aktuellen Schritte von Instagram ließen sich nicht bestätigen.',
  ),
};
