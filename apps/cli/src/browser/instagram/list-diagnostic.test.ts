import { expect, test } from 'vitest';
import { accountDisplayNames, rowTextDiagnostic } from './list-diagnostic.ts';
import { ListRowDiagnosticSchema } from './report.ts';
import { contextEnd } from './copy.ts';

test('IG-list diagnostics distinguish a display name, foreign author, mention and image-only row without values', () => {
  const text = 'Generated target comment';
  const handle = 'generated_handle';
  const display = 'Generated Display Name';
  const names = accountDisplayNames(
    [
      { user: { username: handle, full_name: display } },
      { user: { username: 'generated_foreign', full_name: 'Other Display' } },
      {
        variables: { username: handle, full_name: 'Untrusted parameter name' },
      },
    ],
    handle,
  );
  expect([...names]).toEqual([display]);
  const result = rowTextDiagnostic(
    `${display} ${text} 1w`,
    '',
    text,
    handle,
    names,
  );
  expect(result).toMatchObject({
    authorEqualsHandle: false,
    authorEqualsDisplayName: true,
    commentTextEqualsExport: true,
  });
  expect(
    rowTextDiagnostic(`generated_foreign ${text} 1w`, '', text, handle, names),
  ).toMatchObject({
    authorEqualsHandle: false,
    authorEqualsDisplayName: false,
    commentTextEqualsExport: true,
  });
  expect(
    rowTextDiagnostic(
      `${handle} @generated_friend 1w`,
      '',
      '@generated_friend',
      handle,
      names,
    ),
  ).toMatchObject({ authorEqualsHandle: true, commentTextEqualsExport: true });
  expect(
    rowTextDiagnostic('', 'Generated image label', text, handle, names),
  ).toMatchObject({
    textPresent: false,
    authorParsed: false,
    commentTextEqualsExport: false,
  });
  for (const value of [text, handle, display, '1w'])
    expect(JSON.stringify(result)).not.toContain(value);
  expect(
    Object.values(result).every(
      (value) =>
        value === null ||
        typeof value === 'number' ||
        typeof value === 'boolean',
    ),
  ).toBe(true);
});

test('IG-list diagnostic schema refuses content-bearing fields and excessive rows', () => {
  const empty = {
    observed: true,
    capped: false,
    total: 0,
    displayNameObserved: false,
    displayNameAmbiguous: false,
    rows: [],
  };
  expect(ListRowDiagnosticSchema.safeParse(empty).success).toBe(true);
  expect(
    ListRowDiagnosticSchema.safeParse({ ...empty, handle: 'generated' })
      .success,
  ).toBe(false);
  expect(
    ListRowDiagnosticSchema.safeParse({
      ...empty,
      rows: [{ text: 'Generated private decoy' }],
    }).success,
  ).toBe(false);
  const ambiguous = accountDisplayNames(
    [
      { username: 'generated', full_name: 'First' },
      { username: 'generated', full_name: 'Second' },
    ],
    'generated',
  );
  expect(
    rowTextDiagnostic(
      'First Generated text 1w',
      '',
      'Generated text',
      'generated',
      ambiguous,
    ).authorEqualsDisplayName,
  ).toBeNull();
});

test.each(['de', 'en'] as const)(
  'IG-list timeout ending in %s does not claim a login, challenge, lock or limit',
  (lang) => {
    const text = contextEnd('platform-check', lang, true, 'list-timeout');
    expect(text).not.toMatch(
      /login|sign-in|challenge|lock|limit|Anmeldung|Kontoprüfung|Sperre/iu,
    );
    expect(text).toMatch(/Kommentarliste|comments list/u);
  },
);
