import { guideFacts, helpSource } from './check.ts';
import type { PlatformGuide } from './types.ts';
import type { DesktopLink } from '../workspace/desktop-protocol.ts';

export const REPORT_URL =
  'https://github.com/socialprune/socialprune/issues/new';

/** Resolve a validated guide identifier without opening or fetching anything. */
export function resolveGuideLink(
  guides: readonly PlatformGuide[],
  link: DesktopLink,
): string | null {
  if (link.kind === 'guide-report') return REPORT_URL;
  if (link.kind !== 'guide-source') return null;
  const guide = guides.find(({ platform }) => platform === link.platform);
  const fact = guide && guideFacts(guide).find(({ id }) => id === link.factId);
  if (!fact) return null;
  const source =
    link.locale === 'de' ? (fact.sourceDe ?? fact.source) : fact.source;
  return helpSource(source.url) ? source.url : null;
}
