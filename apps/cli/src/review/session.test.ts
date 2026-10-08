import { expect, test } from 'vitest';
import { ReviewSession, launchUrl } from './session.ts';

test('256-bit bootstrap format, one exchange, expiry and invalidation are distinct gates', () => {
  let now = 1000;
  const session = new ReviewSession(() => now);
  expect(session.bootstrap).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(Buffer.from(session.bootstrap, 'base64url')).toHaveLength(32);
  expect(session.exchange(undefined)).toBeNull();
  expect(session.exchange('wrong')).toBeNull();
  now += 10 * 60000 - 1;
  const exchange = session.exchange(session.bootstrap)!;
  expect(exchange.cookie).toMatch(
    /^sp_[a-f0-9]{16}=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/$/,
  );
  const cookie = exchange.cookie.split(';')[0]!;
  expect(session.authenticated(`other=a; ${cookie}`)).toBe(true);
  expect(session.authenticated(cookie + '; ' + cookie)).toBe(false);
  expect(session.authorized(exchange.csrf)).toBe(true);
  expect(session.authorized('wrong')).toBe(false);
  expect(session.exchange(session.bootstrap)).toBeNull();
  session.invalidate();
  expect(session.authenticated(cookie)).toBe(false);
  expect(session.authorized(exchange.csrf)).toBe(false);
  const expired = new ReviewSession(() => now);
  now += 10 * 60000;
  expect(expired.exchange(expired.bootstrap)).toBeNull();
  expect(launchUrl(32123, session.bootstrap)).toBe(
    `http://127.0.0.1:32123/#bootstrap=${session.bootstrap}`,
  );
});
