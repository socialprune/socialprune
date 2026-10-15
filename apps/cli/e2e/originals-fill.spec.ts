import { test, expect, chromium } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateOriginal } from '@socialprune/core';
import { SQLiteStore } from '../src/workspace/sqlite-store.ts';
import { fixtureWorkspace, FIXTURE } from './fake-x/fixture.ts';
import {
  detailAnswer,
  detailPost,
  DETAIL_FIXTURE,
} from '../src/originals/test/detail.ts';
import { runFillWithDependencies } from '../src/browser/x/fill/run.ts';
import { planFill, FILL_WARNING } from '../src/browser/x/fill/plan.ts';
import { createProfile, profileInUse } from '../src/browser/profile.ts';
import { productionMedia } from '../src/originals/video.ts';
import { SyndicationClient } from '../src/originals/syndication.ts';
import { CliError } from '../src/cli/errors.ts';
import { startConfirmation } from '../src/browser/confirmation.ts';
import { REVIEW_POLICY } from '../src/review/static.ts';
import { readOrder } from '../src/browser/x/fill/order.ts';
import { fileURLToPath } from 'node:url';
import { fetchOriginals } from '../src/originals/fetch.ts';
import { storeOriginalMedia } from '../src/originals/store-media.ts';
import { extract } from '../src/browser/x/fill/extract.ts';
import {
  moduleCursorAnswer,
  displayComparisonAnswer,
  displayComparisonMarkup,
  DISPLAY_COMPARISON_FIXTURE,
  cardComparisonAnswer,
  cardComparisonMarkup,
  CARD_COMPARISON_FIXTURE,
  ownPhotoAnswer,
  ownPhotoMarkup,
  OWN_PHOTO_FIXTURE,
  gatedMediaAnswer,
  gatedMediaMarkup,
  GATED_MEDIA_FIXTURE,
  notePhotoAnswer,
  notePhotoMarkup,
  NOTE_RENDER_FIXTURE,
  gatedLatePlayerMarkup,
  protectedNoticeAnswer,
  protectedNoticeMarkup,
  protectedNoticeText,
  emptyResultsAnswer,
  EMPTY_RESULTS_FIXTURE,
  moduleItemIdsAnswer,
  MODULE_ITEM_IDS_FIXTURE,
  textContentAnswer,
  textContentMarkup,
  textContentStoredText,
  TEXT_CONTENT_FIXTURE,
  noticeAlignmentAnswer,
  noticeAlignmentMarkup,
  NOTICE_ALIGNMENT_FIXTURE,
  noticeParentAnswer,
  noticeParentMarkup,
  NOTICE_PARENT_FIXTURE,
  emptyFocalAnswer,
  emptyFocalMarkup,
  EMPTY_FOCAL_FIXTURE,
  STOP_DETAIL_FIXTURE,
  delayedStopSwitcherMarkup,
  inlineQuoteAnswer,
  inlineQuoteMarkup,
  INLINE_QUOTE_FIXTURE,
  statusEntityAnswer,
  statusEntityMarkup,
  flowAnswer,
  flowMarkup,
  FLOW_FIXTURE,
} from './fake-x/fill-detail.ts';
for (const variant of [
  'success',
  'flag-account',
  'flag-account-mismatch',
  'missing-id',
  'login',
  'challenge',
  'limit',
  '429',
  'never',
  'unexpected',
  'background',
  'does-not-match',
  'stop',
  'stale',
  'extension',
  'extension-at-matches',
  'canary-five',
  'shared-cap',
  'unavailable',
  'tombstone',
  'removed',
  'german-ended',
  'order-match',
  'order-text-mismatch',
  'order-media-mismatch',
  'delayed-many',
  'external-aborted',
  'order-wrong-scope',
  'order-wrong-account',
  'order-stale',
  'order-stop',
  'module-cursor',
  'unknown-module',
  'no-focal-entry',
  'order-status-page',
  'order-display-match',
  'order-display-alt-mismatch',
  'order-display-tail-mismatch',
  'order-card-quote',
  'order-card-link',
  'order-card-video',
  'order-card-rendered-link',
  'order-card-missing-rendered-link',
  'order-card-full-match',
  'order-card-full-mismatch',
  'order-own-photos',
  'order-visibility-gated',
  'order-visibility-exposed',
  'order-visibility-stored',
  'order-visibility-family',
  'order-visibility-full',
  'order-note-delayed-photo',
  'order-note-missing-photo',
  'order-note-delayed-text',
  'order-visibility-late-player',
  'order-protected-de',
  'order-protected-en',
  'order-protected-different',
  'order-protected-duplicate',
  'order-protected-missing',
  'order-protected-long-tail',
  'order-protected-long-match',
  'order-protected-missing-link',
  'order-empty-results',
  'order-module-item-ids',
  'order-textcontent-mention',
  'order-textcontent-missing-word',
  'order-textcontent-hidden-link',
  'order-textcontent-missing-link',
  'order-notice-different-parent',
  'order-notice-identical-parent',
  'order-notice-normal-parent-reply',
  'order-notice-wrong-focal',
  'order-notice-wrong-parent',
  'order-notice-missing-candidate',
  'order-notice-unavailable-parent',
  'order-parent-notice-direct',
  'order-parent-notice-module',
  'order-parent-notice-unavailable-direct',
  'order-parent-notice-unavailable-module',
  'order-parent-unknown-direct',
  'order-parent-unknown-module',
  'order-empty-focal-unknown',
  'order-empty-focal-match',
  'order-empty-focal-continue',
  'order-empty-focal-present',
  'order-empty-focal-late',
  'order-empty-focal-error',
  'order-empty-focal-module',
  'order-platform-render-timeout',
  'order-platform-render-timeout-de',
  'order-platform-login',
  'order-platform-render-timeout-full',
  'order-platform-answer-status',
  'order-platform-answer-type',
  'order-platform-answer-timeout',
  'order-platform-body-timeout',
  'order-platform-account-readback-full',
  'order-platform-account-readback-canary',
  'order-inline-quote-match',
  'order-inline-quote-different-path',
  'order-inline-quote-in-full-text',
  'order-inline-quote-not-trailing',
  'order-readback-failed',
  'order-readback-account-changed',
  'order-readback-extensions-changed',
  'order-readback-failed-de',
  'order-readback-account-changed-de',
  'order-readback-extensions-changed-de',
  'order-error-disk-low',
  'order-error-media-failed',
  'order-error-rate-limit',
  'order-error-media-origin',
  'order-error-media-format',
  'order-error-fs-EACCES',
  'order-error-type-error',
  'order-error-other',
  'order-finalize-error',
  'order-status-entity-match',
  'order-status-entity-different-path',
  'order-status-entity-outside-range',
  'order-status-entity-non-status',
  'order-status-entity-duplicate',
  'order-flow-mismatch-two',
  'order-flow-mismatch-three',
  'order-flow-mismatch-two-de',
  'order-flow-canary-mismatch',
  'order-flow-reload-success',
  'order-flow-reload-twice',
  'order-flow-reload-three',
  'order-flow-reload-cap',
  'order-flow-reload-stop',
  'order-flow-marker',
  'order-flow-answer-status',
  'order-flow-canary-timeout',
  'order-flow-reload-then-marker',
  'order-flow-reload-then-mismatch',
  'order-flow-unexpected',
] as const)
  test(`page-driven fill ${variant}: Start, exact GET response, stop and canary acceptance`, async ({}, testInfo) => {
    const directory = await mkdtemp(join(tmpdir(), 'socialprune-fill-fake-'));
    const flow = variant.startsWith('order-flow-');
    const flowCanary = variant.startsWith('order-flow-canary-');
    const statusKind =
      variant === 'order-status-entity-different-path'
        ? 'different-path'
        : variant === 'order-status-entity-outside-range'
          ? 'outside-range'
          : variant === 'order-status-entity-non-status'
            ? 'non-status'
            : variant === 'order-status-entity-duplicate'
              ? 'duplicate'
              : 'match';
    const workspace =
      variant === 'canary-five'
        ? fixtureWorkspace()
        : variant === 'order-empty-focal-continue'
          ? fixtureWorkspace(['1001', '1002'])
          : fixtureWorkspace(['1001']);
    workspace.items[0]!.kind = 'reply';
    workspace.items[0]!.reference.replyToId = DETAIL_FIXTURE.id;
    if (variant === 'flag-account' || variant === 'flag-account-mismatch') {
      const expected = JSON.parse(
        await readFile(
          fileURLToPath(
            new URL(
              '../../../fixtures/synthetic/x/missing-account/expected.json',
              import.meta.url,
            ),
          ),
          'utf8',
        ),
      ) as { items: { account: { key: string; handle: null } }[] };
      workspace.items.forEach((item) => {
        item.account = { ...expected.items[0]!.account };
      });
      workspace.imports[0]!.accounts = [{ ...expected.items[0]!.account }];
    }
    workspace.originals = [
      migrateOriginal({
        id: DETAIL_FIXTURE.id,
        status: 'fetched',
        fetchedAt: FIXTURE.now,
        text: 'Generated beginning',
        authorName: DETAIL_FIXTURE.name,
        authorHandle: DETAIL_FIXTURE.handle,
        photos: [],
        quotedId: null,
        parentId: null,
        raw: { note_tweet: {} },
        textCompleteness: 'truncated',
        video: null,
      }),
    ];
    workspace.counts.originals = 1;
    if (flow) {
      const ids =
        variant === 'order-flow-reload-three'
          ? FLOW_FIXTURE.ids.slice(0, 4)
          : variant === 'order-flow-mismatch-two' ||
              variant === 'order-flow-mismatch-two-de' ||
              variant === 'order-flow-mismatch-three'
            ? FLOW_FIXTURE.ids.slice(0, 4)
            : variant === 'order-flow-canary-mismatch' ||
                variant === 'order-flow-reload-success'
              ? FLOW_FIXTURE.ids.slice(0, 2)
              : FLOW_FIXTURE.ids.slice(0, 1);
      const generated = fixtureWorkspace(
        ids.map((_, index) => String(1001 + index)),
      );
      workspace.items = generated.items;
      workspace.items.forEach((item, index) => {
        item.kind = 'reply';
        item.reference.replyToId = ids[index]!;
      });
      const template = workspace.originals[0]!;
      workspace.originals = ids.map((id) => ({
        ...template,
        id,
      }));
      workspace.counts.items = workspace.items.length;
      workspace.counts.originals = ids.length;
    }
    if (variant.startsWith('order-empty-focal-')) {
      workspace.originals[0]!.text = EMPTY_FOCAL_FIXTURE.oldText;
      workspace.originals[0]!.anonymous = {
        status: 'not-found',
        at: FIXTURE.now,
      };
      workspace.originals[0]!.raw = {
        text: 'Generated anonymous not-found context',
      };
      workspace.originals[0]!.media = [
        {
          n: 1,
          kind: 'video',
          source: 'anonymous',
          url: null,
          file: null,
          poster: null,
          status: 'not-stored',
          bytes: null,
          durationMs: null,
          bitrateLabel: null,
          altText: null,
        },
      ];
      if (variant === 'order-empty-focal-continue') {
        workspace.items[1]!.kind = 'reply';
        workspace.items[1]!.reference.replyToId = EMPTY_FOCAL_FIXTURE.nextId;
        workspace.originals.push({
          ...workspace.originals[0]!,
          id: EMPTY_FOCAL_FIXTURE.nextId,
        });
        workspace.counts.originals = 2;
      }
    }
    if (variant === 'order-visibility-stored') {
      workspace.originals[0]!.media = [
        {
          n: 1,
          kind: 'video',
          source: 'anonymous',
          url: GATED_MEDIA_FIXTURE.videoUrl,
          file: '1.mp4',
          poster: null,
          status: 'stored',
          bytes: Buffer.from(GATED_MEDIA_FIXTURE.mp4Base64, 'base64').length,
          durationMs: 1200,
          bitrateLabel: 832000,
          altText: null,
        },
      ];
      await mkdir(join(directory, 'originals', DETAIL_FIXTURE.id), {
        recursive: true,
      });
      await writeFile(
        join(directory, 'originals', DETAIL_FIXTURE.id, '1.mp4'),
        Buffer.from(GATED_MEDIA_FIXTURE.mp4Base64, 'base64'),
      );
    }
    if (variant === 'canary-five') {
      workspace.items.forEach((item, index) => {
        item.reference.replyToId = String(910 + index);
      });
      workspace.originals = workspace.items.map((_, index) => ({
        ...workspace.originals![0]!,
        id: String(910 + index),
      }));
      workspace.counts.originals = 6;
    }
    const store = await SQLiteStore.open(
      join(directory, 'socialprune.sqlite'),
      {
        initial: workspace,
      },
    );
    const profile = join(directory, 'profile');
    await mkdir(profile);
    await createProfile(profile);
    const preinstalledId = 'a'.repeat(32);
    await mkdir(join(profile, 'Default', 'Extensions', preinstalledId, '1.0'), {
      recursive: true,
    });
    await writeFile(
      join(
        profile,
        'Default',
        'Extensions',
        preinstalledId,
        '1.0',
        'manifest.json',
      ),
      'Generated contents that must never be read',
    );
    if (
      variant.startsWith('order-error-') ||
      variant.startsWith('order-readback-') ||
      variant.startsWith('order-platform-')
    )
      await rm(join(profile, 'Default', 'Extensions', preinstalledId), {
        recursive: true,
        force: true,
      });
    if (variant === 'removed')
      await mkdir(
        join(profile, 'Default', 'Extensions', 'b'.repeat(32), '1.0'),
        { recursive: true },
      );
    if (variant === 'shared-cap' || variant === 'order-flow-reload-cap') {
      const writer = store.browserOutcomeWriter(),
        run = {
          runId: 'generated-prior-delete',
          platform: 'x' as const,
          accountKey: FIXTURE.account.key,
          mode: 'delete' as const,
          planHash: 'a'.repeat(64),
          startedAt: FIXTURE.now,
          endedAt: null,
          endReason: null,
          bodyShapes: {},
          profileReport: null,
          pageOpens: variant === 'order-flow-reload-cap' ? 199 : 200,
          lastPageOpenedAt: FIXTURE.now,
        };
      await writer.begin(run);
      await writer.finish({
        ...run,
        endedAt: FIXTURE.now,
        endReason: 'daily-cap',
      });
    }
    let context: BrowserContext | undefined;
    let running: Promise<unknown> | undefined;
    const abort = new AbortController();
    const requests: string[] = [];
    const notices: string[] = [];
    const flowStarts: { id: string; at: number; count: number }[] = [];
    const opensById = new Map<string, number>();
    let stopDuringReload = false;
    let extensionMutationInjected = false;
    const readbackVariant = variant.startsWith('order-readback-');
    const injectedError = variant.startsWith('order-error-')
      ? variant.slice('order-error-'.length)
      : null;
    const slowSwitcher =
      variant.startsWith('order-platform-render-timeout') || readbackVariant;
    const inlineQuoteKind =
      variant === 'order-inline-quote-different-path'
        ? 'different-path'
        : variant === 'order-inline-quote-in-full-text'
          ? 'in-full-text'
          : variant === 'order-inline-quote-not-trailing'
            ? 'not-trailing'
            : 'match';
    const emptyFocalKind =
      variant === 'order-empty-focal-present'
        ? 'present'
        : variant === 'order-empty-focal-late'
          ? 'late'
          : variant === 'order-empty-focal-error'
            ? 'error'
            : variant === 'order-empty-focal-module'
              ? 'module'
              : variant === 'order-empty-focal-unknown'
                ? 'unknown'
                : 'empty';
    const noticeKind =
      variant === 'order-notice-identical-parent'
        ? 'identical-parent'
        : variant === 'order-notice-normal-parent-reply'
          ? 'normal-parent-reply'
          : variant === 'order-notice-wrong-focal'
            ? 'wrong-focal'
            : variant === 'order-notice-wrong-parent'
              ? 'wrong-parent'
              : variant === 'order-notice-missing-candidate'
                ? 'missing-candidate'
                : variant === 'order-notice-unavailable-parent'
                  ? 'unavailable-parent'
                  : 'different-parent';
    const textContentKind =
      variant === 'order-textcontent-missing-word'
        ? 'missing-word'
        : variant === 'order-textcontent-hidden-link'
          ? 'hidden-link'
          : variant === 'order-textcontent-missing-link'
            ? 'missing-link'
            : 'mention';
    const mediaRequests: string[] = [];
    let statusBroughtToFront = 0;
    let releaseHome: () => void = () => {};
    let now = Date.parse(FIXTURE.now);
    const server = createServer((request, response) => {
      requests.push(request.url ?? '');
      const pathname = (request.url ?? '').split('?')[0];
      if (flow && pathname?.includes('/status/')) {
        const id = pathname.split('/').at(-1)!;
        opensById.set(id, (opensById.get(id) ?? 0) + 1);
        flowStarts.push({ id, at: now, count: opensById.get(id)! });
      }
      if (pathname?.startsWith('/generated-gated-')) {
        mediaRequests.push(pathname);
        response.setHeader('Content-Type', 'image/png');
        response.end(
          Buffer.from(DISPLAY_COMPARISON_FIXTURE.pngBase64, 'base64'),
        );
        return;
      }
      if (pathname === '/generated-gated.mp4') {
        mediaRequests.push(pathname);
        response.setHeader('Content-Type', 'video/mp4');
        response.end(Buffer.from(GATED_MEDIA_FIXTURE.mp4Base64, 'base64'));
        return;
      }
      if (
        pathname === '/generated-emoji.png' ||
        pathname === '/generated-photo.png'
      ) {
        response.setHeader('Content-Type', 'image/png');
        response.end(
          Buffer.from(DISPLAY_COMPARISON_FIXTURE.pngBase64, 'base64'),
        );
        return;
      }
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (pathname?.startsWith('/i/api/graphql/')) {
        const id = (
          JSON.parse(
            new URL(request.url!, 'http://127.0.0.1:4231').searchParams.get(
              'variables',
            ) ?? '{}',
          ) as { focalTweetId: string }
        ).focalTweetId;
        const post = detailPost(id);
        if (variant === 'unavailable' || variant === 'tombstone') {
          Object.assign(post, {
            __typename:
              variant === 'unavailable' ? 'TweetUnavailable' : 'TweetTombstone',
            reason: 'generated-unavailable',
            tombstone: { text: { text: 'Generated withheld message' } },
          });
        }
        Object.assign(post, {
          note_tweet: {
            note_tweet_results: { result: { text: DETAIL_FIXTURE.longText } },
          },
        });
        response.setHeader('Content-Type', 'application/json');
        if (variant === 'never' || variant === 'order-platform-answer-timeout')
          return;
        if (
          variant === '429' ||
          variant === 'order-platform-answer-status' ||
          variant === 'order-flow-answer-status'
        ) {
          response.writeHead(429);
          response.end('{}');
          return;
        }
        if (variant === 'order-platform-answer-type') {
          response.setHeader('Content-Type', 'text/html');
          response.end('{}');
          return;
        }
        if (variant === 'order-platform-body-timeout') {
          response.writeHead(200);
          response.write('{');
          const delayedBody = setTimeout(
            () => response.end('}'),
            STOP_DETAIL_FIXTURE.switcherDelayMs,
          );
          response.once('close', () => clearTimeout(delayedBody));
          return;
        }
        if (variant === 'missing-id')
          delete (post as Partial<typeof post>).rest_id;
        const cardKind =
          variant === 'order-card-quote'
            ? 'quote'
            : variant === 'order-card-video'
              ? 'video'
              : variant === 'order-card-rendered-link'
                ? 'rendered-link'
                : variant === 'order-card-missing-rendered-link' ||
                    variant === 'order-card-full-mismatch'
                  ? 'missing-rendered-link'
                  : 'link';
        const answer = flow
          ? flowAnswer(id)
          : variant.startsWith('order-status-entity-')
            ? statusEntityAnswer(id, statusKind)
            : injectedError
              ? notePhotoAnswer(id)
              : variant.startsWith('order-inline-quote-')
                ? inlineQuoteAnswer(id, inlineQuoteKind)
                : variant.startsWith('order-empty-focal-') &&
                    id === DETAIL_FIXTURE.id
                  ? emptyFocalAnswer(id, emptyFocalKind)
                  : variant === 'order-empty-focal-continue'
                    ? detailAnswer(post)
                    : variant.startsWith('order-parent-')
                      ? noticeParentAnswer(
                          id,
                          variant === 'order-parent-unknown-direct'
                            ? 'unknown-direct'
                            : variant === 'order-parent-unknown-module'
                              ? 'unknown-module'
                              : variant.endsWith('module')
                                ? 'module'
                                : 'direct',
                          variant.includes('-unavailable-'),
                        )
                      : variant.startsWith('order-notice-')
                        ? noticeAlignmentAnswer(id, noticeKind)
                        : variant.startsWith('order-textcontent-')
                          ? textContentAnswer(id, textContentKind)
                          : variant === 'order-module-item-ids'
                            ? moduleItemIdsAnswer(id)
                            : variant === 'order-empty-results'
                              ? emptyResultsAnswer(id)
                              : variant.startsWith('order-protected-')
                                ? protectedNoticeAnswer(
                                    id,
                                    variant === 'order-protected-en'
                                      ? 'en'
                                      : 'de',
                                    variant === 'order-protected-long-tail' ||
                                      variant === 'order-protected-long-match',
                                  )
                                : variant.startsWith('order-visibility-')
                                  ? gatedMediaAnswer(
                                      id,
                                      variant === 'order-visibility-family',
                                    )
                                  : variant.startsWith('order-note-')
                                    ? notePhotoAnswer(id)
                                    : variant === 'order-own-photos'
                                      ? ownPhotoAnswer(id)
                                      : variant.startsWith('order-card-')
                                        ? cardComparisonAnswer(id, cardKind)
                                        : variant.startsWith('order-display-')
                                          ? displayComparisonAnswer(
                                              id,
                                              variant ===
                                                'order-display-alt-mismatch'
                                                ? 'alt'
                                                : variant ===
                                                    'order-display-tail-mismatch'
                                                  ? 'tail'
                                                  : 'none',
                                            )
                                          : variant === 'module-cursor' ||
                                              variant === 'unknown-module'
                                            ? moduleCursorAnswer(
                                                id,
                                                variant === 'unknown-module',
                                              )
                                            : detailAnswer(post);
        if (variant === 'no-focal-entry')
          answer.data.threaded_conversation_with_injections_v2.instructions[0]!.entries.shift();
        response.end(JSON.stringify(answer));
        return;
      }
      const nav = `<button data-testid="SideNav_AccountSwitcher_Button">@${variant === 'flag-account-mismatch' ? DETAIL_FIXTURE.handle : FIXTURE.account.handle}</button>`;
      const delayedReadbackNav = variant.startsWith('order-readback-failed')
        ? '<button data-testid="SideNav_AccountSwitcher_Button">Generated unnamed account</button>'
        : variant.startsWith('order-readback-account-changed')
          ? '<button data-testid="SideNav_AccountSwitcher_Button">@generated_changed</button>'
          : nav;
      const account =
        variant.startsWith('order-platform-account-readback-') &&
        pathname?.includes('/status/')
          ? '<button data-testid="SideNav_AccountSwitcher_Button">Generated unnamed account</button>'
          : slowSwitcher && pathname?.includes('/status/')
            ? delayedStopSwitcherMarkup(delayedReadbackNav)
            : variant === 'delayed-many'
              ? `<div id="nav"></div><script>setTimeout(()=>document.getElementById('nav').innerHTML=${JSON.stringify(nav)},100)</script>`
              : nav;
      if (
        variant === 'order-platform-login' &&
        pathname?.includes('/status/')
      ) {
        response.end(
          `${account}<button data-testid="loginButton">Generated sign-in</button>`,
        );
        return;
      }
      if (pathname === '/home') {
        if (variant.startsWith('order-')) {
          // An ordered run closes its own window when it ends, so hold the
          // account page until the test has seen the run's start state.
          releaseHome = () => response.end(account);
          return;
        }
        response.end(account);
        return;
      }
      if (flow) {
        const id = pathname!.split('/').at(-1)!;
        const count = opensById.get(id) ?? 1;
        const slow =
          variant === 'order-flow-canary-timeout' ||
          variant === 'order-flow-reload-twice' ||
          variant === 'order-flow-reload-cap' ||
          variant === 'order-flow-reload-stop' ||
          ((variant === 'order-flow-reload-then-marker' ||
            variant === 'order-flow-reload-then-mismatch' ||
            variant === 'order-flow-unexpected') &&
            count === 1) ||
          (variant === 'order-flow-reload-success' &&
            id === FLOW_FIXTURE.ids[0] &&
            count === 1) ||
          (variant === 'order-flow-reload-three' && count === 1);
        const mismatch =
          (variant.startsWith('order-flow-mismatch-') &&
            FLOW_FIXTURE.ids.indexOf(id) <
              (variant === 'order-flow-mismatch-three' ? 3 : 2)) ||
          variant === 'order-flow-canary-mismatch' ||
          (variant === 'order-flow-reload-then-mismatch' && count === 2);
        const marker =
          variant === 'order-flow-marker' ||
          (variant === 'order-flow-reload-then-marker' && count === 2)
            ? '<button data-testid="loginButton">Generated login</button>'
            : '';
        response.end(
          `${slow ? delayedStopSwitcherMarkup(nav) : account}${marker}${flowMarkup(id, mismatch)}<script>${variant === 'order-flow-unexpected' ? "fetch('/i/api/graphql/generated/FavoriteTweet',{method:'POST'});" : ''}fetch('/i/api/graphql/generated/TweetDetail?variables='+encodeURIComponent(JSON.stringify({focalTweetId:'${id}'})))</script>`,
        );
        return;
      }
      if (['login', 'challenge', 'limit', 'german-ended'].includes(variant)) {
        response.end(
          `${account}<p data-testid="${variant === 'login' || variant === 'german-ended' ? 'loginButton' : variant === 'challenge' ? 'challenge' : 'rateLimit'}">${variant === 'login' || variant === 'german-ended' ? 'Log in to X' : variant === 'challenge' ? 'Confirm you are human' : 'Rate limit exceeded'}</p>`,
        );
        return;
      }
      const visibilityMarkup = variant.startsWith('order-status-entity-')
        ? statusEntityMarkup(pathname!.split('/').at(-1)!, statusKind)
        : injectedError
          ? notePhotoMarkup(pathname!.split('/').at(-1)!, 'delayed-text')
          : variant.startsWith('order-inline-quote-')
            ? inlineQuoteMarkup(pathname!.split('/').at(-1)!, inlineQuoteKind)
            : variant.startsWith('order-empty-focal-') &&
                pathname!.split('/').at(-1) === DETAIL_FIXTURE.id
              ? emptyFocalMarkup(pathname!.split('/').at(-1)!, emptyFocalKind)
              : variant.startsWith('order-parent-')
                ? noticeParentMarkup(pathname!.split('/').at(-1)!)
                : variant.startsWith('order-notice-')
                  ? noticeAlignmentMarkup(noticeKind)
                  : variant.startsWith('order-textcontent-')
                    ? textContentMarkup(
                        pathname!.split('/').at(-1)!,
                        textContentKind,
                      )
                    : variant.startsWith('order-protected-')
                      ? protectedNoticeMarkup(
                          variant === 'order-protected-en' ? 'en' : 'de',
                          variant === 'order-protected-different'
                            ? 'different'
                            : variant === 'order-protected-duplicate'
                              ? 'duplicate'
                              : variant === 'order-protected-missing'
                                ? 'missing'
                                : variant === 'order-protected-long-tail'
                                  ? 'long-tail'
                                  : variant === 'order-protected-long-match'
                                    ? 'long-match'
                                    : variant === 'order-protected-missing-link'
                                      ? 'missing-link'
                                      : 'match',
                        )
                      : variant === 'order-visibility-late-player'
                        ? gatedLatePlayerMarkup(pathname!.split('/').at(-1)!)
                        : variant.startsWith('order-note-')
                          ? notePhotoMarkup(
                              pathname!.split('/').at(-1)!,
                              variant === 'order-note-delayed-photo'
                                ? 'delayed-photo'
                                : variant === 'order-note-missing-photo'
                                  ? 'missing-photo'
                                  : 'delayed-text',
                            )
                          : variant.startsWith('order-visibility-')
                            ? gatedMediaMarkup(
                                pathname!.split('/').at(-1)!,
                                variant === 'order-visibility-exposed',
                              )
                            : null;
      response.end(
        `${account}${variant === 'delayed-many' ? Array.from({ length: 13 }, (_, i) => `<article data-testid="tweet"><a href="/generated/status/${2000 + i}"><time>2026</time></a><p data-testid="tweetText">Generated other post</p></article>`).join('') : ''}${visibilityMarkup ?? (variant === 'order-own-photos' ? ownPhotoMarkup(pathname!.split('/').at(-1)!) : variant.startsWith('order-card-') ? cardComparisonMarkup(pathname!.split('/').at(-1)!, variant === 'order-card-quote' ? 'quote' : variant === 'order-card-video' ? 'video' : variant === 'order-card-rendered-link' ? 'rendered-link' : variant === 'order-card-missing-rendered-link' || variant === 'order-card-full-mismatch' ? 'missing-rendered-link' : 'link') : variant.startsWith('order-display-') ? displayComparisonMarkup(pathname!.split('/').at(-1)!) : variant === 'unavailable' || variant === 'tombstone' ? '<p>Generated unavailable message</p>' : `<article data-testid="tweet"><a href="/generated/status/${pathname!.split('/').at(-1)}"><time>2026</time></a><p data-testid="tweetText">${variant === 'order-text-mismatch' ? 'Generated wrong visible text' : DETAIL_FIXTURE.longText}</p>${variant === 'order-media-mismatch' ? '<a role="link" href="/generated/status/' + pathname!.split('/').at(-1) + '/photo/1"><div data-testid="tweetPhoto"><img alt="Generated" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></div></a>' : ''}</article>`)}<script>${variant === 'external-aborted' ? "fetch('http://127.0.0.1:4239/generated/CreateCheckoutSession',{method:'POST',mode:'no-cors'}).catch(()=>{});" : ''}${variant === 'unexpected' || variant === 'background' ? `fetch('${variant === 'unexpected' ? '/i/api/graphql/generated/FavoriteTweet' : '/i/api/telemetry'}',{method:'POST'});` : ''}fetch('/i/api/graphql/generated/TweetDetail?variables='+encodeURIComponent(JSON.stringify({focalTweetId:'${pathname!.split('/').at(-1)}'})))</script>`,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(4231, '127.0.0.1', resolve),
    );
    try {
      const plan = await planFill(store, workspace.items[0]!.account.key);
      if (
        variant === 'order-card-full-match' ||
        variant === 'order-card-full-mismatch' ||
        variant === 'order-visibility-full' ||
        variant === 'order-platform-render-timeout-full' ||
        variant === 'order-platform-account-readback-full' ||
        injectedError ||
        readbackVariant ||
        variant === 'order-finalize-error' ||
        (flow && !flowCanary)
      )
        plan.canary = false;
      if (variant === 'flag-account' || variant === 'flag-account-mismatch') {
        expect(plan.handle).toBe('');
        plan.handle = FIXTURE.account.handle;
      }
      const ordered = variant.startsWith('order-');
      let order: Awaited<ReturnType<typeof readOrder>> | undefined;
      if (ordered) {
        const file = join(directory, 'generated-order.json');
        await writeFile(
          file,
          JSON.stringify({
            scope: 'originals-fill-x',
            account: FIXTURE.account.handle,
            givenAt: FIXTURE.now,
            words: 'Read these generated originals in my dedicated profile.',
            maxPages: flow
              ? 200
              : variant === 'order-empty-focal-continue'
                ? 2
                : 1,
          }),
        );
        order = await readOrder(
          file,
          FIXTURE.account.handle,
          plan.hash,
          plan.hash,
        );
        if (variant === 'order-wrong-scope')
          order = {
            ...order,
            value: { ...order.value, scope: 'delete-x' as 'originals-fill-x' },
          };
        if (variant === 'order-wrong-account')
          order = {
            ...order,
            value: { ...order.value, account: 'foreign_account' },
          };
        if (variant === 'order-stale') plan.hash = 'b'.repeat(64);
      }
      const waits: number[] = [];
      const fakeMediaClient = new SyndicationClient({
        baseUrl: 'http://127.0.0.1:4231',
      });
      const fakePhoto = fakeMediaClient.photo.bind(fakeMediaClient);
      fakeMediaClient.photo = (url, signal) =>
        fakePhoto(
          url === GATED_MEDIA_FIXTURE.posterUrl ||
            url === GATED_MEDIA_FIXTURE.photoUrl
            ? 'http://127.0.0.1:4231/' + new URL(url).pathname.slice(1)
            : url === 'https://pbs.twimg.com/generated-photo.png'
              ? 'http://127.0.0.1:4231/generated-photo.png'
              : url,
          signal,
        );
      const result = runFillWithDependencies(
        {
          store,
          plan,
          profile,
          executablePath: chromium.executablePath(),
          list: 'generated list',
          workspace: directory,
          signal: abort.signal,
          limit: 200,
          maxVideoBytes: 1024 ** 3,
          maxRunBytes: 20 * 1024 ** 3,
          include: new Set(),
          order,
          lang:
            variant === 'german-ended' ||
            variant === 'order-status-page' ||
            variant === 'order-platform-render-timeout-de' ||
            variant.endsWith('-de')
              ? 'de'
              : 'en',
          now: () => new Date(now),
          notice: (text) => {
            notices.push(text);
            if (
              variant.startsWith('order-readback-extensions-changed') &&
              !extensionMutationInjected &&
              text.startsWith('Structure report:')
            ) {
              // Injected callback runs after the error report and before read-back.
              mkdirSync(
                join(profile, 'Default', 'Extensions', 'b'.repeat(32), '1.0'),
                { recursive: true },
              );
              extensionMutationInjected = true;
            }
          },
        },
        {
          origin: 'http://127.0.0.1:4231',
          port: 4232,
          responseMs: flow
            ? FLOW_FIXTURE.slowWaitMs
            : variant === 'never'
              ? 200
              : slowSwitcher ||
                  variant === 'order-platform-answer-timeout' ||
                  variant === 'order-platform-body-timeout'
                ? STOP_DETAIL_FIXTURE.renderWaitMs
                : 5000,
          intervalMs: flow ? FLOW_FIXTURE.paceMs : 5,
          batch: 2,
          pauseMs: 11,
          media: {
            ...productionMedia,
            origin: 'http://127.0.0.1:4231',
            free: () => {
              if (!injectedError) return Promise.resolve(10 * 1024 ** 3);
              if (injectedError === 'disk-low') return Promise.resolve(0);
              if (injectedError === 'media-failed')
                throw new CliError('MEDIA_FAILED');
              if (injectedError === 'rate-limit')
                throw new CliError('MEDIA_RATE_LIMIT');
              if (injectedError === 'media-origin')
                throw new Error('MEDIA_ORIGIN');
              if (injectedError === 'media-format')
                throw new Error('MEDIA_FORMAT');
              if (injectedError === 'fs-EACCES')
                throw Object.assign(
                  new Error('Generated private filesystem details'),
                  { code: 'EACCES', path: 'generated/private' },
                );
              if (injectedError === 'type-error')
                throw new TypeError('Generated private type details');
              throw new Error('Generated private unknown details');
            },
            fetch: (url, init) =>
              fetch(
                (url instanceof URL
                  ? url.href
                  : typeof url === 'string'
                    ? url
                    : url.url) === GATED_MEDIA_FIXTURE.videoUrl
                  ? 'http://127.0.0.1:4231/generated-gated.mp4'
                  : url,
                init,
              ),
          },
          syndication: fakeMediaClient,
          async launch() {
            context = await chromium.launchPersistentContext(profile, {
              executablePath: chromium.executablePath(),
              headless: true,
              chromiumSandbox: true,
              args: ['--enable-automation'],
              ignoreDefaultArgs: ['--disable-infobars'],
            });
            expect(await profileInUse(profile)).toBe(true);
            if (variant === 'removed')
              await rm(join(profile, 'Default', 'Extensions'), {
                recursive: true,
                force: true,
              });
            const probe = await context.newCDPSession(context.pages()[0]!);
            const command = await probe.send('Browser.getBrowserCommandLine');
            expect(command.arguments).not.toContain('--no-sandbox');
            expect(command.arguments).toContain('--disable-extensions');
            expect(command.arguments).not.toContain('--disable-infobars');
            expect(command.arguments).toContain('--enable-automation');
            expect(command.arguments).toContain('--remote-debugging-pipe');
            expect(
              await context.pages()[0]!.evaluate(() => navigator.webdriver),
            ).toBe(true);
            await probe.detach();
            if (variant === 'order-status-page') {
              const actualPages = context.pages.bind(context);
              const statusPage = actualPages()[0]!;
              await statusPage.addInitScript(() => {
                const violations: string[] = [];
                Reflect.set(window, '__statusPageViolations', violations);
                document.addEventListener('securitypolicyviolation', (event) =>
                  violations.push(event.effectiveDirective),
                );
              });
              const front = statusPage.bringToFront.bind(statusPage);
              statusPage.bringToFront = async () => {
                statusBroughtToFront++;
                await front();
              };
              // Test-only page-order decoy: the foreground X tab is first.
              context.pages = () => actualPages().reverse();
            }
            return context;
          },
          async sleep(ms, signal) {
            await Promise.resolve();
            waits.push(ms);
            if (
              variant === 'order-flow-reload-stop' &&
              ms === FLOW_FIXTURE.reloadWaitMs
            ) {
              stopDuringReload = true;
              const confirmationPage = context!
                .pages()
                .find((p) => p.url().startsWith('http://127.0.0.1:4232'))!;
              await confirmationPage.locator('#stop').click();
              await new Promise<void>((_resolve, reject) => {
                if (signal?.aborted) reject(new CliError('CANCELLED'));
                else
                  signal?.addEventListener(
                    'abort',
                    () => reject(new CliError('CANCELLED')),
                    { once: true },
                  );
              });
            }
            now += ms;
          },
          async close() {
            if (ordered) {
              const page = context!
                .pages()
                .find(
                  (value) =>
                    new URL(value.url()).origin === 'http://127.0.0.1:4232',
                )!;
              if (variant === 'order-status-page') {
                expect(statusBroughtToFront).toBe(1);
                expect(context!.pages()[0]).not.toBe(page);
                expect(
                  await page.evaluate(
                    () =>
                      Reflect.get(window, '__statusPageViolations') as string[],
                  ),
                ).toEqual([]);
                expect(notices.join('')).not.toContain(
                  'Die Statusseite konnte den Endzustand nicht anzeigen',
                );
              }
              await expect(page.locator('#result')).toContainText(
                variant === 'order-status-page' ||
                  variant === 'order-platform-render-timeout-de' ||
                  variant.endsWith('-de')
                  ? 'Beendet:'
                  : 'Ended:',
              );
              if (variant.startsWith('order-platform-'))
                await expect(page.locator('#result')).toContainText(
                  variant === 'order-platform-login'
                    ? 'The post-run account and extension check could not finish.'
                    : variant === 'order-platform-render-timeout-de'
                      ? STOP_DETAIL_FIXTURE.timeoutDe
                      : variant.startsWith('order-platform-account-readback-')
                        ? 'The signed-in account could not be read back after the run.'
                        : variant === 'order-platform-answer-status' ||
                            variant === 'order-platform-answer-type'
                          ? 'The page was not recognized.'
                          : STOP_DETAIL_FIXTURE.timeoutEn,
                );
              if (readbackVariant) {
                const de = variant.endsWith('-de');
                const text = variant.startsWith('order-readback-failed')
                  ? de
                    ? 'Das angemeldete Konto konnte nach dem Lauf nicht geprüft werden.'
                    : 'The signed-in account could not be read back after the run.'
                  : variant.startsWith('order-readback-account-changed')
                    ? de
                      ? 'Das angemeldete Konto hat sich während des Laufs geändert.'
                      : 'The signed-in account changed during the run.'
                    : de
                      ? 'Die Erweiterungen des Browserprofils haben sich während des Laufs geändert.'
                      : "The browser profile's extensions changed during the run.";
                await expect(page.locator('#result')).toContainText(text);
                await expect(page.locator('#result')).not.toContainText(
                  de ? 'Es wurde nichts geändert.' : 'Nothing was changed.',
                );
              }
              if (variant === 'order-card-full-mismatch' && !flow) {
                await expect(page.locator('#result')).not.toContainText(
                  'sample',
                );
                await expect(page.locator('#result')).toContainText(
                  'The planned work is complete.',
                );
              }
              await mkdir(join(tmpdir(), 'socialprune-screens'), {
                recursive: true,
              });
              if (variant === 'order-match')
                await page.screenshot({
                  path: join(
                    tmpdir(),
                    'socialprune-screens',
                    'confirmation-order-ended.png',
                  ),
                  fullPage: true,
                  caret: 'initial',
                });
              await context!.close();
              if (variant === 'order-finalize-error')
                throw new TypeError('Generated private close details');
            }
            if (variant === 'german-ended')
              await new Promise<void>((resolve) =>
                context!.once('close', () => resolve()),
              );
          },
        },
      ).then(
        (value) => value,
        (error) => error as CliError,
      );
      running = result;
      if (
        ['order-wrong-scope', 'order-wrong-account', 'order-stale'].includes(
          variant,
        )
      ) {
        expect(await result).toMatchObject({
          code: variant === 'order-stale' ? 'STALE_PLAN' : 'ORDER_INVALID',
        });
        expect(context).toBeUndefined();
        expect(requests).toEqual([]);
        expect((await store.browserJournal()).runs).toEqual([]);
        return;
      }
      await expect
        .poll(() =>
          context
            ?.pages()
            .some((page) => page.url().startsWith('http://127.0.0.1:4232')),
        )
        .toBe(true);
      const page = context!
        .pages()
        .find(
          (value) => new URL(value.url()).origin === 'http://127.0.0.1:4232',
        )!;
      if (ordered) {
        const screens = join(tmpdir(), 'socialprune-screens');
        await mkdir(screens, { recursive: true });
        await expect(page.locator('#start')).toBeHidden();
        await expect(page.locator('#stop')).toBeVisible();
        if (variant === 'order-match')
          await page.screenshot({
            path: join(screens, 'confirmation-order-start.png'),
            fullPage: true,
            caret: 'initial',
          });
        await expect.poll(() => requests.includes('/home')).toBe(true);
        if (variant !== 'order-stop') releaseHome();
        if (variant === 'order-stop') {
          await page.locator('#stop').click();
          releaseHome();
          expect(await result).toMatchObject({ code: 'CANCELLED' });
          expect(
            (await store.browserJournal()).runs.at(-1)?.canaryAcceptedAt ??
              null,
          ).toBeNull();
          return;
        }
        const outcome = await result;
        if (flow) {
          const journal = await store.browserJournal();
          const run = journal.runs.at(-1)!;
          const attempts = journal.attempts;
          const sending = attempts.filter(
            (attempt) => attempt.state === 'sending',
          );
          const states = attempts
            .filter((attempt) => attempt.state !== 'sending')
            .map((attempt) => attempt.state);
          expect(run.pageOpens).toBe(flowStarts.length);
          expect(sending).toHaveLength(flowStarts.length);
          for (let i = 1; i < sending.length; i++)
            expect(
              Date.parse(sending[i]!.at) - Date.parse(sending[i - 1]!.at),
            ).toBeGreaterThanOrEqual(FLOW_FIXTURE.paceMs);
          const reloads = flowStarts.filter((entry) => entry.count === 2);
          if (
            variant === 'order-flow-mismatch-two' ||
            variant === 'order-flow-mismatch-two-de'
          ) {
            expect(outcome).toMatchObject({ completed: 4, endReason: 'done' });
            expect(states).toEqual(['read', 'read', 'read', 'read']);
          } else if (variant === 'order-flow-mismatch-three') {
            expect(outcome).toMatchObject({ code: 'CANARY_MISMATCH' });
            expect(states).toEqual(['read', 'read', 'read']);
          } else if (variant === 'order-flow-canary-mismatch') {
            expect(outcome).toMatchObject({ code: 'CANARY_MISMATCH' });
            expect(flowStarts).toHaveLength(1);
            expect(run.canaryAcceptedAt).toBeNull();
          } else if (variant === 'order-flow-reload-success') {
            expect(outcome).toMatchObject({ completed: 2, endReason: 'done' });
            expect(states).toEqual(['failed', 'read', 'read']);
            expect(reloads).toHaveLength(1);
            expect(waits).toContain(FLOW_FIXTURE.reloadWaitMs);
          } else if (variant === 'order-flow-reload-three') {
            expect(outcome).toMatchObject({
              code: 'PLATFORM_CHECK',
              reason: 'render-timeout',
            });
            expect(reloads).toHaveLength(3);
            expect(flowStarts).toHaveLength(7);
            expect(states).toEqual([
              'failed',
              'read',
              'failed',
              'read',
              'failed',
              'read',
              'failed',
            ]);
          } else if (variant === 'order-flow-reload-twice') {
            expect(outcome).toMatchObject({
              code: 'PLATFORM_CHECK',
              reason: 'render-timeout',
            });
            expect(flowStarts).toHaveLength(2);
            expect(reloads).toHaveLength(1);
            expect(states).toEqual(['failed', 'failed']);
          } else if (variant === 'order-flow-reload-cap') {
            expect(outcome).toMatchObject({
              endReason: 'daily-cap',
              completed: 0,
            });
            expect(flowStarts).toHaveLength(1);
            expect(reloads).toHaveLength(0);
          } else if (variant === 'order-flow-reload-stop') {
            expect(outcome).toMatchObject({ code: 'CANCELLED' });
            expect(stopDuringReload).toBe(true);
            expect(flowStarts).toHaveLength(1);
          } else if (
            variant === 'order-flow-reload-then-marker' ||
            variant === 'order-flow-reload-then-mismatch'
          ) {
            expect(outcome).toMatchObject(
              variant === 'order-flow-reload-then-marker'
                ? { code: 'PLATFORM_CHECK', reason: 'marker-login' }
                : { code: 'CANARY_MISMATCH' },
            );
            expect(flowStarts).toHaveLength(2);
            expect(reloads).toHaveLength(1);
            expect(states).toEqual(
              variant === 'order-flow-reload-then-marker'
                ? ['failed', 'failed']
                : ['failed', 'read'],
            );
          } else if (variant === 'order-flow-unexpected') {
            expect(outcome).toMatchObject({ code: 'UNEXPECTED_ACTION' });
            expect(flowStarts).toHaveLength(1);
            expect(waits).not.toContain(FLOW_FIXTURE.reloadWaitMs);
          } else {
            expect(outcome).toMatchObject({
              code: 'PLATFORM_CHECK',
              reason:
                variant === 'order-flow-marker'
                  ? 'marker-login'
                  : variant === 'order-flow-answer-status'
                    ? 'answer-status'
                    : 'render-timeout',
            });
            expect(flowStarts).toHaveLength(1);
            expect(waits).not.toContain(FLOW_FIXTURE.reloadWaitMs);
            expect(run.canaryAcceptedAt).toBeNull();
          }
          const reportNotices = notices.filter((text) =>
            text.startsWith('Structure report:'),
          );
          if (
            variant.startsWith('order-flow-mismatch-') ||
            variant.startsWith('order-flow-reload-') ||
            variant === 'order-flow-canary-mismatch'
          )
            expect(reportNotices.length).toBeGreaterThan(0);
          if (reportNotices.length) {
            const raw = await readFile(
              join(directory, 'originals', `canary-${run.runId}.json`),
              'utf8',
            );
            const report = JSON.parse(raw) as {
              mismatch?: {
                position: number;
                matches: boolean;
                stored: unknown;
                shown: unknown;
              };
              reload?: {
                position: number;
                number: number;
                waitMs: number;
                reason: string;
              };
            }[];
            const differences = report.flatMap((entry) => entry.mismatch ?? []);
            const expectedDifferences =
              variant === 'order-flow-mismatch-three'
                ? 3
                : variant.startsWith('order-flow-mismatch-two')
                  ? 2
                  : variant === 'order-flow-canary-mismatch' ||
                      variant === 'order-flow-reload-then-mismatch'
                    ? 1
                    : 0;
            expect(differences).toHaveLength(expectedDifferences);
            expect(differences.map((entry) => entry.position)).toEqual(
              Array.from(
                { length: expectedDifferences },
                (_, index) => index + 1,
              ),
            );
            for (const entry of differences)
              expect(entry).toMatchObject({
                matches: false,
                stored: {
                  textLength: FLOW_FIXTURE.text.length,
                  photos: 0,
                  videos: 0,
                },
                shown: {
                  textLength: FLOW_FIXTURE.differentText.length,
                  photos: 0,
                  videos: 0,
                },
              });
            const continuing = notices.filter((text) =>
              text.includes(
                variant.endsWith('-de')
                  ? 'der Lauf geht weiter'
                  : 'the run goes on',
              ),
            );
            expect(continuing).toHaveLength(
              variant.startsWith('order-flow-mismatch-')
                ? Math.min(expectedDifferences, 2)
                : 0,
            );
            if (variant.startsWith('order-flow-mismatch-'))
              for (
                let index = 0;
                index < Math.min(expectedDifferences, 2);
                index++
              )
                expect(continuing[index]).toBe(
                  variant.endsWith('-de')
                    ? `Text oder Medien weichen bei diesem Beitrag ab; der Lauf geht weiter (${index + 1} von 3).\n`
                    : `Text or media differ on this post; the run goes on (${index + 1} of 3).\n`,
                );
            const reloadEntries = report.flatMap((entry) => entry.reload ?? []);
            expect(reloadEntries).toHaveLength(
              waits.filter((ms) => ms === FLOW_FIXTURE.reloadWaitMs).length,
            );
            for (const entry of reloadEntries)
              expect(entry).toMatchObject({
                waitMs: FLOW_FIXTURE.reloadWaitMs,
                reason: 'render-timeout',
              });
            for (const secret of [
              ...FLOW_FIXTURE.ids,
              FLOW_FIXTURE.text,
              FLOW_FIXTURE.differentText,
              FIXTURE.account.handle,
            ])
              expect(raw).not.toContain(secret);
          }
          for (let i = 0; i < flowStarts.length; i++)
            if (flowStarts[i]!.count === 2)
              expect(
                flowStarts[i]!.at - flowStarts[i - 1]!.at,
              ).toBeGreaterThanOrEqual(FLOW_FIXTURE.reloadWaitMs);
          if (variant === 'order-flow-reload-cap')
            expect(
              (await store.browserJournal()).runs.reduce(
                (count, value) => count + (value.pageOpens ?? 0),
                0,
              ),
            ).toBe(200);
          expect(context!.pages()).toHaveLength(0);
          return;
        }
        if (variant === 'order-finalize-error') {
          expect(outcome).toMatchObject({ code: 'ORIGINALS_FAILED' });
          const run = (await store.browserJournal()).runs.at(-1)!;
          const report = JSON.parse(
            await readFile(
              join(directory, 'originals', `canary-${run.runId}.json`),
              'utf8',
            ),
          ) as Record<string, unknown>[];
          expect(report).toEqual(
            expect.arrayContaining([
              { stop: { code: 'type-error' } },
              { readback: { outcome: 'unchanged' } },
            ]),
          );
          expect(
            notices.filter((text) => text.startsWith('Stop detail:')),
          ).toEqual(['Stop detail: type-error\n']);
          expect(context!.pages()).toHaveLength(0);
          return;
        }
        if (
          variant === 'order-match' ||
          variant === 'order-status-page' ||
          variant === 'order-display-match' ||
          variant === 'order-card-quote' ||
          variant === 'order-card-link' ||
          variant === 'order-card-video' ||
          variant === 'order-card-rendered-link' ||
          variant === 'order-card-full-match' ||
          variant === 'order-card-full-mismatch' ||
          variant === 'order-own-photos' ||
          variant === 'order-note-delayed-photo' ||
          variant === 'order-note-delayed-text' ||
          variant === 'order-protected-de' ||
          variant === 'order-protected-en' ||
          variant === 'order-protected-duplicate' ||
          variant === 'order-protected-long-match' ||
          variant === 'order-empty-results' ||
          variant === 'order-module-item-ids' ||
          variant === 'order-textcontent-mention' ||
          variant === 'order-textcontent-hidden-link' ||
          variant === 'order-notice-different-parent' ||
          variant === 'order-notice-identical-parent' ||
          variant === 'order-notice-normal-parent-reply' ||
          variant === 'order-notice-unavailable-parent' ||
          variant.startsWith('order-parent-notice-') ||
          variant === 'order-empty-focal-match' ||
          variant === 'order-empty-focal-continue' ||
          variant === 'order-status-entity-match' ||
          variant === 'order-inline-quote-match' ||
          (variant.startsWith('order-visibility-') &&
            variant !== 'order-visibility-exposed' &&
            variant !== 'order-visibility-late-player')
        ) {
          expect(
            outcome,
            notices.find((value) => value.startsWith('Canary counts:')),
          ).toMatchObject({
            completed: variant === 'order-empty-focal-continue' ? 2 : 1,
            endReason:
              variant === 'order-card-full-match' ||
              variant === 'order-card-full-mismatch' ||
              variant === 'order-visibility-full'
                ? 'done'
                : 'canary',
          });
          expect((await store.browserJournal()).runs.at(-1)).toMatchObject({
            startedBy: 'agent-on-order',
            ...(variant === 'order-card-full-match' ||
            variant === 'order-card-full-mismatch' ||
            variant === 'order-visibility-full'
              ? {}
              : { acceptedBy: 'automatic-check' }),
            orderSha256: order!.sha256,
          });
          if (
            variant === 'order-card-full-match' ||
            variant === 'order-card-full-mismatch' ||
            variant === 'order-visibility-full'
          )
            expect(
              (await store.browserJournal()).runs.at(-1)?.canaryAcceptedAt,
            ).toBeNull();
          if (variant === 'order-own-photos') {
            const original = await store.read((tx) =>
              tx.originals.get(DETAIL_FIXTURE.id),
            );
            expect(original?.media).toHaveLength(OWN_PHOTO_FIXTURE.photos);
            expect(
              original?.media.every(
                (media) => media.kind === 'photo' && media.status === 'stored',
              ),
            ).toBe(true);
            expect((await store.browserJournal()).runs.at(-1)).toMatchObject({
              canaryCounts: [
                {
                  stored: { photos: OWN_PHOTO_FIXTURE.photos },
                  shown: { photos: OWN_PHOTO_FIXTURE.photos },
                  matches: true,
                },
              ],
            });
          }
          if (
            variant === 'order-card-quote' ||
            variant === 'order-card-video'
          ) {
            const focal = await store.read((tx) =>
              tx.originals.get(DETAIL_FIXTURE.id),
            );
            expect(focal?.media.map((media) => media.kind)).toEqual(
              variant === 'order-card-video' ? ['video'] : [],
            );
            expect(
              (await store.read((tx) => tx.originals.get('909')))?.media,
            ).toHaveLength(2);
            expect(
              (await store.read((tx) => tx.originals.get('909')))?.text,
            ).toBe(CARD_COMPARISON_FIXTURE.quotedText);
          }
          if (variant === 'order-display-match') {
            const original = await store.read((tx) =>
              tx.originals.get(DETAIL_FIXTURE.id),
            );
            expect(original?.text).toBe(
              DISPLAY_COMPARISON_FIXTURE.mention +
                DISPLAY_COMPARISON_FIXTURE.encodedDisplay +
                ' ' +
                DISPLAY_COMPARISON_FIXTURE.mediaUrl,
            );
            expect(original?.media[0]).toMatchObject({
              kind: 'photo',
              status: 'stored',
            });
            const visibleLength =
              DISPLAY_COMPARISON_FIXTURE.decodedDisplay.replace(
                'https://t.co/generatedLink',
                DISPLAY_COMPARISON_FIXTURE.renderedLink,
              ).length;
            const shownLength =
              DISPLAY_COMPARISON_FIXTURE.shownInnerText.trim().length;
            expect((await store.browserJournal()).runs.at(-1)).toMatchObject({
              canaryCounts: [
                {
                  stored: { textLength: visibleLength, photos: 1, videos: 0 },
                  shown: { textLength: visibleLength, photos: 1, videos: 0 },
                  text: {
                    storedPlainLength: shownLength,
                    shownInnerTextLength: shownLength,
                    imageAltUnits: 2,
                    matchedImageAlts: 1,
                    imageSpacingUnits: 1,
                  },
                  matches: true,
                },
              ],
            });
          }
          if (variant === 'order-status-page')
            expect(notices.join('')).not.toContain(
              'Die Statusseite konnte den Endzustand nicht anzeigen',
            );
        } else {
          expect(outcome).toMatchObject({
            code: readbackVariant
              ? 'PLATFORM_CHECK'
              : injectedError
                ? injectedError === 'disk-low'
                  ? 'DISK_LOW'
                  : injectedError === 'media-failed'
                    ? 'MEDIA_FAILED'
                    : injectedError === 'rate-limit'
                      ? 'MEDIA_RATE_LIMIT'
                      : 'ORIGINALS_FAILED'
                : variant.startsWith('order-platform-')
                  ? 'PLATFORM_CHECK'
                  : variant.startsWith('order-parent-unknown-') ||
                      variant === 'order-empty-focal-unknown' ||
                      variant === 'order-empty-focal-module'
                    ? 'SHAPE_CHANGED'
                    : 'CANARY_MISMATCH',
          });
          expect(
            (await store.browserJournal()).runs.at(-1)?.canaryAcceptedAt,
          ).toBeNull();
          expect((await store.browserJournal()).runs.at(-1)).toMatchObject(
            readbackVariant || variant.startsWith('order-platform-')
              ? { endReason: 'platform-check' }
              : injectedError
                ? { endReason: 'error' }
                : variant.startsWith('order-parent-unknown-') ||
                    variant === 'order-empty-focal-unknown' ||
                    variant === 'order-empty-focal-module'
                  ? { endReason: 'shape-changed' }
                  : { endReason: 'error', displayEndReason: 'canary-mismatch' },
          );
        }
        if (readbackVariant || injectedError) {
          expect(extensionMutationInjected).toBe(
            variant.startsWith('order-readback-extensions-changed'),
          );
          const run = (await store.browserJournal()).runs.at(-1)!;
          const reportText = await readFile(
            join(directory, 'originals', `canary-${run.runId}.json`),
            'utf8',
          );
          const report = JSON.parse(reportText) as Record<string, unknown>[];
          const code =
            injectedError === 'disk-low'
              ? 'DISK_LOW'
              : injectedError === 'media-failed'
                ? 'MEDIA_FAILED'
                : injectedError === 'rate-limit'
                  ? 'MEDIA_RATE_LIMIT'
                  : injectedError;
          expect(
            report.filter((entry) => Object.hasOwn(entry, 'stop')),
          ).toEqual([
            {
              stop: readbackVariant
                ? { code: 'PLATFORM_CHECK', reason: 'render-timeout' }
                : { code },
            },
          ]);
          const expectedReadback = !readbackVariant
            ? 'unchanged'
            : variant.startsWith('order-readback-failed')
              ? 'account-handle'
              : variant.startsWith('order-readback-account-changed')
                ? 'account-changed'
                : 'extensions-changed';
          expect(report).toEqual(
            expect.arrayContaining([
              { readback: { outcome: expectedReadback } },
            ]),
          );
          expect(
            notices.filter((text) => text.startsWith('Stop detail:')),
          ).toEqual([
            `Stop detail: ${readbackVariant ? 'render-timeout' : code}\n`,
          ]);
          for (const forbidden of [
            DETAIL_FIXTURE.id,
            FIXTURE.account.handle,
            'Generated private',
            'generated/private',
            DETAIL_FIXTURE.longText,
          ])
            expect(reportText).not.toContain(forbidden);
        }
        if (variant.startsWith('order-inline-quote-')) {
          const run = (await store.browserJournal()).runs.at(-1)!;
          expect(run).toMatchObject({
            canaryCounts: [
              expect.objectContaining({ matches: inlineQuoteKind === 'match' }),
            ],
          });
          if (inlineQuoteKind === 'match')
            expect(run).toMatchObject({
              canaryCounts: [
                {
                  stored: {
                    textLength: INLINE_QUOTE_FIXTURE.text.length,
                    photos: 0,
                    videos: 0,
                  },
                  shown: {
                    textLength: INLINE_QUOTE_FIXTURE.text.length,
                    photos: 0,
                    videos: 0,
                  },
                  matches: true,
                },
              ],
            });
        }
        if (variant === 'order-card-full-mismatch') {
          const run = (await store.browserJournal()).runs.at(-1)!;
          const report = JSON.parse(
            await readFile(
              join(directory, 'originals', `canary-${run.runId}.json`),
              'utf8',
            ),
          ) as unknown[];
          expect(run).toMatchObject({ endReason: 'done' });
          expect(report).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                mismatch: expect.objectContaining({
                  position: 1,
                  matches: false,
                }),
              }),
            ]),
          );
          expect(
            report.some((entry) => Object.hasOwn(entry as object, 'stop')),
          ).toBe(false);
          expect(notices).toContain(
            'Text or media differ on this post; the run goes on (1 of 3).\n',
          );
        }
        if (variant.startsWith('order-platform-')) {
          const reason =
            variant === 'order-platform-login'
              ? 'marker-login'
              : variant.startsWith('order-platform-account-readback-')
                ? 'account-handle'
                : variant === 'order-platform-answer-status'
                  ? 'answer-status'
                  : variant === 'order-platform-answer-type'
                    ? 'answer-type'
                    : variant === 'order-platform-answer-timeout'
                      ? 'answer-timeout'
                      : variant === 'order-platform-body-timeout'
                        ? 'body-timeout'
                        : 'render-timeout';
          expect(
            notices.filter((text) => text.startsWith('Stop detail:')),
          ).toEqual([`Stop detail: ${reason}\n`]);
          const run = (await store.browserJournal()).runs.at(-1)!;
          expect(outcome).toMatchObject({ reason });
          if (variant === 'order-platform-account-readback-canary') {
            expect(plan.canary).toBe(true);
            expect(
              notices.filter((text) => text.startsWith('Structure report:')),
            ).toHaveLength(2);
          }
          if (
            variant === 'order-platform-account-readback-full' ||
            variant === 'order-platform-render-timeout-full'
          )
            expect(plan.canary).toBe(false);
          const report = await readFile(
            join(directory, 'originals', `canary-${run.runId}.json`),
            'utf8',
          );
          expect(JSON.parse(report)).toEqual(
            expect.arrayContaining([
              { stop: { code: 'PLATFORM_CHECK', reason } },
              {
                readback: {
                  outcome:
                    variant === 'order-platform-login'
                      ? 'account-readback'
                      : variant.startsWith('order-platform-account-readback-')
                        ? 'account-handle'
                        : 'unchanged',
                },
              },
            ]),
          );
          expect(
            (JSON.parse(report) as Record<string, unknown>[]).filter((entry) =>
              Object.hasOwn(entry, 'stop'),
            ),
          ).toEqual([{ stop: { code: 'PLATFORM_CHECK', reason } }]);
          for (const forbidden of [
            DETAIL_FIXTURE.id,
            DETAIL_FIXTURE.longText,
            FIXTURE.account.handle,
            FIXTURE.account.key,
          ])
            expect(report).not.toContain(forbidden);
          expect(
            (await store.browserJournal()).attempts.map(
              (attempt) => attempt.state,
            ),
          ).toEqual([
            'sending',
            variant.startsWith('order-platform-account-readback-')
              ? 'read'
              : 'failed',
          ]);
          expect(
            (await store.read((tx) => tx.originals.get(DETAIL_FIXTURE.id)))
              ?.signedIn,
          ).toEqual(
            variant.startsWith('order-platform-account-readback-')
              ? expect.objectContaining({ status: 'read' })
              : null,
          );
        }
        if (variant.startsWith('order-empty-focal-')) {
          const accepted =
            variant === 'order-empty-focal-match' ||
            variant === 'order-empty-focal-continue';
          const original = await store.read((tx) =>
            tx.originals.get(DETAIL_FIXTURE.id),
          );
          expect(original).toEqual({
            ...workspace.originals[0]!,
            signedIn: accepted
              ? expect.objectContaining({
                  status: 'unavailable',
                  reason: 'EmptyResult',
                })
              : workspace.originals[0]!.signedIn,
          });
          const journal = await store.browserJournal();
          const run = journal.runs.at(-1)!;
          const attempts = journal.attempts.slice(0, 2);
          expect(attempts.map((attempt) => attempt.state)).toEqual([
            'sending',
            accepted ? 'unavailable' : 'failed',
          ]);
          const shape =
            variant === 'order-empty-focal-module' ||
            variant === 'order-empty-focal-unknown';
          if (shape) {
            expect(run.endReason).toBe('shape-changed');
            expect(notices.join('')).not.toContain(
              'X may require an account check',
            );
          } else
            expect(run).toMatchObject({
              canaryCounts: [
                expect.objectContaining({
                  stored: { textLength: 0, photos: 0, videos: 0 },
                  shown: { textLength: 0, photos: 0, videos: 0 },
                  matches: accepted,
                  absence: expect.objectContaining({
                    focalAbsent:
                      variant !== 'order-empty-focal-present' &&
                      variant !== 'order-empty-focal-late',
                    focalObserved:
                      variant === 'order-empty-focal-present' ||
                      variant === 'order-empty-focal-late',
                    errorObserved: variant === 'order-empty-focal-error',
                  }),
                }),
                ...(variant === 'order-empty-focal-continue'
                  ? [expect.objectContaining({ matches: true })]
                  : []),
              ],
            });
          expect(mediaRequests).toEqual([]);
          if (variant === 'order-empty-focal-continue') {
            expect(
              (
                await store.read((tx) =>
                  tx.originals.get(EMPTY_FOCAL_FIXTURE.nextId),
                )
              )?.signedIn?.status,
            ).toBe('read');
            expect(journal.attempts.map((attempt) => attempt.state)).toEqual([
              'sending',
              'unavailable',
              'sending',
              'read',
            ]);
          }
          if (accepted)
            expect(
              (await planFill(store, workspace.items[0]!.account.key)).rows,
            ).toEqual([]);
          for (const text of [
            EMPTY_FOCAL_FIXTURE.oldText,
            'Generated neighbour post',
          ]) {
            expect(JSON.stringify(journal)).not.toContain(text);
            expect(notices.join('')).not.toContain(text);
          }
        }
        if (variant.startsWith('order-parent-')) {
          const known = variant.startsWith('order-parent-notice-');
          const original = await store.read((tx) =>
            tx.originals.get(DETAIL_FIXTURE.id),
          );
          if (known) {
            expect(original).toMatchObject({
              text: NOTICE_PARENT_FIXTURE.focalText,
              parentId: NOTICE_PARENT_FIXTURE.parentId,
              chainAbove: 'partial',
              signedIn: { status: 'read' },
            });
            expect(
              await store.read((tx) =>
                tx.originals.get(NOTICE_PARENT_FIXTURE.parentId),
              ),
            ).toBeUndefined();
          } else expect(original?.signedIn?.status).not.toBe('read');
          const journal = await store.browserJournal();
          const run = journal.runs.at(-1)!;
          if (known)
            expect(run).toMatchObject({
              canaryCounts: [
                {
                  stored: {
                    textLength: NOTICE_PARENT_FIXTURE.focalText.length,
                    photos: 0,
                    videos: 0,
                  },
                  shown: {
                    textLength: NOTICE_PARENT_FIXTURE.focalText.length,
                    photos: 0,
                    videos: 0,
                  },
                  textBasis: 'innerText',
                  matches: true,
                },
              ],
            });
          const report = await readFile(
            join(directory, 'originals', `canary-${run.runId}.json`),
            'utf8',
          );
          const parsed = JSON.parse(report) as Record<string, unknown>[];
          if (known)
            expect(parsed).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ noticeParents: 1 }),
              ]),
            );
          else {
            expect(parsed).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  failure: variant.endsWith('module')
                    ? 'module-result-type'
                    : 'result-type',
                }),
              ]),
            );
            expect(
              parsed.every((entry) => !Object.hasOwn(entry, 'noticeParents')),
            ).toBe(true);
          }
          for (const text of [
            NOTICE_PARENT_FIXTURE.text,
            NOTICE_PARENT_FIXTURE.focalText,
            NOTICE_PARENT_FIXTURE.parentId,
            DETAIL_FIXTURE.id,
          ])
            expect(report).not.toContain(text);
          for (const text of [
            NOTICE_PARENT_FIXTURE.text,
            NOTICE_PARENT_FIXTURE.focalText,
          ]) {
            expect(JSON.stringify(journal)).not.toContain(text);
            expect(notices.join('')).not.toContain(text);
          }
        }
        if (variant.startsWith('order-notice-')) {
          const original = await store.read((tx) =>
            tx.originals.get(DETAIL_FIXTURE.id),
          );
          expect(original?.signedIn).toMatchObject({
            status: 'tombstone',
            reason: NOTICE_ALIGNMENT_FIXTURE.focalText,
          });
          const matched = ![
            'wrong-focal',
            'wrong-parent',
            'missing-candidate',
          ].includes(noticeKind);
          const journal = await store.browserJournal();
          expect(journal.runs.at(-1)).toMatchObject({
            canaryCounts: [
              {
                stored: { textLength: 0, photos: 0, videos: 0 },
                shown: { textLength: 0, photos: 0, videos: 0 },
                matches: matched,
                notices: {
                  beforeFocal: noticeKind === 'normal-parent-reply' ? 0 : 1,
                  candidatesSeen: noticeKind === 'missing-candidate' ? 1 : 2,
                  matchedIndex: matched
                    ? noticeKind === 'normal-parent-reply'
                      ? 0
                      : 1
                    : null,
                },
              },
            ],
          });
          const report = await readFile(
            join(
              directory,
              'originals',
              `canary-${journal.runs.at(-1)!.runId}.json`,
            ),
            'utf8',
          );
          for (const text of [
            NOTICE_ALIGNMENT_FIXTURE.focalText,
            NOTICE_ALIGNMENT_FIXTURE.parentText,
            NOTICE_ALIGNMENT_FIXTURE.replyText,
          ]) {
            expect(JSON.stringify(journal)).not.toContain(text);
            expect(notices.join('')).not.toContain(text);
            expect(report).not.toContain(text);
          }
        }
        if (variant.startsWith('order-textcontent-')) {
          const original = await store.read((tx) =>
            tx.originals.get(DETAIL_FIXTURE.id),
          );
          const storedText = textContentStoredText(textContentKind);
          expect(original?.text).toBe(storedText);
          expect(original?.media[0]).toMatchObject({
            kind: 'photo',
            status: 'stored',
          });
          const accepted =
            variant === 'order-textcontent-mention' ||
            variant === 'order-textcontent-hidden-link';
          const lengths = accepted
            ? {
                textLength:
                  textContentKind === 'hidden-link'
                    ? storedText.replace(
                        TEXT_CONTENT_FIXTURE.linkUrl,
                        TEXT_CONTENT_FIXTURE.linkHiddenPrefix +
                          TEXT_CONTENT_FIXTURE.linkVisibleText,
                      ).length
                    : storedText.length,
                photos: 1,
                videos: 0,
              }
            : undefined;
          const journal = await store.browserJournal();
          expect(journal.runs.at(-1)).toMatchObject({
            canaryCounts: [
              {
                ...(lengths ? { stored: lengths, shown: lengths } : {}),
                textBasis: accepted ? 'textContent' : 'none',
                matches: accepted,
              },
            ],
          });
          expect(JSON.stringify(journal)).not.toContain(storedText);
          expect(notices.join('')).not.toContain(storedText);
        }
        if (variant === 'order-module-item-ids') {
          const original = await store.read((tx) =>
            tx.originals.get(DETAIL_FIXTURE.id),
          );
          expect(original).toMatchObject({
            text: DETAIL_FIXTURE.longText,
            chainAbove: 'complete',
            signedIn: { status: 'read' },
          });
          expect(
            await store.read((tx) =>
              tx.originals.get(MODULE_ITEM_IDS_FIXTURE.emptyId),
            ),
          ).toBeUndefined();
          expect(
            await store.read(async (tx) => {
              const ids: string[] = [];
              for await (const original of tx.originals.iterate())
                ids.push(original.id);
              return ids;
            }),
          ).toEqual([DETAIL_FIXTURE.id]);
          const run = (await store.browserJournal()).runs.at(-1)!;
          expect(run).toMatchObject({
            endReason: 'canary',
            canaryCounts: [{ matches: true }],
          });
          const report = await readFile(
            join(directory, 'originals', `canary-${run.runId}.json`),
            'utf8',
          );
          expect(JSON.parse(report)).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                emptyResults: MODULE_ITEM_IDS_FIXTURE.emptyItems,
              }),
            ]),
          );
          for (const forbidden of [
            MODULE_ITEM_IDS_FIXTURE.emptyId,
            DETAIL_FIXTURE.id,
            DETAIL_FIXTURE.longText,
          ])
            expect(report).not.toContain(forbidden);
        }
        if (variant === 'order-empty-results') {
          const original = await store.read((tx) =>
            tx.originals.get(DETAIL_FIXTURE.id),
          );
          expect(original).toMatchObject({
            text: DETAIL_FIXTURE.longText,
            chainAbove: 'complete',
            signedIn: { status: 'read' },
          });
          for (const id of [
            EMPTY_RESULTS_FIXTURE.rootId,
            EMPTY_RESULTS_FIXTURE.parentId,
          ])
            expect(
              (await store.read((tx) => tx.originals.get(id)))?.signedIn
                ?.status,
            ).toBe('read');
          expect(
            await store.read((tx) =>
              tx.originals.get(EMPTY_RESULTS_FIXTURE.emptyId),
            ),
          ).toBeUndefined();
          expect(
            await store.read((tx) =>
              tx.originals.get(EMPTY_RESULTS_FIXTURE.replyId),
            ),
          ).toBeUndefined();
          const journal = await store.browserJournal();
          const report = await readFile(
            join(
              directory,
              'originals',
              `canary-${journal.runs.at(-1)!.runId}.json`,
            ),
            'utf8',
          );
          expect(JSON.parse(report)).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                emptyResults: EMPTY_RESULTS_FIXTURE.skipped,
              }),
            ]),
          );
          expect(report).not.toContain(EMPTY_RESULTS_FIXTURE.emptyId);
          expect(journal.runs.at(-1)).toMatchObject({
            canaryCounts: [
              {
                stored: {
                  textLength: DETAIL_FIXTURE.longText.length,
                  photos: 0,
                  videos: 0,
                },
                shown: {
                  textLength: DETAIL_FIXTURE.longText.length,
                  photos: 0,
                  videos: 0,
                },
                matches: true,
              },
            ],
          });
        }
        if (variant === 'order-match') {
          const run = (await store.browserJournal()).runs.at(-1)!;
          const report = JSON.parse(
            await readFile(
              join(directory, 'originals', `canary-${run.runId}.json`),
              'utf8',
            ),
          ) as Record<string, unknown>[];
          expect(report.length).toBeGreaterThan(0);
          expect(
            report.every((entry) => !Object.hasOwn(entry, 'emptyResults')),
          ).toBe(true);
          expect(
            report.every((entry) => !Object.hasOwn(entry, 'noticeParents')),
          ).toBe(true);
        }
        if (variant.startsWith('order-protected-')) {
          const expected = protectedNoticeText(
            variant === 'order-protected-en' ? 'en' : 'de',
            variant === 'order-protected-long-tail' ||
              variant === 'order-protected-long-match',
          );
          const original = await store.read((tx) =>
            tx.originals.get(DETAIL_FIXTURE.id),
          );
          expect(original?.signedIn).toMatchObject({
            status: 'tombstone',
            reason: expected.slice(0, 500),
          });
          const journal = await store.browserJournal();
          expect(journal.runs.at(-1)).toMatchObject({
            canaryCounts: [
              {
                stored: { textLength: 0, photos: 0, videos: 0 },
                shown: { textLength: 0, photos: 0, videos: 0 },
                matches:
                  variant === 'order-protected-de' ||
                  variant === 'order-protected-en' ||
                  variant === 'order-protected-duplicate' ||
                  variant === 'order-protected-long-match',
              },
            ],
          });
          expect(JSON.stringify(journal)).not.toContain(expected.slice(0, 100));
          expect(notices.join('')).not.toContain(expected.slice(0, 100));
          const report = await readFile(
            join(
              directory,
              'originals',
              `canary-${journal.runs.at(-1)!.runId}.json`,
            ),
            'utf8',
          );
          expect(report).not.toContain(expected.slice(0, 100));
          expect(mediaRequests).toEqual([]);
        }
        if (variant.startsWith('order-note-')) {
          const original = await store.read((tx) =>
            tx.originals.get(DETAIL_FIXTURE.id),
          );
          expect(original?.text).toBe(NOTE_RENDER_FIXTURE.text);
          expect(original?.media[0]).toMatchObject({
            kind: 'photo',
            status: 'stored',
          });
          expect((await store.browserJournal()).runs.at(-1)).toMatchObject({
            canaryCounts: [
              {
                stored: {
                  textLength: NOTE_RENDER_FIXTURE.text.length,
                  photos: 1,
                  videos: 0,
                },
                shown: {
                  textLength: NOTE_RENDER_FIXTURE.text.length,
                  photos: variant === 'order-note-missing-photo' ? 0 : 1,
                  videos: 0,
                },
                matches: variant !== 'order-note-missing-photo',
              },
            ],
          });
        }
        if (variant.startsWith('order-visibility-')) {
          const run = (await store.browserJournal()).runs.at(-1)!;
          const ids = [
            DETAIL_FIXTURE.id,
            ...(variant === 'order-visibility-family'
              ? [GATED_MEDIA_FIXTURE.parentId, GATED_MEDIA_FIXTURE.quotedId]
              : []),
          ];
          for (const id of ids) {
            const original = await store.read((tx) => tx.originals.get(id));
            expect(original?.text).toBe(
              GATED_MEDIA_FIXTURE.text + ' ' + GATED_MEDIA_FIXTURE.mediaLink,
            );
            expect(original?.signedIn?.status).toBe('read');
            expect(original?.signedInRecord?.mediaDetails).toEqual([]);
            if (variant === 'order-visibility-stored') {
              expect(original?.media).toEqual(workspace.originals[0]!.media);
              expect(
                await readFile(join(directory, 'originals', id, '1.mp4')),
              ).toEqual(Buffer.from(GATED_MEDIA_FIXTURE.mp4Base64, 'base64'));
            } else {
              expect(original?.media).toHaveLength(1);
              expect(original?.media[0]).toMatchObject({
                kind: id === GATED_MEDIA_FIXTURE.parentId ? 'photo' : 'video',
                status: 'not-stored',
                url: null,
                file: null,
                poster: null,
              });
            }
          }
          if (variant !== 'order-visibility-full')
            expect(run).toMatchObject({
              canaryCounts: [
                {
                  stored: {
                    textLength: GATED_MEDIA_FIXTURE.text.length,
                    photos: 0,
                    videos: 0,
                  },
                  shown: {
                    textLength: GATED_MEDIA_FIXTURE.text.length,
                    photos: 0,
                    videos:
                      variant === 'order-visibility-exposed' ||
                      variant === 'order-visibility-late-player'
                        ? 1
                        : 0,
                  },
                  matches:
                    variant !== 'order-visibility-exposed' &&
                    variant !== 'order-visibility-late-player',
                },
              ],
            });
          const reportText = await readFile(
            join(directory, 'originals', `canary-${run.runId}.json`),
            'utf8',
          );
          const reports = JSON.parse(reportText) as {
            gated?: { posts: number; mediaItems: number };
          }[];
          const counts = { posts: ids.length, mediaItems: ids.length };
          expect(reports.filter((entry) => entry.gated).at(-1)?.gated).toEqual(
            counts,
          );
          expect(notices.join('')).toContain(
            `Gated media: ${JSON.stringify(counts)}`,
          );
          for (const forbidden of [
            ...ids,
            GATED_MEDIA_FIXTURE.text,
            GATED_MEDIA_FIXTURE.videoUrl,
            GATED_MEDIA_FIXTURE.posterUrl,
            'AgeVerificationPrompt',
          ])
            expect(reportText).not.toContain(forbidden);
          expect(mediaRequests).toEqual([]);
          expect(requests).not.toContain('/generated-reveal');
          const replay = await fetchOriginals(
            {
              workspace: directory,
              signal: abort.signal,
              now: () => new Date(now),
            },
            {
              baseUrl: 'http://127.0.0.1:4231',
              media: {
                ...productionMedia,
                origin: 'http://127.0.0.1:4231',
                free: () => Promise.resolve(10 * 1024 ** 3),
              },
            },
          );
          expect(replay.data.attempted).toBe(0);
          expect(mediaRequests).toEqual([]);
          for (const id of ids)
            expect(
              (await store.read((tx) => tx.originals.get(id)))?.signedInRecord
                ?.mediaDetails,
            ).toEqual([]);
        }
        expect(context!.pages()).toHaveLength(0);
        expect(requests.filter((path) => path === '/home')).toHaveLength(1);
        return;
      }
      if (variant === 'german-ended') {
        await expect(page.locator('html')).toHaveAttribute('lang', 'de');
        await expect(page.locator('#continue')).toHaveText('Weiter');
        await expect(page.locator('#matches')).toHaveText('Passt');
        await expect(page.locator('#does-not-match')).toHaveText('Passt nicht');
        await expect(page.locator('#stop')).toHaveText('Stopp');
        await page.locator('#start').click();
        await expect(page.locator('#result')).toContainText('Beendet');
        expect(notices.join('')).toContain('Schließe das X-Fenster');
        expect((await page.request.get(page.url())).status()).toBe(200);
        await context!.close();
        expect(await result).toMatchObject({ code: 'PLATFORM_CHECK' });
        return;
      }
      await expect(
        page.getByRole('button', { name: 'Start', exact: true }),
      ).toBeVisible();
      expect(requests).toEqual([]);
      await expect(page.locator('#account')).toHaveText(
        `Expected X account: @${FIXTURE.account.handle}`,
      );
      if (variant === 'flag-account')
        await page.screenshot({
          path: testInfo.outputPath('expected-account.png'),
          fullPage: true,
        });
      if (variant === 'extension') {
        await mkdir(
          join(profile, 'Default', 'Extensions', 'b'.repeat(32), '1.0'),
          { recursive: true },
        );
        await page.getByRole('button', { name: 'Start', exact: true }).click();
        await expect
          .poll(async () =>
            Boolean((await store.browserJournal()).runs.at(-1)?.endedAt),
          )
          .toBe(true);
        expect(await result).toMatchObject({ code: 'PLATFORM_CHECK' });
        expect(requests).toEqual([]);
        const run = (await store.browserJournal()).runs.at(-1)!;
        const report = JSON.parse(
          await readFile(
            join(profile, `socialprune-readback-${run.runId}.json`),
            'utf8',
          ),
        ) as { extensionIdsBefore: string[]; extensionIdsAfter: string[] };
        expect(report.extensionIdsBefore).toEqual([preinstalledId]);
        expect(report.extensionIdsAfter).toEqual([
          preinstalledId,
          'b'.repeat(32),
        ]);
        return;
      }
      await expect(page.locator('#warning')).toHaveText(FILL_WARNING.en);
      if (variant === 'stop') {
        await page.getByRole('button', { name: 'Stop', exact: true }).click();
        expect(await result).toMatchObject({ code: 'CANCELLED' });
        expect(requests).toEqual([]);
        return;
      }
      if (variant === 'stale') {
        await store.write(async (tx) => {
          const record = (await tx.originals.get(DETAIL_FIXTURE.id))!;
          await tx.originals.put({
            ...record,
            anonymous: { status: 'fetched', at: '2026-10-13T00:00:00.000Z' },
          });
        });
        await page.getByRole('button', { name: 'Start', exact: true }).click();
        expect(await result).toMatchObject({
          code: 'STALE_PLAN',
          message:
            'The plan changed. Make a new dry run and use its plan hash.',
        });
        expect(requests).toEqual([]);
        return;
      }
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      if (variant === 'flag-account-mismatch') {
        expect(await result).toMatchObject({ code: 'ACCOUNT_MISMATCH' });
        expect(requests.every((path) => path === '/home')).toBe(true);
        const journal = await store.browserJournal();
        expect(journal.attempts).toEqual([]);
        expect(journal.runs.at(-1)?.pageOpens ?? 0).toBe(0);
        expect(journal.runs.at(-1)?.endedAt).not.toBeNull();
        expect(
          (await store.read((tx) => tx.originals.get(DETAIL_FIXTURE.id)))
            ?.signedIn,
        ).toBeNull();
        return;
      }
      if (variant === 'shared-cap') {
        await expect
          .poll(async () =>
            Boolean(
              (await store.browserJournal()).runs.find(
                (run) => run.runId !== 'generated-prior-delete',
              )?.endedAt,
            ),
          )
          .toBe(true);
        expect(await result).toMatchObject({
          completed: 0,
          endReason: 'daily-cap',
        });
        expect(
          requests.filter((path) => path.startsWith('/i/api/graphql/')),
        ).toEqual([]);
        return;
      }
      if (
        [
          'missing-id',
          'login',
          'challenge',
          'limit',
          '429',
          'never',
          'unexpected',
          'unknown-module',
          'no-focal-entry',
        ].includes(variant)
      ) {
        await expect
          .poll(async () =>
            Boolean((await store.browserJournal()).runs.at(-1)?.endedAt),
          )
          .toBe(true);
        expect(await result).toMatchObject({
          code:
            variant === 'missing-id' ||
            variant === 'unknown-module' ||
            variant === 'no-focal-entry'
              ? 'SHAPE_CHANGED'
              : variant === 'unexpected'
                ? 'UNEXPECTED_ACTION'
                : 'PLATFORM_CHECK',
        });
        if (
          variant === 'missing-id' ||
          variant === 'unknown-module' ||
          variant === 'no-focal-entry'
        ) {
          const run = (await store.browserJournal()).runs.at(-1)!;
          const report = JSON.parse(
            await readFile(
              join(directory, 'originals', `canary-${run.runId}.json`),
              'utf8',
            ),
          ) as { failure?: string }[];
          expect(report[0]?.failure).toBe(
            variant === 'missing-id'
              ? 'rest_id'
              : variant === 'unknown-module'
                ? 'module-result-type'
                : 'no-entry',
          );
          expect(JSON.stringify(report)).not.toContain('Generated secret');
          expect(JSON.stringify(report)).not.toContain('@private_decoy');
          expect(JSON.stringify(report)).not.toContain('12345678901234567890');
        }
        return;
      }
      await expect(
        page.getByRole('button', { name: 'Continue', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      if (variant === 'canary-five')
        for (let i = 1; i < 5; i++) {
          await expect(
            page.getByRole('button', { name: 'Continue', exact: true }),
          ).toBeVisible();
          await page
            .getByRole('button', { name: 'Continue', exact: true })
            .click();
        }
      await expect(
        page.getByRole('button', { name: 'Matches', exact: true }),
      ).toBeVisible();
      if (variant === 'extension-at-matches')
        await mkdir(
          join(profile, 'Default', 'Extensions', 'b'.repeat(32), '1.0'),
          { recursive: true },
        );
      await page
        .getByRole('button', {
          name: variant === 'does-not-match' ? 'Does not match' : 'Matches',
          exact: true,
        })
        .click();
      if (variant === 'extension-at-matches') {
        expect(await result).toMatchObject({ code: 'PLATFORM_CHECK' });
        expect((await store.browserJournal()).runs.at(-1)).toMatchObject({
          endReason: 'platform-check',
          canaryAcceptedAt: null,
        });
        return;
      }
      expect(await result).toMatchObject({
        completed: variant === 'canary-five' ? 5 : 1,
        endReason: 'canary',
      });
      if (variant === 'success') {
        const run = (await store.browserJournal()).runs.at(-1)!;
        const report = JSON.parse(
          await readFile(
            join(profile, `socialprune-readback-${run.runId}.json`),
            'utf8',
          ),
        ) as {
          extensionIdsBefore: string[];
          extensionIdsAfter: string[];
          extensionsDisabled: boolean;
        };
        expect(report).toMatchObject({
          extensionIdsBefore: [preinstalledId],
          extensionIdsAfter: [preinstalledId],
          extensionsDisabled: true,
        });
      }
      if (variant === 'external-aborted') {
        const run = (await store.browserJournal()).runs.at(-1)!;
        const report = JSON.parse(
          await readFile(
            join(profile, `socialprune-readback-${run.runId}.json`),
            'utf8',
          ),
        ) as { abortedHosts: Record<string, number> };
        expect(report.abortedHosts['127.0.0.1:4239']).toBe(1);
      }
      if (variant === 'delayed-many')
        expect(requests.filter((path) => path === '/home')).toHaveLength(1);
      if (variant === 'removed') {
        const run = (await store.browserJournal()).runs.at(-1)!;
        const report = JSON.parse(
          await readFile(
            join(profile, `socialprune-readback-${run.runId}.json`),
            'utf8',
          ),
        ) as { extensionIdsRemoved: string[]; extensionIdsAdded: string[] };
        expect(report.extensionIdsRemoved).toEqual([
          preinstalledId,
          'b'.repeat(32),
        ]);
        expect(report.extensionIdsAdded).toEqual([]);
      }
      if (variant === 'canary-five') {
        const sends = (await store.browserJournal()).attempts.filter(
          (attempt) => attempt.state === 'sending',
        );
        expect(sends).toHaveLength(5);
        for (let i = 1; i < sends.length; i++)
          expect(
            Date.parse(sends[i]!.at) - Date.parse(sends[i - 1]!.at),
          ).toBeGreaterThanOrEqual(5);
        expect(waits.filter((ms) => ms === 11)).toHaveLength(2);
        expect((await planFill(store, FIXTURE.account.key)).canary).toBe(false);
        expect((await planFill(store, FIXTURE.account.key)).rows).toHaveLength(
          1,
        );
      }
      const original = await store.read((tx) =>
        tx.originals.get(variant === 'canary-five' ? '915' : DETAIL_FIXTURE.id),
      );
      if (variant === 'unavailable' || variant === 'tombstone') {
        expect(original?.signedIn?.status).toBe(variant);
        expect(original?.text).toBe('Generated beginning');
      } else expect(original?.text).toBe(DETAIL_FIXTURE.longText);
      if (variant === 'module-cursor') {
        expect(original?.parentId).toBe('902');
        expect(original?.chainAbove).toBe('complete');
        expect(
          (await store.read((tx) => tx.originals.get('902')))?.parentId,
        ).toBe('901');
        expect((await store.read((tx) => tx.originals.get('901')))?.text).toBe(
          DETAIL_FIXTURE.text,
        );
      }
      for (const secret of DETAIL_FIXTURE.forbidden)
        expect(JSON.stringify(original)).not.toContain(secret);
      if (variant === 'does-not-match')
        expect(
          (await store.browserJournal()).runs[0]?.canaryAcceptedAt,
        ).toBeNull();
      else
        expect(
          (await store.browserJournal()).runs[0]?.canaryAcceptedAt,
        ).not.toBeNull();
    } finally {
      releaseHome();
      abort.abort();
      await context?.close();
      await expect.poll(() => profileInUse(profile)).toBe(false);
      await running;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await store.close();
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  });

test('the fake gated-media recorder observes a real ungated video and poster download control', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'socialprune-gated-media-control-'),
  );
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    const video = request.url === '/generated-gated.mp4';
    response.setHeader('Content-Type', video ? 'video/mp4' : 'image/png');
    response.end(
      Buffer.from(
        video
          ? GATED_MEDIA_FIXTURE.mp4Base64
          : DISPLAY_COMPARISON_FIXTURE.pngBase64,
        'base64',
      ),
    );
  });
  await new Promise<void>((resolve) =>
    server.listen(4231, '127.0.0.1', resolve),
  );
  try {
    const result = extract(
      gatedMediaAnswer(DETAIL_FIXTURE.id),
      DETAIL_FIXTURE.id,
      { instruction: null },
    );
    if (result.kind !== 'read')
      throw new Error('Generated gated control was not read.');
    const origin = 'http://127.0.0.1:4231';
    const original = {
      ...result.post,
      anonymous: null,
      signedIn: null,
      media: [
        { ...result.post.media[0]!, url: origin + '/generated-gated.mp4' },
      ],
      signedInRecord: {
        ...result.post.signedInRecord!,
        mediaDetails: [
          {
            type: 'video' as const,
            media_url_https: origin + '/generated-gated-poster.png',
            ext_alt_text: null,
            video_info: {
              duration_millis: 1200,
              variants: [
                {
                  content_type: 'video/mp4' as const,
                  url: origin + '/generated-gated.mp4',
                },
              ],
            },
          },
        ],
      },
    };
    await storeOriginalMedia(
      directory,
      original,
      new SyndicationClient({ baseUrl: origin }),
      {
        videoBytes: 1024 ** 3,
        runBytes: 20 * 1024 ** 3,
        used: 0,
        lastStart: 0,
        failures: 0,
      },
      new AbortController().signal,
      {
        ...productionMedia,
        origin,
        free: () => Promise.resolve(10 * 1024 ** 3),
        sleep: () => Promise.resolve(),
      },
    );
    expect(requests).toEqual([
      '/generated-gated.mp4',
      '/generated-gated-poster.png',
    ]);
    expect(original.media[0]).toMatchObject({
      status: 'stored',
      file: '1.mp4',
      poster: '1-poster.png',
    });
    expect(
      await readFile(join(directory, 'originals', DETAIL_FIXTURE.id, '1.mp4')),
    ).toEqual(Buffer.from(GATED_MEDIA_FIXTURE.mp4Base64, 'base64'));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});

