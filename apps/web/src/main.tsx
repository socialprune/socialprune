import '@socialprune/core/browser-init';
import './styles/tokens.css';
import { createRoot } from 'react-dom/client';
import { Shell } from './app/Shell.tsx';
import { initialLocale } from './i18n/index.ts';

document.documentElement.lang = initialLocale();
try {
  const theme = localStorage.getItem('sp-theme');
  if (theme === 'light' || theme === 'dark')
    document.documentElement.dataset.theme = theme;
  const density = localStorage.getItem('sp-density');
  if (density === 'compact') document.documentElement.dataset.density = density;
} catch {
  /* The shell can start without persistent preferences. */
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root.');

createRoot(root).render(<Shell />);
