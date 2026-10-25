import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { fakeEndpoint } from '../../../../packages/classify/test/fake-endpoint.ts';
import { scanWorkspace } from '../../../cli/src/engine/test/scan-workspace.ts';
import { EngineScan } from '../../../cli/src/engine/scan.ts';
import { RunControls } from '../../../cli/src/browser/run-controls.ts';
import { SQLiteStore } from '../../../cli/src/workspace/sqlite-store.ts';
import { fakeBridge } from './fake-bridge.ts';

// eslint-disable-next-line no-restricted-properties -- Explicit generated gallery destination.
const folder = process.env['SP_C5_GALLERY_DIR'];
for (const locale of ['de', 'en'] as const)
  for (const theme of ['light', 'dark'] as const)
    for (const width of [390, 1280])
      test(`C5 gallery ${locale} ${theme} ${width}`, async ({ page }) => {
        test.skip(!folder, 'Gallery output is opt-in.');
        const root = await mkdtemp(join(tmpdir(), 'sp-scan-gallery-'));
        const workspace = join(root, 'workspace');
        await mkdir(workspace);
        const seed = scanWorkspace();
        seed.settings.criteria = {
          selected: ['political'],
          custom: [],
          nextCustom: 1,
          level: 0,
        };
        seed.items = Array.from({ length: 75 }, (_, index) => ({
          ...seed.items[0]!,
          id: `x:generated-${index}`,
          text: `Generated gallery scan note ${index}.`,
        }));
        seed.counts.items = seed.items.length;
        const db = await SQLiteStore.open(
          join(workspace, 'socialprune.sqlite'),
          { initial: seed },
        );
        await db.close();
        const scan = new EngineScan(workspace, () => new Date(), RunControls);
        const keyFile = join(root, 'generated.key');
        await writeFile(keyFile, 'generated-gallery-key\n');
        await scan.handle(
          { type: 'scanKey', requestId: crypto.randomUUID() },
          keyFile,
        );
        let hold = false;
        const fake = await fakeEndpoint((input) => {
          if (input.url.endsWith('/models'))
            return { body: { data: [{ id: 'generated-model' }] } };
          if (hold && scan.view.requests > 0 && !scan.view.pauseRequested) {
            void scan.handle({
              type: 'scanAction',
              action: 'pause',
              runId: scan.view.runId!,
              version: scan.view.version,
              requestId: crypto.randomUUID(),
            });
          }
          return {};
        });
        const bridge = await fakeBridge(page, locale, seed, 'direct', scan);
        const de = locale === 'de';
        try {
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ colorScheme: theme });
          await page.goto('/desktop.html');
          await page
            .getByRole('button', {
              name: de ? 'Modellvorschläge' : 'Model suggestions',
              exact: true,
            })
            .click();
          await page
            .getByLabel(
              de ? 'Basisadresse des Endpunkts' : 'Endpoint base URL',
              { exact: true },
            )
            .fill(fake.origin + '/v1');
          await page
            .getByLabel(de ? 'Angefragtes Modell' : 'Requested model', {
              exact: true,
            })
            .fill('generated-model');
          await page
            .getByLabel(de ? 'Einträge pro Anfrage' : 'Entries per request', {
              exact: true,
            })
            .fill('25');
          await page
            .getByRole('button', {
              name: de ? 'Schlüsseldatei wählen' : 'Choose key file',
              exact: true,
            })
            .click();
          await page
            .getByRole('button', {
              name: de ? 'Endpunkt prüfen' : 'Check endpoint',
              exact: true,
            })
            .click();
          const agreement = page.getByRole('checkbox', {
            name: de
              ? 'Ich möchte meine Einträge dorthin senden'
              : 'I want to send my entries there',
          });
          await expect(agreement).toBeEnabled();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await page.screenshot({
            path: join(folder!, `setup-${locale}-${theme}-${width}.png`),
            fullPage: true,
          });
          await agreement.check();
          hold = true;
          await page
            .getByRole('button', {
              name: de ? 'Starten' : 'Start',
              exact: true,
            })
            .click();
          const monitor = page.getByTestId('scan-monitor');
          await expect(monitor).toHaveAttribute('data-phase', 'paused');
          await monitor.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: join(folder!, `monitor-${locale}-${theme}-${width}.png`),
            fullPage: true,
          });
        } finally {
          await scan.close();
          await bridge.close();
          await fake.close();
          await rm(root, { recursive: true, force: true });
        }
      });
