import type { Locator } from 'playwright-core';
import type { ReplyScopeDiagnostic, SoleCommentDiagnostic } from './report.ts';
import type { SoleCaptionTime } from './sole-comment-answer.ts';

/** The qualified answer's verdict, with the caption time it found, if any. */
export type SoleAnswerVerdict =
  boolean | { accepted: boolean; captionTime?: SoleCaptionTime };

export const REPLY_SCOPE_DEPTH = 12;
export const REPLY_ROWS = ':scope > ul > li, :scope > div > ul > li';
export const EXPANDED_REPLY_LISTS = ':scope > div > div > ul';
export const ZERO_SCOPE_CHILD_LIMIT = 512;
export const ZERO_SCOPE_ELEMENT_LIMIT = 20000;

/** Read only element shape and permalink counts, never sibling controls/text. */
async function zeroBoundary(root: Locator, focalSelector: string) {
  const children = root.locator(':scope > *');
  const total = await children.count();
  const result = {
    total,
    observed: false,
    overBound: total > ZERO_SCOPE_CHILD_LIMIT,
    elements: 0,
    focalChildren: 0,
    focalOtherPermalinks: 0,
    foreignChildren: 0,
    directAnchors: 0,
    children: [] as ReplyScopeDiagnostic['levels'][number]['children'],
  };
  if (result.overBound) return result;
  result.elements = await root.locator('*').count();
  if (result.elements > ZERO_SCOPE_ELEMENT_LIMIT) {
    result.overBound = true;
    return result;
  }
  // The selector comes only from the validated post address and numeric ID.
  const href = focalSelector.slice('a[href="'.length, -2);
  const focalTest = `descendant-or-self::a[@href="${href}"]`;
  const links = 'descendant-or-self::a[contains(@href,"/c/")]';
  const focalChildren = root.locator(`xpath=./*[${focalTest}]`);
  result.focalChildren = await focalChildren.count();
  result.focalOtherPermalinks = await focalChildren
    .locator(`xpath=${links}[not(@href="${href}")]`)
    .count();
  result.foreignChildren = await root
    .locator(`xpath=./*[not(${focalTest}) and ${links}]`)
    .count();
  result.directAnchors = await root.locator(':scope > a[href*="/c/"]').count();
  for (const child of (await children.all()).slice(0, 32)) {
    const focal = await child.locator(`xpath=${focalTest}`).count();
    result.children.push({
      containsFocal: focal > 0,
      otherPermalinks: Math.max(
        0,
        (await child.locator(`xpath=${links}`).count()) - focal,
      ),
      times: await child.locator('xpath=descendant-or-self::time').count(),
      expandControls: null,
      images: await child.locator('xpath=descendant-or-self::img').count(),
    });
  }
  result.observed = true;
  return result;
}
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
const replyActions = (root: Locator) =>
  root.locator(BUTTONS).filter({ hasText: /^Reply$/u });

/** The nearest permalink-bearing item must belong only to the focal comment. */
async function focalReplyActions(
  main: Locator,
  focalSelector: string,
  guard: () => void,
) {
  const actions = replyActions(main),
    total = await actions.count();
  let own = 0;
  if (total <= 50)
    for (const action of await actions.all()) {
      guard();
      const item = action.locator(
        'xpath=ancestor::*[descendant::a[contains(@href,"/c/")]][1]',
      );
      if (
        (await item.count()) === 1 &&
        (await item.locator('xpath=ancestor::main').count()) === 1 &&
        (await item.locator(focalSelector).count()) === 1 &&
        (await item.locator('a[href*="/c/"]').count()) === 1 &&
        (await item.locator('time[datetime]').count()) === 1 &&
        (await item
          .locator(focalSelector)
          .locator('time[datetime]')
          .count()) === 1
      )
        own++;
    }
  return { total, own, foreign: total - own };
}
export const replyControls = (root: Locator) =>
  root.locator(BUTTONS).filter({
    hasText: /^(?:View|Hide|See|Load).*repl/iu,
  });
/** Any visible reply counter or expand text, button or not; it only forbids a zero. */
export const replyCounters = (root: Locator) =>
  root.locator('*').filter({
    hasText:
      /^(?:(?:View|Hide|See|Load)\b.*\brepl|(?:Alle\s+\d+\s+)?Antworten\s+(?:ansehen|anzeigen|ausblenden))/iu,
  });
