import { guideDate } from '@socialprune/core/guide/check';

export interface ReminderText {
  summary: string;
  description: string;
}

function escapeText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,');
}

// RFC 5545 limits physical content lines to 75 UTF-8 octets, not characters.
function fold(line: string): string {
  const encoder = new TextEncoder();
  let width = 0;
  let result = '';
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (width + bytes > 75) {
      result += '\r\n ';
      width = 1;
    }
    result += character;
    width += bytes;
  }
  return result;
}

/** Text comes from the catalogs at the call site; no network or personal data. */
export function buildReminder(
  date: string,
  text: ReminderText,
  clock: { now: () => Date; uuid: () => string } = {
    now: () => new Date(),
    uuid: () => crypto.randomUUID(),
  },
): string {
  const day = guideDate(date);
  if (day === null) throw new Error('Invalid calendar date.');
  const uid = clock.uuid();
  if (!/^[\w.-]+$/.test(uid)) throw new Error('Invalid calendar UID.');
  const now = clock.now();
  if (!Number.isFinite(now.getTime()))
    throw new Error('Invalid calendar timestamp.');
  const next = new Date(day + 86_400_000).toISOString().slice(0, 10);
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//socialprune//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${uid}@socialprune.github.io`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${date.replaceAll('-', '')}`,
      `DTEND;VALUE=DATE:${next.replaceAll('-', '')}`,
      `SUMMARY:${escapeText(text.summary)}`,
      `DESCRIPTION:${escapeText(text.description)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      // A DATE event starts at local midnight; nine hours later is 09:00 local.
      'TRIGGER;RELATED=START:PT9H',
      `DESCRIPTION:${escapeText(text.summary)}`,
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ]
      .map(fold)
      .join('\r\n') + '\r\n'
  );
}

export function defaultReminderDate(
  today: Date,
  maxDays: number | null,
): string {
  const date = new Date(today);
  date.setDate(date.getDate() + (maxDays ?? 3));
  return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}
