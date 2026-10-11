import type { GuideFact, PlatformGuide } from '@socialprune/core/guide/types';

// Public help evidence supplied from read-only research on 2026-10-11.
// Only English labels were recorded; do not invent German button names.
const source = {
  url: 'https://www.facebook.com/help/instagram/181231772500920/',
  publisher: 'Meta',
  title: 'Instagram export help (page title not recorded)',
};
const androidSource = {
  url: 'https://www.facebook.com/help/instagram/android-app/181231772500920',
  publisher: 'Meta',
  title: 'Instagram Android export help (page title not recorded)',
};
const editsSource = {
  url: 'https://www.facebook.com/help/instagram/7130835797039956?locale=en_GB',
  publisher: 'Meta',
  title: 'Edits export help (page title not recorded)',
};
const fact = (
  id: string,
  en: string,
  de: string,
  factSource = source,
): GuideFact => ({
  id: `instagram.${id}`,
  text: { en, de },
  source: factSource,
  retrievedOn: '2026-10-11',
  verifiedOn: null,
});

export const instagramGuide: PlatformGuide<'instagram'> = {
  platform: 'instagram',
  startUrl: fact(
    'start',
    'On a computer, Meta says to click "More" at the bottom left, then "Settings", "Meta Account" and "Your information and permissions". Customize the export options, then click "Start export". Follow these steps yourself in Instagram; SocialPrune does not open or operate the platform.',
    'Am Computer sollst du laut Meta unten links "More" und dann "Settings", "Meta Account" und "Your information and permissions" anklicken. Passe die Exportoptionen an und klicke auf "Start export". Die zitierten Menü- und Schaltflächennamen stammen aus englischen Hilfeseiten; die deutschen Namen sind noch nicht bestätigt. Führe die Schritte selbst in Instagram aus. SocialPrune öffnet oder bedient die Plattform nicht.',
  ),
  steps: [
    fact(
      'request',
      'On Android, Meta says to tap "Meta Account", "Your information and permissions", "Export your information" and "Create export". Select the profile, tap "Next" and choose "Export to device". Customize the options, then tap "Start export". Meta notes that some accounts still show "Accounts Center" during the rollout.',
      'Unter Android sollst du laut Meta auf "Meta Account", "Your information and permissions", "Export your information" und "Create export" tippen. Wähle das Profil, tippe auf "Next" und wähle "Export to device". Passe die Optionen an und tippe auf "Start export". Meta weist darauf hin, dass manche Accounts während der Umstellung noch "Accounts Center" anzeigen.',
      androidSource,
    ),
    fact(
      'delivery',
      'Meta says that an export to your device brings both an email notification and a notification on Instagram when it is ready. The help pages do not state whether the download can have several parts.',
      'Meta gibt an, dass du bei einem fertigen Export auf dein Gerät sowohl eine E-Mail als auch eine Benachrichtigung in Instagram erhältst. Die Hilfeseiten sagen nicht, ob der Download mehrere Teile haben kann.',
    ),
  ],
  options: [
    fact(
      'format',
      'SocialPrune needs JSON, not HTML, for Instagram comments. Choose JSON if offered. Meta’s Edits export help describes HTML and JSON formats, but that page is not the main Instagram format selector; its current selector values are unconfirmed.',
      'SocialPrune braucht JSON statt HTML für Instagram-Kommentare. Wähle JSON, falls es angeboten wird. Meta beschreibt HTML und JSON in der Exporthilfe für Edits. Diese Seite ist aber nicht die Formatauswahl des Instagram-Exports; deren aktuelle Auswahlwerte sind nicht bestätigt.',
      editsSource,
    ),
    fact(
      'range',
      'Meta says you can select specific information, a date range and the notification email. For a review of all your old comments, include the relevant information and the whole time range. The help page does not name the whole-range option.',
      'Meta gibt an, dass du bestimmte Informationen, einen Zeitraum und die E-Mail-Adresse für die Benachrichtigung auswählen kannst. Nimm für eine Durchsicht aller alten Kommentare die passenden Informationen und den gesamten Zeitraum auf. Die Hilfeseite nennt keinen Namen für die Auswahl des gesamten Zeitraums.',
    ),
    fact(
      'media',
      'Meta says the selected information and media quality can change the file size. SocialPrune does not show export media, so choose the lowest media quality if offered. The help page does not name the quality levels.',
      'Meta gibt an, dass die ausgewählten Informationen und die Medienqualität die Dateigröße beeinflussen. SocialPrune zeigt keine Medien aus dem Export, also wähle die niedrigste Medienqualität, falls sie angeboten wird. Die Hilfeseite nennt keine Qualitätsstufen.',
    ),
  ],
  waiting: {
    ...fact(
      'waiting',
      'Meta says it may take up to 30 days to email you an export link. It gives no minimum or typical duration. The calendar date you choose is a reminder, not a promised delivery date.',
      'Meta gibt an, dass es bis zu 30 Tage dauern kann, bis du einen Exportlink per E-Mail erhältst. Meta nennt keine Mindestdauer oder typische Wartezeit. Dein gewählter Kalendertermin ist eine Erinnerung, kein zugesagter Bereitstellungstermin.',
    ),
    typicalDays: null,
  },
  downloadWindow: {
    ...fact(
      'download-window',
      'Meta says that once the export is ready, you have 4 days to download it from "Available downloads" in the "Export your information" tool in "Accounts Center".',
      'Meta gibt an, dass du nach der Bereitstellung 4 Tage Zeit hast, den Export unter "Available downloads" im Werkzeug "Export your information" in "Accounts Center" herunterzuladen.',
    ),
    days: 4,
  },
  htmlExportHint: fact(
    'html',
    'If SocialPrune identifies an HTML export, request another export and choose JSON if offered. The HTML version cannot be read here. Meta’s Edits export help mentions both formats, but does not confirm the main Instagram selector’s labels.',
    'Wenn SocialPrune einen HTML-Export erkennt, fordere einen neuen Export an und wähle JSON, falls es angeboten wird. Die HTML-Version lässt sich hier nicht einlesen. Meta nennt beide Formate in der Exporthilfe für Edits, bestätigt dort aber nicht die Bezeichnungen der Formatauswahl des Instagram-Exports.',
    editsSource,
  ),
};
