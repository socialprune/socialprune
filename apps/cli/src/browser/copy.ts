import { platformCheckReason } from '../cli/errors.ts';

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
export type ReadbackOutcome =
  | 'unchanged'
  | 'account-readback'
  | 'account-handle'
  | 'account-changed'
  | 'extensions-changed';
export interface EndTextContext {
  readback?: ReadbackOutcome;
  canary?: boolean;
  fillStop?: 'x-window-long';
}
export function fillMismatchNotice(
  count: number,
  lang: BrowserLanguage = 'en',
): string {
  return lang === 'de'
    ? `Text oder Medien weichen bei diesem Beitrag ab; der Lauf geht weiter (${count} von 3).`
    : `Text or media differ on this post; the run goes on (${count} of 3).`;
}
export const FILL_RELOAD_NOTICE = {
  en: 'X did not load the page in time. Waiting 60 seconds before opening this post once more.',
  de: 'X hat die Seite nicht rechtzeitig geladen. Dieser Beitrag wird nach 60 Sekunden einmal neu geöffnet.',
};
export function fillWindowWaitNotice(
  minutes: number,
  lang: BrowserLanguage = 'en',
): string {
  return lang === 'de'
    ? `Ein X-Limit ist mehr als zur Hälfte verbraucht. Der Lauf wartet ${minutes} Minuten bis zum Zurücksetzen.`
    : `An X limit is more than half used. The run waits ${minutes} minutes for it to reset.`;
}
export function fillPaceNotice(
  seconds: number,
  daily: number,
  pause: boolean,
  lang: BrowserLanguage = 'en',
): string {
  return lang === 'de'
    ? `Tempo: mindestens ${seconds} Sekunden zwischen Seiten, höchstens ${daily} Seiten pro Berliner Tag; ${pause ? '15 Minuten Pause nach 20 Seiten' : 'keine feste Blockpause'}.`
    : `Pace: at least ${seconds} seconds between pages, at most ${daily} pages per Berlin day; ${pause ? 'a 15-minute pause after 20 pages' : 'no fixed batch pause'}.`;
}
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
    en: 'The page was not recognized.',
    de: 'Die Seite wurde nicht erkannt.',
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
  detail?: unknown,
  context: EndTextContext = {},
): string {
  const token = platformCheckReason(detail);
  const readback =
    context.readback === 'unchanged' ? undefined : context.readback;
  const outcome =
    readback ??
    (reason === 'platform-check' &&
    (token === 'extensions-changed' ||
      token === 'account-changed' ||
      token === 'account-handle' ||
      token === 'account-readback')
      ? token
      : undefined);
  const text =
    outcome === 'extensions-changed'
      ? lang === 'de'
        ? 'Die Erweiterungen des Browserprofils haben sich während des Laufs geändert. Der Lauf wurde gestoppt.'
        : "The browser profile's extensions changed during the run. The run stopped."
      : outcome === 'account-changed'
        ? lang === 'de'
          ? 'Das angemeldete Konto hat sich während des Laufs geändert. Der Lauf wurde gestoppt.'
          : 'The signed-in account changed during the run. The run stopped.'
        : outcome === 'account-readback'
          ? lang === 'de'
            ? 'Die Kontrolle von Konto und Erweiterungen nach dem Lauf konnte nicht abgeschlossen werden. Der Lauf wurde gestoppt.'
            : 'The post-run account and extension check could not finish. The run stopped.'
          : outcome === 'account-handle'
            ? lang === 'de'
              ? 'Das angemeldete Konto konnte nach dem Lauf nicht geprüft werden. Der Lauf wurde gestoppt.'
              : 'The signed-in account could not be read back after the run. The run stopped.'
            : context.fillStop === 'x-window-long'
              ? lang === 'de'
                ? 'Ein längeres X-Limit ist mehr als zur Hälfte verbraucht. Der Lauf geht an einem anderen Tag weiter.'
                : 'A longer X limit is more than half used. The run continues another day.'
              : reason === 'platform-check' && token === 'http-429'
                ? lang === 'de'
                  ? 'X hat eine Anfrage mit HTTP 429 begrenzt. Der Lauf wurde gestoppt.'
                  : 'X limited a request with HTTP 429. The run stopped.'
                : reason === 'canary-mismatch' && context.canary === false
                  ? lang === 'de'
                    ? 'Der gespeicherte Text oder die Medienanzahl stimmten nicht mit der Seite überein. Der Lauf wurde gestoppt.'
                    : 'The stored text or media counts did not match the page. The run stopped.'
                  : reason !== 'platform-check'
                    ? END_REASON[reason][lang]
                    : token === 'render-timeout' ||
                        token === 'answer-timeout' ||
                        token === 'body-timeout'
                      ? lang === 'de'
                        ? 'X hat die Seite nicht rechtzeitig geladen.' +
                          (context.readback === 'unchanged'
                            ? ' Es wurde nichts geändert.'
                            : '')
                        : 'X did not load the page in time.' +
                          (context.readback === 'unchanged'
                            ? ' Nothing was changed.'
                            : '')
                      : [
                            'marker-login',
                            'marker-challenge',
                            'marker-locked',
                            'marker-rate-limit',
                            'notice-text',
                          ].some((value) => value === token)
                        ? lang === 'de'
                          ? 'X zeigt eine Seite zum Anmelden, eine Kontoprüfung, eine Sperre oder ein Limit.'
                          : 'X shows a sign-in, account check, lock or limit page.'
                        : token === undefined || token === 'unspecified'
                          ? lang === 'de'
                            ? 'Die Seite wurde nicht erkannt oder X verlangt eine Kontoprüfung.'
                            : 'The page was not recognized, or X requires an account check.'
                          : END_REASON['platform-check'][lang];
  return lang === 'de'
    ? `Beendet: ${text} Schließe das X-Fenster, um den Lauf zu beenden.`
    : `Ended: ${text} Close the X window to finish.`;
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
