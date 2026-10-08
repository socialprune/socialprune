import type { CliContext } from '../context.ts';

export function capturedContext(services: CliContext['services']) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const opened: string[] = [];
  const context: CliContext = {
    io: {
      stdout: {
        write: (text) => {
          stdout.push(text);
        },
      },
      stderr: {
        write: (text) => {
          stderr.push(text);
        },
      },
    },
    now: () => new Date('2026-10-07T00:00:00.000Z'),
    signal: new AbortController().signal,
    nodeVersion: process.versions.node,
    services,
    openBrowser: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
  };
  return { context, stdout, stderr, opened };
}
