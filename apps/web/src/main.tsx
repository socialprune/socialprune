import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WEB_TITLE } from './index.ts';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root.');

createRoot(root).render(
  <StrictMode>
    <main>
      <h1>{WEB_TITLE}</h1>
      <p>Early development. Export review is not available yet.</p>
    </main>
  </StrictMode>,
);
