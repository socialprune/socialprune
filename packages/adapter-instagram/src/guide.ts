import type { GuideFact, PlatformGuide } from '@socialprune/core/guide/types';

// EN help re-read through public-page search excerpts on 2026-10-25.
// German article quotes supplied by the same-day independent reading (R2).
// This lane's GETs returned HTTP 200 but no article (fail_bad_preloaders).
const source = {
  url: 'https://www.facebook.com/help/instagram/181231772500920',
  publisher: 'Meta',
  title:
    'Review and export a copy of your Instagram information | Instagram Help Center',
};
const androidSource = {
  url: 'https://www.facebook.com/help/instagram/android-app/181231772500920',
  publisher: 'Meta',
  title:
    'Review and export a copy of your Instagram information | Instagram Help Center',
};
const sourceGb = {
  url: 'https://www.facebook.com/help/instagram/181231772500920?locale=en_GB',
  publisher: 'Meta',
  title:
    'Review and export a copy of your Instagram information | Instagram Help Centre',
};
const sourceDe = {
  url: 'https://www.facebook.com/help/instagram/181231772500920/?locale=de_DE',
  publisher: 'Meta',
  title:
    'Eine Kopie deiner Instagram-Informationen überprüfen und exportieren | Instagram-Hilfebereich',
};
const androidSourceDe = {
  ...sourceDe,
  url: 'https://www.facebook.com/help/instagram/android-app/181231772500920?locale=de_DE',
};
const editsSource = {
  url: 'https://www.facebook.com/help/instagram/7130835797039956?locale=en_GB',
  publisher: 'Meta',
  title: 'View and export your Edits information | Instagram Help Centre',
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
  retrievedOn: '2026-10-25',
  verifiedOn: '2026-10-25',
});

