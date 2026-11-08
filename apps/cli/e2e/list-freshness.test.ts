import { expect, test } from 'vitest';
import { chromium } from 'playwright-core';
import { fakeInstagram } from './fake-instagram/server.ts';
import { instagramFixture } from './fake-instagram/fixture.ts';
import {
  loadList,
  productionContext,
} from '../src/browser/instagram/driver.ts';
import type { RowReadCounts } from '../src/browser/instagram/selectors.ts';
import { listFreshness } from '../src/browser/instagram/list-freshness.ts';
import { CONTEXT_PORTS } from './fake-instagram/ports.ts';
import { FilteredListTimeout } from '../src/browser/instagram/retry.ts';
import { listRegions } from '../src/browser/instagram/list-regions.ts';
import { commentLikes } from '../src/browser/instagram/likes.ts';
import { IG_FIXTURE } from './fake-instagram/fixture.ts';
import { listRowDiagnostic } from '../src/browser/instagram/list-diagnostic.ts';
import {
  historicalListPage,
  historicalListRows,
} from './fake-instagram/list-reader-20261023.ts';
import { readRows, rowCandidate } from '../src/browser/instagram/selectors.ts';
import { listNavigationPage } from './fake-instagram/list-navigation-pages.ts';
import { listNavigation } from '../src/browser/instagram/list-navigation.ts';
import {
  commentReplies,
  emptyReplyScope,
} from '../src/browser/instagram/replies.ts';
import { structuralReplyScope } from '../src/browser/instagram/replies-scope.ts';
import { inspectSoleCommentAnswer } from '../src/browser/instagram/sole-comment-answer.ts';
import type {
  ReplyControlsDiagnostic,
  ReplyScopeDiagnostic,
} from '../src/browser/instagram/report.ts';
import { ContextStepReportSchema } from '../src/browser/instagram/report.ts';
import { deepReplyRows } from './fake-instagram/replies-page.ts';
import { SOLE_CAPTION_TIME } from './fake-instagram/realshape-page.ts';
import { contextPages } from '../src/browser/instagram/pages.ts';

test.each(['caption-time', 'unlinked-time', 'second-comment-time'] as const)(
  'T2 REPLY-SOLE-1 B sole caption object with %s: only a same-post linked time admits the zero',
  async (kind) => {
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    try {
      const page = await browser.newPage();
      const focal = {
        id: '123',
        username: 'generated',
        text: 'Generated focal',
        createdAt: '2025-01-01T00:00:00.000Z',
      };
      const selector = 'a[href="/p/Generated/c/123/"]';
      const second =
        kind === 'caption-time'
          ? '<a href="/p/Generated/"><time datetime="2024-12-31T00:00:00Z">Generated caption date</time></a>'
          : kind === 'unlinked-time'
            ? '<time datetime="2025-01-02T00:00:00Z">Generated edited marker</time>'
            : '<a href="/p/Generated/c/456/"><time datetime="2025-01-02T00:00:00Z">Generated second comment</time></a>';
      await page.setContent(
        `<main><div><div><a href="/p/Generated/c/123/"><time datetime="${focal.createdAt}">Generated focal date</time></a></div>${second}</div></main>`,
      );
      const answer = inspectSoleCommentAnswer(
        [],
        [
          {
            code: 'Generated',
            comment_count: 1,
            caption: {
              pk: '789',
              user: { username: 'owner' },
              text: 'Generated caption',
              created_at: 1735603200,
            },
            comments: [
              {
                pk: focal.id,
                user: { username: focal.username },
                text: focal.text,
                created_at: Date.parse(focal.createdAt) / 1000,
                child_comment_count: 0,
              },
            ],
          },
        ],
        focal,
        'Generated',
      );
      const shape = emptyReplyScope();
      const scope = await structuralReplyScope(
        page.locator(selector),
        selector,
        true,
        shape,
        () => {},
        () => {
          shape.soleComment = answer.diagnostic;
          return answer.accepted;
        },
      );
      // The caption object is excluded from the answer set in every case; the
      // page's second time decides.
      expect(answer.accepted).toBe(true);
      expect(answer.diagnostic).toMatchObject({
        childCountProofClass: 'zero',
        answerCommentSetSize: 1,
        captionEntriesExcluded: 1,
        answerSetValid: true,
        answerExtraEntries: {
          captionObjects: 0,
          otherParentReferences: 0,
          focalChildReferences: 0,
          unresolvedObjects: 0,
        },
      });
      if (kind === 'caption-time') {
        expect(scope).not.toBeNull();
        expect(shape).toMatchObject({
          scopeKind: 'sole-comment',
          zeroDecision: 'sole-zero',
        });
      } else {
        expect(scope).toBeNull();
        expect(shape.zeroDecision).toBeUndefined();
      }
      // A second comment permalink is refused by the zero boundary before the
      // sole-comment gate is evaluated, as before.
      expect(shape.soleComment?.firstFailedGate).toBe(
        kind === 'caption-time'
          ? 'none'
          : kind === 'unlinked-time'
            ? 'sole-focal'
            : undefined,
      );
      if (kind !== 'second-comment-time')
        expect(shape.soleComment).toMatchObject({
          focalTimes: 2,
          pagePermalinks: 1,
          replyControlDecision: 'absent',
          focalTimeKinds: {
            observed: true,
            inFocalPermalink: 1,
            inOtherCommentPermalink: 0,
            inPostPermalink: kind === 'caption-time' ? 1 : 0,
            inSamePostPermalink: kind === 'caption-time' ? 1 : 0,
            unlinked: kind === 'unlinked-time' ? 1 : 0,
          },
        });
      const noCaption = inspectSoleCommentAnswer(
        [],
        [
          {
            pk: focal.id,
            user: { username: focal.username },
            text: focal.text,
            created_at: Date.parse(focal.createdAt) / 1000,
            child_comment_count: 0,
          },
        ],
        focal,
        'Generated',
      );
      const other = emptyReplyScope();
      const otherScope = await structuralReplyScope(
        page.locator(selector),
        selector,
        true,
        other,
        () => {},
        () => {
          other.soleComment = noCaption.diagnostic;
          return noCaption.accepted;
        },
      );
      if (kind === 'caption-time') expect(otherScope).not.toBeNull();
      else expect(otherScope).toBeNull();
      if (kind === 'unlinked-time')
        expect(other.soleComment?.firstFailedGate).toBe('sole-focal');
    } finally {
      await browser.close();
    }
  },
);
test.each([
  'caption',
  'profile-link',
  'post-path-link',
  'unreadable',
  'two-unlinked',
  'boolean-verdict',
  'ambiguous-caption',
] as const)(
  'REPLY-SOLE-2 B unlinked time in an image sibling, %s: only an unlinked time equal to one caption time admits',
  async (kind) => {
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    try {
      const page = await browser.newPage();
      const focal = {
        id: '123',
        username: 'generated',
        text: 'Generated focal',
        createdAt: '2025-01-01T00:00:00.000Z',
      };
      const selector = 'a[href="/p/Generated/c/123/"]';
      const caption = '2024-12-31T00:00:00.000Z';
      const time =
        kind === 'profile-link'
          ? `<a href="/generated_owner/"><time datetime="${caption}">2w</time></a>`
          : kind === 'post-path-link'
            ? `<a href="/generated_owner/p/Generated/"><time datetime="${caption}">2w</time></a>`
            : kind === 'unreadable'
              ? '<span><time datetime="Generated unreadable">2w</time></span>'
              : kind === 'two-unlinked'
                ? `<span><time datetime="${caption}">2w</time></span><span><time datetime="${caption}">2w</time></span>`
                : `<span><time datetime="${caption}">2w</time></span>`;
      await page.setContent(
        `<main><div><div><img src="/generated-owner.png" alt=""><span>Generated caption</span>${time}</div><div></div><div><img src="/generated-avatar.png" alt=""><a href="/p/Generated/c/123/"><time datetime="${focal.createdAt}">1w</time></a></div></div></main>`,
      );
      const seconds = Date.parse(caption) / 1000;
      const captionObject = {
        pk: '789',
        user: { username: 'generated_owner' },
        text: 'Generated caption',
        created_at: seconds,
      };
      const answer = inspectSoleCommentAnswer(
        [],
        [
          {
            code: 'Generated',
            caption: captionObject,
            comments: [
              {
                pk: focal.id,
                user: { username: focal.username },
                text: focal.text,
                created_at: Date.parse(focal.createdAt) / 1000,
                child_comment_count: 0,
              },
            ],
          },
          ...(kind === 'ambiguous-caption'
            ? [
                {
                  code: 'Generated',
                  caption: { ...captionObject, created_at: seconds + 1 },
                },
              ]
            : []),
        ],
        focal,
        'Generated',
      );
      expect(answer.accepted).toBe(true);
      expect(answer.captionTime).toEqual(
        kind === 'ambiguous-caption'
          ? { reason: 'caption-ambiguous' }
          : { seconds },
      );
      const shape = emptyReplyScope();
      const scope = await structuralReplyScope(
        page.locator(selector),
        selector,
        true,
        shape,
        () => {},
        () => {
          shape.soleComment = answer.diagnostic;
          return kind === 'boolean-verdict'
            ? answer.accepted
            : { accepted: answer.accepted, captionTime: answer.captionTime };
        },
      );
      const sole = ContextStepReportSchema.parse({ replyScope: shape })
        .replyScope!.soleComment!;
      if (kind === 'caption') {
        expect(scope).not.toBeNull();
        expect(shape).toMatchObject({
          scopeKind: 'sole-comment',
          zeroDecision: 'sole-zero',
        });
        expect(sole.firstFailedGate).toBe('none');
      } else {
        expect(scope).toBeNull();
        expect(shape.zeroDecision).toBeUndefined();
        expect(sole.firstFailedGate).toBe('sole-focal');
      }
      expect(sole.unlinkedTime).toEqual(
        kind === 'two-unlinked'
          ? {
              evaluated: false,
              locationClass: 'not-evaluated',
              ancestorLink: 'not-evaluated',
              outsideFocalRow: null,
              outsidePermalinks: null,
              datetimeEqualsCaption: null,
              notComparable: 'several-unlinked-times',
              admitted: false,
            }
          : {
              evaluated: true,
              locationClass: 'image-sibling',
              ancestorLink:
                kind === 'profile-link'
                  ? 'other'
                  : kind === 'post-path-link'
                    ? 'permalink'
                    : 'none',
              outsideFocalRow: true,
              outsidePermalinks: kind !== 'post-path-link',
              datetimeEqualsCaption: [
                'unreadable',
                'boolean-verdict',
                'ambiguous-caption',
              ].includes(kind)
                ? null
                : true,
              ...(kind === 'unreadable'
                ? { notComparable: 'datetime-unreadable' }
                : kind === 'boolean-verdict'
                  ? { notComparable: 'caption-absent' }
                  : kind === 'ambiguous-caption'
                    ? { notComparable: 'caption-ambiguous' }
                    : {}),
              admitted: kind === 'caption',
            },
      );
      expect(JSON.stringify(sole)).not.toContain('2024-12-31');
      expect(JSON.stringify(sole)).not.toContain(String(seconds));
    } finally {
      await browser.close();
    }
  },
);
test('PLACEMENT background pages retain one window identity and a closed three-page ceiling', async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromium.executablePath(),
  });
  const context = await browser.newContext();
  await context.newPage();
  const boundary = contextPages(context, () => {});
  try {
    await boundary.startupPage();
    const first = await boundary.newPage();
    const next = await boundary.replace(first);
    expect(first.isClosed()).toBe(true);
    expect(next.isClosed()).toBe(false);
    expect(boundary.snapshot()).toMatchObject({
      pageLimit: 3,
      ownedOpen: 2,
      ownedPeak: 3,
      backgroundCreated: 3,
      replaced: 1,
    });
    await boundary.newPage();
    await expect(boundary.newPage()).rejects.toMatchObject({
      token: 'unexpected-page',
    });
    expect(boundary.snapshot().ownedPeak).toBe(3);
  } finally {
    boundary.dispose();
    await browser.close();
  }
});
test('T1 another inherited window is never closed when same-window creation refuses', async () => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  const context = await browser.newContext();
  const first = await context.newPage();
  const client = await context.newCDPSession(first);
  const info = await client.send('Target.getTargetInfo');
  const opened = context.waitForEvent('page');
  const created = await client.send('Target.createTarget', {
    url: 'about:blank',
    newWindow: true,
    background: true,
    browserContextId: info.targetInfo.browserContextId,
  });
  await opened;
  const foreign = await (async () => {
    for (const page of context.pages()) {
      const session = await context.newCDPSession(page);
      const value = await session.send('Target.getTargetInfo');
      await session.detach();
      if (value.targetInfo.targetId === created.targetId) return page;
    }
    throw new Error('Generated foreign window missing');
  })();
  const runWindow = (await client.send('Browser.getWindowForTarget')).windowId;
  const foreignSession = await context.newCDPSession(foreign);
  expect(
    (await foreignSession.send('Browser.getWindowForTarget')).windowId,
  ).not.toBe(runWindow);
  const boundary = contextPages(context, () => {});
  try {
    await expect(boundary.startupPage()).rejects.toMatchObject({
      token: 'unexpected-page',
    });
    expect(first.isClosed()).toBe(false);
    expect(foreign.isClosed()).toBe(false);
    expect(boundary.snapshot()).toMatchObject({
      startupClosed: 0,
      remainingNonOwned: null,
    });
  } finally {
    boundary.dispose();
    await foreignSession.detach();
    await client.detach();
    await browser.close();
  }
});

