import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type {
  Assessment,
  DecisionEvent,
  Item,
  ReviewView,
  Submission,
  WorkspaceMeta,
} from '@socialprune/core';
import type { LabelFile, Summary } from '@socialprune/core/workspace/payloads';
import type { ExpectedFixture } from './helpers.ts';
import { observeImport, waitForApp } from './helpers.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const main = fileURLToPath(new URL('../../cli/src/main.ts', import.meta.url));
const fixture = new URL(
  '../../../fixtures/synthetic/x/two-accounts/',
  import.meta.url,
);
function requireNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major! < 24 || (major === 24 && minor! < 15))
    throw new Error(
      `backup-cli.spec.ts needs Node 24.15 or newer for the real CLI and read-only SQLite; process.execPath is ${process.execPath} (Node ${process.versions.node}).`,
    );
}
async function cli(args: string[]) {
  requireNode();
  const child = spawn(process.execPath, [main, ...args, '--json'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (bytes: Buffer) => {
    stdout += bytes.toString('utf8');
  });
  child.stderr.on('data', (bytes: Buffer) => {
    stderr += bytes.toString('utf8');
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  expect(code, `Real CLI ${args[0]} exited ${code}: ${stderr}`).toBe(0);
  // --json emits one envelope, pretty-printed across several lines. Parsing
  // the entire stdout also rejects a second envelope or stray output.
  const reply = JSON.parse(stdout) as {
    schemaVersion: number;
    status: string;
    data: unknown;
  };
  expect(reply).toMatchObject({ schemaVersion: 1, status: 'ok' });
  return reply.data;
}
const hash = (text: string) =>
  'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex');
// This test's JSON input determines its own canonical digest. It never calls
// SocialPrune's canonical/hash helper to construct the submission oracle.
function ordered(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(ordered).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${ordered((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value);
}
function labels(items: Item[]): LabelFile {
  return {
    schemaVersion: 1,
    submissionId: 'i1-browser-cli-generated',
    source: { kind: 'agent', name: 'I1 generated agent', version: '1' },
    labels: items.map((item) => ({
      itemId: item.id,
      contentHash: hash(item.text),
      category: 'harmless',
      risk: 0,
      reason: 'This generated post is a plain statement.',
      evidence: item.text,
      confidence: null,
    })),
  };
}
// Observation only: no workspace request exposes submission records. Read the
// restored disposable browser's native stores without calling product helpers.
async function browserRecords(page: Page) {
  return page.evaluate(async () => {
    const open = (name: string) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(
            request.error ??
              new Error('Disposable browser database open failed.'),
          );
      });
    const read = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(
            request.error ??
              new Error('Disposable browser database read failed.'),
          );
      });
    const registry = await open('sp-registry');
    let storageId: string;
    try {
      storageId = (await read(
        registry.transaction('pointers').objectStore('pointers').get('active'),
      )) as string;
    } finally {
      registry.close();
    }
    const db = await open('sp-ws-' + storageId);
    try {
      const tx = db.transaction(
        ['meta', 'items', 'assessments', 'submissions', 'decisionEvents'],
        'readonly',
      );
      const [meta, items, assessments, submissions, decisions] =
        await Promise.all([
          read<unknown>(tx.objectStore('meta').get('workspace')),
          read(tx.objectStore('items').getAll()),
          read(tx.objectStore('assessments').getAll()),
          read(tx.objectStore('submissions').getAll()),
          read(tx.objectStore('decisionEvents').getAll()),
        ]);
      return {
        meta: meta as WorkspaceMeta,
        items: (items as { item: Item }[]).map((row) => row.item),
        assessments: assessments as Assessment[],
        submissions: submissions as Submission[],
        decisions: decisions as DecisionEvent[],
      };
    } finally {
      db.close();
    }
  });
}
async function sqliteRecords(workspace: string) {
  requireNode();
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(workspace, 'socialprune.sqlite'), {
    readOnly: true,
  });
  try {
    const rows = <T>(table: string): T[] =>
      db
        .prepare(`SELECT data FROM ${table} ORDER BY rowid`)
        .all()
        .map((row) => JSON.parse(String(row.data)) as T);
    return {
      meta: rows<WorkspaceMeta>('meta')[0]!,
      items: rows<{ item: Item }>('items').map((row) => row.item),
      assessments: rows<Assessment>('assessments'),
      submissions: rows<Submission>('submissions'),
      decisions: rows<DecisionEvent>('decision_events'),
    };
  } finally {
    db.close();
  }
}
const sortItems = (items: Item[]) =>
  [...items].sort((a, b) => a.id.localeCompare(b.id));
