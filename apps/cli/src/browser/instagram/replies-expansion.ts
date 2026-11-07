import type { Locator } from 'playwright-core';
import type { ReplyExpansionDiagnostic } from './report.ts';
import { checkedReplyControls } from './reply-controls.ts';
import { ownReplyControls, matchedReplyRows } from './replies-scope.ts';
import { expandedRows } from './reply-neighborhood.ts';

/** Counts only, within the already verified focal scope. Never a row oracle. */
export async function expansionShape(
  root: Locator,
  handle: string,
  total: number | null,
  address: { kind: 'p' | 'reel'; code: string },
  appearedListFocal?: string,
) {
  const rows = await matchedReplyRows(root, address, appearedListFocal);
  return {
    rows: await rows.count(),
    controls: (
      await checkedReplyControls(
        await ownReplyControls(root, rows),
        total,
        true,
      )
    ).diagnostic,
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
  address: { kind: 'p' | 'reel'; code: string },
  siblingsAllowed = false,
  appearedListFocal?: string,
) {
  try {
    const after = await expansionShape(
      root,
      handle,
      total,
      address,
      appearedListFocal,
    );
    click.rowsAfter = after.rows;
    if (siblingsAllowed)
      click.rowsAfter = await (
        await expandedRows(root, address, true, appearedListFocal)
      ).count();
    click.controlsAfter = after.controls;
    click.candidatesAfter = after.candidates;
    click.nestedListAppeared =
      (await root.locator('ul:visible,[role="list"]:visible').count()) >
      listsBefore;
    click.observationFailed = false;
  } catch {
    // A failed diagnostic must not replace the actual click/guard failure.
    click.observationFailed = true;
  }
}
