import type { Locator } from 'playwright-core';
import type { ReplyScopeDiagnostic } from './report.ts';

export const REPLY_SCOPE_DEPTH = 12;
export const REPLY_ROWS = ':scope > ul > li, :scope > div > ul > li';
export const EXPANDED_REPLY_LISTS = ':scope > div > div > ul';
/** Additional expanded wrapper only, never a page-wide or text-only row. */
export async function matchedReplyRows(
  root: Locator,
  address: { kind: 'p' | 'reel'; code: string },
  appearedListFocal?: string,
) {
  let rows = root.locator(REPLY_ROWS);
  let candidates = root.locator(':scope > div > div > ul > li');
  if (appearedListFocal && (await root.locator('ul').count()) === 1) {
    let group = root.locator('ul');
    // Pass through single structural wrappers, stopping at the nearest repeated
    // children of this one new list. Never collect overlapping descendants.
    for (let depth = 0; depth < REPLY_SCOPE_DEPTH; depth++) {
      const children = group.locator(':scope > *');
      if (
        (await children.count()) !== 1 ||
        (await children.locator('a[href*="/c/"]').count()) <= 1
      )
        break;
      group = children;
    }
    candidates = candidates.or(group.locator(':scope > *'));
  }
  for (const row of await candidates.all()) {
    const links = row.locator('a[href*="/c/"]');
    if ((await links.count()) !== 1) continue;
    const href = await links.getAttribute('href', { timeout: 150 });
    if (
      !href ||
      !new RegExp(`^/${address.kind}/${address.code}/c/[0-9]{1,40}/$`).test(
        href,
      ) ||
      (appearedListFocal &&
        href === `/${address.kind}/${address.code}/c/${appearedListFocal}/`)
    )
      continue;
    const times = row.locator('time[datetime]');
    if (
      (await times.count()) !== 1 ||
      (await links.locator('time[datetime]').count()) !== 1
    )
      continue;
    const time = await times.getAttribute('datetime', { timeout: 150 });
    if (!time || !Number.isFinite(Date.parse(time))) continue;
    rows = rows.or(row);
  }
  return rows;
}
const BUTTONS = 'button,[role="button"]';
export const replyControls = (root: Locator) =>
  root.locator(BUTTONS).filter({
    hasText: /^(?:View|Hide|See|Load).*repl/iu,
  });
export async function ownReplyControls(
  root: Locator,
  rows = root.locator(REPLY_ROWS),
) {
  const nested = replyControls(rows);
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
  let isolated: { root: Locator; depth: number; avatar: boolean } | undefined;
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
      // An exact admitted zero answer needs no surrounding reply wrapper. The
      // deepest isolated focal item is bounded by this first comment-list edge;
      // sibling comments' controls are never part of that item or clicked.
      if (zeroAnswer && level.children.length > 0) {
        const focalChildren = level.children.filter(
          (child) => child.containsFocal,
        );
        const foreignChildren = level.children.filter(
          (child) => !child.containsFocal && child.otherPermalinks > 0,
        );
        let plainBoundary =
          focalChildren.length === 1 &&
          focalChildren[0]!.otherPermalinks === 0 &&
          foreignChildren.length > 0 &&
          !level.childrenCapped;
        for (const child of await children.all())
          if (
            (await child
              .locator('xpath=self::a[contains(@href,"/c/")]')
              .count()) > 0
          )
            plainBoundary = false;
        if (!(
          plainBoundary &&
          isolated &&
          (await isolated.root.locator(focalSelector).count()) === 1 &&
          (await isolated.root.locator('a[href*="/c/"]').count()) === 1 &&
          (await isolated.root.locator('time[datetime]').count()) === 1 &&
          (await replyControls(isolated.root).count()) === 0 &&
          (await isolated.root.locator(REPLY_ROWS).count()) === 0
        ))
          return null;
        shape.avatarObserved = isolated.avatar;
        return choose(isolated.root, isolated.depth);
      }
      // The first foreign top-level permalink bounds the whole isolated
      // comment below it. No Reply action or avatar is needed to locate that
      // boundary; the answer check still decides whether absence can be saved.
      if (focalCount !== 1 || count !== 0 || rowCount !== 0 || !isolated)
        return null;
      shape.avatarObserved = isolated.avatar;
      return choose(isolated.root, isolated.depth);
    }
    shape.avatarObserved ||= (await root.locator('img').count()) > 0;
    if (count > 0 || rowCount > 0) {
      if ((await root.locator(':scope > ul, :scope > div > ul').count()) > 1)
        return null;
      return choose(root, depth);
    }
    isolated = { root, depth, avatar: shape.avatarObserved };
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
