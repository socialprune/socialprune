import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { openEngine } from 'socialprune/engine';
import { generatedWorkspace } from './workspace.ts';

test('real engine reads the generated workspace and closes before reopening', async () => {
  const data = await mkdtemp(join(tmpdir(), 'socialprune-desktop-store-'));
  const request = {
    type: 'open' as const,
    workspaceId: 'local',
    requestId: '00000000-0000-4000-8000-000000000001',
  };
  try {
    const count = await generatedWorkspace(data);
    const engine = await openEngine({ dataFolder: data });
    expect(await engine.request(request)).toMatchObject({
      type: 'reviewReply',
      replies: [{ type: 'opened', summary: { counts: { items: count } } }],
    });
    expect(
      await engine.request({ type: 'runView', requestId: 'view' }),
    ).toMatchObject({ type: 'runView', view: { phase: 'idle', version: 0 } });
    await engine.close();
    expect(await engine.request(request)).toMatchObject({
      type: 'desktopFailed',
      code: 'NOT_AVAILABLE',
    });
  } finally {
    await rm(data, { recursive: true, force: true });
  }
}, 30_000);