test.each([
  'script',
  'script-raw',
  'script-empty-list',
  'network',
  'count-one',
  'own-reply',
  'own-foreign',
  'own-expand',
  'own-time',
  'other-answer',
  'count-two',
  'control',
  'permalink',
  'reply',
  'positive',
  'mismatch',
  'missing',
] as const)(
  'SOLESCOPE sole rendered comment %s requires zero answer and sole post evidence',
  async (mode) => {
    const fixture = await instagramFixture(1),
      fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
    fake.replies(0);
    fake.replyAnswer(true);
    fake.replyShape(
      mode === 'control'
        ? 'sole-zero-control'
        : mode === 'permalink'
          ? 'sole-zero-permalink'
          : mode === 'reply'
            ? 'sole-zero-reply'
            : mode === 'own-reply'
              ? 'sole-zero-own-reply'
              : mode === 'own-foreign'
                ? 'sole-zero-own-foreign'
                : mode === 'own-expand'
                  ? 'sole-zero-own-expand'
                  : mode === 'own-time'
                    ? 'sole-zero-own-time'
                    : 'sole-zero',
    );
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    try {
      const page = await browser.newPage(),
        item = fixture.items[0]!;
      const response = page.waitForResponse((response) =>
        response.url().includes('/data/'),
      );
      await page.goto(fake.origin + '/p/' + IG_FIXTURE.code + '/');
      const network = (await (await response).json()) as unknown;
      const focal = {
        pk: IG_FIXTURE.commentId,
        user: { username: item.account.handle! },
        text: mode === 'mismatch' ? 'Generated wrong text' : item.text,
        created_at: Date.parse(item.createdAt) / 1000,
        child_comment_count: mode === 'positive' ? 1 : 0,
      };
      const script = [
        {
          code: IG_FIXTURE.code,
          ...(mode === 'count-one'
            ? { comment_count: 1 }
            : mode === 'count-two'
              ? { comment_count: 2 }
              : {}),
          comments: [
            focal,
            ...(mode === 'other-answer'
              ? [{ ...focal, pk: '888777', text: 'Generated other comment' }]
              : []),
          ],
        },
      ];
      let scope: unknown, expansion: unknown;
      const reading = commentReplies(
        page,
        mode === 'network' ? [network] : [],
        {
          id: IG_FIXTURE.commentId,
          createdAt: item.createdAt,
          username: item.account.handle!,
          text: item.text,
        },
        () => {},
        performance.now() + 15000,
        async () => {},
        0,
        undefined,
        undefined,
        (value) => {
          scope = value;
        },
        undefined,
        undefined,
        undefined,
        () =>
          mode === 'script-raw'
            ? [focal]
            : mode === 'script-empty-list'
              ? [
                  {
                    pk: focal.pk,
                    user: focal.user,
                    text: focal.text,
                    created_at: focal.created_at,
                    child_comments: [],
                  },
                ]
              : mode === 'missing'
                ? []
                : mode === 'network'
                  ? []
                  : script,
        undefined,
        (value) => {
          expansion = value;
        },
      );
      if (
        [
          'script',
          'script-raw',
          'script-empty-list',
          'network',
          'count-one',
          'own-reply',
        ].includes(mode)
      ) {
        expect(await reading).toMatchObject({
          entries: [],
          moreCount: 0,
          capped: false,
        });
        expect(scope).toMatchObject({
          failedCheck: 'none',
          scopeKind: 'sole-comment',
          focalCount: 1,
          focalTimeExact: true,
        });
        expect(
          ContextStepReportSchema.parse({ replyScope: scope }).replyScope
            ?.scopeKind,
        ).toBe('sole-comment');
      } else
        await expect(reading).rejects.toMatchObject({
          reason: 'reply-scope-unverified',
        });
      expect(
        ContextStepReportSchema.parse({ replyExpansion: expansion })
          .replyExpansion?.clicks,
      ).toEqual([]);
      const sole = ContextStepReportSchema.parse({ replyScope: scope })
        .replyScope?.soleComment;
      expect(sole).toMatchObject({
        observed: true,
        observationFailed: false,
        answerNamesFocal: mode !== 'mismatch' && mode !== 'missing',
        declaredCountSeen: mode === 'count-one' || mode === 'count-two' ? 1 : 0,
        declaredCountsAllOne:
          mode === 'count-two' ? false : mode === 'count-one' ? true : null,
        pagePermalinks: mode === 'permalink' ? 2 : 1,
        firstFailedGate:
          mode === 'other-answer'
            ? 'sole-answer-set'
            : mode === 'count-two'
              ? 'sole-declared-count'
              : [
                    'control',
                    'reply',
                    'own-foreign',
                    'own-expand',
                    'own-time',
                  ].includes(mode)
                ? 'sole-page-controls'
                : mode === 'permalink'
                  ? 'sole-page-permalinks'
                  : mode === 'positive'
                    ? 'sole-child-proof'
                    : mode === 'missing' || mode === 'mismatch'
                      ? 'sole-answer-focal'
                      : 'none',
      });
      if (mode.startsWith('own-') || mode === 'reply')
        expect(sole).toMatchObject({
          pageReplyControls: mode === 'own-foreign' ? 2 : 1,
          pageOwnReplyControls: [
            'own-reply',
            'own-foreign',
            'own-expand',
          ].includes(mode)
            ? 1
            : 0,
          pageForeignReplyControls: ['own-reply', 'own-expand'].includes(mode)
            ? 0
            : 1,
        });
      if (
        [
          'script',
          'script-raw',
          'script-empty-list',
          'network',
          'count-one',
          'own-reply',
        ].includes(mode)
      )
        expect(sole).toMatchObject({
          answerCommentSetSize: 1,
          childCountProofClass: 'zero',
          pageReplyControls: mode === 'own-reply' ? 1 : 0,
          pageOwnReplyControls: mode === 'own-reply' ? 1 : 0,
          pageForeignReplyControls: 0,
          pageExpandControls: 0,
          focalPermalinks: 1,
          focalTimes: 1,
          focalRows: 0,
          focalControls: 0,
        });
      expect(
        await page.locator(`main a[href^="/p/${IG_FIXTURE.code}/c/"]`).count(),
      ).toBe(1);
      for (const value of [
        item.text,
        item.account.handle!,
        IG_FIXTURE.commentId,
      ])
        expect(JSON.stringify({ scope, expansion })).not.toContain(value);
    } finally {
      await browser.close();
      await fake.close();
    }
  },
);

