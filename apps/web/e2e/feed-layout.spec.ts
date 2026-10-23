import { expect, test, type Page } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  liveExpected,
  liveFeedFixture,
  restoreLiveFeed,
} from './feed-fixture.ts';

const tabs = ['suggested', 'held', 'kept', 'unclear', 'marked', 'all'] as const;
const screens =
  // eslint-disable-next-line no-restricted-properties -- Test-only synthetic audit output selected by the operator.
  process.env['SP_FEED_AUDIT_DIR'] ??
  join(tmpdir(), 'socialprune-feed-w3b', 'guard');

/** Read the actual rendered and clipped boxes, not document scrollWidth alone. */
async function layoutFindings(page: Page, width: number) {
  return page.evaluate((narrow) => {
    const issues: string[] = [];
    const viewport = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > viewport + 1)
      issues.push('document horizontally overflows');
    const elements = [...document.querySelectorAll<HTMLElement>('body *')];
    function visible(element: HTMLElement) {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        !box.width ||
        !box.height ||
        element.closest('[aria-hidden="true"], [inert]')
      )
        return false;
      if (box.bottom <= 0 || box.top >= innerHeight) return false;
      for (
        let parent = element.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const bounds = parent.getBoundingClientRect();
        if (
          /auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowY) &&
          (box.bottom <= bounds.top || box.top >= bounds.bottom)
        )
          return false;
      }
      return true;
    }
    for (const element of elements) {
      if (
        !visible(element) ||
        element.matches('script, style, option') ||
        (getComputedStyle(element).position === 'absolute' &&
          element.getBoundingClientRect().width <= 1)
      )
        continue;
      const box = element.getBoundingClientRect();
      const label = `${element.tagName.toLowerCase()} ${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 65)}`;
      const strip = element.closest<HTMLElement>('[role="tablist"]');
      const stripBox = strip?.getBoundingClientRect();
      const intentional =
        strip &&
        stripBox &&
        stripBox.left >= -1 &&
        stripBox.right <= viewport + 1 &&
        /auto|scroll/.test(getComputedStyle(strip).overflowX);
      if (
        (box.left < -1 ||
          box.right > viewport + 1 ||
          box.width > viewport + 1) &&
        !intentional
      )
        issues.push(`overflow: ${label}`);
      if (
        narrow &&
        element.matches(
          'button, a[href], select, input:not([type="hidden"]), summary, [role="menuitem"]',
        )
      ) {
        const target = element.matches(
          'input[type="checkbox"], input[type="radio"]',
        )
          ? (element.closest('label') ?? element)
          : element;
        const hit = target.getBoundingClientRect();
        if (hit.width < 43.5 || hit.height < 43.5)
          issues.push(
            `target ${Math.round(hit.width)}x${Math.round(hit.height)}: ${label}`,
          );
      }
      if (!element.matches('button, label, summary, [role="tab"]')) continue;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const rows = new Set(
            [...range.getClientRects()]
              .filter((rect) => rect.width > 0)
              .map((rect) => Math.round(rect.top)),
          );
          if (rows.size > 1) issues.push(`split word ${match[0]}: ${label}`);
        }
      }
    }
    const active = document.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    const strip = active?.closest('[role="tablist"]');
    if (active && strip) {
      const tab = active.getBoundingClientRect(),
        container = strip.getBoundingClientRect();
      if (tab.left < container.left - 1 || tab.right > container.right + 1)
        issues.push('active tab clipped');
      if (
        strip.scrollWidth > strip.clientWidth + 1 &&
        !strip.parentElement?.querySelector('[data-tab-scroll]')
      )
        issues.push('overflowing tab strip has no visible scroll controls');
    }
    const toolbar = document.querySelector('[data-feed-toolbar]');
    if (toolbar && toolbar.getBoundingClientRect().height > 60)
      issues.push('toolbar wraps beyond one line');
    const viewportHeight = document.documentElement.clientHeight;
    const footer = document
      .querySelector('footer button')
      ?.getBoundingClientRect();
    if (footer && (footer.bottom > viewportHeight + 1 || footer.top < 0))
      issues.push('final mark is outside the opening viewport');
    return [...new Set(issues)];
  }, width < 600);
}