type UnlinkedTime = NonNullable<SoleCommentDiagnostic['unlinkedTime']>;
const unlinkedNotEvaluated = (
  notComparable: 'no-unlinked-time' | 'several-unlinked-times',
): UnlinkedTime => ({
  evaluated: false,
  locationClass: 'not-evaluated',
  ancestorLink: 'not-evaluated',
  outsideFocalRow: null,
  outsidePermalinks: null,
  datetimeEqualsCaption: null,
  notComparable,
  admitted: false,
});
/**
 * REPLY-SOLE-2 D and B for the one unlinked time inside the isolated sole
 * comment. The focal row is the widest ancestor of the focal permalink inside
 * the isolated comment that holds only that permalink and at most one image,
 * the avatar. The time's container is the child that holds it at the nearest
 * level that also holds the focal permalink. Only closed values leave here.
 */
async function unlinkedTimeShape(
  time: Locator,
  focal: Locator,
  depth: number,
  href: string,
  captionTime: SoleCaptionTime | undefined,
  guard: () => void,
): Promise<UnlinkedTime> {
  let row: Locator | undefined;
  for (let level = 1; level <= depth; level++) {
    guard();
    const ancestor = focal.locator(`xpath=ancestor::*[${level}]`);
    if (
      (await ancestor.count()) !== 1 ||
      (await ancestor.locator('xpath=descendant-or-self::img').count()) > 1 ||
      (await ancestor.locator('a[href*="/c/"]').count()) !== 1
    )
      break;
    row = ancestor;
  }
  const outsideFocalRow = row
    ? (await time.locator('xpath=ancestor::*').and(row).count()) === 0
    : null;
  const links = time.locator('xpath=ancestor::a');
  let ancestorLink: UnlinkedTime['ancestorLink'] = 'none';
  if ((await links.count()) > 0) {
    const value = await time
      .locator('xpath=ancestor::a[1]')
      .getAttribute('href', { timeout: 150 });
    ancestorLink =
      value && /\/c\/|(?:^|\/)(?:p|reel)\//u.test(value)
        ? 'permalink'
        : 'other';
  }
  // The selector's address is validated; it holds no quote characters.
  const container = time.locator(
    `xpath=ancestor-or-self::*[parent::*[descendant::a[@href="${href}"]]][1]`,
  );
  let locationClass: UnlinkedTime['locationClass'] = 'not-evaluated';
  if (outsideFocalRow === false) locationClass = 'focal-row';
  else if ((await container.count()) === 1) {
    guard();
    locationClass =
      (await container
        .locator('xpath=descendant-or-self::a[contains(@href,"/c/")]')
        .count()) > 0
        ? 'sibling-with-permalink'
        : (await container
              .locator('xpath=descendant-or-self::time')
              .count()) !== 1
          ? 'sibling-with-several-times'
          : (await container
                .locator('xpath=descendant-or-self::img')
                .count()) === 0
            ? 'sibling-without-image'
            : 'image-sibling';
  }
  const raw = await time.getAttribute('datetime', { timeout: 150 });
  const milliseconds = raw ? Date.parse(raw) : Number.NaN;
  let datetimeEqualsCaption: boolean | null = null;
  let notComparable: UnlinkedTime['notComparable'];
  if (!captionTime) notComparable = 'caption-absent';
  else if ('reason' in captionTime) notComparable = captionTime.reason;
  else if (!Number.isFinite(milliseconds))
    notComparable = 'datetime-unreadable';
  else
    datetimeEqualsCaption =
      Math.floor(milliseconds / 1000) === captionTime.seconds;
  return {
    evaluated: true,
    locationClass,
    ancestorLink,
    outsideFocalRow,
    outsidePermalinks: ancestorLink !== 'permalink',
    datetimeEqualsCaption,
    ...(notComparable ? { notComparable } : {}),
    admitted:
      locationClass === 'image-sibling' &&
      ancestorLink === 'none' &&
      outsideFocalRow === true &&
      datetimeEqualsCaption === true,
  };
}
/**
 * Times inside the isolated sole comment. Besides the focal permalink's own
 * time, one time admits only inside a link that is exactly this post's
 * address (REPLY-SOLE-1 B), or as the one unlinked time that REPLY-SOLE-2 B
 * accepts as the caption's time. Any other unlinked or other-linked time
 * refuses.
 */