test('confirmation page loads only its same-origin stylesheet and rejects a second-origin style and connection', async ({
  page,
}) => {
  let hits = 0;
  const decoy = createServer((_request, response) => {
    hits++;
    response.setHeader('Content-Type', 'text/css');
    response.end('body{color:red}');
  });
  await new Promise<void>((resolve) =>
    decoy.listen(4238, '127.0.0.1', resolve),
  );
  const server = await startConfirmation(
    {
      lang: 'de',
      phase: 'start',
      expectedHandle: 'generated',
      warning: 'Generierte Warnung',
      profileWarning: 'Generiertes Profil',
      planned: 1,
      bulk: 0,
      estimateMs: 30000,
      list: 'generierte-liste.txt',
      rows: [],
      completed: 0,
      result: 'Beobachte die Stichprobe.',
    },
    4232,
  );
  try {
    await page.addInitScript(() => {
      const directives: string[] = [];
      Reflect.set(window, '__confirmationViolations', directives);
      document.addEventListener('securitypolicyviolation', (event) =>
        directives.push(event.effectiveDirective),
      );
    });
    const response = await page.goto(server.launchUrl);
    expect(response?.headers()['content-security-policy']).toBe(REVIEW_POLICY);
    expect(
      await page
        .locator('meta[http-equiv="Content-Security-Policy"]')
        .getAttribute('content'),
    ).toBe(REVIEW_POLICY);
    await expect(page.locator('#start')).toBeVisible();
    expect(
      await page
        .locator('#start')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe('rgb(37, 77, 190)');
    expect(
      (await page.request.get(server.url + 'confirmation.css')).headers()[
        'content-type'
      ],
    ).toBe('text/css; charset=utf-8');
    await page.evaluate(() => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'http://127.0.0.1:4238/decoy.css';
      document.head.appendChild(link);
    });
    expect(
      await page.evaluate(async () => {
        try {
          await fetch('http://127.0.0.1:4238/decoy');
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () => Reflect.get(window, '__confirmationViolations') as string[],
        ),
      )
      .toEqual(expect.arrayContaining(['style-src-elem', 'connect-src']));
    expect(hits).toBe(0);
  } finally {
    await server.close();
    decoy.closeAllConnections();
    await new Promise<void>((resolve) => decoy.close(() => resolve()));
  }
});
