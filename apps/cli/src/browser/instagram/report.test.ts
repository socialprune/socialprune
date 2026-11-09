import { expect, test } from 'vitest';
import {
  contextCause,
  ContextCauseSchema,
  stopDetails,
  ContextStop,
  AccountCheckSchema,
  AccountReadbackSchema,
  accountClass,
  stopDetailText,
  errorClass,
  RuntimeReportSchema,
  ownFunction,
  ContextStepReportSchema,
  RunMemorySchema,
  RowShapeDiagnosticSchema,
  ReplyScopeDiagnosticSchema,
  ReplyAnswerDiagnosticSchema,
  NewestProbeSchema,
  SortControlStructureSchema,
  ReplyExpansionDiagnosticSchema,
  WidenedProbeSchema,
} from './report.ts';
import { emptyReplyScope } from './replies.ts';
import { rowShape } from './row-shape.ts';
import { IG_FIXTURE } from '../../../e2e/fake-instagram/fixture.ts';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { replyAnswerDiagnostic } from './replies-answer.ts';
import { emptySortDiagnostic } from './newest-sort.ts';
import { emptyProbeView } from './list-probe.ts';
import { emptySortStructure } from './sort-structure.ts';
import { widenedWindow } from './widened-probe.ts';

test('POSTCLICK diagnostics reject contents, arbitrary stop sites and extra windows', () => {
  const expansion = {
    stopAt: 'postclick-no-growth',
    clicks: [
      {
        clicked: true,
        rowsBefore: 0,
        rowsAfter: 0,
        controlsAfter: { count: 0, capped: false, controls: [] },
        candidatesAfter: {
          li: 0,
          ul: 0,
          roleLists: 0,
          divButtons: 1,
          commentPermalinks: 1,
          datedTimes: 1,
          ownHandleLinks: 1,
        },
        nestedListAppeared: false,
        observationFailed: false,
      },
    ],
  };
  expect(ReplyExpansionDiagnosticSchema.safeParse(expansion).success).toBe(
    true,
  );
  for (const mutation of [
    { text: 'Generated private content' },
    { stopAt: 'private label' },
    { clicks: Array(11).fill(expansion.clicks[0]) },
  ])
    expect(
      ReplyExpansionDiagnosticSchema.safeParse({ ...expansion, ...mutation })
        .success,
    ).toBe(false);
  const probe = {
    radiusDays: 7,
    filter: {
      readbackObserved: true,
      startMatches: true,
      endMatches: true,
      applied: true,
    },
    initial: emptyProbeView(),
    scrolls: [],
    scrollCount: 0,
    observationFailed: false,
    timeoutWait: null,
    failedStep: 'none',
  };
  expect(WidenedProbeSchema.safeParse(probe).success).toBe(true);
  for (const mutation of [
    { radiusDays: 8 },
    { date: '2025-01-01' },
    { scrollCount: 4 },
    { failedStep: 'private label' },
  ])
    expect(
      WidenedProbeSchema.safeParse({ ...probe, ...mutation }).success,
    ).toBe(false);
});
test('ROWTEXT row diagnostics reject contents, arbitrary tags and over-cap row observations', () => {
  const row = {
    index: 0,
    observed: true,
    observationFailed: false,
    directChildCount: 2,
    childrenCapped: false,
    children: [
      { tag: 'div', role: null },
      { tag: 'div', role: 'button' },
    ],
    divBlocks: 1,
    spansByDepth: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ownHandleLinks: 0,
    authorLinks: 1,
    authorDistinctHrefs: 1,
    permalinks: 1,
    times: 1,
    permalinkDepths: [2],
    deeperPermalinks: 0,
    extraction: 'adjacent',
    failedStep: 'none',
  };
  const report = { stopAt: null, clicks: [], rows: [row] };
  expect(ReplyExpansionDiagnosticSchema.safeParse(report).success).toBe(true);
  for (const changed of [
    { ...row, text: 'Generated content' },
    { ...row, failedStep: 'private error' },
    { ...row, children: [{ tag: 'generated-element', role: null }] },
    { ...row, spansByDepth: [1, 2, 3, 4, 5] },
  ])
    expect(
      ReplyExpansionDiagnosticSchema.safeParse({ ...report, rows: [changed] })
        .success,
    ).toBe(false);
  expect(
    ReplyExpansionDiagnosticSchema.safeParse({
      ...report,
      rows: Array(51).fill(row),
    }).success,
  ).toBe(false);
});
test('SOLEDIAG rejects content and arbitrary gate names in the sole-comment report', () => {
  const base = {
    observed: true,
    observationFailed: false,
    answerNamesFocal: true,
    answerValid: true,
    childCountProofSource: 'script',
    childCountProofClass: 'zero',
    answerCommentSetSize: 1,
    captionEntriesExcluded: 1,
    answerSetValid: true,
    answerTraversalCapped: false,
    declaredCountSeen: 0,
    declaredCountsAllOne: null,
    pageMainCount: 1,
    pageFocalPermalinks: 1,
    pagePermalinks: 1,
    pageSamePostPermalinks: 1,
    pageReplyControls: 0,
    pageOwnReplyControls: 0,
    pageForeignReplyControls: 0,
    pageExpandControls: 0,
    pageReplyCounters: 0,
    pageRows: 0,
    focalPresent: true,
    focalPermalinks: 1,
    focalTimes: 2,
    focalTimeKinds: {
      observed: true,
      capped: false,
      inFocalPermalink: 1,
      inOtherCommentPermalink: 0,
      inPostPermalink: 1,
      inSamePostPermalink: 1,
      unlinked: 0,
    },
    focalRows: 0,
    focalControls: 0,
    replyControlDecision: 'absent',
    firstFailedGate: 'none',
  };
  const parse = (sole: unknown, zeroDecision?: unknown) =>
    ContextStepReportSchema.safeParse({
      replyScope: {
        ...emptyReplyScope(),
        soleComment: sole,
        ...(zeroDecision === undefined ? {} : { zeroDecision }),
      },
    }).success;
  expect(parse(base)).toBe(true);
  expect(parse(base, 'sole-zero')).toBe(true);
  expect(parse(base, 'read-normally')).toBe(true);
  expect(parse(base, 'zero')).toBe(false);
  expect(parse({ ...base, replyControlDecision: 'read-normally' })).toBe(true);
  const unlinkedTime = {
    evaluated: true,
    locationClass: 'image-sibling',
    ancestorLink: 'none',
    outsideFocalRow: true,
    outsidePermalinks: true,
    datetimeEqualsCaption: true,
    admitted: true,
  };
  expect(parse({ ...base, unlinkedTime })).toBe(true);
  expect(
    parse({
      ...base,
      unlinkedTime: {
        ...unlinkedTime,
        datetimeEqualsCaption: null,
        notComparable: 'caption-absent',
        admitted: false,
      },
    }),
  ).toBe(true);
  for (const invalid of [
    { ...unlinkedTime, locationClass: 'Generated private container' },
    { ...unlinkedTime, ancestorLink: '/generated_owner/' },
    { ...unlinkedTime, notComparable: 'generated-reason' },
    { ...unlinkedTime, datetime: '2024-12-31T00:00:00.000Z' },
    { ...unlinkedTime, captionSeconds: 1735603200 },
    { ...unlinkedTime, datetimeEqualsCaption: 'true' },
    { ...unlinkedTime, admitted: undefined },
  ])
    expect(parse({ ...base, unlinkedTime: invalid })).toBe(false);
  for (const invalid of [
    { ...base, replyControlDecision: 'Generated private control text' },
    { ...base, captionEntriesExcluded: -1 },
    { ...base, pageReplyCounters: '1' },
    { ...base, text: 'Generated private text' },
    { ...base, firstFailedGate: 'generated-message' },
    { ...base, declaredCountSeen: -1 },
    { ...base, pagePermalinks: '1' },
    { ...base, pageOwnReplyControls: -1 },
    { ...base, pageForeignReplyControls: '1' },
    {
      ...base,
      focalTimeKinds: {
        observed: true,
        capped: false,
        inFocalPermalink: 1,
        inOtherCommentPermalink: 0,
        inPostPermalink: 1,
        inSamePostPermalink: 1,
        unlinked: 0,
        text: 'Generated private',
      },
    },
    {
      ...base,
      focalTimeKinds: {
        observed: true,
        capped: false,
        inFocalPermalink: -1,
        inOtherCommentPermalink: 0,
        inPostPermalink: 1,
        inSamePostPermalink: 1,
        unlinked: 0,
      },
    },
    {
      ...base,
      focalTimeKinds: {
        observed: true,
        capped: false,
        inFocalPermalink: 1,
        inOtherCommentPermalink: 0,
        inPostPermalink: 1,
        unlinked: 0,
      },
    },
    {
      ...base,
      answerExtraEntries: {
        captionObjects: 1,
        otherParentReferences: 0,
        focalChildReferences: 0,
        unresolvedObjects: 0,
        duplicateFocalObjects: 0,
        text: 'Generated private text',
      },
    },
    {
      ...base,
      answerExtraEntries: {
        captionObjects: -1,
        otherParentReferences: 0,
        focalChildReferences: 0,
        unresolvedObjects: 0,
        duplicateFocalObjects: 0,
      },
    },
  ])
    expect(parse(invalid)).toBe(false);
});
test('STALL deadline partial report contains only a closed stage and measured budget', () => {
  const deadline = {
    budgetMs: 120000,
    elapsedMs: 120001,
    stage: 'answers',
    expired: true,
  };
  expect(
    ContextStepReportSchema.safeParse({ deadline, result: 'step-deadline' })
      .success,
  ).toBe(true);
  for (const invalid of [
    { ...deadline, stage: 'Generated private function' },
    { ...deadline, text: 'Generated entry' },
    { ...deadline, budgetMs: -1 },
  ])
    expect(
      ContextStepReportSchema.safeParse({ deadline: invalid }).success,
    ).toBe(false);
});
test('POSTCLICK wider windows use calendar days across month, year and leap-day boundaries', () => {
  expect(widenedWindow('2024-03-01T23:30:00Z', 7)).toEqual([
    '2024-02-23',
    '2024-03-08',
  ]);
  expect(widenedWindow('2025-01-01T00:30:00Z', 31)).toEqual([
    '2024-12-01',
    '2025-02-01',
  ]);
});

