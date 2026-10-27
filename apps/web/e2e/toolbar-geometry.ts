import type { Page } from '@playwright/test';

/** Native select font metrics may vary; a second control row may not. */
export function toolbarIsOneRow(page: Page) {
  return page.evaluate(() => {
    const toolbar = document.querySelector('[data-feed-toolbar]');
    if (!toolbar) return true;
    const rows = [...toolbar.children]
      .filter(
        (node) =>
          node.matches('label, button, [role="group"]') &&
          getComputedStyle(node).position !== 'absolute',
      )
      .map((node) => node.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0);
    return (
      rows.length < 2 ||
      Math.max(...rows.map((box) => box.top + box.height / 2)) -
        Math.min(...rows.map((box) => box.top + box.height / 2)) <=
        1
    );
  });
}