test.each([
  'post-time',
  'unlinked-time',
  'other-post-time',
  'control',
  'counter',
  'counter-text',
  'inner-counter',
  'other-parent',
  'permalink',
] as const)(
  'REPLY-SOLE-1 B caption with %s settles a zero only without a reply control and with a same-post linked time',
  async (mode) => {
    const fixture = await instagramFixture(1),
      fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
    fake.replies(0);
    fake.replyAnswer(true);
    fake.replyShape(
      mode === 'post-time'
        ? 'sole-zero-post-time'
        : mode === 'unlinked-time'
          ? 'sole-zero-unlinked-time'
          : mode === 'other-post-time'
            ? 'sole-zero-other-post-time'
            : mode === 'control'
              ? 'sole-zero-control'
              : mode === 'counter'
                ? 'sole-zero-counter'
                : mode === 'counter-text'
                  ? 'sole-zero-counter-text'
                  : mode === 'inner-counter'
                    ? 'sole-zero-inner-counter'
                    : mode === 'permalink'
                      ? 'sole-zero-permalink'
                      : 'sole-zero',
    );
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    try {
      const page = await browser.newPage(),
        item = fixture.items[0]!;
      await page.goto(fake.origin + '/p/' + IG_FIXTURE.code + '/');
      const focal = {
        pk: IG_FIXTURE.commentId,
        user: { username: item.account.handle! },
        text: item.text,
        created_at: Date.parse(item.createdAt) / 1000,
        child_comment_count: 0,
      };
      const script = [
        {
          code: IG_FIXTURE.code,
          comment_count: 1,
          caption: {
            pk: '555444',
            user: { username: 'generated_owner' },
            text: 'Generated caption',
            created_at: Date.parse('2024-12-31T00:00:00Z') / 1000,
          },
          comments: [
            focal,
            ...(mode === 'other-parent'
              ? [
                  {
                    ...focal,
                    pk: '888777',
                    text: 'Generated other entry',
                    parent_comment_id: '999111',
                  },
                ]
              : []),
          ],
        },
      ];
      let scope: ReplyScopeDiagnostic | undefined;
      let expansion: unknown;
      const checked: boolean[] = [];
      const reading = commentReplies(
        page,
        [],
        {
          id: IG_FIXTURE.commentId,
          createdAt: item.createdAt,
          username: item.account.handle!,
          text: item.text,
        },
        () => {},
        performance.now() + 15000,
        async () => {},
        0,
        (answerChecked) => checked.push(answerChecked),
        undefined,
        (value) => {
          scope = value;
        },
        undefined,
        undefined,
        undefined,
        () => script,
        undefined,
        (value) => {
          expansion = value;
        },
      );
      const settled = await reading.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      const parsed = ContextStepReportSchema.parse({
        replyScope: scope,
      }).replyScope!;
      const sole = parsed.soleComment;
      if (mode === 'post-time') {
        expect(settled).toMatchObject({
          value: { entries: [], moreCount: 0, capped: false },
        });
        expect(checked).toContain(true);
        expect(parsed).toMatchObject({
          scopeKind: 'sole-comment',
          zeroDecision: 'sole-zero',
        });
        expect(sole).toMatchObject({
          captionEntriesExcluded: 1,
          answerCommentSetSize: 1,
          focalTimes: 2,
          focalTimeKinds: { inSamePostPermalink: 1, unlinked: 0 },
          replyControlDecision: 'absent',
          firstFailedGate: 'none',
        });
      } else if (mode === 'inner-counter') {
        // The focal comment's own counter: the scope goes to the normal
        // reading path, whose own control check decides; this generated
        // counter is not a valid expand control there, so that path stops
        // before any click. No zero is written.
        expect(settled).toMatchObject({
          error: { reason: 'reply-controls-changed' },
        });
        expect(checked).not.toContain(true);
        expect(parsed.zeroDecision).toBe('read-normally');
        expect(parsed.scopeKind).not.toBe('sole-comment');
        expect(parsed.soleComment).toBeUndefined();
        expect(
          ContextStepReportSchema.parse({ replyExpansion: expansion })
            .replyExpansion,
        ).toBeDefined();
      } else {
        // No zero is written: the step refuses the scope or reads normally.
        expect(settled).toMatchObject({
          error: { reason: 'reply-scope-unverified' },
        });
        expect(checked).not.toContain(true);
        expect(parsed.scopeKind).not.toBe('sole-comment');
        expect(sole?.firstFailedGate).toBe(
          mode === 'unlinked-time' || mode === 'other-post-time'
            ? 'sole-focal'
            : mode === 'other-parent'
              ? 'sole-answer-set'
              : mode === 'permalink'
                ? 'sole-page-permalinks'
                : 'sole-page-controls',
        );
        if (['control', 'counter', 'counter-text'].includes(mode))
          expect(
            parsed.zeroDecision === 'read-normally' &&
              sole?.replyControlDecision === 'read-normally',
          ).toBe(true);
        if (mode === 'counter-text') {
          expect(sole?.pageExpandControls).toBe(0);
          expect(sole?.pageReplyCounters).toBeGreaterThan(0);
        }
      }
      for (const value of [
        item.text,
        item.account.handle!,
        IG_FIXTURE.commentId,
      ])
        expect(JSON.stringify(parsed)).not.toContain(value);
    } finally {
      await browser.close();
      await fake.close();
    }
  },
);