function assertLabels(
  records: Awaited<ReturnType<typeof sqliteRecords>>,
  input: LabelFile,
) {
  expect(records.assessments).toHaveLength(input.labels.length);
  expect(
    records.assessments
      .map(
        ({
          itemId,
          source,
          submissionId,
          category,
          risk,
          reason,
          evidence,
          confidence,
        }) => ({
          itemId,
          source,
          submissionId,
          category,
          risk,
          reason,
          evidence,
          confidence,
        }),
      )
      .sort((a, b) => a.itemId.localeCompare(b.itemId)),
  ).toEqual(
    input.labels
      .map(({ itemId, category, risk, reason, evidence, confidence }) => ({
        itemId,
        source: input.source,
        submissionId: input.submissionId,
        category,
        risk,
        reason,
        evidence,
        confidence,
      }))
      .sort((a, b) => a.itemId.localeCompare(b.itemId)),
  );
  expect(
    records.submissions.map(({ receivedAt: _at, ...value }) => {
      void _at;
      return value;
    }),
  ).toEqual([
    {
      submissionId: input.submissionId,
      source: input.source,
      labelCount: input.labels.length,
      contentHash: hash(ordered(input)),
    },
  ]);
}

test('I1 real CLI backup restores in the browser, and a human decision and view return intact to a fresh CLI workspace', async ({
  page,
  context,
}) => {
  // D40: 11.8 s in Firefox in the full Windows run on 2026-10-08.
  test.setTimeout(90_000);
  requireNode();
  const directory = await mkdtemp(join(tmpdir(), 'sp-i1-backup-cli-'));
  const fromCli = join(directory, 'from-cli'),
    toCli = join(directory, 'to-cli');
  const labelPath = join(directory, 'labels.json'),
    cliBackup = join(directory, 'cli.json'),
    webBackup = join(directory, 'browser.json');
  try {
    const expected = JSON.parse(
      await readFile(new URL('expected.json', fixture), 'utf8'),
    ) as ExpectedFixture;
    const variant = JSON.parse(
      await readFile(new URL('variant.json', fixture), 'utf8'),
    ) as { archives: string[] };
    const input = labels(expected.items);
    const chosen = expected.items[1]!;
    expect(chosen.account.key).not.toBe(expected.items[0]!.account.key);
    const view: ReviewView = {
      accountKey: chosen.account.key,
      filter: { decisions: ['delete'] },
      sort: [{ by: 'createdAt', direction: 'desc' }],
      search: chosen.text,
    };
    const counts = {
      imports: expected.records.length,
      items: expected.items.length,
      assessments: input.labels.length,
      submissions: 1,
      decisionEvents: 0,
      outcomeEvents: 0,
    };
    await writeFile(labelPath, JSON.stringify(input), 'utf8');
    await cli([
      'import',
      ...variant.archives.map((name) =>
        fileURLToPath(new URL(name + '/', fixture)),
      ),
      '--workspace',
      fromCli,
    ]);
    await cli(['labels', 'submit', labelPath, '--workspace', fromCli]);
    await cli(['backup', 'export', '--workspace', fromCli, '--out', cliBackup]);

    await page.addInitScript(() =>
      Object.defineProperty(window, 'showSaveFilePicker', {
        value: undefined,
        configurable: true,
      }),
    );
    const audit = await observeImport(context, page);
    await waitForApp(page);
    // A fresh workspace has no review-navigation links yet. The backup route
    // is the existing entrypoint for restoring a file before any import.
    await page.goto('/socialprune/#/backup');
    await page
      .getByLabel('SocialPrune backup file', { exact: true })
      .setInputFiles(cliBackup);
    await expect(
      page.getByRole('heading', { name: 'Restore preview', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        `${counts.items} entries, 0 decisions, 0 outcome records, ${counts.assessments} suggestions, ${new Set(expected.items.map((item) => item.account.key)).size} accounts.`,
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Restore this backup', exact: true })
      .click();
    await expect(
      page.getByText(
        'The backup was restored. This browser now uses that review.',
        { exact: true },
      ),
    ).toBeVisible();
    const browser = await browserRecords(page);
    expect(sortItems(browser.items)).toEqual(sortItems(expected.items));
    assertLabels(browser, input);
    expect(browser.decisions).toEqual([]);
    expect(await page.evaluate(() => window.workspace.summary?.counts)).toEqual(
      counts,
    );

    await page.getByRole('link', { name: 'Review', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Account', exact: true })
      .selectOption(chosen.account.key);
    await expect(page.getByRole('row')).toHaveCount(1);
    await expect(page.getByRole('row')).toContainText(chosen.text);
    await expect(
      page
        .getByRole('row')
        .getByText(`Agent: ${input.source.name}`, { exact: true }),
    ).toHaveCount(1);
    await page.getByRole('grid').focus();
    await page.keyboard.press('m');
    await expect(page.getByRole('row')).toContainText('Marked for deletion');
    await expect(page.getByTestId('save-state')).toHaveText(
      'Saved on this device',
    );
    await page
      .getByRole('combobox', { name: 'Decision filter', exact: true })
      .selectOption('delete');
    await page
      .getByRole('combobox', { name: 'Sort by', exact: true })
      .selectOption('createdAt');
    await page.getByRole('searchbox').fill(chosen.text);
    await expect
      .poll(() => page.evaluate(() => window.workspace.summary?.review))
      .toEqual(view);
    await page
      .getByRole('link', { name: 'Backup and restore', exact: true })
      .click();
    const downloading = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Download backup', exact: true })
      .click();
    const download = await downloading;
    await download.saveAs(webBackup);
    await expect(
      page.getByText('The backup file was saved.', { exact: true }),
    ).toBeVisible();
    await audit.assert();

    await cli(['backup', 'restore', webBackup, '--workspace', toCli]);
    const summary = (await cli(['summary', '--workspace', toCli])) as Summary;
    expect(summary.counts).toEqual({ ...counts, decisionEvents: 1 });
    expect(summary.assessments).toEqual([
      { kind: 'agent', name: input.source.name, count: input.labels.length },
    ]);
    expect(summary.decisions).toEqual({
      keep: 0,
      delete: 1,
      later: 0,
      undecided: expected.items.length - 1,
    });
    expect(summary.decisionSources).toEqual([{ via: 'web-review', count: 1 }]);
    expect(summary.withoutAgentAssessment).toBe(0);
    const restored = await sqliteRecords(toCli);
    expect(sortItems(restored.items)).toEqual(sortItems(expected.items));
    assertLabels(restored, input);
    expect(restored.assessments).toEqual(browser.assessments);
    expect(restored.submissions).toEqual(browser.submissions);
    expect(restored.decisions).toHaveLength(1);
    expect(restored.decisions[0]).toMatchObject({
      itemId: chosen.id,
      value: 'delete',
      previous: 'undecided',
      source: { kind: 'human', via: 'web-review' },
      action: { kind: 'single', size: 1 },
    });
    expect(restored.meta.settings.review).toEqual(view);
    const after = await browserRecords(page);
    expect(restored.decisions).toEqual(after.decisions);
    expect(after.meta.settings.review).toEqual(view);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
