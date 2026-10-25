import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { measurementIdentity } from '../tooling/measurement-identity.ts';
import { observeFeedFrames } from './frame-diagnostics.ts';
import {
  installScaleActivity,
  installScrollObserver,
  scrollFrameTargets,
} from './scroll-observer.ts';
import { waitForApp } from './helpers.ts';
import {
  scaleHost,
  scaleOwnedMemory,
  scaleStop,
  SCALE_OUTPUT,
} from './scale-host.ts';
import {
  scaleWorkspace,
  SCALE_ACCOUNT,
  SCALE_SUGGESTIONS,
  SCALE_COUNT_ITEMS,
} from './scale-data.ts';

function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!values.length || values.some((value) => !Number.isFinite(value)))
    throw new Error('Missing timing samples.');
  return {
    samples: values,
    count: values.length,
    min: sorted[0]!,
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1]!,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    max: sorted.at(-1)!,
  };
}
async function restoreScale(page: Page, text: string, count: number) {
  const result = await page.evaluate(
    async ({ text, count }) => {
      const start = performance.now();
      const reply = await window.workspace.request({
        type: 'restore',
        requestId: crypto.randomUUID(),
        file: new File([text], 'generated-scale.json'),
      });
      if (reply.type !== 'opened' || reply.summary.counts.items !== count)
        throw new Error('Generated restore count mismatch.');
      return {
        ms: performance.now() - start,
        items: reply.summary.counts.items,
        assessments: reply.summary.counts.assessments,
      };
    },
    { text, count },
  );
  return result;
}
async function switchTab(page: Page, name: string) {
  return page.evaluate(async (name) => {
    const tab = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((button) => button.getAttribute('aria-label')?.startsWith(name));
    if (!tab) throw new Error('Scale tab missing.');
    const start = performance.now();
    tab.click();
    let frames = 0;
    await new Promise<void>((resolve, reject) => {
      const read = () => {
        const feed = document.querySelector<HTMLElement>('[role="feed"]');
        const panel = document.querySelector<HTMLElement>('[role="tabpanel"]');
        const visible = [
          ...(feed?.querySelectorAll<HTMLElement>('article') ?? []),
        ].some((article) => {
          const box = article.getBoundingClientRect(),
            bounds = panel?.getBoundingClientRect();
          return (
            bounds &&
            box.bottom > bounds.top &&
            box.top < bounds.bottom &&
            box.height > 0
          );
        });
        if (
          tab.getAttribute('aria-selected') === 'true' &&
          feed?.getAttribute('aria-busy') === 'false' &&
          visible
        ) {
          // Two paint opportunities after the ready DOM, not the click's stale cards.
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          return;
        }
        if (++frames > 3600) {
          reject(new Error('Tab did not produce a first visible card.'));
          return;
        }
        requestAnimationFrame(read);
      };
      requestAnimationFrame(read);
    });
    return performance.now() - start;
  }, name);
}