test.each([
  'caption-time',
  'mismatch',
  'no-caption-object',
  'in-row',
  'other-comment',
  'control',
] as const)(
  'REPLY-SOLE-2 B unlinked time beside the sole comment, %s: a zero only when it equals the caption time outside the focal row',
  async (mode) => {
    const fixture = await instagramFixture(1),
      fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
    fake.replies(0);
    fake.replyAnswer(true);
    fake.replyShape(
      mode === 'mismatch'
        ? 'sole-zero-caption-time-mismatch'
        : mode === 'in-row'
          ? 'sole-zero-caption-time-in-row'
          : mode === 'other-comment'
            ? 'sole-zero-caption-time-other-comment'
            : mode === 'control'
              ? 'sole-zero-caption-time-control'
              : 'sole-zero-caption-time',
    );
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    try {
      const page = await browser.newPage(),
        item = fixture.items[0]!;
      await page.goto(fake.origin + '/p/' + IG_FIXTURE.code + '/');
      const focal = {
        pk: IG_FIXTURE.commentId,
        user: { username: item.account.handle! },
        text: item.text,
        created_at: Date.parse(item.createdAt) / 1000,
        child_comment_count: 0,
      };
      const captionSeconds = Date.parse(SOLE_CAPTION_TIME) / 1000;
      const script = [
        {
          code: IG_FIXTURE.code,
          comment_count: 1,
          ...(mode === 'no-caption-object'
            ? {}
            : {
                caption: {
                  pk: '555444',
                  user: { username: 'generated_owner' },
                  text: 'Generated caption',
                  created_at: captionSeconds,
                  created_at_utc: captionSeconds,
                },
              }),
          comments: [focal],
        },
      ];
      let scope: ReplyScopeDiagnostic | undefined;
      const checked: boolean[] = [];
      const settled = await commentReplies(
        page,
        [],
        {
          id: IG_FIXTURE.commentId,
          createdAt: item.createdAt,
          username: item.account.handle!,
          text: item.text,
        },
        () => {},
        performance.now() + 15000,
        async () => {},
        0,
        (answerChecked) => checked.push(answerChecked),
        undefined,
        (value) => {
          scope = value;
        },
        undefined,
        undefined,
        undefined,
        () => script,
      ).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      const parsed = ContextStepReportSchema.parse({
        replyScope: scope,
      }).replyScope!;
      const sole = parsed.soleComment!;
      // The generated page keeps the real shape's counts: one permalink, the
      // own Reply action removed, no counters or rows, two focal times with
      // one unlinked, and three children at scope level 12.
      expect(sole).toMatchObject({
        pagePermalinks: 1,
        pageFocalPermalinks: 1,
        pageForeignReplyControls: 0,
        pageExpandControls: mode === 'control' ? 1 : 0,
        pageReplyCounters: mode === 'control' ? 1 : 0,
        pageRows: 0,
        captionEntriesExcluded: mode === 'no-caption-object' ? 0 : 1,
        answerSetValid: true,
        childCountProofClass: 'zero',
        focalTimes: 2,
        focalTimeKinds: {
          inFocalPermalink: 1,
          inSamePostPermalink: 0,
          inPostPermalink: 0,
          inOtherCommentPermalink: 0,
          unlinked: 1,
        },
      });
      expect(parsed.levels.at(-1)).toMatchObject({
        depth: 12,
        children: [
          {
            containsFocal: false,
            otherPermalinks: 0,
            times: mode === 'in-row' ? 0 : 1,
            expandControls: 0,
            images: 1,
          },
          {
            containsFocal: false,
            otherPermalinks: 0,
            times: 0,
            expandControls: 0,
            images: 0,
          },
          {
            containsFocal: true,
            otherPermalinks: 0,
            times: mode === 'in-row' ? 2 : 1,
            expandControls: 0,
            images: 1,
          },
        ],
      });
      expect(sole.unlinkedTime).toEqual({
        evaluated: true,
        locationClass: mode === 'in-row' ? 'focal-row' : 'image-sibling',
        ancestorLink: 'none',
        outsideFocalRow: mode !== 'in-row',
        outsidePermalinks: true,
        datetimeEqualsCaption:
          mode === 'no-caption-object'
            ? null
            : mode !== 'mismatch' && mode !== 'other-comment',
        ...(mode === 'no-caption-object'
          ? { notComparable: 'caption-absent' }
          : {}),
        admitted: mode === 'caption-time' || mode === 'control',
      });
      if (mode === 'caption-time') {
        expect(settled).toMatchObject({
          value: { entries: [], moreCount: 0, capped: false },
        });
        expect(checked).toContain(true);
        expect(parsed).toMatchObject({
          scopeKind: 'sole-comment',
          zeroDecision: 'sole-zero',
        });
        expect(sole).toMatchObject({
          replyControlDecision: 'absent',
          firstFailedGate: 'none',
        });
      } else {
        expect(settled).toMatchObject({
          error: { reason: 'reply-scope-unverified' },
        });
        expect(checked).not.toContain(true);
        expect(parsed.scopeKind).not.toBe('sole-comment');
        expect(parsed.zeroDecision).toBe(
          mode === 'control' ? 'read-normally' : undefined,
        );
        expect(sole).toMatchObject({
          replyControlDecision: mode === 'control' ? 'read-normally' : 'absent',
          firstFailedGate:
            mode === 'control' ? 'sole-page-controls' : 'sole-focal',
        });
      }
      const report = JSON.stringify(parsed);
      for (const value of [
        item.text,
        item.account.handle!,
        IG_FIXTURE.commentId,
        '555444',
        SOLE_CAPTION_TIME,
        String(captionSeconds),
        '2024-12-31',
      ])
        expect(report).not.toContain(value);
    } finally {
      await browser.close();
      await fake.close();
    }
  },
);

test.each([
  'matching',
  'id',
  'time',
  'author',
  'text',
  'hidden-text',
  'conflict',
] as const)(
  'ROWANSWER deep row %s uses answer content only after DOM presence checks',
  async (variant) => {
    const fixture = await instagramFixture(1),
      fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
    fake.replies(5);
    fake.replyControl('View all 5 replies');
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    try {
      const page = await browser.newPage(),
        item = fixture.items[0]!;
      await page.route('**/p/**', async (route) => {
        const response = await route.fetch();
        let html = await response.text();
        const group =
          /<button onclick="this.nextElementSibling.hidden=false;this.remove\(\)">View all 5 replies<\/button><ul hidden>.*?<\/ul>/s;
        if (!group.test(html)) throw new Error('Generated expansion missing');
        let rows = deepReplyRows(
          5,
          IG_FIXTURE.code,
          item.createdAt,
          variant === 'hidden-text' || variant === 'conflict'
            ? 'matching'
            : variant,
        );
        if (variant === 'hidden-text')
          rows = rows.replace('<span dir="auto">', '<span hidden dir="auto">');
        const script = `const scope=this.parentElement;this.remove();setTimeout(()=>scope.insertAdjacentHTML('beforeend',${JSON.stringify(`<div><div><ul>${rows}</ul></div></div><div role="button">Hide all replies</div>`)}),600)`;
        html = html.replace(
          group,
          `<div role="button" onclick="${script.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">View all 5 replies</div>`,
        );
        await route.fulfill({ response, body: html });
      });
      const response = page.waitForResponse((response) =>
        response.url().includes('/data/'),
      );
      await page.goto(fake.origin + '/p/' + IG_FIXTURE.code + '/');
      const bodies = [await (await response).json()];
      if (variant === 'conflict')
        bodies.push({
          parent_comment_id: IG_FIXTURE.commentId,
          pk: '900000',
          user: { username: 'generated_conflicting' },
          text: 'Generated other source',
          created_at: Date.parse(item.createdAt) / 1000,
        });
      let report: unknown;
      const reading = commentReplies(
        page,
        bodies,
        {
          id: IG_FIXTURE.commentId,
          createdAt: item.createdAt,
          username: item.account.handle!,
          text: item.text,
        },
        () => {},
        performance.now() + 15000,
        async () => {},
        0,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        (value) => {
          report = value;
        },
      );
      if (variant === 'matching') {
        const result = await reading;
        expect(result).toMatchObject({
          capped: false,
          moreCount: 0,
          entries: Array.from({ length: 5 }, (_, index) => ({
            account: `generated_reply_${index}`,
            text: `Generated reply ${index} with local text`,
            createdAt: item.createdAt,
            likes:
              index === 1
                ? { count: null, source: null }
                : { count: index + 2, source: 'answer' },
          })),
        });
      } else if (variant === 'conflict')
        await expect(reading).rejects.toMatchObject({
          reason: 'reply-controls-changed',
        });
      else
        await expect(reading).rejects.toMatchObject({
          token: 'comment-structure',
        });
      const parsed = ContextStepReportSchema.parse({
        replyExpansion: report,
      }).replyExpansion!;
      if (variant === 'conflict') {
        expect(parsed.clicks).toEqual([]);
        expect(parsed.stopAt).toBe('controls');
        return;
      }
      expect(parsed.rows?.[0]).toMatchObject({
        directChildCount: 1,
        divBlocks: 1,
        authorLinks: 3,
        authorDistinctHrefs: 2,
        permalinks: 1,
        permalinkDepths: [9],
        times: 1,
        extraction: variant === 'matching' ? 'answer' : 'none',
        failedStep:
          variant === 'matching'
            ? 'none'
            : variant === 'hidden-text'
              ? 'answer-text'
              : `answer-${variant}`,
      });
      expect(parsed.rows?.[0]?.spansByDepth).toHaveLength(12);
      expect(parsed.rows?.[0]?.spansByDepth.slice(0, 4)).toEqual([0, 0, 0, 0]);
      for (const value of [
        item.text,
        item.account.handle!,
        'generated_reply_0',
        'Generated reply 0 with local text',
      ])
        expect(JSON.stringify(parsed)).not.toContain(value);
    } finally {
      await browser.close();
      await fake.close();
    }
  },
);

