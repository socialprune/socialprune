import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import de from '../i18n/de.json';
import { buildReminder, defaultReminderDate } from './reminder.ts';

const clock = {
  now: () => new Date('2026-10-08T10:30:05.123Z'),
  uuid: () => '12345678-1234-4234-8234-123456789abc',
};
const unfold = (value: string) => value.replace(/\r\n[ \t]/g, '');

describe('local RFC 5545 reminder', () => {
  it('writes CRLF, one all-day event, exclusive next date and a 09:00 local alarm', () => {
    const output = buildReminder(
      '2026-12-31',
      { summary: 'Generated title', description: 'Generated description' },
      clock,
    );
    expect(output.endsWith('\r\n')).toBe(true);
    expect(output.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(output.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(output).toContain('DTSTART;VALUE=DATE:20261231\r\n');
    expect(output).toContain('DTEND;VALUE=DATE:20270101\r\n');
    expect(output).toContain('DTSTAMP:20261008T103005Z\r\n');
    expect(output).toContain(`UID:${clock.uuid()}@socialprune.github.io\r\n`);
    expect(output).toContain('TRIGGER;RELATED=START:PT9H\r\n');
    expect(output).not.toMatch(/TZID|ATTENDEE|ORGANIZER|mailto:|https?:/);
    expect(
      buildReminder('2024-02-29', { summary: '', description: '' }, clock),
    ).toContain('DTEND;VALUE=DATE:20240301');
  });

  it('generates different random UUIDs by default', () => {
    const first = buildReminder('2026-10-11', { summary: '', description: '' });
    const second = buildReminder('2026-10-11', {
      summary: '',
      description: '',
    });
    const uid =
      /^UID:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})@socialprune.github.io$/m;
    expect(first).toMatch(uid);
    expect(second).toMatch(uid);
    expect(first.match(uid)?.[1]).not.toBe(second.match(uid)?.[1]);
  });

  it('escapes text and folds by UTF-8 octets without splitting Unicode', () => {
    const output = buildReminder(
      '2026-10-11',
      {
        summary: 'Grüße, A; B\\C\r\nBEGIN:VEVENT',
        description: 'ä𝄞'.repeat(40) + '\rEND:VCALENDAR',
      },
      clock,
    );
    expect(unfold(output)).toContain(
      'SUMMARY:Grüße\\, A\\; B\\\\C\\nBEGIN:VEVENT\r\n',
    );
    expect(unfold(output)).toContain(
      `DESCRIPTION:${'ä𝄞'.repeat(40)}\\nEND:VCALENDAR\r\n`,
    );
    for (const line of output.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(output).toContain('\r\n ');
    expect(output).not.toContain('�');
    expect(output.match(/^BEGIN:VEVENT\r$/gm)).toHaveLength(1);
  });

  it('puts only catalog text in SUMMARY, DESCRIPTION and the alarm', () => {
    for (const messages of [en, de]) {
      for (const platform of ['X', 'Instagram']) {
        const url = `https://socialprune.github.io/socialprune/#/guide/${platform === 'X' ? 'x' : 'instagram'}`;
        const summary = messages['guide.calendarSummary'].replace(
          '{platform}',
          platform,
        );
        const description = messages['guide.calendarDescription'].replace(
          '{url}',
          url,
        );
        const output = unfold(
          buildReminder('2026-10-11', { summary, description }, clock),
        );
        const humanText = output
          .split('\r\n')
          .filter((line) => /^(?:SUMMARY|DESCRIPTION):/.test(line))
          .map((line) =>
            line.replace(/\\([\\,;nN])/g, (_, value: string) =>
              value.toLowerCase() === 'n' ? '\n' : value,
            ),
          );
        expect(humanText).toEqual([
          `SUMMARY:${summary}`,
          `DESCRIPTION:${description}`,
          `DESCRIPTION:${summary}`,
        ]);
      }
    }
  });

  it('rejects impossible dates and injected UIDs, and uses local calendar days for defaults', () => {
    expect(() =>
      buildReminder('2026-02-30', { summary: '', description: '' }, clock),
    ).toThrow('Invalid calendar date');
    expect(() =>
      buildReminder(
        '2026-10-11',
        { summary: '', description: '' },
        { ...clock, uuid: () => 'injected\r\nATTENDEE:x' },
      ),
    ).toThrow('Invalid calendar UID');
    const today = new Date(2026, 9, 30, 23, 59);
    expect(defaultReminderDate(today, null)).toBe('2026-11-02');
    expect(defaultReminderDate(today, 1)).toBe('2026-10-31');
    expect(today.getDate()).toBe(30);
  });
});
