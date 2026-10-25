import type { GuideFact, PlatformGuide } from '@socialprune/core/guide/types';

// Public EN and DE pages were read directly on 2026-10-25. Their static
// content still exposes iOS only, not the other device tabs.
const source = {
  url: 'https://help.x.com/en/managing-your-account/how-to-download-your-x-archive',
  publisher: 'X',
  title: 'How to download your X archive | X Help Center',
};
const sourceDe = {
  url: 'https://help.x.com/de/managing-your-account/how-to-download-your-x-archive',
  publisher: 'X',
  title: 'So lädst du dein X Archiv herunter | X Hilfe-Center',
};
// The public data-access pages were read directly on 2026-10-25.
// Their EN and DE web instructions differ; retain both without merging paths.
const webSource = {
  url: 'https://help.x.com/en/managing-your-account/accessing-your-x-data',
  publisher: 'X',
  title: 'How to access your X data | X Help Center',
};
const webSourceDe = {
  url: 'https://help.x.com/de/managing-your-account/accessing-your-x-data',
  publisher: 'X',
  title: 'Auf X Daten zugreifen und herunterladen | X Hilfe-Center',
};
const fact = (id: string, en: string, de: string): GuideFact => ({
  id: `x.${id}`,
  text: { en, de },
  source,
  sourceDe,
  retrievedOn: '2026-10-25',
  verifiedOn: '2026-10-25',
});

