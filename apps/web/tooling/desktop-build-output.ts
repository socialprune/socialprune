import { DESKTOP_POLICY } from '../src/desktop/policy.ts';

export function assertDesktopOutput(files: ReadonlyMap<string, string>) {
  const html = files.get('desktop.html') ?? '';
  const policy =
    /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];
  if (policy !== DESKTOP_POLICY) throw new Error('Desktop policy differs.');
  if (/rel=["']manifest|<script(?![^>]*\bsrc=)/.test(html))
    throw new Error('Inline script or manifest in desktop HTML.');
  for (const [path, content] of files) {
    if (
      /\.wasm$|(?:^|\/)sw\.js$|\.webmanifest$|worker[^/]*\.js$|(?:^|\/)(?:e2e|test)\//.test(
        path,
      )
    )
      throw new Error('Worker, WebAssembly or test file in desktop output.');
    if (
      path.endsWith('.js') &&
      /WebAssembly|serviceWorker|indexedDB|desktop-fake-bridge|__desktopTest|accessibility-checker-engine|IBM_Accessibility|new\s+(?:globalThis\.)?Worker\b/.test(
        content,
      )
    )
      throw new Error('Worker, WebAssembly or test code in desktop bundle.');
  }
}
