import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test, vi } from 'vitest';
import { importSelection } from '../src/main/import-selection.ts';
import { createDropHandler } from '../src/main/drop.ts';
import type { DesktopReply } from '../src/protocol.ts';
function identities() {
  const frame = {
    url: 'app://socialprune/desktop.html',
    processId: 7,
    routingId: 2,
    parent: null,
  };
  const owner = {
    mainFrame: frame,
    getURL: () => frame.url,
    isDestroyed: () => false,
  };
  return {
    owner,
    event: { sender: owner, senderFrame: frame, processId: 7, frameId: 2 },
  };
}

test('drop and dialog share native local ZIP metadata checks; paths never appear in replies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-native-drop-'));
  try {
    const zip = join(root, 'generated.ZIP');
    await writeFile(zip, 'engine validates archive bytes');
    expect(await importSelection([zip])).toEqual({
      type: 'importExport',
      paths: [zip],
    });
    expect(await importSelection(null)).toEqual({
      type: 'importExport',
      paths: null,
    });
    await mkdir(join(root, 'folder.zip'));
    await writeFile(join(root, 'other.json'), '{}');
    for (const paths of [
      [],
      [zip, 1],
      ['relative.zip'],
      ['\\\\generated.invalid\\share\\file.zip'],
      [join(root, 'folder.zip')],
      [join(root, 'other.json')],
      [join(root, 'missing.zip')],
      Array.from({ length: 33 }, () => zip),
    ])
      await expect(importSelection(paths)).rejects.toThrow();
    const { owner, event } = identities();
    const reply: DesktopReply = {
      type: 'exportImported',
      requestId: crypto.randomUUID(),
      result: {
        status: 'imported',
        items: 3,
        duplicates: 0,
        accounts: 1,
        partial: false,
      },
    };
    const send = vi.fn().mockResolvedValue(reply),
      record = vi.fn(),
      handler = createDropHandler(owner, send, record);
    const request = { type: 'importExport', requestId: reply.requestId };
    expect(await handler(event, { request, paths: [zip] })).toEqual(reply);
    expect(send).toHaveBeenCalledExactlyOnceWith({
      request,
      selection: { type: 'importExport', paths: [zip] },
    });
    const rejected = await handler(event, {
      request,
      paths: [join(root, 'missing.zip')],
    });
    expect(rejected).toMatchObject({
      type: 'desktopFailed',
      code: 'INVALID_ARCHIVE_PATH',
    });
    expect(JSON.stringify(rejected)).not.toContain(root);
    event.frameId++;
    await expect(handler(event, { request, paths: [zip] })).rejects.toThrow(
      'BRIDGE_REJECTED',
    );
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')(
  'drop refuses a linked archive folder without following its target',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'sp-drop-link-'));
    try {
      const target = join(root, 'target'),
        link = join(root, 'link.zip');
      await mkdir(target);
      await symlink(target, link, 'junction');
      await expect(importSelection([link])).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
