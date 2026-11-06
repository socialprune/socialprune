import type { Locator } from 'playwright-core';
import type { ReplyExpansionDiagnostic } from './report.ts';
import { checkedReplyControls } from './reply-controls.ts';
import { ownReplyControls, REPLY_ROWS } from './replies-scope.ts';

/** Counts only, within the already verified focal scope. Never a row oracle. */
export async function expansionShape(
  root: Locator,
  handle: string,
  total: number | null,
) {
  return {
    rows: await root.locator(REPLY_ROWS).count(),
    controls: (await checkedReplyControls(await ownReplyControls(root), total))
      .diagnostic,
    candidates: {
      li: await root.locator('li').count(),
      ul: await root.locator('ul').count(),
      roleLists: await root.locator('[role="list"]').count(),
      divButtons: await root.locator('div[role="button"]').count(),
      commentPermalinks: await root.locator('a[href*="/c/"]').count(),
      datedTimes: await root.locator('time[datetime]').count(),
      ownHandleLinks: await root.locator(`a[href="/${handle}/" i]`).count(),
    },
  };
}
export async function afterExpansion(
  root: Locator,
  handle: string,
  total: number | null,
  listsBefore: number,
  click: ReplyExpansionDiagnostic['clicks'][number],
) {
  try {
    const after = await expansionShape(root, handle, total);
    click.rowsAfter = after.rows;
    click.controlsAfter = after.controls;
    click.candidatesAfter = after.candidates;
    click.nestedListAppeared =
      after.candidates.ul + after.candidates.roleLists > listsBefore;
    click.observationFailed = false;
  } catch {
    // A failed diagnostic must not replace the actual click/guard failure.
    click.observationFailed = true;
  }
}
