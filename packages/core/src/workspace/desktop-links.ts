/** Post routes emitted by the review, click list and archive, not arbitrary URLs. */
export function platformPostUrl(value: string): string | null {
  // Check the original spelling first: URL parsing would erase dot segments,
  // default ports, empty query/fragment delimiters and some whitespace.
  const x =
    /^https:\/\/(?:x\.com|twitter\.com)\/(?:(?!i\/status\/)[A-Za-z0-9_]{1,15}|i\/web)\/status\/[0-9]+$/;
  const instagram =
    /^https:\/\/www\.instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]{1,64}\/$/;
  if (value.length > 4096 || (!x.test(value) && !instagram.test(value)))
    return null;
  try {
    const url = new URL(value);
    return url.href === value ? url.href : null;
  } catch {
    return null;
  }
}
