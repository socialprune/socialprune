import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export async function copyDiagnosticBundle(
  input: string,
  output: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await mkdir(output, { recursive: true });
  for (const entry of await readdir(input, { withFileTypes: true })) {
    signal.throwIfAborted();
    const source = join(input, entry.name),
      target = join(output, entry.name);
    if (entry.isDirectory()) await copyDiagnosticBundle(source, target, signal);
    else if (entry.isFile())
      await pipeline(createReadStream(source), createWriteStream(target), {
        signal,
      });
    else throw new Error('DIAGNOSE_BUNDLE_LINK_REFUSED');
  }
}

export async function collectDiagnosticReceipts(
  input: string,
  output: string,
): Promise<void> {
  await mkdir(output, { recursive: true });
  for (const entry of await readdir(input, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === 'evidence') {
      await collectDiagnosticReceipts(join(input, entry.name), output);
    } else if (
      entry.isFile() &&
      (/^release-[\w.-]+\.(?:json|ndjson|log)$/.test(entry.name) ||
        entry.name === 'lifecycle.ndjson')
    ) {
      await copyFile(
        join(input, entry.name),
        join(
          output,
          entry.name === 'lifecycle.ndjson'
            ? 'release-lifecycle-events.ndjson'
            : entry.name,
        ),
      );
    }
  }
}

export async function diagnosticPhase<T>(
  deadline: number,
  work: (remainingMs: number, signal: AbortSignal) => Promise<T>,
  collect: () => Promise<void>,
): Promise<T> {
  const controller = new AbortController();
  const remaining = Math.max(0, deadline - Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<T> | undefined;
  try {
    if (!remaining) throw new Error('DIAGNOSE_WORK_DEADLINE');
    running = work(remaining, controller.signal);
    return await Promise.race([
      running,
      new Promise<never>((_resolve, reject) => {
        const expire = () => {
          const remainder = deadline - Date.now();
          if (remainder > 0) {
            timer = setTimeout(expire, Math.ceil(remainder));
            return;
          }
          reject(new Error('DIAGNOSE_WORK_DEADLINE'));
          controller.abort();
        };
        timer = setTimeout(expire, Math.ceil(remaining));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    // Abort terminates the parent-owned launcher; its job closes all owned
    // descendants. Wait for that close before the final receipt copy.
    if (controller.signal.aborted) await running?.catch(() => undefined);
    await collect();
  }
}