test('newestreply report contracts reject contents and unknown answer/sort classes', () => {
  const answer = replyAnswerDiagnostic(
    [],
    {
      id: '123',
      username: 'generated_person',
      text: 'Generated text',
      createdAt: '2025-01-01T00:00:00Z',
    },
    0,
  );
  expect(ReplyAnswerDiagnosticSchema.safeParse(answer).success).toBe(true);
  for (const mutation of [
    { text: 'Generated private words' },
    { childCountClass: 'unknown' },
    { paths: [{ path: '/private/123', bodies: 1 }] },
  ])
    expect(
      ReplyAnswerDiagnosticSchema.safeParse({ ...answer, ...mutation }).success,
    ).toBe(false);
  const newest = {
    observationFailed: false,
    timeoutWait: null,
    sortReadback: true,
    settledReload: true,
    view: emptyProbeView(),
    sort: emptySortDiagnostic(),
  };
  expect(NewestProbeSchema.safeParse(newest).success).toBe(true);
  expect(
    NewestProbeSchema.safeParse({
      ...newest,
      sort: { ...newest.sort, failedStep: 'Generated private label' },
    }).success,
  ).toBe(false);
  expect(
    NewestProbeSchema.safeParse({
      ...newest,
      sort: { ...newest.sort, clickTarget: 'Generated private label' },
    }).success,
  ).toBe(false);
});
test('REPLY-SRC-1 script/structure reports reject unknown identity-bearing fields and arbitrary classes', () => {
  const structure = emptySortStructure();
  expect(SortControlStructureSchema.safeParse(structure).success).toBe(true);
  expect(
    SortControlStructureSchema.safeParse({
      ...structure,
      text: 'Generated private text',
    }).success,
  ).toBe(false);
  const answer = replyAnswerDiagnostic(
    [],
    {
      id: '123',
      username: 'generated_person',
      text: 'Generated text',
      createdAt: '2025-01-01T00:00:00Z',
    },
    0,
  );
  expect(
    ReplyAnswerDiagnosticSchema.safeParse({
      ...answer,
      source: 'generated-private-source',
    }).success,
  ).toBe(false);
  expect(
    ReplyAnswerDiagnosticSchema.safeParse({
      ...answer,
      script: {
        ...answer.script,
        failedChecks: {
          ...answer.script!.failedChecks,
          url: 'Generated private',
        },
      },
    }).success,
  ).toBe(false);
});

