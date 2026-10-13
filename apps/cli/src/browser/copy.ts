export const BROWSER_WARNING = {
  en: "X's and Instagram's rules do not allow this kind of automation. They can lock or suspend your account for it, even though SocialPrune goes slowly and stops at the first problem. Deleted posts and comments cannot be recovered. Neither the platform nor SocialPrune can bring them back. SocialPrune does not hide that a program is acting in your browser. Use it only for your own account, and only if you accept this.",
  de: 'Die Regeln von X und Instagram erlauben diese Art von Automatisierung nicht. Sie können dein Konto dafür sperren oder einschränken, auch wenn SocialPrune langsam vorgeht und beim ersten Problem anhält. Gelöschte Beiträge und Kommentare lassen sich nicht wiederherstellen. Weder die Plattform noch SocialPrune kann sie zurückholen. SocialPrune verbirgt nicht, dass ein Programm in deinem Browser handelt. Nutze es nur für dein eigenes Konto und nur, wenn du das in Kauf nimmst.',
} as const;
export type BrowserLanguage = 'en' | 'de';
export function profileWarning(
  handle: string,
  lang: BrowserLanguage = 'en',
): string {
  return lang === 'de'
    ? `Angemeldet als @${handle} kann ein Programm alles tun, was die Website erlaubt: Beiträge schreiben, liken, folgen, Nachrichten senden, Einstellungen ändern und löschen. Es kann auch Cookies, Websitedaten, Cache, Verlauf und Einstellungen dieses Browserprofils ändern. Der Code von SocialPrune führt nur die für diesen Lauf aufgelisteten Schritte aus.`
    : `Signed in as @${handle}, a program can do anything the website can: post, like, follow, send messages, change settings and delete. It can also change this browser profile's cookies, site data, cache, history and settings. SocialPrune's code only does the steps listed for this run.`;
}
export const EXTENSION_NOTICE = {
  en: 'Extensions are disabled for this run. SocialPrune records their ID sets and writes its own read-back JSON file in this dedicated profile.',
  de: 'Erweiterungen sind für diesen Lauf ausgeschaltet. SocialPrune erfasst ihre Kennungen und schreibt seine eigene Profilkontrolle als JSON-Datei in dieses eigene Profil.',
};
export const FILL_STEPS = {
  en: 'Open each listed post by its address and keep what X sends. No clicks, typing or scrolling in the X tab. Download media anonymously. Pages change history, cache, cookies and site data.',
  de: 'Jeden aufgelisteten Beitrag über seine Adresse öffnen und speichern, was X sendet. Keine Klicks, Eingaben oder Scrollbewegungen im X-Tab. Medien ohne Anmeldung herunterladen. Die Seiten ändern Verlauf, Cache, Cookies und Websitedaten.',
};
export const START_STATUS = {
  delete: {
    en: 'Watch the first entry of each action before continuing.',
    de: 'Beobachte den ersten Eintrag jeder Aktion, bevor du fortfährst.',
  },
  verify: {
    en: 'Read-only verification. No deletion clicks.',
    de: 'Nur lesende Kontrolle. Keine Löschklicks.',
  },
  fill: {
    en: 'Read the remaining planned pages.',
    de: 'Die verbleibenden geplanten Seiten lesen.',
  },
  fillCanary: {
    en: 'Watch up to five pages. Compare each before Continue, then confirm Matches.',
    de: 'Beobachte bis zu fünf Seiten. Vergleiche jede, bevor du Weiter klickst, und bestätige danach mit Passt.',
  },
};
export type DisplayEndReason =
  | 'canary-mismatch'
  | 'done'
  | 'platform-check'
  | 'account-mismatch'
  | 'shape-changed'
  | 'canary'
  | 'daily-cap'
  | 'stopped-by-person'
  | 'error'
  | 'size-cap';
const END_REASON = {
  'canary-mismatch': {
    en: 'The stored text or media counts did not match the page; the sample was not accepted.',
    de: 'Der gespeicherte Text oder die Medienanzahl stimmten nicht mit der Seite überein; die Stichprobe wurde nicht akzeptiert.',
  },
  done: {
    en: 'The planned work is complete.',
    de: 'Die geplanten Schritte sind abgeschlossen.',
  },
  'platform-check': {
    en: 'The page was not recognized, or X requires an account check.',
    de: 'Die Seite wurde nicht erkannt oder X verlangt eine Kontoprüfung.',
  },
  'account-mismatch': {
    en: 'The signed-in account does not match the expected account.',
    de: 'Das angemeldete Konto stimmt nicht mit dem erwarteten Konto überein.',
  },
  'shape-changed': {
    en: 'X returned a different page structure.',
    de: 'X hat eine andere Seitenstruktur geliefert.',
  },
  canary: {
    en: 'The watched sample is complete; this run will read no more pages.',
    de: 'Die beobachtete Stichprobe ist abgeschlossen; dieser Lauf liest keine weiteren Seiten.',
  },
  'daily-cap': {
    en: 'The daily page limit has been reached.',
    de: 'Die tägliche Seitengrenze wurde erreicht.',
  },
  'stopped-by-person': {
    en: 'You stopped this run.',
    de: 'Du hast diesen Lauf gestoppt.',
  },
  error: {
    en: 'An error stopped this run; no automatic retry will run.',
    de: 'Ein Fehler hat diesen Lauf gestoppt; es gibt keinen automatischen Wiederholungsversuch.',
  },
  'size-cap': {
    en: 'The media limit for this run has been reached.',
    de: 'Die Mediengrenze für diesen Lauf wurde erreicht.',
  },
} satisfies Record<DisplayEndReason, Record<BrowserLanguage, string>>;
export function endText(
  reason: DisplayEndReason,
  lang: BrowserLanguage = 'en',
): string {
  return lang === 'de'
    ? `Beendet: ${END_REASON[reason].de} Schließe das X-Fenster, um den Lauf zu beenden.`
    : `Ended: ${END_REASON[reason].en} Close the X window to finish.`;
}
export function endReason(
  reason: string | null,
  error: unknown,
): DisplayEndReason {
  const code =
    error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'ACCOUNT_MISMATCH') return 'account-mismatch';
  if (code === 'SHAPE_CHANGED') return 'shape-changed';
  if (code === 'CANARY_MISMATCH') return 'canary-mismatch';
  if (error && (reason === 'done' || reason === 'canary' || reason === null))
    return 'error';
  return reason && Object.hasOwn(END_REASON, reason)
    ? (reason as DisplayEndReason)
    : 'error';
}
