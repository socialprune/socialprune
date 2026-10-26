import type { Page } from 'playwright-core';
import { normalize } from './plan.ts';
import { filterWindowMatches, utcWindow } from './selectors.ts';

interface Node {
  nodeId: number;
  nodeName: string;
  attributes?: string[];
  children?: Node[];
}
export function regionCounts(root: Node, ids: readonly number[]) {
  const selected = new Set(ids),
    parents = new Set<number>();
  const result = { main: 0, dialog: 0, elsewhere: 0, distinctParents: 0 };
  const walk = (node: Node, parent: number, main: boolean, dialog: boolean) => {
    main ||= node.nodeName === 'MAIN';
    const at = node.attributes?.indexOf('role') ?? -1;
    dialog ||=
      at >= 0 && ['dialog', 'alertdialog'].includes(node.attributes![at + 1]!);
    if (selected.has(node.nodeId)) {
      result[dialog ? 'dialog' : main ? 'main' : 'elsewhere']++;
      parents.add(parent);
    }
    for (const child of node.children ?? [])
      walk(child, node.nodeId, main, dialog);
  };
  walk(root, 0, false, false);
  result.distinctParents = parents.size;
  return result;
}

/** Diagnostic only. Missing exact row dates never become evidence of a window. */
export async function listRegions(page: Page, text: string, at: string) {
  const dates = utcWindow(at);
  const afterApply = await filterWindowMatches(page, dates);
  let client:
    | Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>
    | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        client = await page.context().newCDPSession(page);
        const root = await client.send('DOM.getDocument', { depth: -1 });
        const counted = await client.send('DOM.querySelectorAll', {
          nodeId: root.root.nodeId,
          selector: '[role="button"][aria-label]',
        });
        const regions = regionCounts(root.root, counted.nodeIds);
        let ignoredTextMatches = 0,
          ignoredDatedWindowMatches = 0;
        // Read only the nearest image-button candidates, not arbitrary ancestor text.
        const ignored = page
          .locator('[role="button"]:not([aria-label])')
          .filter({ has: page.locator('img') });
        for (const row of await ignored.all()) {
          if (!normalize(await row.innerText()).includes(normalize(text)))
            continue;
          ignoredTextMatches++;
          const times = await row.locator('time[datetime]').all();
          if (times.length === 1) {
            const time = await times[0]!.getAttribute('datetime');
            if (time && Number.isFinite(Date.parse(time))) {
              const day = new Date(time).toISOString().slice(0, 10);
              if (day >= dates[0] && day <= dates[1])
                ignoredDatedWindowMatches++;
            }
          }
        }
        return {
          observed: true,
          ...regions,
          afterApply,
          ignoredTextMatches,
          ignoredDatedWindowMatches,
        };
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('List region observation expired')),
          1000,
        );
      }),
    ]);
  } catch {
    return {
      observed: false,
      main: 0,
      dialog: 0,
      elsewhere: 0,
      distinctParents: 0,
      afterApply,
      ignoredTextMatches: 0,
      ignoredDatedWindowMatches: 0,
    };
  } finally {
    clearTimeout(timer);
    try {
      await client?.detach();
    } catch {
      /* Observation already carries its availability. */
    }
  }
}
