import type { MessageBoxOptions, WebContents } from 'electron';
import type { DialogLocale } from './dialogs.ts';

// App-owned native copy stays in main, as with the startup-failure dialog.
export function pendingQuitMessage(locale: DialogLocale): MessageBoxOptions {
  const german = locale === 'de';
  return {
    type: 'warning',
    title: 'SocialPrune',
    message: german
      ? 'Deine Entscheidungen werden noch gespeichert.'
      : 'Your decisions are still being saved.',
    detail: german
      ? 'Wenn du jetzt beendest, können noch nicht gespeicherte Entscheidungen verloren gehen.'
      : 'If you quit now, decisions that have not been saved may be lost.',
    buttons: german ? ['Warten', 'Trotzdem beenden'] : ['Wait', 'Quit anyway'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}

export function attachPendingQuit(options: {
  contents: Pick<WebContents, 'on'>;
  locale: () => DialogLocale;
  removalQuitting: () => boolean;
  message: (box: MessageBoxOptions) => number;
  wait: () => void;
  record: (code: string) => void;
}) {
  options.contents.on('will-prevent-unload', (event) => {
    // Confirmed data removal already closed the engine and reported what stays.
    // No queued write can drain now; finish only that removal-owned quit.
    if (options.removalQuitting()) {
      event.preventDefault();
      return;
    }
    let response = 0;
    try {
      response = options.message(pendingQuitMessage(options.locale()));
    } catch {
      options.record('PENDING_DECISIONS_DIALOG_FAILED');
    }
    if (response === 1) {
      options.record('PENDING_DECISIONS_QUIT');
      // Electron defines preventDefault here as ignoring the renderer's veto.
      // The normal close -> window-all-closed -> before-quit path still owns Stop.
      event.preventDefault();
    } else {
      options.record('PENDING_DECISIONS_WAIT');
      options.wait();
    }
  });
}