test.each([
  'shown',
  'missing',
  'wrapped',
  'wrapped-foreign',
  'wrapped-no-time',
  'wrapped-mismatch',
  'sibling-ul',
  'sibling-rows',
  'sibling-delayed',
  'sibling-foreign',
  'sibling-no-time',
  'sibling-mismatch',
  'ul-div',
  'ul-div-hide',
  'ul-div-foreign',
  'ul-div-no-time',
  'ul-div-mismatch',
  'ul-div-unknown',
  'ul-div-wrapper',
  'ul-div-preexisting',
  'ul-div-duplicate',
  'rowtext-adjacent',
  'rowtext-authors',
  'rowtext-texts',
  'rowtext-mismatch',
  'rowtext-control-incomplete',
  'rowtext-author-mismatch',
  'rowtext-embedded',
  'rowtext-hidden',
  'mismatch',
  'blocked',
] as const)(
  'POSTCLICK reply expansion %s records the actual click and scoped after-shape without relaxing answer agreement',
  async (mode) => {
    const fixture = await instagramFixture(1),
      fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
    fake.replies(5);
    fake.replyControl('View all 5 replies');
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    try {
      const page = await browser.newPage(),
        item = fixture.items[0]!;
      await page.route('**/p/**', async (route) => {
        const response = await route.fetch();
        let html = await response.text();
        const group =
          /<button onclick="this.nextElementSibling.hidden=false;this.remove\(\)">View all 5 replies<\/button><ul hidden>(.*?)<\/ul>/s.exec(
            html,
          );
        if (!group) throw new Error('Generated expansion group missing');
        let rows =
          mode === 'mismatch' ||
          mode === 'wrapped-mismatch' ||
          mode === 'sibling-mismatch' ||
          mode === 'ul-div-mismatch' ||
          mode === 'rowtext-mismatch'
            ? group[1]!.replace(
                'Generated reply 0 with local text',
                'Generated different reply',
              )
            : group[1]!;
        if (
          mode.startsWith('wrapped') ||
          mode.startsWith('sibling') ||
          mode.startsWith('ul-div') ||
          mode.startsWith('rowtext')
        ) {
          rows = rows.replace(
            '<span>1w</span>',
            `<a href="/p/${IG_FIXTURE.code}/c/900001/"><time datetime="${item.createdAt}">1w</time></a>`,
          );
          if (mode === 'wrapped-foreign')
            rows = rows.replaceAll(
              `/p/${IG_FIXTURE.code}/c/`,
              '/p/GeneratedForeign/c/',
            );
          if (mode === 'sibling-foreign' || mode === 'ul-div-foreign')
            rows = rows.replaceAll(
              `/p/${IG_FIXTURE.code}/c/`,
              '/p/GeneratedForeign/c/',
            );
          if (
            mode === 'wrapped-no-time' ||
            mode === 'sibling-no-time' ||
            mode === 'ul-div-no-time'
          )
            rows = rows.replace(/<time datetime="[^"]+">1w<\/time>/gu, '1w');
        }
        if (mode.startsWith('ul-div') || mode.startsWith('rowtext'))
          rows = rows.replaceAll('<li>', '<div>').replaceAll('</li>', '</div>');
        if (mode.startsWith('rowtext')) {
          rows = Array.from(
            { length: mode === 'rowtext-control-incomplete' ? 4 : 5 },
            (_, index) =>
              `<div><div><a href="/generated_reply_${index}/">generated_reply_${index}</a><span dir="auto">${mode === 'rowtext-mismatch' && index === 0 ? 'Generated different reply' : `Generated reply ${index} with local text`}</span><a href="/p/${IG_FIXTURE.code}/c/${900000 + index}/"><time datetime="${item.createdAt}">1w</time></a></div><div role="button">${index + 2} likes</div></div>`,
          ).join('');
          if (mode === 'rowtext-authors')
            rows = rows.replace(
              '</a><span dir="auto">',
              '</a><a href="/generated_extra/">generated_extra</a><span dir="auto">',
            );
          if (mode === 'rowtext-texts')
            rows = rows.replace(
              '</span><a href="/p/',
              '</span><span dir="auto">Generated extra text</span><a href="/p/',
            );
          if (mode === 'rowtext-author-mismatch')
            rows = rows.replaceAll('generated_reply_0', 'generated_other');
          if (mode === 'rowtext-embedded')
            rows = rows
              .replace(
                '<div><a href="/generated_reply_0/">',
                '<div><span dir="auto"><a href="/generated_reply_0/">',
              )
              .replace('1w</time></a></div>', '1w</time></a></span></div>');
          if (mode === 'rowtext-hidden')
            rows = rows.replace('<div><div>', '<div hidden><div>');
        }
        if (mode === 'ul-div-duplicate')
          rows = rows.replace('900001', '900000');
        if (mode === 'ul-div-wrapper') rows = `<div>${rows}</div>`;
        const expanded =
          mode === 'missing'
            ? ''
            : mode.startsWith('wrapped')
              ? `<div><div><ul>${rows}</ul></div></div>`
              : `<ul>${rows}</ul>`;
        const script =
          mode.startsWith('ul-div') || mode.startsWith('rowtext')
            ? `const scope=this.parentElement;this.remove();setTimeout(()=>scope.insertAdjacentHTML('beforeend',${JSON.stringify(`<div><div><ul>${rows}</ul></div></div>${mode === 'ul-div-hide' ? '<div role="button" onclick="this.dataset.clicked=\'true\'">Hide replies</div>' : mode === 'ul-div-unknown' || mode.startsWith('rowtext') ? '<div role="button" onclick="this.dataset.clicked=\'true\'">See replies</div>' : ''}`)}),600)`
            : mode.startsWith('sibling')
              ? `const scope=this.parentElement;this.remove();${mode === 'sibling-delayed' ? 'setTimeout(()=>{' : ''}scope.insertAdjacentHTML('afterend',${JSON.stringify(mode === 'sibling-rows' ? rows : `<ul>${rows}</ul>`)});${mode === 'sibling-delayed' ? '},300)' : ''}`
              : `this.insertAdjacentHTML('afterend',${JSON.stringify(expanded)});this.remove()`;
        html = html.replace(
          group[0],
          `<div role="button" onclick="${script.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">View all 5 replies</div>${mode === 'blocked' ? '<div style="position:fixed;inset:0;z-index:9999;background:white"></div>' : ''}`,
        );
        if (mode === 'ul-div-preexisting')
          html = html.replace(
            '>View all 5 replies</div>',
            '>View all 5 replies</div><ul hidden></ul>',
          );
        await route.fulfill({ response, body: html });
      });
      const response = page.waitForResponse((response) =>
        response.url().includes('/data/'),
      );
      await page.goto(fake.origin + '/p/' + IG_FIXTURE.code + '/');
      const bodies = [await (await response).json()];
      let expansion: unknown;
      const reading = commentReplies(
        page,
        bodies,
        {
          id: IG_FIXTURE.commentId,
          createdAt: item.createdAt,
          username: item.account.handle!,
          text: item.text,
        },
        () => {},
        performance.now() + 10000,
        async () => {},
        0,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        (value) => {
          expansion = value;
        },
      );
      if (
        mode === 'shown' ||
        mode === 'wrapped' ||
        [
          'sibling-ul',
          'sibling-rows',
          'sibling-delayed',
          'ul-div',
          'ul-div-hide',
          'ul-div-wrapper',
          'ul-div-unknown',
          'rowtext-adjacent',
          'rowtext-authors',
          'rowtext-texts',
          'rowtext-embedded',
        ].includes(mode)
      )
        expect((await reading).entries).toHaveLength(5);
      else if (mode === 'blocked')
        await expect(reading).rejects.toMatchObject({ name: 'TimeoutError' });
      else
        await expect(reading).rejects.toMatchObject({
          reason:
            mode === 'wrapped-foreign' ||
            mode === 'wrapped-no-time' ||
            mode === 'ul-div-foreign' ||
            mode === 'ul-div-no-time' ||
            mode === 'ul-div-preexisting'
              ? 'reply-scope-unverified'
              : mode === 'mismatch' ||
                  mode === 'wrapped-mismatch' ||
                  mode === 'sibling-mismatch' ||
                  mode === 'ul-div-mismatch'
                ? 'reply-answer-mismatch'
                : mode === 'ul-div-duplicate'
                  ? 'reply-answer-incomplete'
                  : mode === 'rowtext-mismatch' ||
                      mode === 'rowtext-author-mismatch'
                    ? 'reply-answer-mismatch'
                    : mode === 'rowtext-hidden'
                      ? 'reply-answer-incomplete'
                      : 'reply-controls-changed',
        });
      const parsed = ContextStepReportSchema.parse({
        replyExpansion: expansion,
      }).replyExpansion!;
      expect(parsed.clicks).toHaveLength(1);
      if (mode.startsWith('rowtext')) {
        if (mode === 'rowtext-hidden') {
          expect(parsed.rows?.map((row) => row.index)).toEqual([1, 2, 3, 4]);
          expect(parsed.stopAt).toBe('answer-check');
          return;
        }
        expect(parsed.rows?.[0]).toMatchObject({
          observationFailed: false,
          authorLinks: mode === 'rowtext-authors' ? 2 : 1,
          failedStep: 'none',
          extraction: [
            'rowtext-authors',
            'rowtext-texts',
            'rowtext-embedded',
          ].includes(mode)
            ? 'answer'
            : 'adjacent',
        });
        for (const content of [
          item.text,
          item.account.handle!,
          'generated_reply_0',
          'Generated reply 0 with local text',
        ])
          expect(JSON.stringify(parsed)).not.toContain(content);
        expect(await page.locator('[data-clicked="true"]').count()).toBe(0);
        expect(parsed.stopAt).toBe(
          mode === 'rowtext-mismatch' || mode === 'rowtext-author-mismatch'
            ? 'answer-check'
            : mode === 'rowtext-control-incomplete'
              ? 'controls'
              : null,
        );
        return;
      }
      if (mode.startsWith('ul-div')) {
        expect(parsed.clicks[0]?.clicked).toBe(true);
        if (mode === 'ul-div-foreign')
          expect(parsed.clicks[0]?.poll?.firstGrowthMs).toBeNull();
        else
          expect(parsed.clicks[0]?.poll?.firstGrowthMs).toBeGreaterThanOrEqual(
            500,
          );
        expect(parsed.clicks[0]?.candidatesAfter).toMatchObject({
          li: 0,
          ul: mode === 'ul-div-preexisting' ? 2 : 1,
          commentPermalinks: 6,
        });
        if (mode === 'ul-div-hide') {
          expect(parsed.clicks[0]?.controlsAfter?.controls).toMatchObject([
            { shape: 'hide-replies', accepted: false },
          ]);
          expect(await page.locator('[data-clicked="true"]').count()).toBe(0);
        }
        expect(parsed.stopAt).toBe(
          mode === 'ul-div-mismatch'
            ? 'answer-check'
            : mode === 'ul-div-foreign' ||
                mode === 'ul-div-no-time' ||
                mode === 'ul-div-preexisting'
              ? 'reply-group'
              : mode === 'ul-div-unknown'
                ? null
                : mode === 'ul-div-duplicate'
                  ? 'answer-check'
                  : null,
        );
        return;
      }
      if (mode.startsWith('sibling')) {
        expect(parsed.clicks[0]?.rowsAfter).toBe(
          mode === 'sibling-foreign' || mode === 'sibling-no-time' ? 0 : 5,
        );
        expect(parsed.clicks[0]?.poll).toMatchObject({
          timeout: mode === 'sibling-foreign' || mode === 'sibling-no-time',
          observationFailed: false,
        });
        expect(
          parsed.clicks[0]?.poll?.after.find(
            (value) => value.location === 'next-sibling',
          )?.li,
        ).toBe(5);
        expect(parsed.stopAt).toBe(
          mode === 'sibling-foreign' || mode === 'sibling-no-time'
            ? 'postclick-no-growth'
            : mode === 'sibling-mismatch'
              ? 'answer-check'
              : null,
        );
        return;
      }
      expect(parsed.clicks[0]).toMatchObject({
        clicked: mode !== 'blocked',
        rowsBefore: 0,
        rowsAfter: [
          'shown',
          'mismatch',
          'wrapped',
          'wrapped-mismatch',
        ].includes(mode)
          ? 5
          : 0,
        observationFailed: false,
        controlsAfter: { count: mode === 'blocked' ? 1 : 0 },
        candidatesAfter: {
          li: mode === 'missing' || mode === 'blocked' ? 0 : 5,
          ul: mode === 'missing' || mode === 'blocked' ? 0 : 1,
          ownHandleLinks: 1,
        },
        nestedListAppeared: !['missing', 'blocked'].includes(mode),
      });
      expect(parsed.stopAt).toBe(
        mode === 'shown' || mode === 'wrapped'
          ? null
          : mode === 'wrapped-foreign' || mode === 'wrapped-no-time'
            ? 'reply-group'
            : mode === 'mismatch' || mode === 'wrapped-mismatch'
              ? 'answer-check'
              : mode === 'blocked'
                ? 'click'
                : 'postclick-no-growth',
      );
      for (const value of [
        item.text,
        item.account.handle!,
        IG_FIXTURE.commentId,
        'View all 5 replies',
      ])
        expect(JSON.stringify(parsed)).not.toContain(value);
    } finally {
      await browser.close();
      await fake.close();
    }
  },
);
test.each(['View all 5 replies', 'View replies (5)'])(
  'REPCTL numbered control %s expands only with agreeing answer total',
  async (label) => {
    const fixture = await instagramFixture(1),
      fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
    fake.replies(5);
    fake.replyControl(label);
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    try {
      const page = await browser.newPage(),
        item = fixture.items[0]!;
      const response = page.waitForResponse((response) =>
        response.url().includes('/data/'),
      );
      await page.goto(fake.origin + '/p/' + IG_FIXTURE.code + '/');
      const result = await commentReplies(
        page,
        [await (await response).json()],
        {
          id: IG_FIXTURE.commentId,
          createdAt: item.createdAt,
          username: item.account.handle!,
          text: item.text,
        },
        () => {},
        performance.now() + 30000,
        async () => {},
        0,
      );
      expect(result.entries).toHaveLength(5);
    } finally {
      await browser.close();
      await fake.close();
    }
  },
);
test.each([
  'View all 4 replies',
  'View replies (4)',
  'Hide replies',
  'See more replies',
])(
  'REPCTL control %s refuses without expansion and reports closed shape only',
  async (label) => {
    const fixture = await instagramFixture(1),
      fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
    fake.replies(5);
    fake.replyControl(label);
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    try {
      const page = await browser.newPage(),
        item = fixture.items[0]!;
      const response = page.waitForResponse((response) =>
        response.url().includes('/data/'),
      );
      await page.goto(fake.origin + '/p/' + IG_FIXTURE.code + '/');
      let diagnostic: ReplyControlsDiagnostic | undefined;
      await expect(
        commentReplies(
          page,
          [await (await response).json()],
          {
            id: IG_FIXTURE.commentId,
            createdAt: item.createdAt,
            username: item.account.handle!,
            text: item.text,
          },
          () => {},
          performance.now() + 30000,
          async () => {},
          0,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          (value) => {
            diagnostic = value;
          },
        ),
      ).rejects.toMatchObject({ reason: 'reply-controls-changed' });
      expect(diagnostic).toMatchObject({
        count: 1,
        controls: [{ accepted: false, tag: 'button', role: null }],
      });
      expect(JSON.stringify(diagnostic)).not.toContain(label);
      expect(await page.locator('ul[hidden]').count()).toBe(1);
    } finally {
      await browser.close();
      await fake.close();
    }
  },
);

