import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { openFoundationWorkspace } from '../src/engine-host/workspace.ts';
import { generatedWorkspace } from './workspace.ts';

test('read-only generated workspace and failed open produce bounded results', async () => {
  const data = await mkdtemp(join(tmpdir(), 'socialprune-desktop-store-'));
  const request = {
    type: 'foundationRead' as const,
    requestId: '00000000-0000-4000-8000-000000000001',
  };
  try {
    const count = await generatedWorkspace(data);
    const store = openFoundationWorkspace(
      join(data, 'workspace/socialprune.sqlite'),
    );
    expect(store.read(request)).toMatchObject({
      type: 'foundationSummary',
      items: count,
    });
    store.close();
    const failed = openFoundationWorkspace(
      join(data, 'missing-directory/private.sqlite'),
    );
    expect(failed.read(request)).toEqual({
      ...request,
      type: 'rejected',
      code: 'WORKSPACE_OPEN_FAILED',
    });
    expect(failed.read(request)).toMatchObject({
      type: 'rejected',
      code: 'WORKSPACE_OPEN_FAILED',
    });
    failed.close();
  } finally {
    await rm(data, { recursive: true, force: true });
  }
}, 30_000);
