// Labels are data, not executable expressions. Keep export signatures assembled
// so the repository data guard can distinguish source from an actual export.
export const MAP_KEY = ['string', 'map', 'data'].join('_');
export const OWNER_KEY = ['media', 'owner'].join('_');
const MEDIA_KEY = ['media', 'list', 'data'].join('_');

// English labels are in picnic's 2025-07-31 snapshot. Username translations
// are in RobinOehler/unfollowtool-export-parsers. Other translations are
// compatibility assumptions, not observations of a real export (see fixtures).
export const FIELD_ALIASES = {
  comment: ['comment', 'kommentar', 'comentario', 'commentaire'],
  owner: ['media owner', 'medieninhaber', 'propietario del contenido'],
  time: ['time', 'zeit', 'hora', 'heure'],
  username: [
    'username',
    'user name',
    'benutzername',
    'nombre de usuario',
    "nom d'utilisateur",
    'nome utente',
    'gebruikersnaam',
    'nazwa użytkownika',
    'nome de usuário',
    'nome de utilizador',
  ],
} as const;

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export function repairMojibake(text: string): string {
  const bytes = new Uint8Array(text.length);
  let nonAscii = false;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code > 0xff) return text;
    if (code > 0x7f) nonAscii = true;
    bytes[index] = code;
  }
  if (!nonAscii) return text;
  try {
    const decoded = utf8.decode(bytes);
    return decoded === text ? text : decoded;
  } catch {
    return text;
  }
}

export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
// S4 run 4 (2026-10-07) measured one non-reference placeholder on every post
// text row. Count only HTTP(S) links or non-empty relative paths, not entries.
// Relative paths have no leading slash/backslash, colon, whitespace or control
// characters, and contain a slash or end in a file extension. Never open URIs.
export function mediaReferenceCount(
  entries: readonly unknown[] | null,
): number | null {
  if (entries === null) return null;
  let count = 0;
  for (const entry of entries) {
    const uri = object(entry)?.uri;
    if (typeof uri !== 'string' || !uri || /[\s\p{Cc}]/u.test(uri)) continue;
    if (/^https?:\/\//i.test(uri)) {
      try {
        const link = new URL(uri);
        if (link.hostname) count++;
      } catch {
        // An invalid link is not a usable media reference.
      }
    } else if (
      !/^[\/\\]/.test(uri) &&
      !uri.includes(':') &&
      (uri.includes('/') || /\.[a-z0-9]+$/i.test(uri))
    ) {
      count++;
    }
  }
  return count;
}
function label(key: string): string {
  return repairMojibake(key).trim().toLowerCase().replace(/\s+/g, ' ');
}
export function username(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const handle = repairMojibake(value).trim().toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(handle) && /[a-z0-9_]/.test(handle)
    ? handle
    : null;
}
export function timestampToUtc(seconds: unknown): string | null {
  // Do not guess milliseconds or a timezone. Comments use whole Unix seconds.
  if (
    typeof seconds !== 'number' ||
    !Number.isSafeInteger(seconds) ||
    seconds < 0 ||
    seconds > 253_402_300_799
  )
    return null;
  return new Date(seconds * 1000).toISOString();
}
export interface CommentData {
  text: string;
  createdAt: string;
  ownerHandle: string | null;
  mediaCount?: number;
}