test('ADR-032 scale: connected 6000-suggestion scroll and 100k count timings', async ({
  browserName,
  playwright,
  baseURL,
}, info) => {
  scaleStop();
  const host = await scaleHost();
  const sourceHash = await measurementIdentity();
  const harnessFiles = [
    'scale.measurement.ts',
    'scroll-observer.ts',
    'scale-data.ts',
    'scale-host.ts',
    'scale.config.ts',
    'frame-diagnostics.ts',
    'frame-attribution-model.ts',
    'frame.config.ts',
    '../test/probes/frame-entry.tsx',
    '../test/probes/frame-runtime.ts',
    '../test/probes/frame-session.ts',
    '../test/probes/frame-virtualizer.ts',
    '../tooling/frame-attribution-build.ts',
    '../vite.config.ts',
  ];
  const harnessHash = createHash('sha256');
  for (const name of harnessFiles)
    harnessHash
      .update(name)
      .update(await readFile(new URL(name, import.meta.url)));
  const output = SCALE_OUTPUT;
  await mkdir(output, { recursive: true });
  const startedAt = new Date().toISOString();
  const report: Record<string, unknown> = {
    format: 'socialprune-feed-scale-v1',
    browserName,
    sourceHash,
    harnessHash: harnessHash.digest('hex'),
    startedAt,
    host,
    targets: {
      countsP95Ms: 500,
      firstCardAfterTabMs: 1000,
      scrollFrameP999Ms: 50,
      maximumScrollFrameMs: 200,
      maximumResponseCards: 50,
      maximumUiCards: 300,
    },
    scope:
      'Production PWA, IndexedDB worker, generated demo expansion, desktop viewport, no originals or media, one run per engine',
  };
  const file = join(
    output,
    `${browserName}-${startedAt.replace(/[:.]/g, '-')}.json`,
  );
  const save = async () =>
    writeFile(file, JSON.stringify(report, null, 2) + '\n');
  if (host.freePhysicalBytes < 12 * 1024 ** 3) {
    report['completed'] = false;
    report['admission'] =
      'free physical memory below 12 GiB; no browser launched';
    await save();
    throw new Error(
      'Scale browser admission needs at least 12 GiB free physical memory.',
    );
  }
  // A server-owned browser yields its real root PID; no foreign process is inspected or stopped.
  const server = await playwright[browserName].launchServer({ headless: true });
  const rootPid = server.process().pid;
  if (!rootPid) throw new Error('Owned browser PID missing.');
  const browser = await playwright[browserName].connect(server.wsEndpoint());
  const context = await browser.newContext({
    baseURL,
    locale: 'en-US',
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
  });
  const page = await context.newPage();
  // Test process opt-in only. No runtime setting reaches a shipped entrypoint.
  const frameDiagnostics =
    // eslint-disable-next-line no-restricted-properties -- Content-free test-process diagnostics opt-in, not credentials.
    process.env['SP_FEED_FRAME_DIAGNOSTICS'] === '1'
      ? await observeFeedFrames(page)
      : null;
  report['renderer'] = frameDiagnostics
    ? 'test-only wrapped production React attribution build, not uninstrumented acceptance timing'
    : 'production';
  const external: string[] = [],
    pageErrors: string[] = [];
  const startupEvents: { at: string; kind: string; detail: string }[] = [];
  const startupEvent = (kind: string, detail: string) =>
    startupEvents.push({ at: new Date().toISOString(), kind, detail });
  const origin = new URL(baseURL!).origin;
  context.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) external.push(request.url());
  });
  context.on('requestfailed', (request) =>
    startupEvent(
      'requestfailed',
      `${request.url()} ${request.failure()?.errorText}`,
    ),
  );
  context.on('serviceworker', (worker) =>
    startupEvent('serviceworker', worker.url()),
  );
  page.on('worker', (worker) => startupEvent('worker', worker.url()));
  page.on('console', (message) => {
    if (message.type() === 'error')
      startupEvent('console-error', message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const memory: unknown[] = [];
  let resourceFailure: string | null = null;
  let checkingResources = false;
  const resourceGuard = setInterval(() => {
    if (checkingResources) return;
    checkingResources = true;
    void scaleHost()
      .then((state) => {
        if (state.freePhysicalBytes < 6144 * 1024 ** 2) {
          resourceFailure =
            'free physical memory below6144MiB; only owned browser closed';
          report['resourceAbort'] = { at: new Date().toISOString(), ...state };
          return context.close();
        }
      })
      .catch((error) => {
        resourceFailure = String(error);
      })
      .finally(() => {
        checkingResources = false;
      });
  }, 15000);
  async function sampleMemory(label: string) {
    memory.push({ label, ...(await scaleOwnedMemory(rootPid!)) });
  }
  try {
    report['engineVersion'] = browser.version();
    const startupStart = performance.now();
    await waitForApp(page);
    if (resourceFailure) throw Error(resourceFailure);
    report['startupMs'] = performance.now() - startupStart;
    report['startupEvents'] = startupEvents;
    await page.evaluate(() => {
      localStorage.setItem('sp-locale', 'en');
      localStorage.setItem('sp-theme', 'light');
    });
    await sampleMemory('empty app');
    const generated = await scaleWorkspace(SCALE_SUGGESTIONS);
    report['scrollData'] = generated.manifest;
    report['restore6000'] = await restoreScale(
      page,
      generated.text,
      SCALE_SUGGESTIONS,
    );
    await sampleMemory('restored 6000');
    const cold6000 = await page.evaluate(async (accountKey) => {
      const start = performance.now(),
        counts = await window.workspace.planCounts(accountKey);
      if (counts.type !== 'planCounts' || counts.tabs.suggested !== 6000)
        throw new Error('Minimal connected count path failed.');
      const countMs = performance.now() - start,
        windowStart = performance.now();
      const cards = await window.workspace.feedWindow({
        accountKey,
        tab: 'suggested',
        offset: 0,
        limit: 50,
      });
      if (
        cards.type !== 'feedCards' ||
        cards.cards.length !== 50 ||
        cards.total !== 6000
      )
        throw new Error('Minimal connected window path failed.');
      return {
        countMs,
        windowMs: performance.now() - windowStart,
        count: counts.tabs.suggested,
        returnedCards: cards.cards.length,
      };
    }, SCALE_ACCOUNT);
    report['foundation'] = cold6000;
    await save();
    const navigationStart = performance.now();
    await page.goto('/socialprune/#/review');
    await expect(
      page.getByRole('feed').locator('article').first(),
    ).toBeVisible();
    await expect(page.getByRole('feed')).toHaveAttribute('aria-busy', 'false');
    report['initialFeedMs'] = performance.now() - navigationStart;
    // Test-page observations only. No responses, delays or results are stubbed.
    await page.evaluate(installScaleActivity);
    const tabMs: number[] = [];
    for (let index = 0; index < 10; index++) {
      scaleStop();
      tabMs.push(
        await switchTab(page, index % 2 ? 'Suggested for deletion' : 'All'),
      );
    }
    report['tabFirstCardMs'] = distribution(tabMs);
    await page.screenshot({
      path: join(output, `${browserName}-6000-feed.png`),
    });
    await frameDiagnostics?.start();
    await page.evaluate(installScrollObserver);
    let focusedCards = 0;
    let scrollStop: string | null = null;
    const scrollStart = performance.now();
    await page
      .getByRole('feed')
      .locator('article[data-card-id]')
      .first()
      .focus();
    for (let index = 0; index < SCALE_SUGGESTIONS; index++) {
      scaleStop();
      const id = `x:scale-${index.toString().padStart(6, '0')}`;
      if (index) await page.keyboard.press('ArrowDown');
      try {
        await page.waitForFunction(
          (id) => {
            const card = document.activeElement;
            const panel = document.querySelector('[role="tabpanel"]');
            if (!(card instanceof HTMLElement) || !panel) return false;
            const box = card.getBoundingClientRect();
            const bounds = panel.getBoundingClientRect();
            return (
              card.dataset['cardId'] === id &&
              document
                .querySelector('[role="feed"]')
                ?.getAttribute('aria-busy') === 'false' &&
              box.bottom > Math.max(0, bounds.top) &&
              box.top < Math.min(innerHeight, bounds.bottom)
            );
          },
          id,
          { timeout: 10_000 },
        );
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        focusedCards++;
      } catch {
        scrollStop = `Expected card ${index + 1} did not become focused and visible`;
        break;
      }
      if (performance.now() - scrollStart > 660_000) {
        scrollStop = `Traversal timeout after ${focusedCards} focused visible cards`;
        break;
      }
    }
    report['scroll'] = {
      ...(await page.evaluate(() =>
        (
          Reflect.get(window, '__scaleFinishScroll') as () => Record<
            string,
            unknown
          >
        )(),
      )),
      focusedCards,
      stopDetail: scrollStop,
    };
    const scroll = report['scroll'] as {
      frames: number[];
      maxFrameMs: number;
      maxDomCards: number;
      uniqueVisible: number;
    };
    const scrollFrameResult = scrollFrameTargets(scroll.frames);
    Object.assign(scroll, {
      frameP999Ms: scrollFrameResult.frameP999Ms,
      maxFrameMs: scrollFrameResult.maxFrameMs,
      framesOver50Ms: scrollFrameResult.framesOver50Ms,
    });
    if (frameDiagnostics)
      report['frameDiagnostics'] = await frameDiagnostics.read();
    await save();
    await sampleMemory('after 6000 traversal attempt');
    report['requests6000'] = await page.evaluate(
      () => Reflect.get(window, '__scaleRequests') as unknown,
    );
    // Attribution-only mode shortens the loop; it does not claim the omitted
    // 100k timings or alter any acceptance threshold.
    // eslint-disable-next-line no-restricted-properties -- Test-process measurement scope only.
    if (process.env['SP_SCALE_SCOPE'] === 'frames') {
      report['scope'] =
        '6000-suggestion frame attribution only; 100k counts omitted';
      report['completed'] = true;
      report['framePhaseOnly'] = true;
      report['frameTargetResults'] = {
        ...scrollFrameResult.targets,
        atMost300DomCards: scroll.maxDomCards <= 300,
        all6000SuggestionsVisible:
          scroll.uniqueVisible === 6000 && focusedCards === 6000,
      };
      report['pageErrors'] = pageErrors;
      report['networkOutsideOrigin'] = external;
      expect(external).toEqual([]);
      expect(pageErrors).toEqual([]);
      return;
    }
    const previewStart = performance.now();
    await page
      .getByRole('button', {
        name: 'Mark 6,000 entries for deletion',
        exact: true,
      })
      .click();
    await expect(
      page
        .getByRole('dialog')
        .getByRole('button', { name: 'Mark 6,000 entries', exact: true }),
    ).toBeEnabled();
    report['previewReadyMs'] = performance.now() - previewStart;
    await page.screenshot({
      path: join(output, `${browserName}-6000-preview.png`),
    });
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    report['requests6000'] = await page.evaluate(
      () => Reflect.get(window, '__scaleRequests') as unknown,
    );
    const trace = report['requests6000'] as {
      type: string;
      ms: number;
      cards: number | null;
    }[];
    expect(
      trace
        .filter((event) => event.type === 'feedWindow')
        .every((event) => event.cards! <= 50),
    ).toBe(true);
    await page.goto('/socialprune/#/settings');
    const large = await scaleWorkspace(SCALE_COUNT_ITEMS);
    report['countData'] = large.manifest;
    report['restore100000'] = await restoreScale(
      page,
      large.text,
      SCALE_COUNT_ITEMS,
    );
    await sampleMemory('restored 100000');
    const counts = await page.evaluate(async (accountKey) => {
      const cold: number[] = [],
        warm: number[] = [],
        preview: number[] = [];
      const criteria = structuredClone(window.workspace.summary!.criteria!);
      for (let index = 0; index < 20; index++) {
        criteria.level = index % 2 ? 2 : 0;
        const changed = await window.workspace.setCriteria(criteria);
        if (changed.type !== 'settingsChanged')
          throw new Error('Could not invalidate count configuration.');
        let start = performance.now(),
          result = await window.workspace.planCounts(accountKey);
        cold.push(performance.now() - start);
        if (
          result.type !== 'planCounts' ||
          result.tabs.suggested !== 6000 ||
          result.tabs.all !== 100000
        )
          throw new Error('100k projected counts mismatch.');
        start = performance.now();
        result = await window.workspace.planCounts(accountKey);
        warm.push(performance.now() - start);
        if (result.type !== 'planCounts' || result.tabs.all !== 100000)
          throw new Error('Warm count mismatch.');
      }
      for (let index = 0; index < 5; index++) {
        const start = performance.now();
        const reply = await window.workspace.previewPlan({
          accountKey,
          pageId: 'generated-scale-preview',
          previewId: `preview-${index}`,
        });
        preview.push(performance.now() - start);
        if (reply.type !== 'bulkPreview' || reply.total !== 6000)
          throw new Error('100k preview mismatch.');
      }
      return { cold, warm, preview };
    }, SCALE_ACCOUNT);
    report['counts100000ColdMs'] = distribution(counts.cold);
    report['counts100000WarmMs'] = distribution(counts.warm);
    report['preview100000Ms'] = distribution(counts.preview);
    report['memory'] = memory;
    report['networkOutsideOrigin'] = external;
    report['pageErrors'] = pageErrors;
    report['targetResults'] = {
      countsP95Under500: distribution(counts.cold).p95 < 500,
      firstCardAfterEveryTabUnder1000: tabMs.every((value) => value < 1000),
      ...scrollFrameResult.targets,
      atMost50ResponseCards: trace
        .filter((event) => event.type === 'feedWindow')
        .every((event) => event.cards! <= 50),
      atMost300DomCards: scroll.maxDomCards <= 300,
      all6000SuggestionsVisible:
        scroll.uniqueVisible === 6000 && focusedCards === 6000,
    };
    expect(external).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(await measurementIdentity()).toBe(sourceHash);
    report['completed'] = true;
  } catch (error) {
    report['completed'] = false;
    report['failure'] = error instanceof Error ? error.message : String(error);
    report['startupEvents'] = startupEvents;
    report['pageErrors'] = pageErrors;
    report['networkOutsideOrigin'] = external;
    report['failureState'] = await page
      .evaluate(async () => ({
        url: location.href,
        gate: document
          .querySelector('main[data-gate]')
          ?.getAttribute('data-gate'),
        controller: navigator.serviceWorker.controller?.scriptURL ?? null,
        registrations: (await navigator.serviceWorker.getRegistrations()).map(
          (registration) => ({
            scope: registration.scope,
            active: registration.active?.state ?? null,
            waiting: registration.waiting?.state ?? null,
            installing: registration.installing?.state ?? null,
          }),
        ),
      }))
      .catch(() => ({
        unavailable: 'owned page closed or diagnostic evaluation failed',
      }));
    await page
      .screenshot({ path: file.replace(/\.json$/, '-failure.png') })
      .catch(() => undefined);
    throw error;
  } finally {
    clearInterval(resourceGuard);
    report['endedAt'] = new Date().toISOString();
    report['memory'] = memory;
    await save();
    await context.close();
    await browser.close();
    await server.close();
    await info.attach('scale measurements', {
      path: file,
      contentType: 'application/json',
    });
    console.log(
      'SCALE_RESULT',
      file,
      'SHA256',
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
    );
  }
});
