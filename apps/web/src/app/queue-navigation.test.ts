import { expect, test, vi } from 'vitest';
import { queuedHashNavigation } from './queue-navigation.ts';
import { CommandQueue } from '../workspace/command-queue.ts';
import type { WorkspaceClient } from '../workspace/client.ts';

for (const fail of [false, true])
  test(`F2 hash handler holds the route and ${fail ? 'restores review on failure' : 'accepts navigation after success'}`, async () => {
    const commands = new CommandQueue(),
      accept = vi.fn(),
      replaceState = vi.fn();
    vi.stubGlobal('location', { hash: '#/archive' });
    vi.stubGlobal('history', { replaceState });
    let release!: () => void;
    const work = commands.enqueue(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return !fail;
    });
    const client = {
      commands,
      flushCommands: () => commands.flush(),
    } as unknown as WorkspaceClient;
    const changed = queuedHashNavigation(() => client, accept);
    changed();
    expect(accept).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release();
    await work;
    await commands.flush();
    await vi.waitFor(() =>
      expect(accept).toHaveBeenCalledWith(fail ? '#/review' : '#/archive'),
    );
    if (fail) expect(replaceState).toHaveBeenCalledWith(null, '', '#/review');
    vi.unstubAllGlobals();
  });