test.each([0, 3, 55])(
  'REPLIES-1 focal nested replies capture=%i stays scoped and caps without a write request',
  async (count) => {
    const fixture = await instagramFixture(1);
    const fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
    fake.replies(count);
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    try {
      const page = await browser.newPage();
      const item = fixture.items[0]!;
      const response = page.waitForResponse((response) =>
        response.url().includes('/data/'),
      );
      await page.goto(fake.origin + '/p/' + IG_FIXTURE.code + '/');
      const bodies: unknown[] = [await (await response).json()];
      const result = await commentReplies(
        page,
        bodies,
        {
          id: IG_FIXTURE.commentId,
          createdAt: item.createdAt,
          username: item.account.handle!,
          text: item.text,
        },
        () => {},
        performance.now() + 30000,
      );
      expect(result.entries).toHaveLength(Math.min(count, 50));
      expect(result).toMatchObject({
        moreCount: Math.max(0, count - 50),
        capped: count > 50,
      });
      if (count)
        expect(result.entries[0]).toEqual({
          account: 'generated_reply_0',
          text: 'Generated reply 0 with local text',
          createdAt: item.createdAt,
          likes: { count: 2, source: 'answer' },
        });
      if (count > 1)
        expect(result.entries[1]).toMatchObject({
          createdAt: null,
          likes: { count: null, source: null },
        });
      if (count) {
        await expect(
          commentReplies(
            page,
            [],
            {
              id: IG_FIXTURE.commentId,
              createdAt: item.createdAt,
              username: item.account.handle!,
              text: item.text,
            },
            () => {},
            performance.now() - 1,
          ),
        ).rejects.toMatchObject({ reason: 'reply-window-empty' });
      }
      if (count)
        expect(
          await page.locator('[data-reply-decoy]').getAttribute('data-clicked'),
        ).toBe(null);
      // /events is the fake's own passive browser recorder, not a platform API.
      expect(
        fake.requests
          .filter((request) => request.path !== '/events')
          .every((request) => request.method === 'GET'),
      ).toBe(true);
    } finally {
      await browser.close();
      await fake.close();
    }
  },
);

test('IG-list crash probe races old passive snapshots and readiness-gated diagnostics with generated navigation and detached subframes', async () => {
  const fixture = await instagramFixture(1);
  const fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  let pageCrashes = 0,
    browserDisconnects = 0;
  browser.on('disconnected', () => browserDisconnects++);
  try {
    const page = await browser.newPage();
    page.on('crash', () => pageCrashes++);
    for (let index = 0; index < 8; index++) {
      await page.goto(fake.origin + '/your_activity/interactions/comments');
      const client = await page.context().newCDPSession(page);
      const navigation = page.reload({ waitUntil: 'domcontentloaded' });
      await client
        .send('DOMSnapshot.captureSnapshot', {
          computedStyles: ['display', 'visibility', 'overflow-y'],
          includeDOMRects: true,
        })
        .catch(() => undefined);
      await navigation;
      await client.detach();
      // Test-only frame churn; production diagnostics never evaluate a page.
      await page.setContent('<main><iframe src="about:blank"></iframe></main>');
      const frame = page.frames().find((value) => value !== page.mainFrame());
      const frameRead = frame
        ?.locator('body')
        .count()
        .catch(() => 0);
      await page.setContent('<main><p>Generated replacement</p></main>');
      await frameRead;
      expect(
        await listNavigation(
          page,
          fixture.items[0]!.createdAt,
          fixture.items[0]!.account.handle!,
        ),
      ).toMatchObject({ observed: true, waitedForReadiness: true });
    }
    expect({ pageCrashes, browserDisconnects }).toEqual({
      pageCrashes: 0,
      browserDisconnects: 0,
    });
  } finally {
    await browser.close();
    await fake.close();
  }
});

