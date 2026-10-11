import { describe, expect, it } from 'vitest';
import { originalXLink } from '../src/social/originalLink.ts';

const invalidIDs = [
  null,
  '',
  'abc',
  '123a',
  '12345678901234567890123456',
  'https://x.com/i/web/status/123',
  '/i/web/status/123',
  '../123',
  ' 123',
  '123 ',
  '123\n',
  '123\r\n',
  '123/456',
  '123?x=1',
  '１２３',
];

describe('original X reference link', () => {
  it.each(['0', '7', '000123', '1234567890123456789012345'])(
    'preserves a 1-to-25-digit reference %s',
    (id) => {
      expect(originalXLink(id)).toBe(`https://x.com/i/web/status/${id}`);
    },
  );
  it.each(invalidIDs)('rejects a non-ID input %j without a link', (id) => {
    expect(originalXLink(id)).toBeNull();
  });
  it('the independent rejection oracle catches a missing validation guard (LL-002)', () => {
    const assertRejected = (builder: typeof originalXLink) => {
      for (const id of invalidIDs) expect(builder(id)).toBeNull();
    };
    expect(() => assertRejected(originalXLink)).not.toThrow();
    // The planted defect exists only in this test and has no production route.
    const withoutGuard = (id: string | null) =>
      id === null ? null : `https://x.com/i/web/status/${id}`;
    expect(() => assertRejected(withoutGuard)).toThrow();
  });
});
