import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { SQLiteStore } from '../../cli/src/workspace/sqlite-store.ts';
import { startReviewServer } from '../../cli/src/review/server.ts';
import { InstagramContextWriter } from '@socialprune/core/workspace/instagram-context-writer';
import { instagramContextDirectory } from '../../cli/src/workspace/context-files.ts';
import { fakeBridge } from '../e2e/desktop/fake-bridge.ts';
import { runView } from '../e2e/desktop/views.ts';
import {
  liveFeedFixture,
  generatedReadPost,
  generatedPostImage,
  liveExpected,
} from '../e2e/feed-fixture.ts';
import { startStaticServer } from '../e2e/static-server.ts';
import { demoArchives } from '../tooling/demo-bytes.ts';

// Run after build and build:review; desktop mode also needs build:desktop.
// These are capture-only
// imports: no production entrypoint imports this file or the generated fakes.
// Required settings: SP_MEDIA_OUTPUT_DIR, SP_MEDIA_FFMPEG, SP_MEDIA_ADMISSION_DIR.
// Every capture is headless. SP_MEDIA_MODE=desktop uses the shipped desktop
// renderer with its test-only fake bridge, never a packaged/windowed process.
// The existing native desktop PNG is retained in web (default) mode. Desktop
// reproduction writes a clearly labelled fake-bridge variant, not native proof.
// Optional SP_MEDIA_MODE selects web, desktop or gallery. Only browser command
// lines under the named admission directory's wt-* worktrees are lane browsers.
// Personal browsers and unrelated tool Chromium processes never block capture.
// eslint-disable-next-line no-restricted-properties -- Explicit output, tool and admission settings only; never keys.
const settings = process.env;
const outputSetting = settings['SP_MEDIA_OUTPUT_DIR'];
const ffmpeg = settings['SP_MEDIA_FFMPEG'];
const admission = settings['SP_MEDIA_ADMISSION_DIR'];
if (!outputSetting || !ffmpeg || !admission)
  throw new Error(
    'SP_MEDIA_OUTPUT_DIR, SP_MEDIA_FFMPEG and SP_MEDIA_ADMISSION_DIR are required.',
  );
const mode = settings['SP_MEDIA_MODE'] ?? 'web';
assert.ok(['web', 'desktop', 'gallery'].includes(mode));
const output = resolve(outputSetting);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const web = join(root, 'apps/web');
const run = promisify(execFile);
const scratch = await mkdtemp(join(tmpdir(), 'socialprune-release-media-'));
await mkdir(output, { recursive: true });
await access(ffmpeg);
let browser: Browser | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;
let resourceError: Error | undefined;
let peakBrowserMB = 0;
const ownedPids: number[] = [];

