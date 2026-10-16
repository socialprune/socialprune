import { platformPostUrl } from '@socialprune/core/workspace/desktop-links';
import type { DesktopBridge } from '@socialprune/core/workspace/desktop-protocol';
import { command } from './bridge.ts';

/** Desktop only: shared review links cannot navigate or create web windows. */
export function installDesktopLinks(
  bridge: DesktopBridge,
  failed: (error: unknown) => void,
) {
  const stripRejected = () => {
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>(
      'a[href]',
    )) {
      const href = anchor.getAttribute('href') ?? '';
      if (href.startsWith('#')) continue;
      if (!platformPostUrl(href)) {
        anchor.removeAttribute('href');
        anchor.removeAttribute('target');
        anchor.removeAttribute('role');
        anchor.removeAttribute('tabindex');
      }
    }
  };
  const clicked = (event: MouseEvent) => {
    const target =
      event.target instanceof Element ? event.target.closest('a') : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const href = target.getAttribute('href') ?? '';
    if (href === '#main') {
      document.querySelector<HTMLElement>('main h1')?.focus();
      return;
    }
    if (href.startsWith('#/')) {
      location.hash = href;
      return;
    }
    const url = platformPostUrl(href);
    if (url)
      void command(bridge, {
        type: 'openLink',
        link: { kind: 'platform-post', url },
      }).catch(failed);
  };
  document.addEventListener('click', clicked, true);
  document.addEventListener('auxclick', clicked, true);
  const observer = new MutationObserver(stripRejected);
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href'],
  });
  stripRejected();
  return () => {
    observer.disconnect();
    document.removeEventListener('click', clicked, true);
    document.removeEventListener('auxclick', clicked, true);
  };
}
