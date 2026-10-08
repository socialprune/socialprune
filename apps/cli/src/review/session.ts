import { randomBytes, timingSafeEqual } from 'node:crypto';

const lifetime = 10 * 60_000;
function equal(left: string | undefined, right: string): boolean {
  if (left === undefined) return false;
  const bytes = Buffer.from(left);
  const expected = Buffer.from(right);
  return bytes.length === expected.length && timingSafeEqual(bytes, expected);
}

/** Secrets are memory-only and never part of a command reply or error. */
export class ReviewSession {
  readonly bootstrap = randomBytes(32).toString('base64url');
  private readonly issuedAt: number;
  private readonly now: () => number;
  private used = false;
  private stopped = false;
  private cookieName = '';
  private cookieValue = '';
  private csrf = '';
  constructor(now: () => number = Date.now) {
    this.now = now;
    this.issuedAt = now();
  }
  canExchange(token: string | undefined): boolean {
    return (
      !this.stopped &&
      !this.used &&
      this.now() - this.issuedAt < lifetime &&
      equal(token, this.bootstrap)
    );
  }
  exchange(token: string | undefined): { csrf: string; cookie: string } | null {
    if (!this.canExchange(token)) return null;
    this.used = true;
    this.cookieName = `sp_${randomBytes(8).toString('hex')}`;
    this.cookieValue = randomBytes(32).toString('base64url');
    this.csrf = randomBytes(32).toString('base64url');
    return {
      csrf: this.csrf,
      cookie: `${this.cookieName}=${this.cookieValue}; HttpOnly; SameSite=Strict; Path=/`,
    };
  }
  authenticated(cookie: string | undefined): boolean {
    if (this.stopped || !this.used || !cookie) return false;
    const values = cookie.split(';').map((part) => part.trim());
    const matches = values.filter((part) =>
      part.startsWith(`${this.cookieName}=`),
    );
    return (
      matches.length === 1 &&
      equal(matches[0], `${this.cookieName}=${this.cookieValue}`)
    );
  }
  authorized(csrf: string | undefined): boolean {
    return !this.stopped && this.used && equal(csrf, this.csrf);
  }
  invalidate(): void {
    this.stopped = true;
    this.cookieValue = '';
    this.csrf = '';
  }
}

export function launchUrl(port: number, token: string): string {
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^[A-Za-z0-9_-]{43}$/.test(token)
  )
    throw new Error('INVALID_LAUNCH');
  return `http://127.0.0.1:${port}/#bootstrap=${token}`;
}
