import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function failureRecord(
  error: unknown,
  repo: string,
  runRoot: string,
  entry?: string,
) {
  const value =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : {};
  const classify = (path: string) => {
    for (const [pathClass, root] of [
      ['run-owned', runRoot],
      ['repo-relative', repo],
    ] as const) {
      const name = relative(root, resolve(path));
      if (
        !isAbsolute(name) &&
        name !== '..' &&
        !name.startsWith('..\\') &&
        !name.startsWith('../')
      )
        return { pathClass, path: name.replaceAll('\\', '/') };
    }
    return { pathClass: 'external', path: null };
  };
  const frame =
    typeof value.stack === 'string'
      ? value.stack.match(
          /(?:file:\/\/\/[^\s)]+|[A-Z]:[\\/][^\n)]+):\d+:\d+/i,
        )?.[0]
      : undefined;
  const file = frame
    ? classify(
        frame.startsWith('file:')
          ? fileURLToPath(frame.replace(/:\d+:\d+$/, ''))
          : frame.replace(/:\d+:\d+$/, ''),
      )
    : entry
      ? classify(entry)
      : { pathClass: 'unknown', path: null };
  const shell =
    value.powerShell && typeof value.powerShell === 'object'
      ? (value.powerShell as Record<string, unknown>)
      : undefined;
  return {
    name: typeof value.name === 'string' ? value.name : 'Error',
    code:
      typeof value.code === 'string' || typeof value.code === 'number'
        ? value.code
        : shell?.killed === true && shell.signal
          ? 'WINDOWS_POWERSHELL_TIMEOUT'
          : 'PROOF_FAILED',
    syscall: typeof value.syscall === 'string' ? value.syscall : null,
    file,
    ...(shell
      ? {
          powerShell: {
            executable: 'WindowsPowerShell',
            script:
              typeof shell.script === 'string' ? classify(shell.script) : null,
            timeoutMs:
              typeof shell.timeoutMs === 'number' ? shell.timeoutMs : null,
            killed: shell.killed === true,
            signal: typeof shell.signal === 'string' ? shell.signal : null,
            errorId: typeof shell.errorId === 'string' ? shell.errorId : null,
          },
        }
      : {}),
    location:
      frame
        ?.match(/:(\d+):(\d+)$/)
        ?.slice(1)
        .map(Number) ?? null,
    invariant:
      typeof value.message === 'string' &&
      /^[A-Z][A-Z0-9_:.-]+$/.test(value.message.split('\n')[0]!)
        ? value.message.split('\n')[0]
        : null,
    assertion:
      value.code === 'ERR_ASSERTION'
        ? {
            operator: value.operator,
            actual:
              typeof value.actual === 'boolean' ||
              typeof value.actual === 'number'
                ? value.actual
                : null,
            expected:
              typeof value.expected === 'boolean' ||
              typeof value.expected === 'number'
                ? value.expected
                : null,
          }
        : null,
    ...(typeof value.path === 'string'
      ? classify(value.path)
      : { pathClass: 'unknown', path: null }),
  };
}
