import '@socialprune/core/browser-init';
import { createRoot } from 'react-dom/client';
import { DesktopApp } from './App.tsx';
import { desktopBridge } from './bridge.ts';
import { catalogs, initialLocale } from '../i18n/index.ts';

document.documentElement.lang = initialLocale();
const element = document.getElementById('root');
if (!element) throw new Error('Missing desktop root.');
const root = createRoot(element);
if (window.top !== window.self)
  root.render(
    <main>
      <h1>{catalogs[initialLocale()]['gate.framed.title']}</h1>
    </main>,
  );
else {
  try {
    root.render(<DesktopApp bridge={desktopBridge()} />);
  } catch {
    root.render(
      <main>
        <h1>{catalogs[initialLocale()]['app.name']}</h1>
        <p role="alert">
          {catalogs[initialLocale()]['desktop.bridgeUnavailable']}
        </p>
      </main>,
    );
  }
}
