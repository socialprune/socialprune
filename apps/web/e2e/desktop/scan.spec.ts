import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { fakeEndpoint } from '../../../../packages/classify/test/fake-endpoint.ts';
import { scanWorkspace } from '../../../cli/src/engine/test/scan-workspace.ts';
import { EngineScan } from '../../../cli/src/engine/scan.ts';
import { RunControls } from '../../../cli/src/browser/run-controls.ts';
import { SQLiteStore } from '../../../cli/src/workspace/sqlite-store.ts';
import { fakeBridge } from './fake-bridge.ts';

for (const locale of ['en', 'de'] as const)
  test(`C5 setup agreement, real fake endpoint, aggregate monitor and resume ${locale}`, async ({
    page,
  }) => {
    const root = await mkdtemp(join(tmpdir(), 'sp-scan-bridge-'));
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
      text: `Generated bridge scan note ${index}.`,
    }));
    seed.counts.items = seed.items.length;
    const db = await SQLiteStore.open(join(workspace, 'socialprune.sqlite'), {
      initial: seed,
    });
    await db.close();
    const fake = await fakeEndpoint((input) =>
      input.url.endsWith('/models')
        ? { body: { data: [{ id: 'generated-model' }] } }
        : {},
    );
    const scan = new EngineScan(workspace, () => new Date(), RunControls);
    const bridge = await fakeBridge(page, locale, seed, 'direct', scan);
    const de = locale === 'de';
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    try {
      await page.goto('/desktop.html');
      await page
        .getByRole('button', {
          name: de ? 'Modellvorschläge' : 'Model suggestions',
          exact: true,
        })
        .click();
      await page
        .getByLabel(de ? 'Basisadresse des Endpunkts' : 'Endpoint base URL', {
          exact: true,
        })
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
      expect(fake.requests).toHaveLength(0);
      await page
        .getByRole('button', {
          name: de ? 'Endpunkt prüfen' : 'Check endpoint',
          exact: true,
        })
        .click();
      const start = page.getByRole('button', {
        name: de ? 'Starten' : 'Start',
        exact: true,
      });
      await expect(start).toBeDisabled();
      // A test-only DOM mutation defeats the visual disabled state. The event
      // handler must still require agreement and send no Start command.
      await start.evaluate((button: HTMLButtonElement) => {
        button.disabled = false;
      });
      await start.click();
      expect(fake.requests).toHaveLength(2);
      await page
        .getByLabel(de ? 'Angefragtes Modell' : 'Requested model', {
          exact: true,
        })
        .fill('generated-model-edited');
      await expect(
        page.getByRole('button', {
          name: de ? 'Starten' : 'Start',
          exact: true,
        }),
      ).toHaveCount(0);
      await page
        .getByLabel(de ? 'Angefragtes Modell' : 'Requested model', {
          exact: true,
        })
        .fill('generated-model');
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
      expect(fake.requests).toHaveLength(4);
      await agreement.check();
      await start.click();
      await expect(page.getByTestId('scan-monitor')).toHaveAttribute(
        'data-phase',
        'ended',
      );
      expect(scan.view).toMatchObject({
        stored: 50,
        limit: 50,
        canResume: true,
      });
      const resume = page.getByRole('button', {
        name: de
          ? 'Mit übrigen Einträgen fortfahren'
          : 'Continue with remaining entries',
      });
      await expect(resume).toBeDisabled();
      await page
        .getByRole('checkbox', {
          name: de
            ? 'Ich habe die ersten Vorschläge durchgesehen und möchte fortfahren'
            : 'I have reviewed the first suggestions and want to continue',
        })
        .check();
      await resume.click();
      await expect.poll(() => scan.view.stored).toBe(25);
      await expect(page.getByTestId('scan-monitor')).toHaveAttribute(
        'data-phase',
        'ended',
      );
      expect(
        requests.every((url) => url.startsWith(new URL(page.url()).origin)),
      ).toBe(true);
      expect(await page.getByTestId('desktop-scan').innerText()).not.toContain(
        'Generated bridge scan note',
      );
    } finally {
      await scan.close();
      await bridge.close();
      await fake.close();
      await rm(root, { recursive: true, force: true });
    }
  });
