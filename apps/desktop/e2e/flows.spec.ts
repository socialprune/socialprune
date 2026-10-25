import { runNativeQuery } from '../packaging/windows-powershell.ts';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { root } from '../packaging/paths.ts';
import { launch, call, select } from './helpers.ts';
import { writeZipFile } from '../../../tools/fixture-gen/src/shared/zip.ts';
import { expectDesktopNavigation } from '../../web/e2e/desktop/navigation.ts';

test('desktop navigation follows setup and human review before optional model suggestions', async () => {
  const app = await launch('probe', false);
  try {
    await expectDesktopNavigation(app.page, 'en');
    const buttons = app.page
      .getByRole('navigation', { name: 'SocialPrune' })
      .getByRole('button');
    await buttons.first().focus();
    for (const button of await buttons.all()) {
      await expect(button).toBeFocused();
      await app.page.keyboard.press('Tab');
    }
    await buttons.first().click();
    await expect(app.page.getByTestId('desktop-setup')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('demo review decision crosses the real bridge, portable backup, CLI and restore', async () => {
  const app = await launch('probe');
  try {
    await expect(app.page.getByTestId('review-card')).toBeVisible();
    await app.page.getByRole('tab', { name: /^All,/ }).click();
    await app.page.getByRole('button', { name: /^Keep/ }).first().click();
    const opened = await call(app, {
      type: 'open',
      requestId: 'decision-summary',
      workspaceId: 'local',
    });
    expect(opened).toMatchObject({
      type: 'reviewReply',
      replies: [{ type: 'opened', summary: { decisions: { keep: 1 } } }],
    });
    const file = join(app.data, 'desktop-backup.json');
    await select(app, { type: 'backupExport', path: file });
    expect(
      await call(app, { type: 'backupExport', requestId: 'export' }),
    ).toMatchObject({ type: 'backupExported', result: { status: 'exported' } });
    const backup = JSON.parse(await readFile(file, 'utf8')) as {
      decisionEvents: {
        value: string;
        source: { kind: string; via: string };
      }[];
    };
    expect(backup.decisionEvents).toHaveLength(1);
    expect(backup.decisionEvents[0]).toMatchObject({
      value: 'keep',
      source: { kind: 'human', via: 'local-review' },
    });
    const cli = async (args: string[]) => {
      const { stdout } = await runNativeQuery(
        process.execPath,
        [join(root, 'apps/cli/src/main.ts'), ...args, '--json'],
        { windowsHide: true, timeout: 60_000, queryClass: 'cli-backup' },
      );
      return JSON.parse(stdout) as unknown;
    };
    const other = join(app.data, 'cli-copy');
    await cli(['backup', 'restore', file, '--workspace', other]);
    expect(await cli(['summary', '--workspace', other])).toMatchObject({
      data: { decisions: { keep: 1 } },
    });
    const returned = join(app.data, 'cli-backup.json');
    await cli(['backup', 'export', '--workspace', other, '--out', returned]);
    await select(app, { type: 'backupRestore', path: returned });
    expect(
      await call(app, { type: 'backupRestore', requestId: 'restore' }),
    ).toMatchObject({
      type: 'backupRestored',
      result: { status: 'restored', items: 300 },
    });
    expect(
      await call(app, {
        type: 'open',
        requestId: 'roundtrip',
        workspaceId: 'local',
      }),
    ).toMatchObject({
      type: 'reviewReply',
      replies: [
        {
          type: 'opened',
          summary: { decisions: { keep: 1 }, counts: { decisionEvents: 1 } },
        },
      ],
    });
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('native dialog cancellations and selections stay outside renderer messages', async () => {
  const app = await launch('probe', false);
  try {
    for (const type of [
      'importExport',
      'backupExport',
      'backupRestore',
    ] as const) {
      expect(await call(app, { type, requestId: type })).toMatchObject({
        result: { status: 'cancelled' },
      });
    }
    const entries: { path: string; content: Uint8Array }[] = [];
    const exportDirectory = join(
      root,
      'fixtures/synthetic/demo/x/twitter-2026-10-01-demox',
    );
    const collect = async (prefix = ''): Promise<void> => {
      for (const entry of await readdir(join(exportDirectory, prefix), {
        withFileTypes: true,
      })) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await collect(path);
        else if (entry.isFile())
          entries.push({
            path,
            content: await readFile(join(exportDirectory, path)),
          });
      }
    };
    await collect();
    const zip = join(app.data, 'generated-demo.zip');
    await writeZipFile(zip, entries);
    await select(app, { type: 'importExport', paths: [zip] });
    const reply = await call(app, {
      type: 'importExport',
      requestId: 'import',
    });
    expect(reply).toMatchObject({
      type: 'exportImported',
      result: { status: 'imported', items: 300 },
    });
    expect(JSON.stringify(reply)).not.toMatch(/[A-Z]:\\|twitter-2026|demox/);
    await expect(
      app.page.evaluate(() =>
        window.socialprune.request({
          type: 'importExport',
          requestId: 'path',
          path: 'generated',
        } as never),
      ),
    ).rejects.toThrow();
  } finally {
    await app.close();
  }
});

test('guide fact, report and post addresses open only on requests and unknown addresses do not', async () => {
  const app = await launch('probe');
  try {
    const links = () =>
      app.application.evaluate(
        () =>
          (Reflect.get(globalThis, 'desktopProbe') as { links: string[] })
            .links,
      );
    expect(await links()).toEqual([]);
    const { guides } = await import('socialprune/engine');
    const { guideFacts } = await import('@socialprune/core/guide/check');
    const fact = guideFacts(
      guides.find((guide) => guide.platform === 'x')!,
    )[0]!;
    expect(
      await call(app, {
        type: 'openLink',
        requestId: 'guide',
        link: {
          kind: 'guide-source',
          platform: 'x',
          factId: fact.id,
          locale: 'en',
        },
      }),
    ).toMatchObject({ type: 'linkOpened' });
    expect(
      await call(app, {
        type: 'openLink',
        requestId: 'report',
        link: { kind: 'guide-report' },
      }),
    ).toMatchObject({ type: 'linkOpened' });
    expect(
      await call(app, {
        type: 'openLink',
        requestId: 'post',
        link: {
          kind: 'platform-post',
          url: 'https://www.instagram.com/p/Generated_99/',
        },
      }),
    ).toMatchObject({ type: 'linkOpened' });
    expect(
      await call(app, {
        type: 'openLink',
        requestId: 'unknown',
        link: {
          kind: 'guide-source',
          platform: 'x',
          factId: 'x.unknown',
          locale: 'en',
        },
      }),
    ).toMatchObject({ type: 'desktopFailed', code: 'LINK_UNKNOWN' });
    await expect(
      call(app, {
        type: 'openLink',
        requestId: 'foreign',
        link: {
          kind: 'platform-post',
          url: 'https://generated.invalid/secret',
        },
      }),
    ).rejects.toThrow();
    expect(await links()).toEqual([
      fact.source.url,
      'https://github.com/socialprune/socialprune/issues/new',
      'https://www.instagram.com/p/Generated_99/',
    ]);
  } finally {
    await app.close();
  }
});
