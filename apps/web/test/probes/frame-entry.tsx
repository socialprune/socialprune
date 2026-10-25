import { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import '@socialprune/core/browser-init';
import '../../src/styles/tokens.css';
import { Shell } from '../../src/app/Shell.tsx';
import { initialLocale } from '../../src/i18n/index.ts';
import { record } from './frame-runtime.ts';

document.documentElement.lang = initialLocale();
try {
  const theme = localStorage.getItem('sp-theme');
  if (theme === 'light' || theme === 'dark')
    document.documentElement.dataset.theme = theme;
  if (localStorage.getItem('sp-density') === 'compact')
    document.documentElement.dataset.density = 'compact';
} catch {
  /* Same startup preferences as the production entry. */
}
const root = document.getElementById('root');
if (!root) throw Error('Missing application root.');
createRoot(root).render(
  <Profiler
    id="feed-shell"
    onRender={(_id, phase, actualDuration, _base, start, commit) => {
      record(
        'react-render',
        start,
        commit,
        phase,
        'react-reported',
        actualDuration,
      );
      record('react-commit', commit, commit, phase);
    }}
  >
    <Shell />
  </Profiler>,
);
