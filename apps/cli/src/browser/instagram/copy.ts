import type { BrowserLanguage } from '../copy.ts';

export const CONTEXT_WARNING = {
  en: "Instagram's rules do not allow this kind of automation. Instagram can lock or suspend your account for it, even though SocialPrune goes slowly and stops at the first problem. This run only reads. It sorts and filters your comments list, opens the posts and expands their comments in your signed-in Instagram window, and keeps what Instagram shows. SocialPrune does not hide that a program is acting in your browser. Use it only for your own account, and only if you accept this.",
  de: 'Die Regeln von Instagram erlauben diese Art von Automatisierung nicht. Instagram kann dein Konto dafür sperren oder einschränken, auch wenn SocialPrune langsam vorgeht und beim ersten Problem anhält. Dieser Lauf liest nur. Er sortiert und filtert deine Kommentarliste, öffnet die Beiträge und klappt ihre Kommentare auf, in deinem angemeldeten Instagram-Fenster, und speichert, was Instagram anzeigt. SocialPrune verbirgt nicht, dass ein Programm in deinem Browser handelt. Nutze es nur für dein eigenes Konto und nur, wenn du das in Kauf nimmst.',
} as const;
export const CONTEXT_STEPS = {
  en: "Open your comments list in Instagram's Your activity, sort and filter it by date, open the posts your comments are on and expand their comments. No typing, likes, replies, follows, selection or deletion. Keep each confirmed post's account, caption, date, first image and a screenshot. Each opened page goes into this profile's history. Instagram's pages fill its cache, and Instagram may change its cookies and site data.",
  de: 'Deine Kommentarliste unter Deine Aktivitäten auf Instagram öffnen, sortieren und nach Datum filtern, die Beiträge deiner Kommentare öffnen und ihre Kommentare aufklappen. Keine Eingaben, Likes, Antworten, neuen Abonnements, Auswahl oder Löschungen. Konto, Bildunterschrift, Datum, erstes Bild und ein kleines Bildschirmfoto jedes bestätigten Beitrags behalten. Jede geöffnete Seite erscheint im Verlauf dieses Profils. Instagrams Seiten füllen seinen Cache; Instagram kann Cookies und Websitedaten ändern.',
};
export function contextEnd(
  reason: string,
  lang: BrowserLanguage,
  automatic: boolean,
): string {
  const endings: Record<string, [string, string]> = {
    done: [
      'The planned reading steps are complete.',
      'Die geplanten Leseschritte sind abgeschlossen.',
    ],
    canary: [
      'The canary ended here. Read its structure report before a new dry run and a full run.',
      'Die Stichprobe endet hier. Lies ihren Strukturbericht vor einem neuen Probelauf und einem vollständigen Lauf.',
    ],
    'daily-cap': [
      'The Instagram daily step limit has been reached.',
      'Die tägliche Schrittgrenze für Instagram wurde erreicht.',
    ],
    'stopped-by-person': [
      'You stopped this run. No further click will run.',
      'Du hast diesen Lauf gestoppt. Es folgt kein weiterer Klick.',
    ],
    'shape-changed': [
      'Instagram showed an unrecognized structure. The next run stays a canary.',
      'Instagram zeigte eine unbekannte Struktur. Der nächste Lauf bleibt eine Stichprobe.',
    ],
    'platform-check': [
      'Instagram showed a sign-in, challenge, lock, limit or unrecognized page. The run stopped.',
      'Instagram zeigte eine Anmeldung, Kontoprüfung, Sperre, ein Limit oder eine unbekannte Seite. Der Lauf wurde gestoppt.',
    ],
    error: [
      'An error stopped this reading run. No automatic retry will run.',
      'Ein Fehler hat diesen Leselauf gestoppt. Es gibt keinen automatischen Wiederholungsversuch.',
    ],
  };
  const text = (endings[reason] ?? endings.error)![lang === 'de' ? 1 : 0];
  return lang === 'de'
    ? `Beendet: ${text} ${automatic ? 'Das Browserfenster wird automatisch geschlossen.' : 'Schließe das Instagram-Fenster, um den Lauf zu beenden.'}`
    : `Ended: ${text} ${automatic ? 'The browser window closes automatically.' : 'Close the Instagram window to finish.'}`;
}
