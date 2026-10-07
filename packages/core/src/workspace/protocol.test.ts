import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  HttpReviewRequestSchema,
  WorkspaceNotificationSchema,
  WorkspaceReplySchema,
  WorkspaceRequestSchema,
} from './protocol.ts';
import { sampleItem } from '../testing.ts';

test('shared protocol subpath resolves and its repository import graph is browser-clean', async () => {
  expect(import.meta.resolve('@socialprune/core/workspace/protocol')).toBe(
    new URL('./protocol.ts', import.meta.url).href,
  );
  const visited = new Set<string>();
  const visit = async (file: string): Promise<void> => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(
      /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\bfrom\s*)?(['"])([^'"]+)\1|\bimport\s*\(\s*(['"])([^'"]+)\3/g,
    )) {
      const specifier = (match[2] ?? match[4])!;
      expect(specifier.startsWith('node:'), `${file} -> ${specifier}`).toBe(
        false,
      );
      expect(specifier.includes('workspace/review')).toBe(false);
      if (specifier.startsWith('.'))
        await visit(resolve(dirname(file), specifier));
    }
  };
  await visit(fileURLToPath(new URL('./protocol.ts', import.meta.url)));
  expect(visited.size).toBeGreaterThan(2);
});
test('protocol rejects unknown request types, raw errors, selected sources and transfer objects over HTTP', () => {
  for (const input of [
    { type: 'approve', requestId: 'r' },
    { type: 'unknown', requestId: 'r' },
    {
      type: 'decide',
      requestId: 'r',
      commandId: 'c',
      itemIds: ['x:1'],
      value: 'delete',
      expected: { 'x:1': 'undecided' },
      source: { kind: 'agent' },
    },
  ])
    expect(WorkspaceRequestSchema.safeParse(input).success).toBe(false);
  for (const input of [
    'PLANTED_ERROR_TEXT',
    { type: 'failed', requestId: 'r', code: 'PLANTED_ERROR_TEXT' },
    {
      type: 'failed',
      requestId: 'r',
      code: 'STORAGE',
      message: 'PLANTED_ERROR_TEXT',
    },
    {
      type: 'rejected',
      requestId: 'r',
      commandId: 'c',
      code: 'STORAGE',
      error: 'PLANTED_ERROR_TEXT',
    },
  ])
    expect(WorkspaceReplySchema.safeParse(input).success).toBe(false);
  expect(
    WorkspaceReplySchema.parse({
      type: 'failed',
      requestId: 'r',
      code: 'STORAGE',
    }).type,
  ).toBe('failed');
  expect(
    HttpReviewRequestSchema.safeParse({
      type: 'restore',
      requestId: 'r',
      file: new Blob(['[]']),
    }).success,
  ).toBe(false);
  expect(
    WorkspaceRequestSchema.parse({
      type: 'restore',
      requestId: 'r',
      file: new Blob(['[]']),
    }).type,
  ).toBe('restore');
});
test('N1 overwrite selection and N2 page binding are mandatory for preview commands', () => {
  const preview = {
    type: 'previewBulk',
    requestId: 'r',
    pageId: 'page-1',
    previewId: 'preview-1',
    queryId: 'query-1',
    generation: 2,
    value: 'delete',
    overwrite: ['undecided', 'later'],
  };
  expect(WorkspaceRequestSchema.parse(preview)).toEqual(preview);
  const { pageId: _page, ...withoutPage } = preview;
  const { overwrite: _overwrite, ...withoutOverwrite } = preview;
  expect(_page).toBe('page-1');
  expect(_overwrite).toEqual(['undecided', 'later']);
  expect(WorkspaceRequestSchema.safeParse(withoutPage).success).toBe(false);
  expect(WorkspaceRequestSchema.safeParse(withoutOverwrite).success).toBe(
    false,
  );
  expect(
    WorkspaceRequestSchema.safeParse({ ...preview, overwrite: ['agent'] })
      .success,
  ).toBe(false);
  for (const type of ['confirmBulk', 'releasePreview']) {
    const value = {
      type,
      requestId: 'r',
      previewId: 'p',
      ...(type === 'confirmBulk' ? { commandId: 'c' } : {}),
    };
    expect(WorkspaceRequestSchema.safeParse(value).success).toBe(false);
    expect(
      WorkspaceRequestSchema.safeParse({ ...value, pageId: 'page-1' }).success,
    ).toBe(true);
  }
});
test('commands require exact expected ID sets and bounded rows carry v2 items', () => {
  const command = {
    type: 'decide',
    requestId: 'r',
    commandId: 'c',
    itemIds: ['x:1'],
    value: 'keep',
    expected: { 'x:1': 'undecided' },
  };
  expect(WorkspaceRequestSchema.parse(command)).toEqual(command);
  for (const expected of [{}, { 'x:1': 'undecided', 'x:2': 'later' }])
    expect(
      WorkspaceRequestSchema.safeParse({ ...command, expected }).success,
    ).toBe(false);
  expect(
    WorkspaceRequestSchema.safeParse({ ...command, itemIds: ['x:1', 'x:1'] })
      .success,
  ).toBe(false);
  expect(
    WorkspaceRequestSchema.safeParse({
      type: 'window',
      requestId: 'r',
      queryId: 'q',
      generation: 0,
      offset: 0,
      limit: 201,
    }).success,
  ).toBe(false);
  expect(
    WorkspaceReplySchema.parse({
      type: 'itemDetail',
      requestId: 'r',
      item: sampleItem(),
      assessments: [],
      events: [],
    }).type,
  ).toBe('itemDetail');
  expect(
    WorkspaceNotificationSchema.parse({
      type: 'changed',
      revision: 1,
      itemIds: 'many',
      countsChanged: true,
    }).type,
  ).toBe('changed');
  expect(
    WorkspaceNotificationSchema.safeParse({ type: 'failed', code: 'STORAGE' })
      .success,
  ).toBe(false);
});
