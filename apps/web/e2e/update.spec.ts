import { cp, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { startStaticServer } from './static-server.ts';

const digest = (bytes: string) =>
  createHash('sha256').update(bytes).digest('hex');
async function nextBuild() {
  const original = fileURLToPath(new URL('../dist/', import.meta.url));
  const copy = await mkdtemp(join(tmpdir(), 'socialprune-update-'));
  await cp(original, copy, { recursive: true });
  const info = await readFile(join(copy, 'build-info.js'), 'utf8');
  const id = /buildId="([a-f0-9]+)"/.exec(info)?.[1];
  if (!id) throw new Error('Build identity not found.');
  const next = digest(`test-only-update:${id}`).slice(0, 24);
  const updatedInfo = info.replace(id, next);
  await writeFile(join(copy, 'build-info.js'), updatedInfo);
  const worker = await readFile(join(copy, 'sw.js'), 'utf8');
  if (!worker.includes(digest(info)))
    throw new Error('Manifest does not bind build-info bytes.');
  // This copy-only test build changes just manifest identity and its bound
  // metadata bytes, never production entrypoint behavior or an env switch.
  await writeFile(
    join(copy, 'sw.js'),
    worker.replaceAll(id, next).replace(digest(info), digest(updatedInfo)),
  );
  return {
    copy,
    id,
    next,
    close: () => rm(copy, { recursive: true, force: true }),
  };
}

test('W0 two-tab update waits for consent, Later keeps v1 and reload flushes all tabs', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const server = await startStaticServer(4182);
  const version = await nextBuild();
  const second = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  try {
    for (const tab of [page, second]) {
      await tab.goto(`${server.origin}/socialprune/#/settings`);
      await expect(tab.locator('main[data-gate]')).toHaveAttribute(
        'data-gate',
        'ready',
      );
      await expect(tab.getByText(`Build ${version.id}`)).toBeVisible();
    }
    await page.evaluate(async () => {
      await (
        await caches.open('sp-model-invented')
      ).put('/invented-model', new Response('invented model bytes'));
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('sp-update-test', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('events');
        open.onerror = () =>
          reject(open.error ?? new Error('Test database did not open.'));
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('events', 'readwrite');
          tx.objectStore('events').put('invented retained event', 'one');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      });
    });
    server.switchOutput(version.copy);
    await page.evaluate(() =>
      navigator.serviceWorker
        .getRegistration()
        .then((registration) => registration?.update()),
    );
    await expect(
      page.getByText('A new version of SocialPrune is ready.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Later', exact: true }).click();
    await expect(page.getByText(`Build ${version.id}`)).toBeVisible();
    await expect(second.getByText(`Build ${version.id}`)).toBeVisible();
    expect(await page.evaluate(() => caches.keys())).toContain(
      `sp-app-${version.id}`,
    );
    // A fresh tab on the still-active old shell exposes the pending update.
    const third = await context.newPage();
    await third.goto(`${server.origin}/socialprune/#/settings`);
    await expect(
      third.getByRole('button', { name: 'Reload now' }),
    ).toBeVisible();
    const flushes: string[] = [];
    await page.exposeFunction('__recordFlush', () => flushes.push('first'));
    await second.exposeFunction('__recordFlush', () => flushes.push('second'));
    for (const tab of [page, second])
      await tab.evaluate(() => {
        navigator.serviceWorker.addEventListener(
          'message',
          (event: MessageEvent<{ type: string }>) => {
            if (event.data.type === 'flush-tab')
              void (
                Reflect.get(globalThis, '__recordFlush') as () => Promise<void>
              )();
          },
        );
      });
    await third.getByRole('button', { name: 'Reload now' }).click();
    await expect.poll(() => flushes.sort()).toEqual(['first', 'second']);
    for (const tab of [page, second, third]) {
      try {
        await expect(
          tab.getByText(`Build ${version.next}`),
          JSON.stringify(errors),
        ).toBeVisible();
      } catch (error) {
        console.log(
          JSON.stringify({
            errors,
            url: tab.url(),
            text: await tab.locator('body').innerText(),
            caches: await tab.evaluate(() =>
              'caches' in globalThis ? caches.keys() : [],
            ),
            hits: server.hits,
          }),
        );
        throw error;
      }
    }
    await expect
      .poll(() => page.evaluate(() => caches.keys()))
      .not.toContain(`sp-app-${version.id}`);
    expect(await page.evaluate(() => caches.keys())).toContain(
      'sp-model-invented',
    );
    expect(
      await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const open = indexedDB.open('sp-update-test');
          open.onsuccess = () => resolve(open.result);
        });
        const result = await new Promise<unknown>((resolve) => {
          const get = db.transaction('events').objectStore('events').get('one');
          get.onsuccess = () => resolve(get.result);
        });
        db.close();
        return result;
      }),
    ).toBe('invented retained event');
    await third.close();
  } finally {
    await second.close();
    await server.close();
    await version.close();
  }
});

test('W0 failed update install leaves the old controlled shell available', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const server = await startStaticServer(4182);
  const version = await nextBuild();
  try {
    await page.goto(`${server.origin}/socialprune/#/settings`);
    await expect(page.locator('main[data-gate]')).toHaveAttribute(
      'data-gate',
      'ready',
    );
    server.switchOutput(version.copy);
    server.failures.add('/socialprune/icon.svg');
    await page.evaluate(() =>
      navigator.serviceWorker
        .getRegistration()
        .then((registration) => registration?.update()),
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          navigator.serviceWorker
            .getRegistration()
            .then((registration) => registration?.installing?.state ?? 'none'),
        ),
      )
      .toBe('none');
    expect(await page.evaluate(() => caches.keys())).not.toContain(
      `sp-app-${version.next}`,
    );
    const response = await page.reload();
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(page.getByText(`Build ${version.id}`)).toBeVisible();
    expect(await page.getByRole('button', { name: 'Reload now' }).count()).toBe(
      0,
    );
  } finally {
    await server.close();
    await version.close();
  }
});