export const xGuide: PlatformGuide<'x'> = {
  platform: 'x',
  startUrl: fact(
    'start',
    'X describes the request in the account settings. Use the Computer instructions below for the web path and password check. The archive help page shows an iOS path; its Android tab was not readable in the page text. Open the help page yourself if your menus differ.',
    'X beschreibt die Anfrage in den Account-Einstellungen. Der Computer-Tab unten nennt den Webpfad und die Passwortprüfung. Die Archiv-Hilfeseite zeigt einen iOS-Pfad; ihr Android-Tab war im Seitentext nicht lesbar. Öffne die Hilfeseite selbst, wenn deine Menüs abweichen.',
  ),
  steps: [
    fact(
      'request',
      'X says to confirm your email address before requesting the archive. Follow the instructions in the phone tab yourself; this guide does not open or operate X.',
      'X gibt an, dass du deine E-Mail-Adresse vor der Archivanfrage bestätigen sollst. Führe die Schritte im Handy-Tab selbst aus. Diese Anleitung öffnet oder bedient X nicht.',
    ),
    fact(
      'delivery',
      'X says it sends an email to the connected address or a push notification when the archive is ready. It also sends an email download link. Choose "Download archive" under "Download your data", or "Download" in the email flow, while signed in to X in that browser. Keep the ZIP. The help page does not say whether there can be several parts.',
      'X gibt an, dass du bei einem fertigen Archiv eine E-Mail an die verknüpfte Adresse oder eine Push-Mitteilung erhältst. X sendet auch einen Downloadlink per E-Mail. Wähle "Archiv herunterladen" unter "Deine Daten herunterladen" oder "Herunterladen" im E-Mail-Ablauf, während du in diesem Browser bei X angemeldet bist. Behalte die ZIP. Die Hilfeseite sagt nicht, ob es mehrere Teile geben kann.',
    ),
  ],
  options: [
    fact(
      'format',
      'X says the archive contains HTML and JSON files. SocialPrune reads the data files in the downloaded ZIP. The help page does not describe a separate format selector.',
      'X gibt an, dass das Archiv HTML- und JSON-Dateien enthält. SocialPrune liest die Datendateien in der heruntergeladenen ZIP. Die Hilfeseite beschreibt keine separate Formatauswahl.',
    ),
    fact(
      'range',
      'X describes the archive as a snapshot starting with your first post. The help page does not name a time-range option. For a review of all old entries, keep the whole archive.',
      'X beschreibt das Archiv als Momentaufnahme ab deinem ersten Post. Die Hilfeseite nennt keine Option für den Zeitraum. Behalte für eine Durchsicht aller alten Einträge das gesamte Archiv.',
    ),
    fact(
      'media',
      'X says media are included in the archive. The help page names no media-quality option. SocialPrune does not show media from the export; separately fetched originals can have local media.',
      'X gibt an, dass Medien im Archiv enthalten sind. Die Hilfeseite nennt keine Option für die Medienqualität. SocialPrune zeigt keine Medien aus dem Export; separat abgerufene Originale können lokale Medien enthalten.',
    ),
  ],
  waiting: {
    ...fact(
      'waiting',
      'X says preparing the download may take a few days. It gives no numerical range. The calendar date you choose is a reminder, not a delivery date from X.',
      'X gibt an, dass die Vorbereitung des Downloads ein paar Tage dauern kann. X nennt keinen Zahlenbereich. Dein gewählter Kalendertermin ist eine Erinnerung, kein Bereitstellungstermin von X.',
    ),
    typicalDays: null,
  },
  downloadWindow: {
    ...fact(
      'download-window',
      'The X help page gives no download-link expiry. Check the date shown with your export when it becomes available.',
      'Die X-Hilfeseite nennt keine Gültigkeitsdauer für den Downloadlink. Prüfe das Datum, das bei deinem fertigen Export steht.',
    ),
    days: null,
  },
  htmlExportHint: fact(
    'html',
    'X says the archive includes HTML and JSON. Keep the export ZIP for SocialPrune rather than selecting the HTML page used to browse the archive.',
    'X gibt an, dass das Archiv HTML und JSON enthält. Behalte die Export-ZIP für SocialPrune, statt die HTML-Seite zum Lesen des Archivs auszuwählen.',
  ),
  paths: {
    desktop: [
      {
        ...fact(
          'desktop-missing',
          'On the web, X’s English data-access help says to choose "More", "Settings and privacy", "Your account" and "Download an archive of your data". Confirm your password, then choose "Request archive" yourself. The German help page describes a different route; check the linked help if your menus differ.',
          'Für das Web nennt die deutsche X-Hilfe im Abschnitt „Wo finde ich meine X Daten?“ den Weg „Mehr“ („More“), „Einstellungen und Datenschutz“ („Settings and privacy“), unter „Einstellungen“ („Settings“) den Punkt „Account“ und unter „Daten und Berechtigungen“ („Data and permissions“) die Option „Deine X Daten“ („Your X data“). Die englischen Namen der letzten beiden Controls stammen aus der öffentlichen englischen Archivhilfe. Bestätige dein Passwort selbst bei X; die deutsche Downloadanleitung nennt danach „Archiv anfordern“ („Request archive“). Die Sprachfassungen und Abschnitte nennen unterschiedliche Wege: Die englische Downloadanleitung führt über „Your account“ und „Download an archive of your data“. Deren deutsche Menünamen wurden in der deutschen Downloadanleitung nicht gelesen. Prüfe die verlinkte Hilfe, wenn deine Menüs abweichen.',
        ),
        source: webSource,
        sourceDe: webSourceDe,
      },
    ],
    mobile: [
      fact(
        'mobile-menu',
        'For iOS, X says to open the profile menu, then "Settings and privacy", then "Account". Under "Data and permissions", choose "Your X data". The Android tab’s instructions were not readable in the static text.',
        'Für iOS gibt X an, dass du das Profilmenü, dann "Einstellungen und Datenschutz" und dann "Account" öffnen sollst. Wähle unter "Daten und Berechtigungen" die Option "Deine X Daten". Die Anleitung des Android-Tabs war im statischen Text nicht lesbar.',
      ),
      fact(
        'mobile-code',
        'X says to use "Send code" to verify your identity, then enter the code sent to your email address or phone. If neither is on file, X says it takes you to "Account information".',
        'X gibt an, dass du mit "Code senden" deine Identität bestätigen und dann den Code aus der E-Mail oder Nachricht eingeben sollst. Wenn keine Adresse oder Telefonnummer hinterlegt ist, führt X dich laut Hilfeseite zu "Account-Informationen".',
      ),
      fact(
        'mobile-request',
        'After verification, X says to choose "Request data" next to "X" under "Download your data".',
        'Nach der Bestätigung sollst du laut X unter "Deine Daten herunterladen" neben "X" die Option "Daten anfordern" wählen.',
      ),
    ],
  },
};