for (const lang of ['de', 'en'] as const)
  for (const theme of ['light', 'dark'] as const)
    for (const width of [320, 390, 1280])
      test(`connected geometry ${lang} ${theme} ${width}`, async ({ page }) => {
        test.setTimeout(120_000);
        const findings: string[] = [];
        await page.setViewportSize({ width, height: width < 600 ? 844 : 800 });
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: 'reduce',
        });
        await page.addInitScript(
          ({ lang, theme }) => {
            localStorage.setItem('sp-locale', lang);
            localStorage.setItem('sp-theme', theme);
          },
          { lang, theme },
        );
        const messages = JSON.parse(
          await readFile(
            new URL(`../src/i18n/${lang}.json`, import.meta.url),
            'utf8',
          ),
        ) as Record<string, string>;
        await page.goto('/socialprune/');
        if (
          await page
            .locator('main h1')
            .evaluate((element) => element === document.activeElement)
        )
          findings.push('initial load moves focus to page heading');
        await restoreLiveFeed(page);
        async function inspect(state: string) {
          findings.push(
            ...(await layoutFindings(page, width)).map(
              (issue) => `${state}: ${issue}`,
            ),
          );
          if (!state.endsWith('-bottom'))
            await page.screenshot({
              path: join(screens, `${state}-${lang}-${theme}-${width}.png`),
            });
        }
        const menu = page.getByRole('button', {
          name: messages['reviewFeed.options'],
          exact: true,
        });
        if (await menu.count()) {
          await menu.click();
          await inspect('toolbar-menu');
          await page.keyboard.press('Escape');
          await expect(menu).toBeFocused();
        }
        for (const [platform, account] of [
          ['x', liveExpected.account],
          ['instagram', liveExpected.instagram],
        ] as const) {
          await page
            .getByRole('combobox', {
              name: messages['review.account'],
              exact: true,
            })
            .selectOption(account);
          for (const tab of tabs) {
            await page
              .getByRole('tab', {
                name: new RegExp(`^${messages[`reviewFeed.tab.${tab}`]},`),
              })
              .click();
            await expect(page.getByRole('feed')).toHaveAttribute(
              'aria-busy',
              'false',
            );
            await inspect(`${platform}-${tab}`);
            const panel = page.getByRole('tabpanel');
            await panel.evaluate((node) => {
              node.scrollTop = node.scrollHeight;
            });
            await inspect(`${platform}-${tab}-bottom`);
            await panel.evaluate((node) => {
              node.scrollTop = 0;
            });
          }
        }
        await page
          .getByRole('combobox', {
            name: messages['review.account'],
            exact: true,
          })
          .selectOption(liveExpected.account);
        await page
          .getByRole('tab', {
            name: new RegExp(`^${messages['reviewFeed.tab.suggested']},`),
          })
          .click();
        await expect(page.getByRole('feed')).toHaveAttribute(
          'aria-busy',
          'false',
        );
        await page.locator('footer button').click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await inspect('preview');
        await page.getByRole('dialog').evaluate((node) => {
          node.scrollTop = node.scrollHeight;
        });
        await inspect('preview-bottom');
        await page.getByRole('dialog').getByRole('button').last().click();
        const empty = liveFeedFixture();
        empty.settings.criteria!.selected = [];
        await page.goto('/socialprune/');
        await restoreLiveFeed(page, empty);
        await expect(
          page.getByRole('heading', {
            name: messages['reviewFeed.noCriteria'],
            exact: true,
          }),
        ).toBeVisible();
        await inspect('first-start');
        await page
          .getByRole('button', {
            name: messages['reviewFeed.chooseCriteria'],
            exact: true,
          })
          .click();
        await inspect('criteria');
        const editor = page
          .locator('section')
          .filter({
            has: page.getByRole('heading', {
              name: messages['criteriaPicker.title'],
              exact: true,
            }),
          })
          .last();
        await editor.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await inspect('criteria-bottom');
        await page.screenshot({
          path: join(screens, `audit-${lang}-${theme}-${width}.png`),
        });
        console.log(
          'FEED_LAYOUT_FINDINGS',
          JSON.stringify({ lang, theme, width, findings }),
        );
        expect(findings).toEqual([]);
      });
