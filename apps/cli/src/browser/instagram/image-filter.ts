import { postObjects } from './answers.ts';
import { COMMENTS_PATH } from './network.ts';

/**
 * REQ-1: what a reading run does with one image download. `load` keeps
 * today's behaviour; the other classes are aborted by the client and counted.
 * Nothing is replaced, rewritten or answered on Instagram's behalf.
 */
export type ImageDecision = 'list' | 'avatar' | 'other' | 'load';
export const IMAGE_ABORT_CLASSES = ['list', 'avatar', 'other'] as const;

const PROFILE_KEY = /profile_pic/u;
const LIMIT = 100000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
/** Bounded walk; `false` when the bound was reached. */
function walk(
  input: unknown,
  visit: (key: string | null, value: unknown, profile: boolean) => void,
): boolean {
  let visits = 0;
  const step = (
    value: unknown,
    key: string | null,
    depth: number,
    profile: boolean,
  ): boolean => {
    if (++visits > LIMIT || depth > 40) return false;
    visit(key, value, profile);
    if (Array.isArray(value)) {
      for (const entry of value)
        if (!step(entry, key, depth + 1, profile)) return false;
      return true;
    }
    const object = record(value);
    if (!object) return true;
    for (const [name, entry] of Object.entries(object))
      if (!step(entry, name, depth + 1, profile || PROFILE_KEY.test(name)))
        return false;
    return true;
  };
  return step(input, null, 0, false);
}
/** The focal post code from a post or comment permalink page address. */
export function focalCode(pageUrl: string): string | null {
  try {
    return (
      /^\/(?:p|reel)\/([A-Za-z0-9_-]{1,64})(?:\/(?:c\/\d{1,40}\/?)?)?$/u.exec(
        new URL(pageUrl).pathname,
      )?.[1] ?? null
    );
  } catch {
    return null;
  }
}
interface Sets {
  complete: boolean;
  focal: Set<string>;
  avatar: Set<string>;
  other: Set<string>;
}
/**
 * Exact addresses from the page's own answers: every string inside the
 * qualifying focal-post objects except profile pictures (kept), every
 * profile-picture address (avatar) and every image candidate address of a
 * post object with another code (other).
 */
export function answerAddresses(
  bodies: readonly unknown[],
  code: string,
): Sets {
  const focal = new Set<string>(),
    avatar = new Set<string>(),
    other = new Set<string>();
  const objects = postObjects(bodies, code);
  let complete = !objects.capped && objects.objects.length > 0;
  for (const { value } of objects.objects)
    complete &&= walk(value, (_key, entry, profile) => {
      if (typeof entry === 'string' && !profile) focal.add(entry);
    });
  for (const body of bodies)
    complete &&= walk(body, (key, entry, profile) => {
      if (typeof entry === 'string' && profile) avatar.add(entry);
      const object = record(entry);
      const postCode = object?.code ?? object?.shortcode;
      if (
        object &&
        typeof postCode === 'string' &&
        postCode !== code &&
        record(object.image_versions2)
      )
        walk(object, (_name, value, inProfile) => {
          if (typeof value === 'string' && !inProfile) other.add(value);
        });
      void key;
    });
  return { complete, focal, avatar, other };
}
/**
 * REQ-1 rule 1. Comments-list page: every image download is aborted. Post
 * page: only an address the page's own answer lists as a profile picture or
 * as another post's media is aborted, and never one the focal post lists.
 * Anything not classifiable before it loads, including every image before the
 * focal answer arrived, loads as today (fail open).
 */
export function imageClassifier(bodies: () => readonly unknown[]) {
  let cache:
    | { bodies: readonly unknown[]; length: number; code: string; sets: Sets }
    | undefined;
  return (pageUrl: string, imageUrl: string): ImageDecision => {
    let path: string;
    try {
      path = new URL(pageUrl).pathname;
    } catch {
      return 'load';
    }
    if (path === COMMENTS_PATH || path.startsWith(COMMENTS_PATH + '/'))
      return 'list';
    const code = focalCode(pageUrl);
    if (!code) return 'load';
    const current = bodies();
    if (
      !cache ||
      cache.bodies !== current ||
      cache.length !== current.length ||
      cache.code !== code
    )
      cache = {
        bodies: current,
        length: current.length,
        code,
        sets: answerAddresses(current, code),
      };
    const { complete, focal, avatar, other } = cache.sets;
    if (!complete || focal.has(imageUrl)) return 'load';
    if (avatar.has(imageUrl)) return 'avatar';
    if (other.has(imageUrl)) return 'other';
    return 'load';
  };
}