async function focalTimeShape(
  root: Locator,
  focal: Locator,
  depth: number,
  focalSelector: string,
  captionTime: SoleCaptionTime | undefined,
  guard: () => void,
) {
  const href = focalSelector.slice('a[href="'.length, -2);
  const postHref = href.slice(0, href.indexOf('/c/') + 1);
  const times = root.locator('time[datetime]');
  const total = await times.count();
  const kinds = {
    observed: true,
    capped: total > 32,
    inFocalPermalink: 0,
    inOtherCommentPermalink: 0,
    inPostPermalink: 0,
    inSamePostPermalink: 0,
    unlinked: 0,
  };
  let unlinkedIndex = -1;
  for (let index = 0; index < Math.min(total, 32); index++) {
    guard();
    const link = times.nth(index).locator('xpath=ancestor::a[1]');
    if ((await link.count()) === 0) {
      kinds.unlinked++;
      unlinkedIndex = index;
    } else if ((await link.and(root.locator(focalSelector)).count()) === 1)
      kinds.inFocalPermalink++;
    else {
      const value = await link.getAttribute('href', { timeout: 150 });
      if (value?.includes('/c/')) kinds.inOtherCommentPermalink++;
      else if (value && /^\/(?:p|reel)\/[^/]+\/$/u.test(value)) {
        kinds.inPostPermalink++;
        if (value === postHref) kinds.inSamePostPermalink++;
      } else {
        kinds.unlinked++;
        unlinkedIndex = index;
      }
    }
  }
  const unlinkedTime =
    kinds.unlinked === 0
      ? unlinkedNotEvaluated('no-unlinked-time')
      : kinds.unlinked > 1 || kinds.capped
        ? unlinkedNotEvaluated('several-unlinked-times')
        : await unlinkedTimeShape(
            times.nth(unlinkedIndex),
            focal,
            depth,
            href,
            captionTime,
            guard,
          );
  const focalOnly =
    !kinds.capped &&
    kinds.inFocalPermalink === 1 &&
    kinds.inOtherCommentPermalink === 0;
  const admitted =
    (focalOnly &&
      kinds.unlinked === 0 &&
      kinds.inPostPermalink === kinds.inSamePostPermalink &&
      kinds.inSamePostPermalink <= 1 &&
      total === 1 + kinds.inSamePostPermalink) ||
    (focalOnly &&
      kinds.unlinked === 1 &&
      kinds.inPostPermalink === 0 &&
      total === 2 &&
      unlinkedTime.admitted);
  return { total, kinds, unlinkedTime, admitted };
}
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
  soleAnswer: () => SoleAnswerVerdict = () => false,
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
    const rows = root.locator(REPLY_ROWS);
    const rowCount = await rows.count();
    const focalCount = await root.locator(focalSelector).count();
    const other =
      (await root.locator('a[href*="/c/"]').count()) -
      (await rows.locator('a[href*="/c/"]').count());
    if (zeroAnswer && (focalCount !== 1 || other !== 1)) {
      let boundary: Awaited<ReturnType<typeof zeroBoundary>>;
      try {
        boundary = await zeroBoundary(root, focalSelector);
      } catch {
        guard();
        return null;
      }
      guard();
      shape.levels.push({
        depth,
        childrenCapped: boundary.total > 32,
        children: boundary.children,
        zeroBoundary: {
          observed: boundary.observed,
          overBound: boundary.overBound,
          totalChildren: boundary.total,
          inspectedElements: boundary.elements,
          focalChildren: boundary.focalChildren,
          focalOtherPermalinks: boundary.focalOtherPermalinks,
          foreignChildren: boundary.foreignChildren,
          directAnchors: boundary.directAnchors,
        },
      });
      if (!(
        boundary.observed &&
        !boundary.overBound &&
        focalCount === 1 &&
        boundary.focalChildren === 1 &&
        boundary.focalOtherPermalinks === 0 &&
        boundary.foreignChildren > 0 &&
        boundary.directAnchors === 0 &&
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
    const controls = replyControls(root);
    const rowControls = replyControls(rows);
    const count = (await controls.count()) - (await rowControls.count());
    if (focalCount !== 1 || other !== 1) {
      // An exact admitted zero answer needs no surrounding reply wrapper. The
      // deepest isolated focal item is bounded by this first comment-list edge;
      // sibling comments' controls are never part of that item or clicked.
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
      // A reply control or row at the focal comment: never a zero here.
      if (zeroAnswer) shape.zeroDecision = 'read-normally';
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
  const verdict = soleAnswer();
  const answerAccepted =
    typeof verdict === 'boolean' ? verdict : verdict.accepted;
  const captionTime =
    typeof verdict === 'boolean' ? undefined : verdict.captionTime;
  const sole = shape.soleComment;
  let actionCounts: Awaited<ReturnType<typeof focalReplyActions>> | undefined;
  let soleTimesAdmitted = false;
  if (sole) {
    guard();
    try {
      const main = focal.locator('xpath=ancestor::main');
      sole.pageMainCount = await main.count();
      sole.pageFocalPermalinks = await main.locator(focalSelector).count();
      sole.pagePermalinks = await main.locator('a[href*="/c/"]').count();
      const postPrefix =
        focalSelector.slice(0, focalSelector.indexOf('/c/')) + '/c/';
      sole.pageSamePostPermalinks = await main
        .locator(postPrefix.replace('a[href="', 'a[href^="') + '"]')
        .count();
      sole.pageExpandControls = await replyControls(main).count();
      sole.pageReplyCounters = await replyCounters(main).count();
      actionCounts = await focalReplyActions(main, focalSelector, guard);
      sole.pageReplyControls = actionCounts.total;
      sole.pageOwnReplyControls = actionCounts.own;
      sole.pageForeignReplyControls = actionCounts.foreign;
      sole.pageRows = await main.locator(REPLY_ROWS).count();
      sole.focalPresent = Boolean(isolated);
      if (isolated) {
        sole.focalPermalinks = await isolated.root
          .locator('a[href*="/c/"]')
          .count();
        const times = await focalTimeShape(
          isolated.root,
          focal,
          isolated.depth,
          focalSelector,
          captionTime,
          guard,
        );
        sole.focalTimes = times.total;
        sole.focalTimeKinds = times.kinds;
        sole.unlinkedTime = times.unlinkedTime;
        soleTimesAdmitted = times.admitted;
        sole.focalRows = await isolated.root.locator(REPLY_ROWS).count();
        sole.focalControls = await replyControls(isolated.root).count();
      }
      sole.replyControlDecision =
        sole.pageExpandControls !== 0 ||
        sole.pageReplyCounters !== 0 ||
        sole.pageRows !== 0 ||
        (sole.focalControls !== null && sole.focalControls !== 0) ||
        (sole.focalRows !== null && sole.focalRows !== 0)
          ? 'read-normally'
          : 'absent';
      if (sole.replyControlDecision === 'read-normally')
        shape.zeroDecision = 'read-normally';
      if (sole.firstFailedGate === 'none') {
        sole.firstFailedGate =
          sole.pageMainCount !== 1
            ? 'sole-page-main'
            : sole.pageFocalPermalinks !== 1 || sole.pagePermalinks !== 1
              ? 'sole-page-permalinks'
              : sole.pageExpandControls !== 0 ||
                  sole.pageReplyCounters !== 0 ||
                  sole.pageReplyControls !== sole.pageOwnReplyControls ||
                  sole.pageForeignReplyControls !== 0
                ? 'sole-page-controls'
                : sole.pageRows !== 0
                  ? 'sole-page-rows'
                  : !isolated ||
                      sole.focalPermalinks !== 1 ||
                      !soleTimesAdmitted ||
                      sole.focalControls !== 0 ||
                      sole.focalRows !== 0
                    ? 'sole-focal'
                    : 'none';
      }
      sole.observed = true;
    } catch {
      sole.observationFailed = true;
      if (sole.firstFailedGate === 'none')
        sole.firstFailedGate = 'sole-observation';
      guard();
    }
  }
  if (zeroAnswer && isolated && answerAccepted) {
    guard();
    const main = focal.locator('xpath=ancestor::main');
    actionCounts ??= await focalReplyActions(main, focalSelector, guard);
    if (
      (await main.count()) === 1 &&
      (await main.locator(focalSelector).count()) === 1 &&
      (await main.locator('a[href*="/c/"]').count()) === 1 &&
      (await replyControls(main).count()) === 0 &&
      (await replyCounters(main).count()) === 0 &&
      actionCounts.total === actionCounts.own &&
      actionCounts.foreign === 0 &&
      (await main.locator(REPLY_ROWS).count()) === 0 &&
      (await isolated.root.locator('a[href*="/c/"]').count()) === 1 &&
      (
        await focalTimeShape(
          isolated.root,
          focal,
          isolated.depth,
          focalSelector,
          captionTime,
          guard,
        )
      ).admitted &&
      (await replyControls(isolated.root).count()) === 0 &&
      (await isolated.root.locator(REPLY_ROWS).count()) === 0
    ) {
      shape.scopeKind = 'sole-comment';
      shape.zeroDecision = 'sole-zero';
      shape.avatarObserved = isolated.avatar;
      return choose(isolated.root, isolated.depth);
    }
  }
  if (shape.levels.length >= REPLY_SCOPE_DEPTH || !emptyScope) return null;
  // A visible reply counter that is not a button cannot be read here, and a
  // zero is never written over it.
  if (zeroAnswer && (await replyCounters(emptyScope.root).count()) > 0) {
    shape.zeroDecision = 'read-normally';
    return null;
  }
  shape.levels = shape.levels.slice(0, emptyScope.depth);
  shape.avatarObserved = emptyScope.avatar;
  return choose(emptyScope.root, emptyScope.depth);
}
