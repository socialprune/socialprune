import type { Original } from '@socialprune/core';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// X escapes these three characters in post text. Decode once, never as HTML.
function decodeXText(text: string): string {
  return text.replace(/&(?:amp|lt|gt);/g, (entity) =>
    entity === '&amp;' ? '&' : entity === '&lt;' ? '<' : '>',
  );
}

function isQuoteLink(value: unknown, id: string | null): boolean {
  if (typeof value !== 'string' || id === null) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      [
        'x.com',
        'twitter.com',
        'www.twitter.com',
        'mobile.twitter.com',
      ].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      /^\/(?:[A-Za-z0-9_]{1,50}|i\/web)\/status\/(\d{1,40})\/?$/.exec(
        url.pathname,
      )?.[1] === id
    );
  } catch {
    return false;
  }
}

/** Display only. Metadata belongs to the exact anonymous text, not a later fill. */
export function originalDisplayText(original: Original): string | null {
  if (original.text === null) return null;
  let display = original.text;
  const raw = object(original.raw);
  if (
    original.textSource === 'anonymous' &&
    raw.text === original.text &&
    (raw.id_str === undefined || raw.id_str === original.id)
  ) {
    const range = raw.display_text_range;
    if (
      Array.isArray(range) &&
      range.length === 2 &&
      typeof range[0] === 'number' &&
      typeof range[1] === 'number' &&
      Number.isSafeInteger(range[0]) &&
      Number.isSafeInteger(range[1]) &&
      range[0] >= 0 &&
      range[1] >= range[0]
    ) {
      const points = Array.from(display);
      if (range[1] <= points.length)
        display = points.slice(range[0], range[1]).join('');
    }
    const hidden = new Set<string>();
    const add = (url: unknown) => {
      if (
        typeof url === 'string' &&
        /^https:\/\/t\.co\/[A-Za-z0-9]+$/.test(url)
      )
        hidden.add(url);
    };
    const entities = object(raw.entities);
    for (const list of [
      entities.media,
      object(raw.extended_entities).media,
      raw.mediaDetails,
    ])
      for (const entry of Array.isArray(list) ? list : [])
        add(object(entry).url);
    const quote = object(raw.quoted_status_permalink);
    if (isQuoteLink(quote.expanded, original.quotedId)) add(quote.url);
    for (const entry of Array.isArray(entities.urls) ? entities.urls : []) {
      const link = object(entry);
      if (isQuoteLink(link.expanded_url, original.quotedId)) add(link.url);
    }
    // A matching URL in the middle of the post is still the author's text.
    for (;;) {
      const suffix = /(?:^|\s)(https:\/\/t\.co\/[A-Za-z0-9]+)\s*$/u.exec(
        display,
      );
      if (!suffix || !hidden.has(suffix[1]!)) break;
      display = display.slice(0, suffix.index).trimEnd();
    }
  }
  return decodeXText(display);
}