export const instagramGuide: PlatformGuide<'instagram'> = {
  platform: 'instagram',
  startUrl: {
    ...fact(
      'start',
      'On a computer, Meta says to click "More" at the bottom left, then "Settings", "Meta Account", "Your information and permissions", "Export your information" and "Create export". Meta describes "More" as a hamburger icon (≡). Select the profile, click "Next" and choose "Export to device". Customize the export options, then click "Start export". Meta says some accounts show "Accounts Center" instead of "Meta Account" during the rollout. Follow these steps yourself in Instagram; this guide does not operate the platform.',
      'Am Computer sollst du laut Meta unten links „Mehr“ („More“) und dann „Einstellungen“ („Settings“), „Meta-Konto“ („Meta Account“), „Deine Informationen und Berechtigungen“ („Your information and permissions“), „Deine Informationen exportieren“ („Export your information“) und „Export erstellen“ („Create export“) anklicken. Meta beschreibt den ersten Menüpunkt als Hamburger-Symbol (≡). Wähle das Profil, klicke auf „Weiter“ („Next“) und wähle „Zu Gerät exportieren“ („Export to device“). Passe die Optionen an und klicke auf „Export starten“ („Start export“). Laut Meta kann während der Umstellung statt des Meta-Kontos die „Kontenübersicht“ („Accounts Center“) erscheinen. Führe die Schritte selbst in Instagram aus. Diese Anleitung bedient die Plattform nicht.',
    ),
    sourceDe,
  },
  steps: [
    {
      ...fact(
        'request',
        'On Android, Meta’s device-specific help says to tap "Accounts Center", "Your information and permissions", "Export your information" and "Create export". Select the profile, tap "Next" and choose "Export to device". Customize the options, then tap "Start export". The general help also uses "Meta Account" during the rollout; check the help if your menus differ.',
        'Unter Android nennt Meta während der Umstellung die „Kontenübersicht“ („Accounts Center“) oder „Meta-Konto“ („Meta Account“). Tippe dort auf „Deine Informationen und Berechtigungen“ („Your information and permissions“), „Deine Informationen exportieren“ („Export your information“) und „Export erstellen“ („Create export“). Wähle das Profil, tippe auf „Weiter“ („Next“) und wähle „Zu Gerät exportieren“ („Export to device“). Passe die Optionen an und tippe auf „Export starten“ („Start export“). Prüfe die Hilfe, wenn deine Menüs abweichen.',
        androidSource,
      ),
      sourceDe: androidSourceDe,
    },
    fact(
      'delivery',
      'Meta says that an export to your device brings both an email notification and a notification on Instagram when it is ready. The help-page excerpts read for this guide do not establish whether the download can have several parts.',
      'Meta gibt an, dass du bei einem fertigen Export auf dein Gerät sowohl eine E-Mail als auch eine Benachrichtigung in Instagram erhältst. Die für diese Anleitung gelesenen Auszüge der Hilfeseite belegen nicht, ob der Download mehrere Teile haben kann.',
      sourceGb,
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
      'Meta says you can select specific information, a date range and the notification email. For a review of all your old comments, include the relevant information and the whole time range. The help-page excerpts read for this guide do not establish the whole-range option’s label.',
      'Meta gibt an, dass du bestimmte Informationen, einen Zeitraum und die E-Mail-Adresse für die Benachrichtigung auswählen kannst. Nimm für eine Durchsicht aller alten Kommentare die passenden Informationen und den gesamten Zeitraum auf. Die gelesenen Auszüge der Hilfeseite belegen den Namen dieser Zeitraumoption nicht.',
    ),
    fact(
      'media',
      'Meta says the selected information and media quality can change the file size. SocialPrune does not show export media, so choose the lowest media quality if offered. The help-page excerpts read for this guide do not establish the quality-level labels.',
      'Meta gibt an, dass die ausgewählten Informationen und die Medienqualität die Dateigröße beeinflussen. SocialPrune zeigt keine Medien aus dem Export, also wähle die niedrigste Medienqualität, falls sie angeboten wird. Die gelesenen Auszüge der Hilfeseite belegen die Namen der Qualitätsstufen nicht.',
    ),
  ],
  waiting: {
    ...fact(
      'waiting',
      'Meta says it may take up to 30 days to email you an export link. The help-page excerpts read for this guide give no minimum or typical duration. The calendar date you choose is a reminder, not a promised delivery date.',
      'Meta gibt an, dass es bis zu 30 Tage dauern kann, bis du einen Exportlink per E-Mail erhältst. Die gelesenen Auszüge der Hilfeseite nennen keine Mindestdauer oder typische Wartezeit. Dein gewählter Kalendertermin ist eine Erinnerung, kein zugesagter Bereitstellungstermin.',
      sourceGb,
    ),
    typicalDays: null,
  },
  downloadWindow: {
    ...fact(
      'download-window',
      'Meta says that once the export is ready, you have 4 days to download it from "Available downloads" in the "Export your information" tool in "Accounts Centre" (the UK English help page’s spelling).',
      'Meta gibt an, dass du nach der Bereitstellung 4 Tage Zeit hast, den Export unter „Verfügbare Downloads“ („Available downloads“) im Werkzeug „Deine Informationen exportieren“ („Export your information“) in der „Kontenübersicht“ („Accounts Centre“ in der britisch-englischen Quelle) herunterzuladen.',
      sourceGb,
    ),
    sourceDe,
    days: 4,
  },
  htmlExportHint: fact(
    'html',
    'If SocialPrune identifies an HTML export, request another export and choose JSON if offered. The HTML version cannot be read here. Meta’s Edits export help mentions both formats, but does not confirm the main Instagram selector’s labels.',
    'Wenn SocialPrune einen HTML-Export erkennt, fordere einen neuen Export an und wähle JSON, falls es angeboten wird. Die HTML-Version lässt sich hier nicht einlesen. Meta nennt beide Formate in der Exporthilfe für Edits, bestätigt dort aber nicht die Bezeichnungen der Formatauswahl des Instagram-Exports.',
    editsSource,
  ),
};
