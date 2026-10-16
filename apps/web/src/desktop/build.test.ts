import { expect, test } from 'vitest';
import { assertDesktopOutput } from '../../tooling/desktop-build-output.ts';
import { DESKTOP_POLICY } from './policy.ts';

const html = `<meta http-equiv="Content-Security-Policy" content="${DESKTOP_POLICY}" />`;
test('desktop policy retains the directives specified by ADR-031', () => {
  for (const directive of [
    "connect-src 'none'",
    'img-src app:',
    'media-src app:',
    "require-trusted-types-for 'script'",
    'trusted-types socialprune',
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ])
    expect(DESKTOP_POLICY.split('; ')).toContain(directive);
});
test('desktop output accepts its policy and rejects planted violations', () => {
  expect(() =>
    assertDesktopOutput(new Map([['desktop.html', html]])),
  ).not.toThrow();
  for (const planted of [
    new Map([
      [
        'desktop.html',
        html.replace("connect-src 'none'", "connect-src 'self'"),
      ],
    ]),
    new Map([['desktop.html', `${html}<script>alert(1)</script>`]]),
    new Map([
      ['desktop.html', html],
      ['assets/planted.js', 'desktop-fake-bridge'],
    ]),
    new Map([
      ['desktop.html', html],
      ['assets/module.wasm', 'module'],
    ]),
    new Map([
      ['desktop.html', html],
      ['assets/planted.js', 'WebAssembly.instantiate(bytes)'],
    ]),
  ])
    expect(() => assertDesktopOutput(planted)).toThrow();
});
