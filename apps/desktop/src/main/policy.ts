export const APP_URL = 'app://socialprune/desktop.html';
export const DESKTOP_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src app:; media-src app:; connect-src 'none'; worker-src 'none'; font-src 'none'; manifest-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types socialprune";

export function isAppUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'app:' &&
      url.hostname === 'socialprune' &&
      url.port === '' &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

export function isAppDocument(value: string): boolean {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href === APP_URL;
  } catch {
    return false;
  }
}

export const WINDOW_PREFERENCES = Object.freeze({
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  webviewTag: false,
  allowRunningInsecureContent: false,
  navigateOnDragDrop: false,
});