test.each(['populated-empty', 'empty-empty', 'populated-populated'] as const)(
  'IG-list window snapshots distinguish generated %s without changing the reader stop',
  async (mode) => {
    const fixture = await instagramFixture(1);
    const fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
    fake.windowLists(mode, mode === 'populated-empty');
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    try {
      const page = await browser.newPage();
      const counts: RowReadCounts = { emptySkipped: 0, otherName: 0 };
      const item = fixture.items[0]!;
      const outcome = await loadList(
        page,
        item,
        item.account.handle!,
        { ...productionContext, origin: fake.origin, responseMs: 1500 },
        () => {},
        true,
        undefined,
        counts,
        listFreshness(),
        [],
        true,
        'Europe/Berlin',
      ).catch((error: unknown) => error);
      expect(counts.unfilteredDiagnostic).toMatchObject({
        observed: true,
        knownEmptyStatePresent: mode === 'empty-empty',
        containers: { main: { images: mode === 'empty-empty' ? 0 : 2 } },
      });
      expect(counts.unfilteredOldestSortApplied).toBe(mode !== 'empty-empty');
      expect(counts.unfilteredDiagnostic?.waitedForReadiness).toBe(true);
      expect(counts.windowDiagnostic).toMatchObject({
        observed: true,
        windowLengthDays: 3,
        exportInsideWorkspaceWindow: true,
        exportInsideUtcWindow: true,
        startEndSameDay: false,
      });
      if (mode === 'empty-empty') {
        expect(counts.initialDiagnostic).toBeUndefined();
        expect(outcome).toMatchObject({ token: 'list-timeout' });
      } else {
        expect(counts.diagnostic?.page).toMatchObject({
          observed: true,
          knownEmptyStatePresent: mode === 'populated-empty',
          containers: { main: { images: mode === 'populated-empty' ? 0 : 2 } },
        });
        expect(counts.filterDialogClosedObserved).toBe(true);
        expect(counts.dialogClosedDiagnostic?.containers.main.images).toBe(
          mode === 'populated-empty' ? 0 : 2,
        );
        if (mode === 'populated-empty') {
          expect(counts.afterDialogSameAsAfterApply).toBe(false);
          expect(outcome).toMatchObject({ token: 'list-timeout' });
        } else expect(outcome).toMatchObject({ candidates: [{ index: 0 }] });
      }
      expect(
        fake.requests.some((request) => /^\/(?:p|reel)\//.test(request.path)),
      ).toBe(false);
    } finally {
      await browser.close();
      await fake.close();
    }
  },
);

test.each(['tiles', 'dialog', 'empty'] as const)(
  'IG-list page locations distinguish generated %s from navigation-only rows',
  async (mode) => {
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    try {
      const page = await browser.newPage();
      const fixture = listNavigationPage(mode);
      await page.setContent(fixture.html);
      const diagnostic = await listRowDiagnostic(
        page,
        fixture.text,
        fixture.at,
        fixture.handle,
      );
      expect(diagnostic.observed).toBe(true);
      expect(diagnostic.page).toMatchObject({
        observed: true,
        observationFailed: false,
        knownEmptyStatePresent: mode === 'empty',
      });
      expect(diagnostic.page!.containers.navAside.links.yourActivity).toBe(3);
      expect(diagnostic.rows.slice(0, 3).map((row) => row.textLength)).toEqual([
        76, 74, 80,
      ]);
      expect(
        diagnostic.rows.slice(0, 3).map((row) => row.authorLength),
      ).toEqual([12, 6, 7]);
      for (const row of diagnostic.rows.slice(0, 3))
        expect(row).toMatchObject({
          container: 'main',
          shape: 'listitem',
          ancestry: {
            nav: true,
            aside: true,
            header: true,
            navigation: true,
            tablist: true,
            dialog: false,
          },
          singleLinkPathClass: 'your-activity',
          imagePresent: false,
          authorEqualsHandle: false,
          timeElementPresent: false,
        });
      if (mode === 'tiles')
        expect(diagnostic.page!.containers.main).toMatchObject({
          links: { post: 3 },
          images: 3,
          checkboxes: 1,
          scrollContainers: 1,
        });
      if (mode === 'dialog') {
        expect(diagnostic.page!.containers.dialog).toMatchObject({
          links: { post: 1 },
          images: 1,
          timeElements: 1,
          timesWithinWindow: 1,
          checkboxes: 1,
          handleElements: 1,
        });
        expect(
          diagnostic.rows.find((row) => row.container === 'dialog'),
        ).toMatchObject({
          ancestry: { dialog: true },
          singleLinkPathClass: 'post',
          imagePresent: true,
        });
      }
      if (mode === 'empty') {
        expect(diagnostic.total).toBe(7);
        for (const region of Object.values(diagnostic.page!.containers))
          expect(region).toMatchObject({
            links: { post: 0 },
            timeElements: 0,
            handleElements: 0,
            checkboxes: 0,
            scrollContainers: 0,
          });
        expect(
          diagnostic.rows.every(
            (row) =>
              !row.handleElementPresent &&
              !row.timeElementPresent &&
              !row.exportStartsWithCommentPrefix,
          ),
        ).toBe(true);
        const german = listNavigationPage('empty', true);
        await page.setContent(german.html);
        expect(
          (await listRowDiagnostic(page, german.text, german.at, german.handle))
            .page!.knownEmptyStatePresent,
        ).toBe(true);
      }
      for (const value of [
        fixture.handle,
        fixture.text,
        fixture.at,
        'Generated_post',
        'No results',
        'generatednav',
      ])
        expect(JSON.stringify(diagnostic)).not.toContain(value);
    } finally {
      await browser.close();
    }
  },
);

test.each(['old', 'split', 'foreign-first'] as const)(
  'IG-list historical 8ad968d and current reader agree on generated %s rows',
  async (layout) => {
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    try {
      const page = await browser.newPage();
      const fixture = historicalListPage(layout);
      await page.setContent(fixture.html);
      const historical = await historicalListRows(page);
      const current = await readRows(page);
      expect(current).toEqual(historical);
      expect(
        current.filter(
          (row) =>
            row.username === fixture.own &&
            rowCandidate(row.text, fixture.text),
        ),
      ).toHaveLength(layout === 'split' ? 0 : 1);
      if (layout === 'foreign-first')
        expect(current.at(-1)?.username).toBe('generated_other');
      if (layout === 'split')
        expect(await page.locator('main li').count()).toBe(3);
    } finally {
      await browser.close();
    }
  },
);

test('IG-list link and element projection pins a later own-name link, truncation and non-datetime time without contents', async () => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  try {
    const page = await browser.newPage();
    const handle = 'generated_handle';
    const prefix = 'Generated target comment with a long prefix';
    const target = prefix + ' and more text';
    await page.setContent(
      `<main><li><a href="/foreign/">foreign</a> <a href="/${handle}/">${handle}</a> <span>${prefix}...</span> <time>1w</time></li><li><span>${handle.toUpperCase()}</span> <span>${target}</span> 2d</li><li><a role="link">foreign</a> unrelated 1w</li></main>`,
    );
    const result = await listRowDiagnostic(
      page,
      target,
      '2025-01-02T12:00:00Z',
      handle,
    );
    expect(result).toMatchObject({
      observed: true,
      total: 3,
      rows: [
        {
          anchorCount: 2,
          firstHandleAnchorIndex: 1,
          handleElementPresent: true,
          rowTextStartsWithHandle: false,
          trailingEllipsisPresent: true,
          timeElementPresent: true,
          exactTimeObserved: false,
        },
        {
          anchorCount: 0,
          firstHandleAnchorIndex: -1,
          handleElementPresent: true,
          rowTextStartsWithHandle: true,
          exportStartsWithCommentText: true,
          commentTextStartsWithExport: true,
          timeElementPresent: false,
        },
        {
          anchorCount: 1,
          firstHandleAnchorIndex: -1,
          handleElementPresent: false,
          rowTextStartsWithHandle: false,
          timeElementPresent: false,
        },
      ],
    });
    for (const value of [
      handle,
      prefix,
      target,
      'foreign',
      '/foreign/',
      '2025',
      '1w',
    ])
      expect(JSON.stringify(result)).not.toContain(value);
    const row = result.rows[0]!;
    const diagnostic = {
      observed: true,
      capped: false,
      total: 1,
      displayNameObserved: false,
      displayNameAmbiguous: false,
      rows: [row],
    };
    const { ListRowDiagnosticSchema } =
      await import('../src/browser/instagram/report.ts');
    expect(
      ListRowDiagnosticSchema.safeParse({
        ...diagnostic,
        rows: [{ ...row, firstHandleAnchorIndex: 2 }],
      }).success,
    ).toBe(false);
    expect(
      ListRowDiagnosticSchema.safeParse({
        ...diagnostic,
        rows: [{ ...row, handle: handle }],
      }).success,
    ).toBe(false);
  } finally {
    await browser.close();
  }
});

