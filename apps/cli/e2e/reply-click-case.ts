import type { Page } from 'playwright-core';
import { fakeInstagram } from './fake-instagram/server.ts';
import { IG_FIXTURE, instagramFixture } from './fake-instagram/fixture.ts';
import { commentReplies } from '../src/browser/instagram/replies.ts';
import { ContextStepReportSchema } from '../src/browser/instagram/report.ts';
import type { ReplyExpansionDiagnostic } from '../src/browser/instagram/report.ts';

/**
 * Generated reply-click case: one focal comment whose own control is a
 * `div role=button` reading "View all 4 replies", four delayed reply rows and
 * an agreeing page answer. Generated data only.
 */
export async function replyClickFake(port: number) {
  const fixture = await instagramFixture(1),
    fake = await fakeInstagram(port, fixture.items);
  fake.replies(4);
  fake.replyControl('View all 4 replies');
  fake.replyDivRows();
  return { fixture, fake };
}

export async function replyClickCase(
  page: Page,
  generated: Awaited<ReturnType<typeof replyClickFake>>,
  deadlineMs = 15000,
) {
  const item = generated.fixture.items[0]!;
  const reportsBefore = generated.fake.events.length;
  const response = page.waitForResponse((value) =>
    value.url().includes('/data/'),
  );
  await page.goto(generated.fake.origin + '/p/' + IG_FIXTURE.code + '/');
  const bodies = [await (await response).json()];
  let expansion: ReplyExpansionDiagnostic | undefined;
  let outcome:
    | { read: number; error: null }
    | { read: null; error: { name: string; reason?: string; token?: string } };
  try {
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
      performance.now() + deadlineMs,
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
    outcome = { read: result.entries.length, error: null };
  } catch (error) {
    const value = error as {
      name?: unknown;
      reason?: unknown;
      token?: unknown;
    };
    outcome = {
      read: null,
      error: {
        name: typeof value.name === 'string' ? value.name : 'unknown',
        ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
        ...(typeof value.token === 'string' ? { token: value.token } : {}),
      },
    };
  }
  return {
    ...outcome,
    expansion: ContextStepReportSchema.parse({ replyExpansion: expansion })
      .replyExpansion,
    // Each page report carries the page's cumulative click list.
    clickedOnPage: (
      generated.fake.events.slice(reportsBefore).at(-1)?.clicks ?? []
    ).filter((label) => label === 'View all 4 replies').length,
  };
}
