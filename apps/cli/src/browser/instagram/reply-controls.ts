import type { Locator } from 'playwright-core';
import { normalize } from './plan.ts';
import type { ReplyControlsDiagnostic } from './report.ts';

export function replyControlShape(label: string, answerTotal: number | null) {
  const text = normalize(label);
  const all = /^View all ([1-9]\d{0,5}) replies$/u.exec(text);
  const numbered = /^View replies \(([1-9]\d{0,5})\)$/u.exec(text);
  const number = all?.[1] ?? numbered?.[1];
  const shape =
    text === 'View replies'
      ? ('exact-view-replies' as const)
      : all
        ? ('view-all-n-replies' as const)
        : numbered
          ? ('view-replies-n' as const)
          : /^Hide replies(?: \(\d+\))?$/u.test(text)
            ? ('hide-replies' as const)
            : ('other' as const);
  const numberEqualsAnswer =
    number === undefined || answerTotal === null
      ? null
      : Number(number) === answerTotal;
  return {
    shape,
    digitsPresent: /\d/u.test(text),
    numberEqualsAnswer,
    accepted:
      shape === 'exact-view-replies' ||
      ((shape === 'view-all-n-replies' || shape === 'view-replies-n') &&
        numberEqualsAnswer === true),
  };
}
export async function checkedReplyControls(
  controls: Locator,
  answerTotal: number | null,
) {
  const count = await controls.count();
  const diagnostic: ReplyControlsDiagnostic = {
    count,
    capped: count > 20,
    controls: [],
  };
  let accepted: Locator | undefined;
  if (count === 0) return { diagnostic, control: accepted, valid: true };
  for (const control of (await controls.all()).slice(0, 20)) {
    const value = replyControlShape(
      await control.innerText({ timeout: 150 }),
      answerTotal,
    );
    const tag =
      (await control.locator('xpath=self::button').count()) === 1
        ? ('button' as const)
        : (await control.locator('xpath=self::div').count()) === 1
          ? ('div' as const)
          : ('other' as const);
    const rawRole = await control.getAttribute('role', { timeout: 150 });
    const role =
      rawRole === null
        ? null
        : rawRole === 'button'
          ? ('button' as const)
          : ('other' as const);
    diagnostic.controls.push({ ...value, tag, role });
    if (value.accepted) accepted = accepted ? accepted.or(control) : control;
  }
  return {
    diagnostic,
    control: accepted,
    valid:
      !diagnostic.capped &&
      diagnostic.controls.every((value) => value.accepted) &&
      count <= 1,
  };
}
