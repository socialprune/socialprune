import { expect, test, vi } from 'vitest';
import { WorkspaceClient } from './client.ts';
import type { WorkspacePort } from './client.ts';

test('FAST-1 click-list reads and client disposal wait for unsent human writes', async () => {
  const posted = vi.fn(),
    terminate = vi.fn();
  const port: WorkspacePort = {
    postMessage: posted,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    terminate,
  };
  const client = new WorkspaceClient(port, 'generated-queue-test');
  let release!: () => void;
  const write = client.commands.enqueue(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const list = client.request({
    type: 'clickListOpen',
    requestId: 'list',
    listId: 'generated-list',
    accountKey: 'x:generated',
  });
  void list.catch(() => undefined);
  client.dispose();
  await vi.waitFor(() => {
    expect(client.commands.pending).toBe(1);
    expect(release).toBeTypeOf('function');
  });
  expect(posted).not.toHaveBeenCalled();
  expect(terminate).not.toHaveBeenCalled();
  release();
  await write;
  await client.commands.flush();
  await vi.waitFor(() => expect(terminate).toHaveBeenCalledOnce());
});

test('disposed worker clients reject outstanding and later requests instead of hanging', async () => {
  const postMessage = vi.fn();
  const client = new WorkspaceClient(
    {
      postMessage,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
      terminate() {},
    },
    'generated-disposal',
  );
  const outstanding = client.open();
  const settled = vi.fn();
  void outstanding.then(settled, settled);
  client.dispose();
  await vi.waitFor(() => expect(settled).toHaveBeenCalled());
  await expect(outstanding).rejects.toThrow('Workspace client disposed.');
  const before = postMessage.mock.calls.length;
  await expect(client.open()).rejects.toThrow('Workspace client disposed.');
  expect(postMessage).toHaveBeenCalledTimes(before);
});
