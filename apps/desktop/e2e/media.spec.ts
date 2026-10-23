import { test, expect } from '@playwright/test';
import { launch } from './helpers.ts';
import { mediaFixture } from '../../cli/src/engine/test/media-fixture.ts';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { instagramContextDirectory } from '../../cli/src/workspace/context-files.ts';

test('stored X original/photo and confirmed Instagram image/screenshot cross only the private app engine path', async () => {
  let fixture!: Awaited<ReturnType<typeof mediaFixture>>;
  // A generated JPEG, not a screenshot of any platform or export content.
  const app = await launch('test', false, async (data) => {
    fixture = await mediaFixture(data);
  });
  try {
    const jpeg = await app.application.evaluate(
      ({ nativeImage }, png) =>
        Array.from(nativeImage.createFromBuffer(Buffer.from(png)).toJPEG(80)),
      Array.from(fixture.png),
    );
    await writeFile(
      join(
        instagramContextDirectory(fixture.workspace, fixture.context.post.code),
        'shot.jpg',
      ),
      Uint8Array.from(jpeg),
    );
    const violations: string[] = [];
    await app.page.exposeFunction('mediaPolicyViolation', (value: string) =>
      violations.push(value),
    );
    await app.page.evaluate(() =>
      document.addEventListener('securitypolicyviolation', (event) => {
        void (
          Reflect.get(globalThis, 'mediaPolicyViolation') as (
            value: string,
          ) => Promise<void>
        )(event.effectiveDirective);
      }),
    );
    await app.page.getByRole('tab', { name: /^All,/ }).click();
    await app.page
      .getByLabel('Account', { exact: true })
      .selectOption(fixture.item.account.key);
    await app.page.getByRole('tab', { name: /^All,/ }).click();
    const card = app.page.locator(`article[data-item-id="${fixture.item.id}"]`);
    await expect(card).toContainText(fixture.original.text!);
    const photo = card.locator(
      `img[src="/originals/${fixture.original.id}/1.png"]`,
    );
    await expect(photo).toBeVisible();
    await expect
      .poll(() =>
        photo.evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await app.page
      .getByLabel('Account', { exact: true })
      .selectOption(fixture.context.accountKey);
    await app.page.getByRole('tab', { name: /^All,/ }).click();
    const post = app.page
      .locator(`article[data-item-id="${fixture.context.itemId}"]`)
      .getByTestId('instagram-post');
    await expect(post).toContainText(fixture.context.post.owner);
    await expect
      .poll(() =>
        post
          .locator('img')
          .first()
          .evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await post.getByRole('button', { name: 'Show screenshot' }).click();
    await expect(post.locator('img')).toHaveCount(2);
    await expect
      .poll(() =>
        post
          .locator('img')
          .nth(1)
          .evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    const routes = await app.application.evaluate(
      async ({ session }, urls) => {
        const local = session.fromPartition('socialprune');
        const result: {
          status: number;
          type: string | null;
          bytes: number;
          range: string | null;
        }[] = [];
        for (const url of urls) {
          const response = await local.fetch(url);
          result.push({
            status: response.status,
            type: response.headers.get('content-type'),
            bytes: (await response.arrayBuffer()).byteLength,
            range: response.headers.get('content-range'),
          });
        }
        return result;
      },
      [
        `app://socialprune/context/instagram/${fixture.context.post.code}/shot.jpg`,
        `app://socialprune/originals/${fixture.original.id}/2.png`,
        `app://socialprune/originals/${fixture.original.id}/1.svg`,
        `app://socialprune/context/instagram/Absent/image.png`,
      ],
    );
    expect(routes[0]).toMatchObject({
      status: 200,
      type: 'image/jpeg',
      bytes: jpeg.length,
    });
    expect(routes.slice(1).map((row) => row.status)).toEqual([404, 404, 404]);
    const ranges = await app.application.evaluate(async ({ session }, path) => {
      const local = session.fromPartition('socialprune');
      const result: {
        status: number;
        contentRange: string | null;
        size: number;
      }[] = [];
      const cases: RequestInit[] = [
        { headers: { Range: 'bytes=1-4' } },
        { headers: { Range: 'bytes=999999-' } },
        { method: 'HEAD', headers: { Range: 'bytes=1-4' } },
        { headers: { Range: 'bytes=1-4', 'If-Range': 'generated' } },
      ];
      for (const options of cases) {
        const response = await local.fetch(path, options);
        result.push({
          status: response.status,
          contentRange: response.headers.get('content-range'),
          size: (await response.arrayBuffer()).byteLength,
        });
      }
      return result;
    }, `app://socialprune/originals/${fixture.original.id}/1.png`);
    expect(ranges).toEqual([
      { status: 206, contentRange: `bytes 1-4/${fixture.png.length}`, size: 4 },
      { status: 416, contentRange: `bytes */${fixture.png.length}`, size: 0 },
      { status: 200, contentRange: null, size: 0 },
      { status: 200, contentRange: null, size: fixture.png.length },
    ]);
    expect(
      app.requests.filter((url) => !url.startsWith('app://socialprune/')),
    ).toEqual([]);
    expect(violations).toEqual([]);
    expect(app.errors).toEqual([]);
    await app.page.screenshot({
      path: test.info().outputPath('desktop-stored-context.png'),
      fullPage: true,
    });
  } finally {
    await app.close();
  }
});
