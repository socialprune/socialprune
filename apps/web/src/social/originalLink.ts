export function originalXLink(id: string | null): string | null {
  if (id === null || id.length < 1 || id.length > 25 || /[^0-9]/u.test(id))
    return null;
  return `https://x.com/i/web/status/${id}`;
}
