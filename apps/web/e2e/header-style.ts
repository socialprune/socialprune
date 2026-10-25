import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

export async function expectHeaderStyle(
  page: Page,
  info: TestInfo,
  name: string,
) {
  await page.evaluate(() => document.fonts.ready);
  const observed = await page.evaluate(() => {
    const rgba = (value: string) => value.match(/[\d.]+/g)!.map(Number);
    const background = (node: Element | null): number[] => {
      if (!node) return [255, 255, 255];
      const color = rgba(getComputedStyle(node).backgroundColor);
      const alpha = color[3] ?? 1;
      const behind = alpha < 1 ? background(node.parentElement) : color;
      return color
        .slice(0, 3)
        .map((v, i) => v * alpha + behind[i]! * (1 - alpha));
    };
    const luminance = (color: number[]) => {
      const linear = color.map((v) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
    };
    const text = [
      ...document.querySelectorAll(
        'header a, header strong, header label, header select, header > div > button, header + nav button',
      ),
    ]
      .filter((node) => node.getBoundingClientRect().width > 0)
      .map((node) => {
        const style = getComputedStyle(node);
        const bg = background(node);
        const color = rgba(style.color);
        const alpha = color[3] ?? 1;
        const fg = color
          .slice(0, 3)
          .map((v, i) => v * alpha + bg[i]! * (1 - alpha));
        const a = luminance(fg),
          b = luminance(bg);
        return {
          label: node.getAttribute('aria-label') ?? node.textContent?.trim(),
          color: style.color,
          background: bg,
          contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        };
      });
    const menu = document.querySelector(
      'header button[aria-controls="app-menu"]',
    );
    const menuBackground = menu ? getComputedStyle(menu).backgroundColor : null;
    const tabs = [...document.querySelectorAll('[role="tab"]')].map((node) => ({
      radius: getComputedStyle(node).borderTopLeftRadius,
      borderWidth: getComputedStyle(node).borderTopWidth,
    }));
    return {
      text,
      menuBackground,
      tabs,
      sheets: [...document.styleSheets].map((sheet) => ({
        href: sheet.href?.split('/').at(-1),
        layers: [...sheet.cssRules]
          .filter((rule) => rule.cssText.startsWith('@layer'))
          .map((rule) => rule.cssText.slice(0, 100)),
      })),
    };
  });
  await info.attach(`${name}-computed-styles`, {
    body: JSON.stringify(observed, null, 2),
    contentType: 'application/json',
  });
  // eslint-disable-next-line no-restricted-properties -- Optional generated screenshot destination, never credentials.
  const folder = process.env['SP_H_SCREEN_DIR'];
  if (folder) {
    await page.screenshot({
      path: join(folder, `${name}-${info.project.name}.png`),
      animations: 'disabled',
    });
    await writeFile(
      join(folder, `${name}-${info.project.name}.json`),
      JSON.stringify(observed, null, 2),
    );
  }
  expect(observed.text.length).toBeGreaterThan(0);
  for (const row of observed.text)
    expect
      .soft(
        row.contrast,
        `${row.label}: ${row.color} on ${row.background.join(',')}`,
      )
      .toBeGreaterThanOrEqual(4.5);
  if (observed.menuBackground !== null)
    expect.soft(observed.menuBackground).toBe('rgba(0, 0, 0, 0)');
  expect(observed.tabs).toHaveLength(6);
  for (const tab of observed.tabs) {
    expect.soft(tab.radius).toBe('0px');
    expect.soft(tab.borderWidth).toBe('0px');
  }
}
