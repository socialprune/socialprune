import type { Page, Request, Response } from 'playwright-core';
import {
  ContextStop,
  PostOpenDiagnosticSchema,
  PostReadShape,
  SETTLED_LAST,
} from './report.ts';
import type {
  PostOpenDiagnostic,
  PostOpenPathClass,
  PostReadSite,
} from './report.ts';
import { postElement } from './selectors.ts';

export type SettledLast = (typeof SETTLED_LAST)[number];

/**
 * POST-READY-1: the post element did not appear in time after a post open.
 * Same code and token as before; the run may reopen a row-click case once.
 */
export class PostNotReady extends ContextStop {
  readonly rowClick: boolean;
  readonly navigationStarted: boolean;
  constructor(rowClick: boolean, navigationStarted: boolean) {
    super('INSTAGRAM_SHAPE_CHANGED', 'post-structure');
    this.rowClick = rowClick;
    this.navigationStarted = navigationStarted;
  }
}
/**
 * POST-READ-1: build the post-read stop with closed observations of the page
 * at the throw. Observation failures only leave a field null.
 */
export async function postReadShape(
  page: Page,
  origin: string,
  site: PostReadSite,
  options: { commentId?: string; settledLast?: SettledLast } = {},
): Promise<PostReadShape> {
  let url = 'unknown';
  try {
    url = page.url();
  } catch {
    url = 'unknown';
  }
  let focalPostAttached: boolean | null = null,
    focalCommentAttached: boolean | null = null;
  try {
    focalPostAttached = (await postElement(page, origin)) !== null;
  } catch {
    focalPostAttached = null;
  }
  if (options.commentId && /^\d{1,40}$/u.test(options.commentId))
    try {
      focalCommentAttached =
        (await page
          .locator(`main a[href$="/c/${options.commentId}/"]`)
          .count()) > 0;
    } catch {
      focalCommentAttached = null;
    }
  return new PostReadShape(site, {
    site,
    ...(options.settledLast ? { settledLast: options.settledLast } : {}),
    pagePathClass: postOpenPathClass(url, origin),
    focalPostAttached,
    focalCommentAttached,
  });
}
/** Closed path class of a page address relative to the run's origin. */
export function postOpenPathClass(
  input: string,
  origin: string,
): PostOpenPathClass {
  if (input === 'about:blank') return 'about-blank';
  let url: URL, base: URL;
  try {
    url = new URL(input);
    base = new URL(origin);
  } catch {
    return 'unknown';
  }
  if (url.origin !== base.origin) return 'other-host';
  const path = url.pathname.replace(/\/$/u, '');
  if (/^\/p\/[A-Za-z0-9_-]{1,64}(?:\/c\/\d{1,40})?$/u.test(path)) return 'post';
  if (/^\/reel\/[A-Za-z0-9_-]{1,64}(?:\/c\/\d{1,40})?$/u.test(path))
    return 'reel';
  if (path === '/your_activity/interactions/comments') return 'comments-list';
  return 'other-instagram';
}
/**
 * Watch one row-click post open: main-frame navigation requests and document
 * responses after the press. Counts and booleans only; listener failures
 * only lose fields, never change the run.
 */
export function watchPostOpen(page: Page, origin: string) {
  let pressedAt: number | null = null,
    navigationAt: number | null = null,
    documentResponse = false,
    documentStatus: number | null = null;
  const main = (request: Request) => {
    try {
      return (
        request.isNavigationRequest() && request.frame() === page.mainFrame()
      );
    } catch {
      return false;
    }
  };
  const onRequest = (request: Request) => {
    if (pressedAt !== null && navigationAt === null && main(request))
      navigationAt = performance.now();
  };
  const onResponse = (response: Response) => {
    if (pressedAt === null || !main(response.request())) return;
    documentResponse = true;
    const status = response.status();
    documentStatus = status >= 100 && status <= 599 ? status : null;
  };
  const listen = (on: boolean) => {
    try {
      if (typeof page.on !== 'function' || typeof page.off !== 'function')
        return;
      if (on) {
        page.on('request', onRequest);
        page.on('response', onResponse);
      } else {
        page.off('request', onRequest);
        page.off('response', onResponse);
      }
    } catch {
      // Inert observer.
    }
  };
  listen(true);
  return {
    pressed() {
      pressedAt ??= performance.now();
      return pressedAt;
    },
    get pressedAt() {
      return pressedAt;
    },
    navigationStarted: () => navigationAt !== null,
    summary(press?: {
      position: 'left' | 'middle' | 'right';
      hoverPassed: boolean;
    }): PostOpenDiagnostic {
      let url = 'unknown';
      try {
        url = page.url();
      } catch {
        url = 'unknown';
      }
      return PostOpenDiagnosticSchema.parse({
        navigationStarted: navigationAt !== null,
        navigationMs:
          navigationAt !== null && pressedAt !== null
            ? Math.max(0, Math.round(navigationAt - pressedAt))
            : null,
        documentResponse,
        documentStatus,
        pagePathClass: postOpenPathClass(url, origin),
        ...(press
          ? { pressPosition: press.position, hoverPassed: press.hoverPassed }
          : {}),
      });
    },
    dispose: () => listen(false),
  };
}