async function absent(path: string) {
  return access(path).then(
    () => false,
    () => true,
  );
}
async function admissionCheck(allowOwned = false) {
  assert.ok(await absent(join(admission!, 'STOP')), 'STOP_PRESENT');
  assert.ok(await absent(join(admission!, 'IG-RUN-ACTIVE')), 'IG_RUN_ACTIVE');
  const script = `$os=Get-CimInstance Win32_OperatingSystem; $owned=@(${ownedPids.join(',')}); $rows=@(Get-CimInstance Win32_Process); $ids=[Collections.Generic.HashSet[int]]::new(); foreach($id in $owned){[void]$ids.Add($id)}; for($n=0;$n -lt 5;$n++){foreach($p in $rows){if($ids.Contains([int]$p.ParentProcessId)){[void]$ids.Add([int]$p.ProcessId)}}}; $b=@($rows | Where-Object {$_.Name -match '^(chrome|msedge|SocialPrune|electron|firefox|MiniBrowser|headless_shell)\\.exe$' -and $_.CommandLine -match 'remote-debugging|playwright|socialprune|--data-dir'}); @{freeMB=[math]::Floor($os.FreePhysicalMemory/1024);foreign=@($b | Where-Object {-not $ids.Contains([int]$_.ProcessId)} | ForEach-Object {@{pid=$_.ProcessId;name=$_.Name;rssMB=[math]::Round($_.WorkingSetSize/1MB)}});ownedMB=[math]::Round(($rows | Where-Object {$ids.Contains([int]$_.ProcessId)} | Measure-Object WorkingSetSize -Sum).Sum/1MB)} | ConvertTo-Json -Compress`;
  const laneRoot = admission!.replaceAll("'", "''").replaceAll('\\', '/');
  const command = script.replace(
    "-and $_.CommandLine -match 'remote-debugging|playwright|socialprune|--data-dir'",
    `-and $_.CommandLine.Replace('\\','/').Contains('${laneRoot}/wt-')`,
  );
  const result = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { timeout: 20_000, windowsHide: true },
  );
  const sample = JSON.parse(result.stdout) as {
    freeMB: number;
    foreign: { pid: number; name: string; rssMB: number }[];
    ownedMB: number;
  };
  peakBrowserMB = Math.max(peakBrowserMB, sample.ownedMB);
  if (!allowOwned) console.log(JSON.stringify({ admission: sample }));
  assert.equal(sample.foreign.length, 0, 'OTHER_AUTOMATED_BROWSER_ACTIVE');
  assert.ok(
    sample.freeMB >= (allowOwned ? 4096 : 9216),
    'FREE_MEMORY_BELOW_ADMISSION',
  );
  assert.ok(sample.ownedMB < 4096, 'OWNED_BROWSER_MEMORY_LIMIT');
  return sample;
}
async function startBrowser() {
  await admissionCheck();
  browser = await chromium.launch({ headless: true });
  // Browser.getVersion cannot provide a PID; Chromium's process list is CDP-owned.
  const cdp = await browser.newBrowserCDPSession();
  const rows = await cdp.send('SystemInfo.getProcessInfo');
  ownedPids.push(...rows.processInfo.map((row) => row.id));
  await cdp.detach();
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void admissionCheck(true)
      .catch(async (error: unknown) => {
        resourceError =
          error instanceof Error ? error : new Error('RESOURCE_GUARD_FAILED');
        console.error('CAPTURE_RESOURCE_GUARD', resourceError.message);
        await browser?.close();
      })
      .finally(() => {
        busy = false;
      });
  }, 5000);
  return browser;
}
async function context(record = false) {
  if (!browser) throw new Error('BROWSER_NOT_STARTED');
  const ctx = await browser.newContext({
    viewport: { width: record ? 960 : 1280, height: record ? 840 : 1160 },
    deviceScaleFactor: 1,
    locale: 'en-GB',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    ...(record
      ? { recordVideo: { dir: scratch, size: { width: 960, height: 840 } } }
      : {}),
  });
  await ctx.addInitScript(() => {
    localStorage.setItem('sp-locale', 'en');
    localStorage.setItem('sp-theme', 'light');
  });
  const remote: string[] = [];
  ctx.on('request', (request) => {
    const url = new URL(request.url());
    if (
      !['data:', 'blob:', 'app:'].includes(url.protocol) &&
      !['127.0.0.1', 'localhost'].includes(url.hostname)
    )
      remote.push(url.origin);
  });
  return { ctx, remote };
}
async function ff(args: string[]) {
  assert.ok(await absent(join(admission!, 'STOP')), 'STOP_PRESENT');
  await run(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    timeout: 120_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}
async function screenshot(page: Page, file: string) {
  await page.evaluate(() => document.fonts.ready);
  const raw = join(scratch, file);
  await page.screenshot({ path: raw, animations: 'disabled' });
  await ff([
    '-i',
    raw,
    '-map_metadata',
    '-1',
    '-frames:v',
    '1',
    '-compression_level',
    '9',
    join(output, file),
  ]);
}
async function generatedWorkspace(directory: string) {
  const data = liveFeedFixture();
  data.items = data.items.filter(
    (item) => item.id !== 'instagram:feed-comment',
  );
  data.assessments = data.assessments.filter(
    (row) => row.itemId !== 'instagram:feed-comment',
  );
  data.counts.items = data.items.length;
  data.counts.assessments = data.assessments.length;
  data.submissions[0]!.labelCount = data.assessments.length;
  for (const platform of ['x', 'instagram']) {
    const items = data.items.filter((item) => item.platform === platform);
    const account = items[0]!.account;
    data.imports.push({
      id: `generated-media-${platform}`,
      status: 'complete',
      platform,
      accounts: [account],
      variant: 'generated-media',
      exportCreatedAt: null,
      importedAt: data.createdAt,
      archives: ['generated-media'],
      adapter: { name: `generated-${platform}`, version: '1' },
      itemCount: items.length,
      diagnostics: [],
    });
  }
  const texts = [
    'The council should publish the full budget before the vote.',
    'A new walking route through the neighbourhood garden.',
    'I changed my mind after reading the public meeting notes.',
    'The park plan needs benches and a step-free entrance.',
    'Saturday coffee with the neighbours. Keeping this memory.',
    'An old note without enough context to judge.',
    'A draft I no longer want to keep online.',
    'A reminder to revisit another day.',
  ];
  for (const [index, item] of data.items.entries()) {
    if (item.platform === 'x') item.text = texts[index] ?? item.text;
    else item.text = 'A step-free path would make this garden easier to visit.';
    if (item.id === 'x:feed-4') item.createdAt = '2024-02-03T12:00:00.000Z';
    if (item.id === 'x:feed-5') item.createdAt = '2024-02-02T12:00:00.000Z';
    if (item.id === 'x:feed-1') item.createdAt = '2024-02-01T12:00:00.000Z';
  }
  data.settings.review!.feed!.tab = 'all';
  for (const assessment of data.assessments) {
    assessment.reason = 'Discusses a local policy decision.';
    assessment.evidence = 'council';
  }
  await mkdir(directory, { recursive: true });
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: data,
  });
  const record = generatedReadPost();
  record.post.caption =
    'A new path through the neighbourhood garden. Generated example.';
  const writer = new InstagramContextWriter(store);
  try {
    await writer.startRun({
      runId: record.runId,
      accountKey: record.accountKey,
      planHash: 'c'.repeat(64),
      startedAt: record.confirmedAt,
    });
    await writer.sending({
      attemptId: record.attemptId,
      runId: record.runId,
      itemId: record.itemId,
      at: record.confirmedAt,
    });
    await writer.step(record.runId, record.confirmedAt);
    await writer.confirm(record);
    await writer.endRun({
      runId: record.runId,
      endedAt: record.confirmedAt,
      endReason: 'done',
      bodyShapes: {},
      profileReport: {
        accountBefore: 'invented_commenter',
        accountAfter: 'invented_commenter',
        extensionsBefore: 0,
        extensionsAfter: 0,
        changedFiles: [],
        unexpectedRequests: [],
      },
    });
  } finally {
    await store.close();
  }
  const folder = instagramContextDirectory(directory, record.post.code);
  await mkdir(folder, { recursive: true });
  const { ctx } = await context();
  try {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 320, height: 320 });
    await page.setContent(`<style>body{margin:0}</style>${generatedPostImage}`);
    await page.screenshot({ path: join(folder, 'image.png') });
  } finally {
    await ctx.close();
  }
}
async function waitFeed(page: Page) {
  await expect(page.getByRole('feed')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('feed')).toHaveAttribute('aria-busy', 'false');
}
async function checkReviewStyle(page: Page) {
  const styles = await page.evaluate(() => {
    const header = document.querySelector('header')!;
    const brand = header.querySelector('a')!;
    const menu = header.querySelector('button[aria-controls="app-menu"]')!;
    const select = document.querySelector<HTMLSelectElement>(
      '[data-feed-toolbar] select',
    )!;
    return {
      header: getComputedStyle(header).backgroundColor,
      brand: getComputedStyle(brand).color,
      menu: getComputedStyle(menu).backgroundColor,
      account: select.selectedOptions[0]?.textContent?.trim() ?? '',
      tabs: [...document.querySelectorAll('[role="tab"]')].map((node) => ({
        radius: getComputedStyle(node).borderTopLeftRadius,
        border: getComputedStyle(node).borderTopWidth,
      })),
    };
  });
  assert.equal(
    styles.menu,
    'rgba(0, 0, 0, 0)',
    'HEADER_MENU_MUST_BE_TRANSPARENT',
  );
  assert.ok(
    styles.account.startsWith('@') && styles.account.length > 1,
    'ACCOUNT_NAME_REQUIRED',
  );
  assert.equal(styles.tabs.length, 6);
  for (const tab of styles.tabs)
    assert.deepEqual(tab, { radius: '0px', border: '0px' });
  const rgb = (value: string) =>
    value
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number);
  const luminance = (value: string) => {
    const c = rgb(value).map((n) =>
      (n /= 255) <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4,
    );
    return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
  };
  const a = luminance(styles.header),
    b = luminance(styles.brand);
  assert.ok(
    (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5,
    'HEADER_CONTRAST',
  );
  console.log(JSON.stringify({ reviewStyle: styles }));
}
async function webMedia() {
  const workspace = join(scratch, 'review-workspace');
  await generatedWorkspace(workspace);
  const review = await startReviewServer({
    workspace,
    assetDirectory: join(web, 'dist-review'),
    handleSignals: false,
  });
  const staticSite = await startStaticServer(4749, join(web, 'dist'));
  try {
    const { ctx, remote } = await context();
    try {
      const page = await ctx.newPage();
      await page.goto(review.launchUrl);
      await page
        .getByRole('link', { name: 'Review', exact: true })
        .first()
        .click();
      await waitFeed(page);
      await page.getByRole('tab', { name: /^All,/ }).click();
      await waitFeed(page);
      await expect(page.getByRole('tab')).toHaveCount(6);
      await expect(
        page.locator('article[data-item-id="x:feed-4"]'),
      ).toContainText(/rule|likes/i);
      await expect(
        page.locator('article[data-item-id="x:feed-5"]'),
      ).toHaveAttribute('data-decision', 'keep');
      await checkReviewStyle(page);
      await screenshot(page, 'review-x.png');
      await page
        .getByRole('combobox', { name: 'Account', exact: true })
        .selectOption(liveExpected.instagram);
      await page.getByRole('tab', { name: /^Suggested for deletion,/ }).click();
      await waitFeed(page);
      const post = page.getByTestId('instagram-post');
      await expect(post.locator('img')).toBeVisible();
      await expect
        .poll(() =>
          post
            .locator('img')
            .evaluate((node) => (node as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
      await expect(page.getByRole('feed')).toContainText(
        /confirmed|matched|comment/i,
      );
      await page
        .getByText('How this post was matched', { exact: true })
        .click();
      await expect(post.locator('details')).toHaveAttribute('open', '');
      await checkReviewStyle(page);
      await screenshot(page, 'review-instagram.png');
      // A separate static card is composition only; the crop is a real capture.
      const crop = await readFile(join(output, 'review-x.png'));
      const card = await ctx.newPage();
      await card.setViewportSize({ width: 1280, height: 640 });
      await card.setContent(
        `<!doctype html><html lang="en"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#eaf0f4;color:#202e37;font-family:'Segoe UI',sans-serif;width:1280px;height:640px;overflow:hidden}.top{height:208px;padding:40px 56px;display:flex;align-items:center;justify-content:space-between}.name{font-size:58px;font-weight:650;letter-spacing:-2px;margin:0}.copy{font-size:24px;line-height:1.4;margin:10px 0 0;max-width:800px}.pill{color:#6b4791;border:1px solid #d2dde4;background:white;padding:12px 18px;border-radius:12px;font-size:17px}.shot{margin:0 56px;border:1px solid #d2dde4;border-radius:12px 12px 0 0;box-shadow:0 12px 30px #213b4b18;overflow:hidden;height:432px;background:white}.shot img{display:block;width:1168px;height:auto}</style><div class="top"><div><h1 class="name">SocialPrune</h1><p class="copy">Review old posts locally. You choose what stays.</p></div><div class="pill">Generated demo</div></div><div class="shot"><img alt="Generated X review" src="data:image/png;base64,${crop.toString('base64')}"></div></html>`,
      );
      await card.locator('.copy').evaluate((node) => {
        node.textContent = 'Review old posts locally and choose what stays.';
      });
      await screenshot(card, 'social-preview.png');
      await card.close();
      assert.deepEqual(remote, [], 'REMOTE_REQUEST_DURING_CAPTURE');
    } finally {
      await ctx.close();
    }
    const { ctx: recording, remote: recordedRemote } = await context(true);
    const page = await recording.newPage();
    const video = page.video();
    const completed: {
      imported: boolean;
      kept: string | null;
      marked: string | null;
      preview: boolean;
    } = {
      imported: false,
      kept: null,
      marked: null,
      preview: false,
    };
    try {
      await page.goto(`${staticSite.origin}/socialprune/`);
      await expect(page.locator('main[data-gate]')).toHaveAttribute(
        'data-gate',
        'ready',
      );
      await page.goto(`${staticSite.origin}/socialprune/#/import`);
      await expect(page.getByTestId('archives')).toBeEnabled();
      const archive = (await demoArchives())[0]!;
      await page.getByTestId('archives').setInputFiles({
        name: `${archive.name}.zip`,
        mimeType: 'application/zip',
        buffer: archive.bytes,
      });
      await page.waitForTimeout(1000);
      await page.getByTestId('import-button').click();
      await expect(page.getByTestId('import-state')).toHaveAttribute(
        'data-phase',
        'complete',
        { timeout: 20000 },
      );
      await expect(page.getByTestId('import-state')).toContainText('300');
      completed.imported = true;
      console.log(JSON.stringify({ demoStep: 'import-complete', items: 300 }));
      await page.waitForTimeout(1800);
      // The demo entrypoint performs the bundled generated ZIP import in the
      // real worker and keeps its generated-data banner throughout the loop.
      await page.goto(`${staticSite.origin}/socialprune/#/demo`);
      await waitFeed(page);
      await page.waitForTimeout(1800);
      const picker = page.getByRole('button', {
        name: 'Choose criteria',
        exact: true,
      });
      await picker.click();
      const political = page.getByRole('checkbox', {
        name: /^Political \d/,
      });
      await political.check();
      await expect(
        page.getByText('Changes saved. Nothing is marked for deletion.', {
          exact: true,
        }),
      ).toBeVisible();
      const personal = page.getByRole('checkbox', {
        name: /^Personal information \d/,
      });
      await expect(personal).toBeEnabled();
      await personal.check();
      await expect(personal).toBeChecked();
      console.log(JSON.stringify({ demoStep: 'criteria-selected' }));
      await expect(
        page.getByText('Changes saved. Nothing is marked for deletion.', {
          exact: true,
        }),
      ).toBeVisible();
      const close = page.getByRole('button', {
        name: 'Use these criteria',
        exact: true,
      });
      await expect(close).toBeEnabled();
      await close.click();
      await waitFeed(page);
      console.log(JSON.stringify({ demoStep: 'criteria-applied' }));
      await page.getByRole('tab', { name: /^Suggested for deletion,/ }).click();
      await waitFeed(page);
      const first = page
        .getByRole('feed')
        .locator('article')
        .filter({ hasText: 'The invented town council debate' });
      await first.scrollIntoViewIfNeeded();
      await expect(first.locator('svg.lucide-wand-sparkles')).toBeVisible();
      const keptId = await first.getAttribute('data-item-id');
      await page.waitForTimeout(2500);
      await first.locator('[data-keep-action]').click();
      console.log(JSON.stringify({ demoStep: 'keep' }));
      await expect(
        page.locator(`article[data-item-id="${keptId}"]`),
      ).toHaveAttribute('data-decision', 'keep');
      completed.kept = keptId;
      await expect(
        page.getByRole('tab', { name: /^Kept, 1 entry/ }),
      ).toBeVisible();
      await page.waitForTimeout(1800);
      const second = page
        .getByRole('feed')
        .locator('article')
        .filter({ hasText: 'Write to lanternplot@example.com' });
      await second.scrollIntoViewIfNeeded();
      const markedId = await second.getAttribute('data-item-id');
      assert.notEqual(
        markedId,
        keptId,
        'DEMO_MUST_KEEP_AND_MARK_DIFFERENT_ENTRIES',
      );
      await second.locator('[data-mark-action]').click();
      console.log(JSON.stringify({ demoStep: 'mark' }));
      await expect(
        page.locator(`article[data-item-id="${markedId}"]`),
      ).toHaveAttribute('data-decision', 'delete');
      completed.marked = markedId;
      await expect(
        page.getByRole('tab', { name: /^Marked, 1 entry/ }),
      ).toBeVisible();
      await page.waitForTimeout(1800);
      await page.getByRole('tab', { name: /^Suggested for deletion,/ }).click();
      await waitFeed(page);
      await page.locator('footer button').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('dialog')).toContainText('You kept 1 entry.');
      completed.preview = true;
      console.log(JSON.stringify({ demoStep: 'final-preview' }));
      await page.waitForTimeout(4000);
      assert.deepEqual(recordedRemote, [], 'REMOTE_REQUEST_DURING_DEMO');
      assert.ok(
        completed.imported &&
          completed.preview &&
          completed.kept &&
          completed.marked,
        'DEMO_IMPORT_KEEP_MARK_PREVIEW_REQUIRED',
      );
      assert.notEqual(
        completed.kept,
        completed.marked,
        'DEMO_SEPARATE_DECISIONS_REQUIRED',
      );
      console.log(JSON.stringify({ demoCompleted: completed }));
    } catch (error) {
      console.error('DEMO_CAPTURE_CAUSE', error);
      throw error;
    } finally {
      await recording.close();
    }
    assert.ok(video);
    const source = await video.path();
    await ff([
      '-i',
      source,
      '-t',
      '24',
      '-filter_complex',
      '[0:v]fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
      '-map_metadata',
      '-1',
      '-loop',
      '0',
      join(output, 'demo.gif'),
    ]);
  } finally {
    await review.stop();
    await staticSite.close();
  }
}

async function desktopMedia() {
  const site = await startStaticServer(4750, join(web, 'dist-desktop'));
  const { ctx } = await context();
  const page = await ctx.newPage();
  const bridge = await fakeBridge(page, 'en', liveFeedFixture(), 'direct');
  await page.route(`${site.origin}/assets/**`, (route) =>
    route.continue({
      url: route
        .request()
        .url()
        .replace(
          `${site.origin}/assets/`,
          `${site.origin}/socialprune/assets/`,
        ),
    }),
  );
  try {
    await page.setViewportSize({ width: 760, height: 820 });
    await page.goto(`${site.origin}/socialprune/desktop.html`);
    await expect(
      page.getByRole('button', { name: 'Run monitor', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Run monitor', exact: true })
      .click();
    await bridge.push(runView('awaiting-warning'));
    const monitor = page.getByTestId('desktop-monitor');
    await expect(monitor).toHaveAttribute('data-phase', 'awaiting-warning');
    await expect(
      monitor.getByRole('button', { name: 'Stop', exact: true }),
    ).toBeEnabled();
    const appPng = await page.screenshot({ animations: 'disabled' });
    // The adjacent page is an explicitly labelled local generated stand-in,
    // not a platform session. No platform run is started for this capture.
    const { ctx: composition } = await context();
    try {
      const canvas = await composition.newPage();
      await canvas.setViewportSize({ width: 1280, height: 900 });
      await canvas.setContent(
        `<!doctype html><html lang="en"><style>*{box-sizing:border-box}body{margin:0;background:#eaf0f4;font:16px 'Segoe UI',sans-serif;color:#202e37;padding:24px}.label{font-size:14px;color:#526572;margin:0 0 10px}.columns{display:grid;grid-template-columns:760px 448px;gap:24px}.window{border:1px solid #758997;border-radius:12px;background:white;overflow:hidden}.bar{height:36px;background:#213b4b;color:white;padding:8px 14px;font-size:14px}.app{display:block;width:760px}.fake{padding:28px}.badge{background:#e9e1f2;color:#6b4791;border-radius:8px;padding:10px;line-height:1.5;font-weight:650}h2{font-size:24px}article{border-top:1px solid #d2dde4;border-bottom:1px solid #d2dde4;padding:24px 0;line-height:1.6}.muted{color:#526572}</style><p class="label">Packaged Windows app · generated data · no platform run started</p><div class="columns"><section class="window"><div class="bar">SocialPrune</div><img class="app" alt="Unmodified packaged app capture" src="data:image/png;base64,${appPng.toString('base64')}"></section><section class="window"><div class="bar">Local generated platform page</div><div class="fake"><div class="badge">GENERATED EXAMPLE<br>Not a real account or platform page</div><h2>Example timeline</h2><p class="muted">@fixture_person</p><article><strong>Generated first post</strong><p>A small invented entry for this screenshot.</p><p class="muted">1 January 2020 · Generated data</p></article><p>The app waits for the person's confirmation.</p><p>No real account is signed in. Nothing is sent to a platform.</p></div></section></div></html>`,
      );
      await canvas.locator('.label').evaluate((node) => {
        node.textContent =
          'Desktop renderer · generated fake bridge · no platform run started';
      });
      await canvas.locator('img.app').evaluate((node) => {
        node.setAttribute('alt', 'Headless desktop renderer capture');
      });
      await screenshot(canvas, 'desktop-monitor.png');
    } finally {
      await composition.close();
    }
    await monitor.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(monitor).toHaveAttribute('data-phase', 'ended');
  } finally {
    await ctx.close();
    await bridge.close();
    await site.close();
  }
}

async function galleryCheck() {
  const gallery = settings['SP_MEDIA_GALLERY_FILE'];
  assert.ok(gallery, 'SP_MEDIA_GALLERY_FILE_REQUIRED');
  const { ctx } = await context();
  try {
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(resolve(gallery)).href);
    await expect(page.locator('img')).toHaveCount(5);
    for (const image of await page.locator('img').all()) {
      await expect
        .poll(() =>
          image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
      const target = await image.locator('..').getAttribute('href');
      assert.ok(target);
      await access(fileURLToPath(new URL(target, page.url())));
    }
    for (const link of await page.locator('nav a').all()) {
      const id = (await link.getAttribute('href'))!.slice(1);
      await link.click();
      await expect(page.locator(`section[id="${id}"]`)).toBeInViewport();
    }
    console.log(
      JSON.stringify({ galleryImages: 5, brokenLinks: 0, headless: true }),
    );
  } finally {
    await ctx.close();
  }
}

try {
  await startBrowser();
  if (mode === 'web') await webMedia();
  if (mode === 'desktop') await desktopMedia();
  if (mode === 'gallery') await galleryCheck();
  if (resourceError) throw resourceError;
  const files =
    mode === 'web'
      ? [
          'review-x.png',
          'review-instagram.png',
          'social-preview.png',
          'demo.gif',
        ]
      : mode === 'desktop'
        ? ['desktop-monitor.png']
        : [];
  for (const file of files) {
    const info = await stat(join(output, file));
    if (file === 'demo.gif') assert.ok(info.size < 5_000_000, 'GIF_TOO_LARGE');
    if (file === 'social-preview.png')
      assert.ok(info.size < 1_000_000, 'PREVIEW_TOO_LARGE');
    console.log(JSON.stringify({ media: file, bytes: info.size }));
  }
  console.log(
    JSON.stringify({ completed: mode, generatedOnly: true, peakBrowserMB }),
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  if (timer) clearInterval(timer);
  await browser?.close();
  await rm(scratch, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 500,
  }).catch((error) => console.error('CAPTURE_CLEANUP_FAILED', error));
}
