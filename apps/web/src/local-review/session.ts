import { HttpWorkspacePort } from './http-port.ts';
import type { ReviewFetch } from './http-port.ts';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export function takeBootstrap(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState'>,
): string | null {
  const match = /^#bootstrap=([A-Za-z0-9_-]{43})$/.exec(location.hash);
  if (!match || match[0] !== location.hash) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return match[1]!;
}

export type ReviewSessionState = 'preparing' | 'ready' | 'ended' | 'framed';
export class ReviewSession {
  state: ReviewSessionState = 'preparing';
  port: HttpWorkspacePort | null = null;
  readonly pageId = crypto.randomUUID();
  private readonly listeners = new Set<(state: ReviewSessionState) => void>();
  private readonly controller = new AbortController();
  private started = false;

  private readonly options: {
    isTopLevel: boolean;
    location: Pick<Location, 'hash' | 'pathname' | 'search' | 'origin'>;
    history: Pick<History, 'replaceState'>;
    document: Pick<
      Document,
      'visibilityState' | 'addEventListener' | 'removeEventListener'
    >;
    fetch: ReviewFetch;
  };
  constructor(options: ReviewSession['options']) {
    this.options = options;
  }

  // This synchronous prefix runs in the entrypoint before importing any UI or
  // router module. Framing wins even over fragment handling.
  start(): Promise<void> {
    if (this.started) throw new Error('Review session already started.');
    this.started = true;
    if (!this.options.isTopLevel) {
      this.update('framed');
      return Promise.resolve();
    }
    const token = takeBootstrap(this.options.location, this.options.history);
    if (!token) {
      this.update('ended');
      return Promise.resolve();
    }
    return this.exchange(token);
  }

  private async exchange(token: string) {
    try {
      const response = await this.options.fetch('/session', {
        method: 'POST',
        headers: {
          Origin: this.options.location.origin,
          'Content-Type': 'application/json',
          'X-SocialPrune-Bootstrap': token,
        },
        body: '{}',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: this.controller.signal,
      });
      if (this.state !== 'preparing') return;
      if (response.status !== 200) {
        this.end();
        return;
      }
      const body: unknown = await response.json();
      if (
        typeof body !== 'object' ||
        body === null ||
        !('csrf' in body) ||
        typeof body.csrf !== 'string' ||
        body.csrf.length !== 43 ||
        !TOKEN.test(body.csrf) ||
        Object.keys(body).length !== 1
      )
        throw new Error('Invalid session reply.');
      if (this.state !== 'preparing') return;
      this.port = new HttpWorkspacePort({
        csrf: body.csrf,
        origin: this.options.location.origin,
        pageId: this.pageId,
        document: this.options.document,
        fetch: this.options.fetch,
        ended: () => this.end(),
      });
      this.update('ready');
    } catch {
      this.end();
    }
  }

  private update(state: ReviewSessionState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
  subscribe(listener: (state: ReviewSessionState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
  end() {
    this.controller.abort();
    this.port?.terminate();
    this.update('ended');
  }
}
