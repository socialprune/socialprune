import type { Page } from 'playwright-core';
import { normalize, ownerName } from './plan.ts';
import { utcWindow } from './selectors.ts';
import { ListRowDiagnosticSchema } from './report.ts';

/** Only a user object naming the checked handle can supply a display name. */
export function accountDisplayNames(
  bodies: readonly unknown[],
  handle: string,
) {
  const names = new Set<string>();
  let visits = 0;
  const walk = (input: unknown, depth: number) => {
    if (++visits > 10000 || depth > 20 || !input || typeof input !== 'object')
      return;
    if (Array.isArray(input)) {
      for (const value of input) {
        if (visits >= 10000) break;
        walk(value, depth + 1);
      }
      return;
    }
    const value = input as Record<string, unknown>;
    if (
      typeof value.username === 'string' &&
      ownerName(value.username) === ownerName(handle) &&
      typeof value.full_name === 'string' &&
      normalize(value.full_name)
    )
      names.add(normalize(value.full_name));
    for (const [key, child] of Object.entries(value)) {
      if (visits >= 10000) break;
      if (
        ![
          'variables',
          'params',
          'instanceParams',
          'route_match_infos',
        ].includes(key)
      )
        walk(child, depth + 1);
    }
  };
  for (const body of bodies) {
    if (visits >= 10000) break;
    walk(body, 0);
  }
  return names;
}

/** Comparisons stay in memory. No name, text, address, ID or digest is returned. */
export function rowTextDiagnostic(
  raw: string,
  label: string,
  text: string,
  handle: string,
  names: ReadonlySet<string>,
) {
  const value = normalize(raw),
    target = normalize(text);
  const body = value.replace(
    /\s+\d+\s*(?:y|w|d|h|m|s|years?|weeks?|days?|hours?|minutes?|seconds?)$/u,
    '',
  );
  const display = names.size === 1 ? [...names][0]! : undefined;
  const prefix = [handle, display]
    .filter((name): name is string => !!name)
    .sort((a, b) => b.length - a.length)
    .find((name) => body.toLowerCase().startsWith(name.toLowerCase() + ' '));
  const author = prefix ?? /^([A-Za-z0-9_.]{1,30})\s/u.exec(body)?.[1];
  const comment = author ? normalize(body.slice(author.length)) : '';
  const commentPrefix = comment.replace(/(?:\u2026|\.\.\.)$/u, '');
  return {
    textPresent: !!value,
    textLength: value.length,
    textEqualsExport: value === target,
    textContainsExport: !!target && value.includes(target),
    authorParsed: !!author,
    authorLength: author?.length ?? 0,
    authorEqualsHandle: !!author && ownerName(author) === ownerName(handle),
    authorEqualsDisplayName: display ? author === display : null,
    commentTextLength: comment.length,
    commentTextEqualsExport: !!author && comment === target,
    rowTextStartsWithHandle:
      body.toLowerCase() === handle.toLowerCase() ||
      body.toLowerCase().startsWith(handle.toLowerCase() + ' '),
    exportStartsWithCommentText:
      !!comment && !!target && target.startsWith(comment),
    commentTextStartsWithExport:
      !!comment && !!target && comment.startsWith(target),
    exportStartsWithCommentPrefix:
      !!commentPrefix && !!target && target.startsWith(commentPrefix),
    trailingEllipsisPresent: commentPrefix !== comment,
    labelPresent: !!label,
    labelLength: label.length,
    labelContainsExport: !!target && normalize(label).includes(target),
  };
}

/** Bounded passive read on the existing page, never a locator used to click. */
export async function listRowDiagnostic(
  page: Page,
  text: string,
  at: string,
  handle: string,
  bodies: readonly unknown[] = [],
) {
  const empty = {
    observed: false,
    capped: false,
    total: 0,
    displayNameObserved: false,
    displayNameAmbiguous: false,
    rows: [],
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    return await Promise.race([
      (async () => {
        const names = accountDisplayNames(bodies, handle);
        const candidates = page.locator(
          '[role="button"][aria-label],li:not([role="button"][aria-label]),[role="listitem"],[role="button"]:not([aria-label])',
        );
        const total = await candidates.count();
        const rows = [];
        const window = utcWindow(at);
        const handlePattern = new RegExp(
          '^' + handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$',
          'i',
        );
        for (let index = 0; index < Math.min(total, 40) && !expired; index++) {
          const row = candidates.nth(index);
          const label = await row.getAttribute('aria-label', { timeout: 150 });
          const role = await row.getAttribute('role', { timeout: 150 });
          const times = row.locator('time[datetime]');
          const anchors = await row.locator('a,[role="link"]').allInnerTexts();
          const date =
            (await times.count()) === 1
              ? await times.getAttribute('datetime', { timeout: 150 })
              : null;
          const valid = date !== null && Number.isFinite(Date.parse(date));
          const day = valid ? new Date(date).toISOString().slice(0, 10) : null;
          rows.push({
            container: (await row
              .locator(
                'xpath=ancestor::*[@role="dialog" or @role="alertdialog"]',
              )
              .count())
              ? 'dialog'
              : (await row.locator('xpath=ancestor::main').count())
                ? 'main'
                : 'elsewhere',
            shape:
              role === 'button' && label !== null
                ? 'counted'
                : role === 'button'
                  ? 'unlabelled-button'
                  : 'listitem',
            visible: await row.isVisible(),
            ...rowTextDiagnostic(
              await row.innerText({ timeout: 150 }),
              label ?? '',
              text,
              handle,
              names,
            ),
            imagePresent: (await row.locator('img').count()) > 0,
            anchorCount: anchors.length,
            firstHandleAnchorIndex: anchors.findIndex(
              (value) =>
                normalize(value).toLowerCase() === handle.toLowerCase(),
            ),
            handleElementPresent:
              (await row.getByText(handlePattern).count()) > 0,
            timeElementPresent: (await row.locator('time').count()) > 0,
            exactTimeObserved: valid,
            timestampWithinWindow:
              day === null ? null : day >= window[0] && day <= window[1],
          });
        }
        return ListRowDiagnosticSchema.parse({
          observed: true,
          capped: total > 40,
          total,
          displayNameObserved: names.size === 1,
          displayNameAmbiguous: names.size > 1,
          rows,
        });
      })(),
      new Promise<typeof empty>((resolve) => {
        timer = setTimeout(() => {
          expired = true;
          resolve(empty);
        }, 1000);
      }),
    ]);
  } catch {
    return ListRowDiagnosticSchema.parse(empty);
  } finally {
    expired = true;
    clearTimeout(timer);
  }
}
