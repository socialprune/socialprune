import { stripVTControlCharacters } from 'node:util';
import { homedir, tmpdir } from 'node:os';
import { root } from './paths.ts';

interface DiagnosticPaths {
  repo: string;
  temp: string;
  home: string;
}
const diagnosticPaths = { repo: root, temp: tmpdir(), home: homedir() };

// Shared bounded path redaction. Importing this from an early child failure
// must not initialize the red-control runner or resolve test frameworks.
export function controlOutputExcerpt(
  output: string,
  paths: DiagnosticPaths = diagnosticPaths,
): string[] {
  let text = stripVTControlCharacters(output).replace(/\\+/g, '/');
  text = text
    .replace(/file:\/\/\/[^\s"'<>]+/gi, (url) => {
      try {
        return decodeURIComponent(url);
      } catch {
        return url;
      }
    })
    .replace(/file:\/\/\/(?=[a-z]:\/)/gi, '')
    .replace(/file:\/\/(?=\/)/gi, '');
  const roots: [string, string][] = [
    ['repo', paths.repo],
    ['temp', paths.temp],
    ['home', paths.home],
  ];
  for (const [kind, path] of roots.sort(
    ([, left], [, right]) => right.length - left.length,
  )) {
    const normalized = path.replace(/\\+/g, '/').replace(/\/$/, '');
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(
      new RegExp(escaped + '(?=/|[\\s"\'():]|$)', 'gi'),
      `<${kind}>`,
    );
  }
  text = text
    .replace(/[a-z]:\/a\/_temp\b/gi, '<temp>')
    .replace(/[a-z]:\/a\/[^/\s"']+\/[^/\s"']+(?=\/)/gi, '<repo>')
    .replace(/\/(?:home|Users)\/[^/\n"']+\/work\/_temp\b/g, '<temp>')
    .replace(
      /\/(?:home|Users)\/[^/\n"']+\/work\/[^/\s"']+\/[^/\s"']+(?=\/)/g,
      '<repo>',
    )
    .replace(
      /(?:[a-z]:)?\/Users\/[^/\n"']+\/AppData\/Local\/Temp\b/gi,
      '<temp>',
    )
    .replace(/(?:[a-z]:)?\/Users\/[^/\n"']+(?=\/|$)/gim, '<home>')
    .replace(/\/home\/[^/\s"']+(?=\/|$)/gm, '<home>');
  return text
    .replace(/\r\n?/g, '\n')
    .trimEnd()
    .split('\n')
    .slice(-200)
    .map((line) =>
      [...line]
        .filter(
          (character) =>
            character === '\t' ||
            (character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127),
        )
        .join('')
        .slice(0, 400),
    );
}
