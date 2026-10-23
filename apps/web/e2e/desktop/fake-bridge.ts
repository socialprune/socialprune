import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import {
  DesktopRequestSchema,
  DesktopReplySchema,
  parseDesktopReply,
  RunViewSchema,
} from '@socialprune/core/workspace/desktop-protocol';
import type {
  DesktopRequest,
  DesktopReply,
  DesktopErrorCode,
  DesktopProfileStatus,
  RunView,
} from '@socialprune/core/workspace/desktop-protocol';
import {
  createWorkspace,
  readWorkspace,
} from '@socialprune/core/workspace/store';
import {
  createMemoryStore,
  MemoryStoreBacking,
} from '@socialprune/core/workspace/memory-store';
import { LabelService } from '@socialprune/core/workspace/labels';
import type {
  Item,
  ImportRecord,
  Assessment,
  WorkspaceV2,
} from '@socialprune/core';
import { ReviewRuntime } from '../../../cli/src/review/runtime.ts';
import { runView } from './views.ts';

// desktop-fake-bridge: this module is loaded only by Playwright in Node.
export async function fakeBridge(
  page: Page,
  locale = 'en',
  seed?: WorkspaceV2,
) {
  const root = new URL('../../../../fixtures/synthetic/demo/', import.meta.url);
  const fixture =
    seed ?? createWorkspace({ id: 'desktop-generated', kind: 'demo' });
  for (const platform of seed ? [] : ['x', 'instagram']) {
    const expected = JSON.parse(
      await readFile(new URL(`${platform}/expected.json`, root), 'utf8'),
    ) as {
      items: Item[];
      records: Omit<ImportRecord, 'id' | 'status' | 'adapter' | 'importedAt'>[];
    };
    fixture.items.push(...expected.items);
    fixture.imports.push(
      ...expected.records.map((record, index) => ({
        ...record,
        id: `demo-${platform}-${index}`,
        status: 'complete' as const,
        archives: [expected.items[0]!.provenance.archive],
        importedAt: fixture.createdAt,
        adapter: { name: platform, version: '1' },
      })),
    );
  }
  fixture.counts.items = fixture.items.length;
  fixture.counts.imports = fixture.imports.length;
  const store = createMemoryStore(new MemoryStoreBacking(fixture));
  const labels = new LabelService(store);
  const assessments = JSON.parse(
    await readFile(new URL('assessments.json', root), 'utf8'),
  ) as Assessment[];
  for (const assessment of seed ? [] : assessments)
    await labels.appendAssessment(assessment);
  const runtime = new ReviewRuntime(store);
  const requests: DesktopRequest[] = [];
  const failures = new Map<'planRun' | 'startRun' | 'stop', DesktopErrorCode>();
  let current: RunView = runView('idle', 0);
  let sequence = 0;
  let firstOpen = !seed;
  const profiles = new Map<string, DesktopProfileStatus>(
    (['x', 'instagram'] as const).map((platform) => [
      platform,
      {
        platform,
        exists: false,
        ready: false,
        inUse: false,
        browser: null,
        canAdopt: platform === 'instagram',
      },
    ]),
  );
  const push = async (raw: RunView) => {
    current = RunViewSchema.parse(raw);
    await page.evaluate((value) => {
      const push = Reflect.get(globalThis, '__desktopTestPush') as (
        view: unknown,
      ) => void;
      push(value);
    }, current);
  };
  await page.exposeBinding(
    '__desktopTestRequest',
    async (_source, raw: unknown) => {
      const input = DesktopRequestSchema.parse(raw);
      requests.push(input);
      const requestId = input.requestId;
      const failureKey =
        input.type === 'runAction' && input.action === 'stop'
          ? 'stop'
          : input.type === 'planRun' || input.type === 'startRun'
            ? input.type
            : null;
      const failure = failureKey && failures.get(failureKey);
      if (failureKey && failure) {
        failures.delete(failureKey);
        return parseDesktopReply(input, {
          type: 'desktopFailed',
          requestId,
          code: failure,
        });
      }
      let reply: unknown;
      switch (input.type) {
        case 'open': {
          const replies = await runtime.run(++sequence, input);
          if (firstOpen) {
            firstOpen = false;
            for (const reply of replies)
              if (reply.type === 'opened') {
                reply.summary.accounts = [];
                reply.summary.counts.items = 0;
              }
          }
          reply = { type: 'reviewReply', requestId, replies };
          break;
        }
        case 'runView':
          reply = { type: 'runView', requestId, view: current };
          break;
        case 'browsers':
          reply = {
            type: 'browsersFound',
            requestId,
            browsers: ['chrome', 'edge'],
            preferred: 'chrome',
          };
          break;
        case 'profileStatus':
          reply = {
            type: 'profileStatus',
            requestId,
            profile: profiles.get(input.platform),
          };
          break;
        case 'profileSetup':
        case 'profileAdopt':
        case 'profileForget': {
          const exists = input.type !== 'profileForget';
          const profile: DesktopProfileStatus = {
            platform: input.platform,
            exists,
            ready: exists,
            inUse: false,
            browser: exists ? 'edge' : null,
            canAdopt: input.platform === 'instagram' && !exists,
          };
          profiles.set(input.platform, profile);
          reply = { type: `${input.type}Result`, requestId, profile };
          break;
        }
        case 'dataFolderInfo':
          reply = {
            type: 'dataFolderInfo',
            requestId,
            folder: {
              path: 'C:\\Generated\\SocialPrune Data',
              storeBuild: true,
              folders: [
                { kind: 'workspace', bytes: 4096 },
                { kind: 'profile-x', bytes: 8192 },
                { kind: 'profile-instagram', bytes: 16384 },
                { kind: 'logs', bytes: 512 },
              ],
            },
          };
          break;
        case 'dataFolderOpen':
          reply = { type: 'dataFolderOpened', requestId, opened: true };
          break;
        case 'importExport':
          reply = {
            type: 'exportImported',
            requestId,
            result: {
              status: 'imported',
              items: fixture.items.length,
              duplicates: 0,
              accounts: 2,
              partial: false,
            },
          };
          break;
        case 'backupExport':
          reply = {
            type: 'backupExported',
            requestId,
            result: {
              status: 'exported',
              bytes: 16384,
              mediaFiles: 0,
              mediaBytes: 0,
            },
          };
          break;
        case 'backupRestore':
          reply = {
            type: 'backupRestored',
            requestId,
            result: { status: 'restored', items: fixture.items.length },
          };
          break;
        case 'openLink':
          reply = { type: 'linkOpened', requestId };
          break;
        case 'planRun':
          reply = {
            type: 'runPlanned',
            requestId,
            plan: {
              platform: input.platform,
              mode: input.mode,
              accountKey: input.accountKey,
              expectedHandle: 'demo_quokka',
              planHash: 'a'.repeat(64),
              planned: 20,
              marked: 20,
              bulk: 0,
              estimateMs: 600000,
              canary: true,
              rows: [],
            },
          };
          break;
        case 'startRun':
          current = runView('awaiting-warning', current.version + 1);
          reply = { type: 'runStarted', requestId, view: current };
          break;
        case 'runAction': {
          if (current.phase !== 'idle') {
            const version = current.version + 1;
            if (input.action === 'acknowledge-warning')
              current = runView('awaiting-start', version);
            else if (
              input.action === 'start' ||
              input.action === 'continue' ||
              input.action === 'resume'
            )
              current = runView('running', version);
            else if (input.action === 'pause')
              current = runView('running', version, { pauseRequested: true });
            else
              current = runView('ended', version, {
                end: {
                  at: new Date().toISOString(),
                  reason:
                    input.action === 'stop'
                      ? 'stopped-by-person'
                      : input.action === 'matches'
                        ? 'canary'
                        : 'canary-mismatch',
                  detail:
                    input.action === 'does-not-match'
                      ? 'CANARY_MISMATCH'
                      : null,
                  cliCode:
                    input.action === 'does-not-match'
                      ? 'CANARY_MISMATCH'
                      : null,
                },
              });
          }
          reply = { type: 'runActionResult', requestId, view: current };
          break;
        }
        default:
          reply = {
            type: 'reviewReply',
            requestId,
            replies: await runtime.run(++sequence, input),
          };
      }
      return parseDesktopReply(input, DesktopReplySchema.parse(reply));
    },
  );
  await page.addInitScript((locale) => {
    localStorage.setItem('sp-locale', locale);
    const listeners = new Set<(view: unknown) => void>();
    Reflect.set(globalThis, '__desktopTestPush', (view: unknown) => {
      for (const listener of listeners) listener(view);
    });
    Reflect.set(window, 'socialprune', {
      async request(message: unknown) {
        const send = Reflect.get(globalThis, '__desktopTestRequest') as (
          message: unknown,
        ) => Promise<{ view?: unknown }>;
        const reply = await send(message);
        if (reply.view) for (const listener of listeners) listener(reply.view);
        return reply;
      },
      onRunView(listener: (view: unknown) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
  }, locale);
  return {
    requests,
    push,
    failNext: (
      action: 'planRun' | 'startRun' | 'stop',
      code: DesktopErrorCode,
    ) => {
      failures.set(action, code);
    },
    snapshot: () => store.read(readWorkspace),
    close: () => runtime.close(),
  };
}

export type FakeBridge = Awaited<ReturnType<typeof fakeBridge>>;
export type FakeReply = DesktopReply;
