import { expect, type Page, type TestInfo } from '@playwright/test';
import { join } from 'node:path';

/** Geometry and resolved-color checks shared by all three real renderer shells. */
export async function assertPolish(
  page: Page,
  info: TestInfo,
  platform: 'x' | 'instagram',
) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('feed')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('feed').locator('article').first()).toBeVisible();
  const observed = await page.evaluate(() => {
    const heading = document.querySelector('main > h1')!,
      card = document.querySelector('[role="feed"] article')!;
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const background = (node: Element | null): number[] => {
      if (!node) return [255, 255, 255];
      const color = rgb(getComputedStyle(node).backgroundColor),
        alpha = color[3] ?? 1;
      const behind = alpha < 1 ? background(node.parentElement) : color;
      return color
        .slice(0, 3)
        .map((v, i) => v * alpha + behind[i]! * (1 - alpha));
    };
    const luminance = (values: number[]) => {
      const c = values.map((v) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
    };
    const ratio = (a: number[], b: number[]) => {
      const x = luminance(a),
        y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const segments = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-feed-toolbar] [role="group"] button[aria-pressed]',
      ),
    ];
    const active = segments.find(
        (node) => node.getAttribute('aria-pressed') === 'true',
      )!,
      inactive = segments.find((node) => node !== active)!;
    const a = getComputedStyle(active),
      b = getComputedStyle(inactive);
    const cue =
      a.fontWeight !== b.fontWeight ||
      a.textDecorationLine !== b.textDecorationLine ||
      a.borderBottomWidth !== b.borderBottomWidth ||
      a.boxShadow !== b.boxShadow ||
      !!active.querySelector('svg');
    const link = document.querySelector<HTMLElement>(
        '[data-testid="stored-original"] > a',
      ),
      provenance = link?.previousElementSibling?.previousElementSibling;
    return {
      headingX: heading.getBoundingClientRect().x,
      cardX: card.getBoundingClientRect().x,
      backgroundContrast: ratio(background(active), background(inactive)),
      cue,
      textContrast: segments.map((node) =>
        ratio(rgb(getComputedStyle(node).color), background(node)),
      ),
      linkSize: link ? parseFloat(getComputedStyle(link).fontSize) : null,
      provenanceSize: provenance
        ? parseFloat(getComputedStyle(provenance).fontSize)
        : null,
      toolbar: [
        ...document.querySelectorAll<HTMLElement>(
          '[data-feed-toolbar], [data-feed-toolbar] > *',
        ),
      ].map((node) => {
        const s = getComputedStyle(node),
          r = node.getBoundingClientRect();
        return {
          tag: node.tagName,
          height: r.height,
          top: r.top,
          font: s.font,
          lineHeight: s.lineHeight,
          padding: s.padding,
          minHeight: s.minHeight,
        };
      }),
    };
  });
  console.log(
    'POLISH_MEASUREMENT',
    JSON.stringify({ platform, viewport: page.viewportSize(), ...observed }),
  );
  await info.attach('polish-measurements', {
    body: JSON.stringify(observed, null, 2),
    contentType: 'application/json',
  });
  // eslint-disable-next-line no-restricted-properties -- Explicit generated screenshot destination.
  const folder = process.env['SP_H_SCREEN_DIR'];
  if (folder)
    await page.screenshot({
      path: join(
        folder,
        `${info.project.name}-${info.title.replaceAll(/[^a-zA-Z0-9]+/g, '-')}-${(await page.getByTestId('card-review').getAttribute('data-single')) === 'true' ? 'single' : 'list'}.png`,
      ),
      animations: 'disabled',
    });
  expect
    .soft(Math.abs(observed.headingX - observed.cardX))
    .toBeLessThanOrEqual(1);
  expect.soft(observed.cue || observed.backgroundContrast >= 3).toBe(true);
  for (const ratio of observed.textContrast)
    expect.soft(ratio).toBeGreaterThanOrEqual(4.5);
  if (observed.linkSize !== null)
    expect.soft(observed.linkSize).toBe(observed.provenanceSize);
}