const runId = '00000000-0000-4000-8000-000000000016';
const plantedUrl = `https://www.instagram.com/${IG_FIXTURE.other.username}/p/${IG_FIXTURE.other.code}/`;
const ownSelectors = new URL('./selectors.ts', import.meta.url).href;
test('realshape row and reply diagnostic schemas reject text, links, IDs and unknown closed tokens', () => {
  const row = {
    ...rowShape(
      'generated_person\nInvented private diagnostic text\n2 Std.',
      'generated_person',
      false,
    ),
    anchors: 0,
    linkClasses: { post: 0, profile: 0, yourActivity: 0, other: 0 },
    imagePresent: true,
  };
  const rows = { observed: true, total: 1, capped: false, rows: [row] },
    scope = emptyReplyScope();
  expect(RowShapeDiagnosticSchema.safeParse(rows).success).toBe(true);
  expect(ReplyScopeDiagnosticSchema.safeParse(scope).success).toBe(true);
  const level = {
    depth: 1,
    childrenCapped: false,
    children: [
      {
        containsFocal: true,
        otherPermalinks: 0,
        times: 1,
        expandControls: 0,
        images: 0,
      },
    ],
  };
  expect(
    ReplyScopeDiagnosticSchema.safeParse({
      ...scope,
      chosenDepth: 1,
      levels: [level],
    }).success,
  ).toBe(true);
  const boundary = {
    observed: true,
    overBound: false,
    totalChildren: 40,
    inspectedElements: 240,
    focalChildren: 1,
    focalOtherPermalinks: 0,
    foreignChildren: 39,
    directAnchors: 0,
  };
  expect(
    ReplyScopeDiagnosticSchema.safeParse({
      ...scope,
      levels: [
        {
          ...level,
          zeroBoundary: boundary,
          children: [{ ...level.children[0], expandControls: null }],
        },
      ],
    }).success,
  ).toBe(true);
  for (const zeroBoundary of [
    { ...boundary, text: plantedUrl },
    { ...boundary, totalChildren: -1 },
    { ...boundary, observed: 'true' },
  ])
    expect(
      ReplyScopeDiagnosticSchema.safeParse({
        ...scope,
        levels: [{ ...level, zeroBoundary }],
      }).success,
    ).toBe(false);
  for (const invalid of [
    { ...scope, chosenDepth: 13 },
    { ...scope, levels: Array(13).fill(level) },
    {
      ...scope,
      levels: [
        { ...level, children: [{ ...level.children[0], text: plantedUrl }] },
      ],
    },
    {
      ...scope,
      levels: [{ ...level, children: Array(33).fill(level.children[0]) }],
    },
  ])
    expect(ReplyScopeDiagnosticSchema.safeParse(invalid).success).toBe(false);
  for (const key of ['text', 'handle', 'id', 'url']) {
    expect(
      RowShapeDiagnosticSchema.safeParse({
        ...rows,
        rows: [{ ...row, [key]: plantedUrl }],
      }).success,
    ).toBe(false);
    expect(
      ReplyScopeDiagnosticSchema.safeParse({ ...scope, [key]: plantedUrl })
        .success,
    ).toBe(false);
  }
  expect(
    ReplyScopeDiagnosticSchema.safeParse({
      ...scope,
      failedCheck: 'generated_private_reason',
    }).success,
  ).toBe(false);
});
test('IG-IMAGE diagnostic accepts closed numeric image data only and enforces count and source consistency', () => {
  const image = {
    status: 'stored',
    bytes: 69,
    qualifyingObjects: 2,
    matchingLists: 2,
    distinctListLengths: [1, 2],
    source: 'img-current-src',
  };
  expect(ContextStepReportSchema.parse({ image })).toEqual({ image });
  for (const invalid of [
    { ...image, url: plantedUrl },
    { ...image, id: IG_FIXTURE.code },
    { ...image, qualifyingObjects: -1 },
    { ...image, matchingLists: 3 },
    { ...image, matchingLists: 1.5 },
    { ...image, distinctListLengths: [2, 1] },
    { ...image, distinctListLengths: [1, 1] },
    { ...image, distinctListLengths: [Infinity] },
    { ...image, distinctListLengths: [-1] },
    { ...image, distinctListLengths: [IG_FIXTURE.code] },
    { ...image, qualifyingObjects: 0 },
    { ...image, source: 'video-poster' },
    { ...image, source: 'none' },
    { ...image, status: plantedUrl },
  ])
    expect(ContextStepReportSchema.safeParse({ image: invalid }).success).toBe(
      false,
    );
  // IMAGE-2: a carousel position is a closed number tied to one object.
  const slide = {
    ...image,
    qualifyingObjects: 1,
    matchingLists: 0,
    distinctListLengths: [1],
    carouselPosition: 2,
    carouselFirstSlide: false,
  };
  expect(ContextStepReportSchema.safeParse({ image: slide }).success).toBe(
    true,
  );
  for (const invalid of [
    { ...slide, carouselPosition: 0 },
    { ...slide, carouselPosition: 1.5 },
    { ...slide, carouselPosition: plantedUrl },
    { ...slide, carouselFirstSlide: true },
    { ...slide, carouselFirstSlide: null },
    { ...slide, qualifyingObjects: 2, distinctListLengths: [1] },
    { ...slide, source: 'none' },
  ])
    expect(ContextStepReportSchema.safeParse({ image: invalid }).success).toBe(
      false,
    );
});
test('C28 per-step memory is strict numeric data rather than arbitrary fields in the loose step', () => {
  const memory = {
    observed: true,
    observationFailed: false,
    jsHeapUsedMB: 4,
    jsHeapTotalMB: 8,
    nodes: 100,
    documents: 2,
    jsEventListeners: 10,
    frames: 1,
  };
  expect(ContextStepReportSchema.parse({ memory })).toEqual({ memory });
  for (const invalid of [
    { ...memory, url: plantedUrl },
    { ...memory, text: IG_FIXTURE.other.text },
    { ...memory, nodes: -1 },
    { ...memory, documents: 1.5 },
    { ...memory, jsHeapUsedMB: 9 },
    { ...memory, frames: Infinity },
    { ...memory, observed: false },
    { ...memory, nodes: null },
  ])
    expect(ContextStepReportSchema.safeParse({ memory: invalid }).success).toBe(
      false,
    );
});
test('C28 memory peak schema is strict and never accepts page values or a missing failure count', () => {
  const peak = {
    jsHeapUsedMB: 4,
    jsHeapTotalMB: 8,
    nodes: 100,
    documents: 2,
    jsEventListeners: 10,
    frames: 1,
  };
  const value = {
    samples: 4,
    failedSamples: 1,
    sessionAttached: true,
    observationFailed: true,
    peak,
  };
  expect(RunMemorySchema.parse(value)).toEqual(value);
  for (const invalid of [
    { ...value, text: IG_FIXTURE.other.text },
    { ...value, failedSamples: 5 },
    { ...value, peak: { ...peak, url: plantedUrl } },
    { ...value, peak: { ...peak, jsHeapUsedMB: 9 } },
  ])
    expect(RunMemorySchema.safeParse(invalid).success).toBe(false);
});
test('LIST-DIAG the image-only decision record holds closed values only', () => {
  const decision = {
    filteredTimeout: true,
    initialAccountRow: true,
    firstReadAccountClass: 'expected',
    firstCheck: true,
    secondRead: true,
    secondReadAccountClass: 'other',
    secondReadCandidates: 0,
    secondCheck: true,
    domChangesSame: false,
    lastChangeSame: true,
    retainedResult: false,
    outcome: 'second-read-account',
  };
  const base = {
    rowContainers: 2,
    readableRows: 1,
    imageOnlyRows: 1,
    statusElementPresent: false,
    busyElementPresent: false,
    emptyStateClassKnown: false,
    emptyStatePresent: false,
    rowsObserved: true,
    filter: {
      applied: true,
      readbackObserved: true,
      startMatches: true,
      endMatches: true,
    },
    dom: {
      observed: true,
      changes: 18,
      lastChangeAfterApplyMs: 790,
      observedForMs: 30400,
    },
    observationFailed: false,
  };
  const parse = (value: unknown) =>
    ContextStepReportSchema.safeParse({
      listTimeout: { ...base, imageOnlyDecision: value },
    }).success;
  expect(parse(decision)).toBe(true);
  expect(
    parse({
      ...decision,
      secondRead: false,
      secondReadAccountClass: null,
      secondReadCandidates: null,
      secondCheck: null,
      domChangesSame: null,
      lastChangeSame: null,
      firstReadAccountClass: null,
      outcome: 'no-initial-account-row',
    }),
  ).toBe(true);
  for (const invalid of [
    { ...decision, outcome: 'Generated private outcome' },
    { ...decision, firstReadAccountClass: IG_FIXTURE.other.username },
    { ...decision, secondReadCandidates: -1 },
    { ...decision, secondReadCandidates: 1.5 },
    { ...decision, handle: IG_FIXTURE.other.username },
    { ...decision, text: IG_FIXTURE.other.text },
    { ...decision, at: IG_FIXTURE.other.time },
  ])
    expect(parse(invalid)).toBe(false);
});
test('C27 list-timeout diagnostic rejects raw values and malformed counts rather than relying on the loose outer step', () => {
  const diagnostic = {
    rowContainers: 3,
    readableRows: 0,
    imageOnlyRows: 3,
    statusElementPresent: true,
    busyElementPresent: false,
    emptyStateClassKnown: false,
    emptyStatePresent: false,
    rowsObserved: true,
    filter: {
      applied: true,
      readbackObserved: true,
      startMatches: true,
      endMatches: true,
    },
    dom: {
      observed: true,
      changes: 1,
      lastChangeAfterApplyMs: 12,
      observedForMs: 1500,
    },
    observationFailed: false,
  };
  expect(ContextStepReportSchema.parse({ listTimeout: diagnostic })).toEqual({
    listTimeout: diagnostic,
  });
  for (const invalid of [
    { ...diagnostic, text: IG_FIXTURE.other.text },
    { ...diagnostic, url: plantedUrl },
    { ...diagnostic, rowContainers: -1 },
    { ...diagnostic, readableRows: 4 },
    { ...diagnostic, imageOnlyRows: 1.5 },
    { ...diagnostic, emptyStateClassKnown: false, emptyStatePresent: true },
    {
      ...diagnostic,
      filter: { ...diagnostic.filter, start: IG_FIXTURE.other.time },
    },
    { ...diagnostic, dom: { ...diagnostic.dom, lastChangeAfterApplyMs: 1501 } },
    {
      ...diagnostic,
      rowSignature: {
        observed: true,
        sameAsBeforeApply: false,
        sameAsPreviousStep: null,
        previousWindowDifferent: null,
        text: IG_FIXTURE.other.text,
      },
    },
    {
      ...diagnostic,
      rowSignature: {
        observed: true,
        sameAsBeforeApply: null,
        sameAsPreviousStep: null,
        previousWindowDifferent: null,
      },
    },
  ])
    expect(
      ContextStepReportSchema.safeParse({ listTimeout: invalid }).success,
    ).toBe(false);
});
function generatedUnexpected(
  message: string,
  name = 'Error',
  stack?: string,
): Error {
  const error = new Error(message);
  error.name = name;
  error.stack =
    stack ??
    `${name}: ${message}\n    at async readPost (${ownSelectors}:250:4)\n    at async confirmOnPost (${new URL('./driver.ts', import.meta.url).href}:382:14)`;
  return error;
}
test.each([
  [
    'Execution context was destroyed, most likely because of a navigation',
    'execution-context-destroyed',
  ],
  ['Cannot find context with specified id', 'execution-context-destroyed'],
  ['Element is detached from the DOM', 'element-detached'],
  ['Element was detached from the DOM', 'element-detached'],
  [
    'strict mode violation: locator resolved to two elements',
    'strict-mode-violation',
  ],
  ['Target page, context or browser has been closed', 'target-closed'],
  [
    'Error: strict mode violation: locator resolved to two elements',
    'strict-mode-violation',
  ],
  ['Target closed', 'target-closed'],
  ['Element is not attached to the DOM', 'not-attached'],
  ['Frame was detached', 'frame-detached'],
  ['Navigating frame was detached', 'frame-detached'],
  ['Protocol error (DOM.getDocument): generated error', 'protocol-error'],
  [IG_FIXTURE.other.text, 'unmatched'],
] as const)(
  'C24 generated unexpected message fixture %# retains only a closed class',
  (prefix, expected) => {
    const failure = generatedUnexpected(
      `locator.innerText: ${prefix} ${IG_FIXTURE.other.text} ${plantedUrl}`,
    );
    const diagnostic = {
      errorName: 'Error',
      playwrightMessageClass: expected,
      ownFunction: 'readPost',
    };
    const cause = contextCause(failure, runId, 'post-read', 38);
    expect(cause).toMatchObject({
      token: 'unexpected-error',
      errorClass: 'other',
      ...diagnostic,
    });
    expect(stopDetails(failure)).toMatchObject({
      token: 'unexpected-error',
      errorClass: 'other',
      ...diagnostic,
    });
    expect(stopDetailText(failure)).toBe(
      `unexpected-error; errorClass=other; errorName=Error; playwrightMessageClass=${expected}; ownFunction=readPost`,
    );
    expect(ContextCauseSchema.parse(cause)).toEqual(cause);
    const emitted = JSON.stringify({
      cause,
      stop: stopDetails(failure),
      text: stopDetailText(failure),
    });
    for (const value of [
      plantedUrl,
      ownSelectors,
      ...Object.values(IG_FIXTURE.other),
      ':250:4',
    ])
      expect(emitted).not.toContain(value);
  },
);
test.each([
  'Error',
  'ZodError',
  'AggregateError',
  'EvalError',
  'URIError',
  'PageCrashedError',
  'NavigationError',
  'ProtocolError',
  'NonRecoverableDOMError',
  'JavaScriptErrorInEvaluate',
])(
  'C24 unexpected own name %s remains a closed name rather than a constructor guess',
  (name) => {
    const failure = generatedUnexpected(IG_FIXTURE.other.text, name);
    expect(contextCause(failure, runId, 'post-read', 38)).toMatchObject({
      token: 'unexpected-error',
      errorName: name,
    });
  },
);
test('C24 an arbitrary name or a phrase inside contents never becomes a diagnostic class', () => {
  const failure = generatedUnexpected(
    `${IG_FIXTURE.other.text} locator.innerText: Execution context was destroyed ${plantedUrl}`,
    IG_FIXTURE.other.username,
  );
  expect(stopDetails(failure)).toMatchObject({
    errorName: 'other-name',
    playwrightMessageClass: 'unmatched',
  });
  expect(
    JSON.stringify(stopDetails(failure)) + stopDetailText(failure),
  ).not.toContain(IG_FIXTURE.other.username);
});
test.each([
  ['readPost', 'selectors.ts'],
  ['profileLinks', 'selectors.ts'],
  ['textBlock', 'selectors.ts'],
  ['captionText', 'selectors.ts'],
  ['postLinks', 'selectors.ts'],
  ['postElement', 'selectors.ts'],
  ['scrollPostComments', 'selectors.ts'],
  ['currentImageSource', 'selectors.ts'],
  ['imageDiagnostic', 'canary.ts'],
  ['confirmOnPost', 'driver.ts'],
  ['postReopenTarget', 'driver.ts'],
  ['listTimeoutDiagnostic', 'driver.ts'],
  ['listTimeoutRows', 'selectors.ts'],
  ['filterWindowMatches', 'selectors.ts'],
  ['observeListDomChanges', 'selectors.ts'],
  ['listDiagnosticRead', 'selectors.ts'],
  ['settledPost', 'driver.ts'],
  ['blockCount', 'driver.ts'],
  ['runContextWithDependencies', 'run.ts'],
] as const)(
  'C24 only the known own source frame %s is retained',
  (name, file) => {
    const location = new URL(`./${file}`, import.meta.url).href;
    const failure = generatedUnexpected(
      IG_FIXTURE.other.text,
      'Error',
      `Error: ${IG_FIXTURE.other.text}\n    at Locator.innerText (file:///generated/node_modules/playwright-core/client.js:1:2)\n    at async Module.${name} (${location}:250:4)`,
    );
    expect(contextCause(failure, runId, 'post-read', 38)).toMatchObject({
      ownFunction: name,
    });
  },
);
test.each([
  '    at readPost (file:///generated/third-party/selectors.ts:3:9)',
  `    at ${IG_FIXTURE.other.username} (${ownSelectors}:3:9)\n    at readPost (${ownSelectors}:7:2)`,
  `    at confirmOnPost (${ownSelectors}:3:9)`,
  `    at ${ownSelectors}:3:9`,
  `    at readPost (https://www.instagram.com/${IG_FIXTURE.other.username}/selectors.ts:3:9)`,
] as const)(
  'C24 outside or unknown top own frame fixture %# falls back without a path',
  (stack) => {
    const failure = generatedUnexpected(
      IG_FIXTURE.other.text,
      'Error',
      `Error: ${IG_FIXTURE.other.text}\n${stack}`,
    );
    expect(stopDetails(failure)).toMatchObject({
      ownFunction: 'outside-own-code',
    });
    expect(stopDetailText(failure)).not.toContain(IG_FIXTURE.other.username);
  },
);
test('C24 enriched cause schema allows closed fields but rejects raw diagnostic values', () => {
  const value = {
    runId,
    stage: 'post-read',
    step: 38,
    token: 'unexpected-error',
    chain: ['unexpected-error'],
    errorClass: 'other',
    errorName: 'AbortError',
    playwrightMessageClass: 'unmatched',
    ownFunction: 'outside-own-code',
  };
  expect(ContextCauseSchema.parse(value)).toEqual(value);
  for (const bad of [
    { ...value, errorName: IG_FIXTURE.other.username },
    { ...value, playwrightMessageClass: plantedUrl },
    { ...value, ownFunction: IG_FIXTURE.other.code },
    { ...value, message: IG_FIXTURE.other.text },
    { ...value, stack: ownSelectors },
  ])
    expect(() => ContextCauseSchema.parse(bad)).toThrow();
});
test('C24 a generated real ZodError has the closed name while its issues never reach diagnostics', () => {
  const parsed = z
    .string()
    .safeParse({ username: IG_FIXTURE.other.username, url: plantedUrl });
  expect(parsed.success).toBe(false);
  if (parsed.success) throw new Error('Generated schema unexpectedly accepted');
  expect(stopDetails(parsed.error)).toMatchObject({
    token: 'unexpected-error',
    errorName: 'ZodError',
    playwrightMessageClass: 'unmatched',
  });
  for (const value of [plantedUrl, ...Object.values(IG_FIXTURE.other)])
    expect(JSON.stringify(stopDetails(parsed.error))).not.toContain(value);
});
test('C24 optional diagnostic getters cannot replace an unexpected stop with a diagnostic exception', () => {
  const failure = new Error();
  for (const key of ['message', 'stack'])
    Object.defineProperty(failure, key, {
      get() {
        throw new Error(IG_FIXTURE.other.text);
      },
    });
  expect(stopDetails(failure)).toMatchObject({
    token: 'unexpected-error',
    errorName: 'Error',
    playwrightMessageClass: 'unmatched',
    ownFunction: 'outside-own-code',
  });
});
test('C24 known abort and timeout tokens are unchanged and do not receive unexpected-only fields', () => {
  for (const [name, token] of [
    ['AbortError', 'aborted'],
    ['TimeoutError', 'browser-timeout'],
    ['TargetClosedError', 'browser-closed'],
  ] as const) {
    const error = generatedUnexpected(
      `Execution context was destroyed ${plantedUrl}`,
      name,
    );
    expect(stopDetails(error)).toEqual({ code: token, token });
    expect(stopDetailText(error)).toBe(token);
    expect(contextCause(error, runId, 'post-read', 38)).not.toHaveProperty(
      'errorName',
    );
  }
});
test('C24 both run stop-detail paths consume the shared closed formatter and correlated cause helper', async () => {
  const source = await readFile(new URL('./run.ts', import.meta.url), 'utf8');
  expect(
    source.match(/Stop detail: \$\{stopDetailText\(error\)\}/g),
  ).toHaveLength(2);
  expect(source).toContain(
    'report.cause = contextCause(caught, runId, at, steps)',
  );
});
test('C24 bundle and Windows stack locations retain known tokens but never infer a minified or foreign function', () => {
  const bundle = 'file:///C:/generated/package/bin/socialprune.mjs';
  expect(
    ownFunction(
      'Error: generated\n    at async currentImageSource (C:\\generated\\package\\bin\\socialprune.mjs:1:928)',
      bundle,
    ),
  ).toBe('currentImageSource');
  expect(
    ownFunction(
      'Error: generated\n    at async confirmOnPost (file:///C:/generated/package/bin/socialprune.mjs:1:928)',
      bundle,
    ),
  ).toBe('confirmOnPost');
  expect(
    ownFunction(
      'Error: generated\n    at a (file:///C:/generated/package/bin/socialprune.mjs:1:928)\n    at readPost (file:///C:/generated/package/bin/socialprune.mjs:1:929)',
      bundle,
    ),
  ).toBe('outside-own-code');
  expect(
    ownFunction(
      'Error: generated\n    at readPost (file:///C:/generated/other/socialprune.mjs:1:928)',
      bundle,
    ),
  ).toBe('outside-own-code');
  expect(
    ownFunction(
      'Error: generated\n    at async readPost (file:///C:/generated/apps/cli/src/browser/instagram/selectors.ts:250:4)',
      bundle,
    ),
  ).toBe('readPost');
  expect(
    ownFunction(
      'Error: generated\n    at async currentImageSource (file:///C:/generated/resources/app.asar/engine.cjs:1:928)',
      'file:///C:/generated/resources/app.asar/engine.cjs',
    ),
  ).toBe('currentImageSource');
});
test('C24 an unlisted own-source function blocks a deeper known frame', () => {
  const failure = generatedUnexpected(
    IG_FIXTURE.other.text,
    'Error',
    `Error: generated\n    at unlisted (${new URL('./retry.ts', import.meta.url).href}:1:2)\n    at readPost (${ownSelectors}:7:2)`,
  );
  expect(stopDetails(failure)).toMatchObject({
    ownFunction: 'outside-own-code',
  });
});
test('C24 the exact installed CLI bundle is own code even below node_modules but another package is not', () => {
  const bundle =
    'file:///C:/generated/node_modules/socialprune/bin/socialprune.mjs';
  expect(
    ownFunction(
      'Error: generated\n    at readPost (C:\\generated\\node_modules\\socialprune\\bin\\socialprune.mjs:1:928)',
      bundle,
    ),
  ).toBe('readPost');
  expect(
    ownFunction(
      'Error: generated\n    at readPost (C:\\generated\\node_modules\\other\\bin\\socialprune.mjs:1:928)',
      bundle,
    ),
  ).toBe('outside-own-code');
});
test.each([
  ['TargetClosedError', 'target-closed'],
  ['TargetClosedError2', 'target-closed'],
  ['PageCrashedError', 'page-crashed'],
  ['TimeoutError', 'timeout'],
  ['NavigationError', 'navigation'],
  ['ProtocolError', 'protocol'],
  ['Error', 'other'],
] as const)(
  'C21 exact error type or name %s maps to %s without inspecting private properties',
  (name, expected) => {
    const failure = new Error();
    failure.name = name;
    for (const key of ['message', 'stack'])
      Object.defineProperty(failure, key, {
        get() {
          throw new Error('private property read');
        },
      });
    expect(errorClass(failure)).toBe(expected);
    class TargetClosedError extends Error {}
    expect(errorClass(new TargetClosedError(IG_FIXTURE.other.text))).toBe(
      'target-closed',
    );
  },
);
test('C21 unexpected errors retain a closed class in cause stop and terminal while tokens stay unchanged', () => {
  const failure = new Error(IG_FIXTURE.other.text);
  failure.name = 'PageCrashedError';
  expect(contextCause(failure, runId, 'post-read', 4)).toMatchObject({
    token: 'unexpected-error',
    errorClass: 'page-crashed',
  });
  expect(stopDetails(failure)).toEqual({
    code: 'unexpected-error',
    token: 'unexpected-error',
    errorClass: 'page-crashed',
    errorName: 'PageCrashedError',
    playwrightMessageClass: 'unmatched',
    ownFunction: 'outside-own-code',
  });
  expect(stopDetailText(failure)).toBe(
    'unexpected-error; errorClass=page-crashed; errorName=PageCrashedError; playwrightMessageClass=unmatched; ownFunction=outside-own-code',
  );
  expect(stopDetails(new Error(IG_FIXTURE.other.text))).toMatchObject({
    token: 'unexpected-error',
    errorClass: 'other',
  });
  const zero = {
    pageCrashes: 0,
    browserDisconnects: 0,
    unexpectedPageCloses: 0,
    browserObserved: false,
    observationFailed: false,
    events: [],
  };
  expect(RuntimeReportSchema.parse(zero)).toEqual(zero);
  for (const invalid of [
    { ...zero, url: IG_FIXTURE.other.code },
    { ...zero, pageCrashes: -1 },
    {
      ...zero,
      events: [
        { event: IG_FIXTURE.other.text, step: 1, stage: 'post-read', count: 1 },
      ],
    },
  ])
    expect(() => RuntimeReportSchema.parse(invalid)).toThrow();
});
test('C20 account-check evidence survives the stop and terminal formatter as closed fields only', () => {
  const accountCheck = {
    profileLinkFound: false,
    outsidePathCount: 0,
    rows: 5,
    ownRows: 5,
    elapsedMs: 17052,
    reads: 9,
    lastReadAfterDeadline: false,
  };
  const error = new ContextStop(
    'ACCOUNT_MISMATCH',
    'account-changed',
    accountCheck,
  );
  expect(stopDetails(error)).toEqual({
    code: 'ACCOUNT_MISMATCH',
    token: 'account-changed',
    accountCheck,
  });
  expect(stopDetailText(error)).toBe(
    'account-changed; link=false; outsidePathCount=0; rows=5; own=5; reads=9; elapsedMs=17052; lastReadAfterDeadline=false',
  );
  for (const value of Object.values(IG_FIXTURE.other))
    expect(
      JSON.stringify(stopDetails(error)) + stopDetailText(error),
    ).not.toContain(value);
  expect(
    stopDetailText(new ContextStop('PLATFORM_CHECK', 'notice-error')),
  ).toBe('notice-error');
});
test('C20 account-check schema rejects private fields and inconsistent counts', () => {
  const valid = {
    profileLinkFound: true,
    outsidePathCount: 1,
    rows: 5,
    ownRows: 2,
    elapsedMs: 1,
    reads: 1,
    lastReadAfterDeadline: true,
  };
  expect(AccountCheckSchema.parse(valid)).toEqual(valid);
  for (const value of [
    { ...valid, username: IG_FIXTURE.other.username },
    { ...valid, paths: [`/${IG_FIXTURE.other.username}/`] },
    { ...valid, ownRows: 6 },
    { ...valid, reads: 0 },
    { ...valid, elapsedMs: -1 },
    { ...valid, rows: 1.5 },
    { ...valid, profileLinkFound: IG_FIXTURE.other.text },
  ])
    expect(() => AccountCheckSchema.parse(value)).toThrow();
});
test('C20 readback account classes distinguish expected absent and other without names', () => {
  const expected = 'generated_c20_person';
  expect(accountClass(expected, [`/${expected.toUpperCase()}/`])).toBe(
    'expected',
  );
  expect(accountClass(expected, [])).toBe('absent');
  expect(
    accountClass(expected, [
      '/your_activity/interactions/comments',
      '/p/generated/',
    ]),
  ).toBe('absent');
  expect(accountClass(expected, [`/${IG_FIXTURE.other.username}/`])).toBe(
    'other',
  );
  expect(
    AccountReadbackSchema.parse({
      accountBeforeClass: 'expected',
      accountAfterClass: 'absent',
    }),
  ).toEqual({ accountBeforeClass: 'expected', accountAfterClass: 'absent' });
  for (const value of [
    { accountBeforeClass: expected, accountAfterClass: 'absent' },
    {
      accountBeforeClass: 'other',
      accountAfterClass: IG_FIXTURE.other.username,
    },
    {
      accountBeforeClass: 'expected',
      accountAfterClass: 'other',
      username: expected,
    },
  ])
    expect(() => AccountReadbackSchema.parse(value)).toThrow();
});
test('C16 unexpected error retains a correlated closed cause chain without its values', () => {
  const timeout = new Error(IG_FIXTURE.other.text);
  timeout.name = 'TimeoutError';
  const error = new Error(IG_FIXTURE.other.username, { cause: timeout });
  const cause = contextCause(error, runId, 'list-read', 3);
  expect(cause).toEqual({
    runId,
    stage: 'list-read',
    step: 3,
    token: 'browser-timeout',
    chain: ['unexpected-error', 'browser-timeout'],
    timedOut: 'outside-own-code',
  });
  for (const value of Object.values(IG_FIXTURE.other))
    expect(JSON.stringify(cause)).not.toContain(value);
});
test('RETRY-2 a browser timeout names only the closed own operation class that timed out', () => {
  const location = new URL('./driver.ts', import.meta.url).href;
  const timeout = generatedUnexpected(
    `locator.click: Timeout 5000ms exceeded. ${plantedUrl}`,
    'TimeoutError',
    `TimeoutError: ${IG_FIXTURE.other.text}\n    at Locator.click (file:///generated/node_modules/playwright-core/client.js:1:2)\n    at async loadList (${location}:300:4)`,
  );
  const direct = contextCause(timeout, runId, 'list-read', 9);
  expect(direct).toMatchObject({
    token: 'browser-timeout',
    timedOut: 'loadList',
  });
  expect(direct).not.toHaveProperty('errorName');
  const wrapped = contextCause(
    new Error(IG_FIXTURE.other.username, { cause: timeout }),
    runId,
    'list-read',
    9,
  );
  expect(wrapped).toMatchObject({
    token: 'browser-timeout',
    timedOut: 'loadList',
  });
  expect(
    contextCause(
      generatedUnexpected('generated', 'AbortError'),
      runId,
      'list-read',
      9,
    ),
  ).not.toHaveProperty('timedOut');
  expect(() =>
    ContextCauseSchema.parse({ ...direct, timedOut: IG_FIXTURE.other.code }),
  ).toThrow();
  for (const value of [
    plantedUrl,
    location,
    ...Object.values(IG_FIXTURE.other),
  ])
    expect(JSON.stringify([direct, wrapped])).not.toContain(value);
});
test.each([
  [new TypeError(IG_FIXTURE.other.text), 'type-error'],
  [new RangeError(IG_FIXTURE.other.text), 'range-error'],
  [
    Object.assign(new Error(IG_FIXTURE.other.text), { code: 'EBUSY' }),
    'fs-EBUSY',
  ],
  [
    Object.assign(new Error(IG_FIXTURE.other.text), { code: 'EADDRINUSE' }),
    'socket-EADDRINUSE',
  ],
  [
    Object.assign(new Error(IG_FIXTURE.other.text), {
      code: 'ERR_SQLITE_ERROR',
      errcode: 5,
    }),
    'sqlite-busy',
  ],
  [
    Object.assign(new Error(IG_FIXTURE.other.text), {
      code: 'ERR_SQLITE_ERROR',
      errcode: 1,
    }),
    'sqlite-error',
  ],
  [
    Object.assign(new Error(IG_FIXTURE.other.text), {
      name: 'TargetClosedError',
    }),
    'browser-closed',
  ],
  [new Error(IG_FIXTURE.other.text), 'unexpected-error'],
  [IG_FIXTURE.other.text, 'unexpected-value'],
])(
  'C16 cause classification is closed for generated error %j',
  (error, token) => {
    expect(contextCause(error, runId, 'capture', 1).token).toBe(token);
    expect(stopDetails(error)).toEqual({
      code: token,
      token,
      ...(token === 'unexpected-error'
        ? {
            errorClass: 'other',
            errorName: 'Error',
            playwrightMessageClass: 'unmatched',
            ownFunction: 'outside-own-code',
          }
        : {}),
    });
  },
);
test('C16 cause gate refuses arbitrary fields tokens stages and correlators', () => {
  const cause = {
    runId,
    stage: 'list-read',
    step: 1,
    token: 'unexpected-error',
    chain: ['unexpected-error'],
  };
  expect(ContextCauseSchema.parse(cause)).toEqual(cause);
  for (const value of [
    { ...cause, message: IG_FIXTURE.other.text },
    { ...cause, token: IG_FIXTURE.other.username },
    { ...cause, stage: IG_FIXTURE.other.code },
    { ...cause, runId: IG_FIXTURE.other.code },
    { ...cause, chain: [IG_FIXTURE.other.text] },
    { ...cause, step: -1 },
  ])
    expect(() => ContextCauseSchema.parse(value)).toThrow();
});
test('C16 cause traversal bounds depth and cycles without serializing a message or arbitrary code', () => {
  const error = new Error(IG_FIXTURE.other.text, { cause: undefined });
  error.cause = error;
  expect(contextCause(error, runId, 'run', 0).chain).toEqual([
    'unexpected-error',
  ]);
  let nested: unknown = Object.assign(new Error(IG_FIXTURE.other.text), {
    code: IG_FIXTURE.other.code,
  });
  for (let i = 0; i < 10; i++)
    nested = new Error(IG_FIXTURE.other.username, { cause: nested });
  const result = contextCause(nested, runId, 'capture', 3);
  expect(result.chain).toHaveLength(4);
  for (const value of Object.values(IG_FIXTURE.other))
    expect(JSON.stringify(result)).not.toContain(value);
});
