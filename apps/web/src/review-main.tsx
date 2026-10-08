import '@socialprune/core/browser-init';
import { ReviewSession } from './local-review/session.ts';

const session = new ReviewSession({
  isTopLevel: window.top === window.self,
  location,
  history,
  document,
  fetch: (input, init) => fetch(input, init),
});
void session.start();
// No UI module (including the router) is evaluated until the synchronous
// framing/fragment prefix has finished and removed a valid bootstrap.
void import('./local-review/ReviewShell.tsx').then(({ mountReview }) =>
  mountReview(session),
);