test('IG-list per-row projection separates a foreign display-name match, an ignored result and a nav image', async () => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<nav><div role="button" aria-label="Generated nav"><img></div></nav><main><div role="button" aria-label="Generated display row"><img>Generated Display Generated target 1w</div><li><time datetime="2025-01-02T12:00:00Z"></time>Generated target</li></main>`,
    );
    const result = await listRowDiagnostic(
      page,
      'Generated target',
      '2025-01-02T12:00:00Z',
      'generated_handle',
      [
        {
          user: {
            username: 'generated_handle',
            full_name: 'Generated Display',
          },
        },
      ],
    );
    expect(result).toMatchObject({
      observed: true,
      total: 3,
      displayNameObserved: true,
      rows: [
        { container: 'elsewhere', textPresent: false, imagePresent: true },
        {
          container: 'main',
          authorEqualsHandle: false,
          authorEqualsDisplayName: true,
          commentTextEqualsExport: true,
        },
        {
          container: 'main',
          shape: 'listitem',
          textEqualsExport: true,
          exactTimeObserved: true,
          timestampWithinWindow: true,
        },
      ],
    });
    for (const forbidden of [
      'Generated',
      'generated_handle',
      '2025',
      'datetime',
      '1w',
    ])
      expect(JSON.stringify(result)).not.toContain(forbidden);
  } finally {
    await browser.close();
  }
});

test.each(['readable-retained', 'readable-repeated'] as const)(
  'IG-list a split-container %s result cannot exclude a comment through no-row',
  async (mode) => {
    const fixture = await instagramFixture(2);
    fixture.items[1]!.createdAt = new Date(
      Date.parse(fixture.items[0]!.createdAt) + 100 * 86400000,
    ).toISOString();
    const fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
    fake.setToday('2026-10-29');
    fake.listFreshness(mode);
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    const tracker = listFreshness();
    try {
      const page = await browser.newPage();
      const outcomes: unknown[] = [];
      for (const item of fixture.items) {
        const counts: RowReadCounts = { emptySkipped: 0, otherName: 0 };
        outcomes.push(
          await loadList(
            page,
            item,
            item.account.handle!,
            { ...productionContext, origin: fake.origin, responseMs: 1500 },
            () => {},
            false,
            undefined,
            counts,
            tracker,
          ).catch((error: unknown) => error),
        );
        expect(counts.regions).toMatchObject({
          observed: true,
          main: 1,
          elsewhere: 1,
          distinctParents: 2,
        });
        expect(counts.emptySkipped).toBe(1);
      }
      expect(outcomes[mode === 'readable-retained' ? 0 : 1]).toMatchObject({
        code: 'PLATFORM_CHECK',
        token: 'list-timeout',
      });
      expect(
        fake.requests.some((request) => request.path.startsWith('/p/')),
      ).toBe(false);
    } finally {
      await browser.close();
      await fake.close();
    }
  },
);

test.each(['retained', 'sibling'] as const)(
  'C-list matching dropdowns with %s rows must stop, not exclude the comment',
  async (mode) => {
    const fixture = await instagramFixture();
    const fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
    fake.listFreshness(mode);
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    const page = await browser.newPage();
    const counts: RowReadCounts = { emptySkipped: 0, otherName: 0 };
    try {
      const outcome = await loadList(
        page,
        fixture.items[0]!,
        fixture.items[0]!.account.handle!,
        { ...productionContext, origin: fake.origin, responseMs: 1500 },
        () => {},
        false,
        undefined,
        counts,
      ).catch((error: unknown) => error);
      expect(counts.listTimeout, String(outcome)).toMatchObject({
        rowContainers: 4,
        readableRows: 1,
        imageOnlyRows: 3,
        filter: {
          applied: true,
          readbackObserved: true,
          startMatches: true,
          endMatches: true,
        },
      });
      if (mode === 'sibling')
        expect(
          await page.locator('#generated-filter-result').innerText(),
        ).toContain(fixture.items[0]!.text);
      expect(counts.regions).toMatchObject({
        observed: true,
        main: 4,
        dialog: 0,
        elsewhere: 0,
        distinctParents: 1,
        ignoredTextMatches: mode === 'sibling' ? 1 : 0,
        ignoredDatedWindowMatches: mode === 'sibling' ? 1 : 0,
        ignoredDatedWindowRows: mode === 'sibling' ? 1 : 0,
        afterApply: {
          readbackObserved: false,
          startMatches: false,
          endMatches: false,
        },
      });
      expect(outcome).toMatchObject({
        code: 'PLATFORM_CHECK',
        token: 'list-timeout',
      });
      expect(outcome).not.toBeInstanceOf(FilteredListTimeout);
      expect(
        fake.requests.some((request) => request.path.startsWith('/p/')),
      ).toBe(false);
    } finally {
      await browser.close();
      await fake.close();
    }
  },
);

test('list-region correct refresh counts the selected main rows without ignored candidates', async () => {
  const fixture = await instagramFixture(1);
  const fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  try {
    const page = await browser.newPage();
    const counts: RowReadCounts = { emptySkipped: 0, otherName: 0 };
    const result = await loadList(
      page,
      fixture.items[0]!,
      fixture.items[0]!.account.handle!,
      { ...productionContext, origin: fake.origin, responseMs: 1500 },
      () => {},
      false,
      undefined,
      counts,
    );
    expect(result.candidates).toHaveLength(1);
    expect(counts.regions).toMatchObject({
      observed: true,
      main: 1,
      dialog: 0,
      elsewhere: 0,
      distinctParents: 1,
      ignoredTextMatches: 0,
      ignoredDatedWindowMatches: 0,
    });
  } finally {
    await browser.close();
    await fake.close();
  }
});

test('list-region reports main/dialog/elsewhere and post-Apply dropdown equality separately', async () => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<main><div><div role="button" aria-label="Generated row">Generated target</div></div><div role="dialog"><button role="button" aria-label="Oldest to newest">Oldest to newest</button><span>Start date</span><select><option>January</option></select><select><option>1</option></select><select><option>2025</option></select><span>End date</span><select><option>January</option></select><select><option>3</option></select><select><option>2025</option></select></div></main><nav><div role="button" aria-label="Generated other row"></div></nav>`,
    );
    expect(
      await listRegions(page, 'Generated target', '2025-01-02T12:00:00.000Z'),
    ).toMatchObject({
      observed: true,
      main: 1,
      dialog: 1,
      elsewhere: 1,
      distinctParents: 3,
      afterApply: {
        readbackObserved: true,
        startMatches: true,
        endMatches: true,
      },
    });
    await page.locator('select').first().selectOption({ label: 'January' });
    expect(
      await listRegions(page, 'Generated target', '2025-02-02T12:00:00.000Z'),
    ).toMatchObject({
      afterApply: {
        readbackObserved: true,
        startMatches: false,
        endMatches: false,
      },
    });
  } finally {
    await browser.close();
  }
});

test('likes exact fake comment block supplies 17, not the other comment 999', async () => {
  const fixture = await instagramFixture(1);
  const item = fixture.items[0]!;
  const fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
  fake.likes('dom');
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  try {
    const page = await browser.newPage();
    await page.goto(fake.origin + `/p/${IG_FIXTURE.code}/`);
    expect(
      await commentLikes(page, [], {
        id: IG_FIXTURE.commentId,
        createdAt: item.createdAt,
        username: item.account.handle!,
        text: item.text,
      }),
    ).toEqual({ count: 17, source: 'dom' });
  } finally {
    await browser.close();
    await fake.close();
  }
});

test('C-list a repeated opaque result for a different window stops on the second step', async () => {
  const fixture = await instagramFixture(2);
  fixture.items[1]!.createdAt = new Date(
    Date.parse(fixture.items[0]!.createdAt) + 100 * 86400000,
  ).toISOString();
  const fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
  fake.setToday('2026-10-25');
  fake.listFreshness('repeated');
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  const page = await browser.newPage();
  const freshness = listFreshness();
  const counts: RowReadCounts[] = [];
  try {
    const outcomes: unknown[] = [];
    for (const item of fixture.items) {
      const count: RowReadCounts = { emptySkipped: 0, otherName: 0 };
      counts.push(count);
      outcomes.push(
        await loadList(
          page,
          item,
          item.account.handle!,
          { ...productionContext, origin: fake.origin, responseMs: 1500 },
          () => {},
          false,
          undefined,
          count,
          freshness,
        ).catch((error: unknown) => error),
      );
    }
    expect(outcomes[0]).toMatchObject({ manualReason: 'list-image-only' });
    expect(outcomes[1]).toMatchObject({
      code: 'PLATFORM_CHECK',
      token: 'list-timeout',
    });
    expect(outcomes[1]).not.toBeInstanceOf(FilteredListTimeout);
    expect(counts[1]!.rowSignature).toEqual({
      observed: true,
      sameAsBeforeApply: false,
      sameAsPreviousStep: true,
      previousWindowDifferent: true,
    });
    expect(
      fake.requests.some((request) => request.path.startsWith('/p/')),
    ).toBe(false);
  } finally {
    await browser.close();
    await fake.close();
  }
});