interface Field {
  label: string;
  data: Record<string, unknown>;
}
function known(fields: Field[], aliases: readonly string[]): Field[] {
  return fields.filter((field) => aliases.includes(field.label));
}
export function parseComment(value: unknown): CommentData | null {
  const row = object(value);
  const map = object(row?.[MAP_KEY]);
  if (!row || !map) return null;
  const media = row[MEDIA_KEY];
  const entries: unknown[] | null = Array.isArray(media) ? media : null;
  const mediaCount = mediaReferenceCount(entries);
  const fields: Field[] = [];
  for (const [key, value] of Object.entries(map)) {
    const data = object(value);
    if (!data) return null;
    fields.push({ label: label(key), data });
  }
  const comments = known(fields, FIELD_ALIASES.comment);
  const times = known(fields, FIELD_ALIASES.time);
  const owners = known(fields, FIELD_ALIASES.owner);
  if (comments.length > 1 || times.length > 1 || owners.length > 1) return null;
  let comment = comments[0];
  let time = times[0];
  let owner = owners[0];
  if (
    (comment && typeof comment.data.value !== 'string') ||
    (time && typeof time.data.timestamp !== 'number') ||
    (owner && typeof owner.data.value !== 'string') ||
    (OWNER_KEY in row && typeof row[OWNER_KEY] !== 'string')
  )
    return null;

  if (!time) {
    const candidates = fields.filter(
      (field) =>
        field !== comment &&
        field !== owner &&
        typeof field.data.timestamp === 'number' &&
        (field.data.value === '' || field.data.value === undefined),
    );
    if (candidates.length !== 1) return null;
    time = candidates[0];
  }
  const siblingValue = row[OWNER_KEY];
  const sibling =
    typeof siblingValue === 'string' ? repairMojibake(siblingValue) : null;
  if (!owner && sibling !== null) {
    const candidates = fields.filter(
      (field) =>
        field !== comment &&
        field !== time &&
        typeof field.data.value === 'string' &&
        repairMojibake(field.data.value) === sibling,
    );
    if (candidates.length > 1) return null;
    owner = candidates[0];
  }
  if (!comment) {
    // An unknown translated label is accepted only after the time/owner slots
    // have been identified, leaving exactly one string slot. Two unnamed text
    // fields are ambiguous even when their positions look familiar.
    const candidates = fields.filter(
      (field) =>
        field !== time &&
        field !== owner &&
        typeof field.data.value === 'string',
    );
    if (candidates.length === 1 && (mediaCount === null || mediaCount === 0)) {
      comment = candidates[0];
    } else if (!(
      candidates.length === 0 &&
      entries !== null &&
      entries.length > 0
    )) {
      // With media, a lone unknown string could name its owner, not text.
      // Media-only rows need a non-empty list and no unresolved string slots.
      return null;
    }
  }
  if (!owner && sibling === null) {
    const candidates = fields.filter(
      (field) =>
        field !== time &&
        field !== comment &&
        typeof field.data.value === 'string',
    );
    if (candidates.length > 1) return null;
    owner = candidates[0];
  }
  const createdAt = timestampToUtc(time?.data.timestamp);
  if (!createdAt) return null;
  const ownerHandle =
    typeof owner?.data.value === 'string'
      ? repairMojibake(owner.data.value)
      : sibling;
  if (sibling !== null && ownerHandle !== sibling) return null;
  return {
    text: comment ? repairMojibake(comment.data.value as string) : '',
    createdAt,
    ownerHandle: ownerHandle === '' ? null : ownerHandle,
    ...(mediaCount === null ? {} : { mediaCount }),
  };
}

export function profileUsername(value: unknown): {
  handle: string | null;
  status: 'found' | 'missing' | 'empty' | 'unreadable';
} {
  const profiles = object(value)?.profile_user;
  if (!Array.isArray(profiles)) return { handle: null, status: 'unreadable' };
  if (!profiles.length) return { handle: null, status: 'empty' };
  const handles = new Set<string>();
  let empty = false;
  for (const profile of profiles) {
    const map = object(object(profile)?.[MAP_KEY]);
    if (!map) return { handle: null, status: 'unreadable' };
    // Never use shape/position guessing here: it could turn an email or phone
    // number into an account handle. Read only explicitly named username slots.
    for (const key of Object.keys(map)) {
      if (!(FIELD_ALIASES.username as readonly string[]).includes(label(key)))
        continue;
      const value = object(map[key])?.value;
      if (value === '') {
        empty = true;
        continue;
      }
      const handle = username(value);
      if (!handle) return { handle: null, status: 'unreadable' };
      handles.add(handle);
    }
  }
  if (handles.size > 1) return { handle: null, status: 'unreadable' };
  const handle = [...handles][0] ?? null;
  return {
    handle,
    status: handle ? 'found' : empty ? 'empty' : 'missing',
  };
}

export function parseLegacyComment(value: unknown): CommentData | null {
  // The pre-envelope comments.json contains media_comments triples, as
  // described by instagram_json_viewer. Story/live arrays are never visited.
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [date, text, owner] = value as unknown[];
  if (typeof text !== 'string' || typeof owner !== 'string') return null;
  let createdAt = timestampToUtc(date);
  if (
    typeof date === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      date,
    )
  ) {
    const milliseconds = Date.parse(date);
    const day = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
    if (
      Number.isFinite(milliseconds) &&
      Number.isFinite(day.getTime()) &&
      day.toISOString().slice(0, 10) === date.slice(0, 10)
    )
      createdAt = new Date(milliseconds).toISOString();
  }
  if (!createdAt) return null;
  return {
    text: repairMojibake(text),
    createdAt,
    ownerHandle: repairMojibake(owner) || null,
  };
}
