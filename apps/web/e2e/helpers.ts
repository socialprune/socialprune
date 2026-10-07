import { readdir, readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir as systemTemp } from 'node:os';
import { expect } from '@playwright/test';
import type { BrowserContext, Page, Request } from '@playwright/test';
import {
  FIXTURES_ROOT,
  loadFixtureVariant,
  writeZipFile,
} from '@socialprune/fixture-gen';
import type { ZipFileEntry } from '@socialprune/fixture-gen';
import type { ImportRecord, ImportSummary, Item } from '@socialprune/core';
import type { ImportSnapshot } from '../src/import/client.ts';
import { PAGE_POLICY } from '../src/sw/policies.ts';

export interface ExpectedFixture {
  status: ImportSummary['status'];
  records: Pick<
    ImportRecord,
    | 'platform'
    | 'accounts'
    | 'variant'
    | 'exportCreatedAt'
    | 'itemCount'
    | 'diagnostics'
  >[];
  items: Item[];
}

export async function* folderEntries(
  folder: string,
  prefix = '',
): AsyncGenerator<ZipFileEntry> {
  for (const entry of (await readdir(folder, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (entry.isSymbolicLink())
      throw new Error('Fixture symlinks are not allowed.');
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      yield* folderEntries(join(folder, entry.name), `${path}/`);
    else yield { path, content: await readFile(join(folder, entry.name)) };
  }
}

export async function fixtureZips(platform: string, id: string) {
  // Use the shared loader for metadata/expectations; ZIP writing to disk lets
  // Playwright supply real Files rather than a page-side synthetic Blob.
  const fixture = await loadFixtureVariant(platform, id, { as: 'zip' });
  await fixture.archive.close();
  const directory = await mkdtemp(join(systemTemp(), 'socialprune-e2e-'));
  const files: string[] = [];
  try {
    for (const archive of fixture.variant.archives) {
      // Keep metadata names verbatim: archive names participate in fallback
      // account keys and split-part identity, even when they lack .zip.
      const out = join(directory, archive);
      await writeZipFile(
        out,
        folderEntries(join(FIXTURES_ROOT, platform, id, archive)),
      );
      files.push(out);
    }
    return {
      files,
      expected: fixture.expected as ExpectedFixture,
      description: fixture.variant.description,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function observeImport(
  context: BrowserContext,
  page: Page,
  options: { abortOnFirstItems?: boolean } = {},
) {
  const origin = 'http://127.0.0.1:4180';
  const requests: { url: string; source: string }[] = [];
  const failures: { url: string; error: string | null }[] = [];
  const errors: string[] = [];
  const record = (source: string) => (request: Request) =>
    requests.push({ url: request.url(), source });
  context.on('request', record('context'));
  page.on('request', record('page'));
  context.on('requestfailed', (request) =>
    failures.push({
      url: request.url(),
      error: request.failure()?.errorText ?? null,
    }),
  );
  page.on('requestfailed', (request) =>
    failures.push({
      url: request.url(),
      error: request.failure()?.errorText ?? null,
    }),
  );
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((abortOnFirstItems: boolean) => {
    const host = globalThis as typeof globalThis & {
      __policy: string[];
      __workerMessages: { type: string; id: number }[];
      __abortTrigger: {
        id: number;
        phaseBefore: string;
        receivedBefore: number;
      } | null;
      __insertedStyles: number;
    };
    host.__policy = [];
    host.__workerMessages = [];
    host.__abortTrigger = null;
    host.__insertedStyles = 0;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element)
            host.__insertedStyles +=
              Number(node.tagName === 'STYLE') +
              node.querySelectorAll('style').length;
        }
      }
    }).observe(document, { childList: true, subtree: true });
    let abortPending = abortOnFirstItems;
    document.addEventListener('securitypolicyviolation', (event) =>
      host.__policy.push(event.effectiveDirective),
    );
    const OriginalWorker = Worker;
    globalThis.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener(
          'message',
          (event: MessageEvent<{ type: string; id: number }>) => {
            host.__workerMessages.push({
              type: event.data.type,
              id: event.data.id,
            });
            if (abortPending && event.data.type === 'items') {
              // Law 23: enter the real abort path on the first batch, rather
              // than assume it is still running after a Node poll and click.
              abortPending = false;
              const state = window.socialprune.getImportSnapshot();
              host.__abortTrigger = {
                id: event.data.id,
                phaseBefore: state.phase,
                receivedBefore: state.receivedItems,
              };
              const button = document.querySelector<HTMLButtonElement>(
                '[data-testid="abort-button"]',
              );
              if (!button || button.disabled)
                throw new Error(
                  'Abort must be enabled on the first item batch.',
                );
              button.click();
            }
          },
        );
      }
    };
  }, options.abortOnFirstItems ?? false);
  return {
    assert: async () => {
      expect(
        requests.length,
        'The audit must observe actual browser loads.',
      ).toBeGreaterThan(0);
      expect(
        requests.filter(({ url }) => new URL(url).origin !== origin),
      ).toEqual([]);
      expect(failures).toEqual([]);
      expect(errors).toEqual([]);
      expect(await page.locator('style').count()).toBe(0);
      expect(
        await page.evaluate(
          () => Reflect.get(globalThis, '__insertedStyles') as number,
        ),
      ).toBe(0);
      expect(
        await page.evaluate(
          () =>
            (globalThis as typeof globalThis & { __policy: string[] }).__policy,
        ),
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => window.socialprune.getImportSnapshot().policyViolations,
        ),
      ).toEqual([]);
    },
  };
}

export async function waitForApp(page: Page): Promise<void> {
  await page.goto('/socialprune/#/import');
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy).toBe(PAGE_POLICY);
  expect(await page.locator('script:not([src])').count()).toBe(0);
  await expect(page.getByTestId('import-state')).toHaveAttribute(
    'data-phase',
    'idle',
  );
  await expect(page.locator('main[data-gate]')).toHaveAttribute(
    'data-gate',
    'ready',
  );
  await expect
    .poll(
      () =>
        page.workers().filter((worker) => /\/worker-/.test(worker.url()))
          .length,
    )
    .toBe(1);
}

export async function importFiles(
  page: Page,
  files: string[],
): Promise<ImportSnapshot> {
  await page.getByTestId('archives').setInputFiles(files);
  await page.getByTestId('import-button').click();
  await expect(page.getByTestId('import-state')).toHaveAttribute(
    'data-phase',
    'complete',
  );
  return page.evaluate(() => window.socialprune.getImportSnapshot());
}

export function comparableRecords(
  records: ExpectedFixture['records'],
): ExpectedFixture['records'] {
  return records
    .map(
      ({
        platform,
        accounts,
        variant,
        exportCreatedAt,
        itemCount,
        diagnostics,
      }) => ({
        platform,
        accounts: [...accounts].sort((a, b) => a.key.localeCompare(b.key)),
        variant,
        exportCreatedAt,
        itemCount,
        diagnostics: diagnostics.map((diagnostic) => ({
          ...diagnostic,
          files: [...diagnostic.files].sort(),
        })),
      }),
    )
    .sort((a, b) => a.platform.localeCompare(b.platform));
}
