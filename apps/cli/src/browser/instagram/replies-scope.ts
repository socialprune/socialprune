import type { Locator } from 'playwright-core';
import type { ReplyScopeDiagnostic } from './report.ts';

export const REPLY_SCOPE_DEPTH = 12;
export const REPLY_ROWS = ':scope > ul > li, :scope > div > ul > li';
const BUTTONS = 'button,[role="button"]';
export const replyControls = (root: Locator) =>
  root.locator(BUTTONS).filter({
    hasText: /^(?:View|Hide|See|Load).*repl/iu,
  });
export async function ownReplyControls(root: Locator) {
  const nested = replyControls(root.locator(REPLY_ROWS));
  let own = root.locator('xpath=./*[false()]');
  for (const control of await replyControls(root).all())
    if ((await control.and(nested).count()) === 0) own = own.or(control);
  return own;
}

/** Bound every expansion to this comment, never to a surrounding thread. */
export async function structuralReplyScope(
  focal: Locator,
  focalSelector: string,
  zeroAnswer: boolean,
  shape: ReplyScopeDiagnostic,
  guard: () => void,
) {
  let emptyScope: { root: Locator; depth: number; avatar: boolean } | undefined;
  const choose = (root: Locator, depth: number) => {
    shape.chosenDepth = depth;
    shape.rootCount = 1;
    shape.rootMainCount = 1;
    shape.rootFocalCount = 1;
    return root;
  };
  for (let depth = 1; depth <= REPLY_SCOPE_DEPTH; depth++) {
    guard();
    const root = focal.locator(`xpath=ancestor::*[${depth}]`);
    if (
      (await root.count()) !== 1 ||
      (await root.locator('xpath=ancestor::main').count()) !== 1
    )
      break;
    const children = root.locator(':scope > *');
    const level: ReplyScopeDiagnostic['levels'][number] = {
      depth,
      childrenCapped: (await children.count()) > 32,
      children: [],
    };
    for (const child of (await children.all()).slice(0, 32)) {
      const focalCount =
        (await child.locator(focalSelector).count()) +
        (await child.locator(`xpath=self::a`).and(focal).count());
      level.children.push({
        containsFocal: focalCount > 0,
        otherPermalinks: Math.max(
          0,
          (await child.locator('a[href*="/c/"]').count()) +
            (await child
              .locator('xpath=self::a[contains(@href,"/c/")]')
              .count()) -
            focalCount,
        ),
        times:
          (await child.locator('time').count()) +
          (await child.locator('xpath=self::time').count()),
        expandControls:
          (await replyControls(child).count()) +
          (await child
            .locator('xpath=self::button | self::*[@role="button"]')
            .filter({ hasText: /^(?:View|Hide|See|Load).*repl/iu })
            .count()),
        images:
          (await child.locator('img').count()) +
          (await child.locator('xpath=self::img').count()),
      });
    }
    shape.levels.push(level);
    const rows = root.locator(REPLY_ROWS);
    const controls = replyControls(root);
    const rowControls = replyControls(rows);
    const count = (await controls.count()) - (await rowControls.count());
    const rowCount = await rows.count();
    const focalCount = await root.locator(focalSelector).count();
    const other =
      (await root.locator('a[href*="/c/"]').count()) -
      (await rows.locator('a[href*="/c/"]').count());
    if (focalCount !== 1 || other !== 1) {
      // Do not adopt an ancestor which owns another top-level comment. An
      // already isolated zero-child scope may end immediately below it.
      if (count !== 0 || rowCount !== 0 || !emptyScope) return null;
      shape.levels = shape.levels.slice(0, emptyScope.depth);
      shape.avatarObserved = emptyScope.avatar;
      return choose(emptyScope.root, emptyScope.depth);
    }
    shape.avatarObserved ||= (await root.locator('img').count()) > 0;
    if (count > 0 || rowCount > 0) {
      if ((await root.locator(':scope > ul, :scope > div > ul').count()) > 1)
        return null;
      return choose(root, depth);
    }
    // Scan through the whole isolated comment before proving no expand
    // control. A narrower text/actions wrapper is not proof of absence.
    if (
      zeroAnswer &&
      (await root
        .locator(BUTTONS)
        .filter({ hasText: /^Reply$/u })
        .count()) > 0
    )
      emptyScope ??= { root, depth, avatar: shape.avatarObserved };
  }
  if (shape.levels.length >= REPLY_SCOPE_DEPTH || !emptyScope) return null;
  shape.levels = shape.levels.slice(0, emptyScope.depth);
  shape.avatarObserved = emptyScope.avatar;
  return choose(emptyScope.root, emptyScope.depth);
}
