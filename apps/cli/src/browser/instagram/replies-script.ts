import type { ReplyMatch } from './replies-answer.ts';
import { normalize } from './plan.ts';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const id = (value: unknown) =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : '';
export const emptyScriptDiagnostic = () => ({
  objectsInspected: 0,
  focalMatches: 0,
  qualified: 0,
  parameterObjectsSkipped: 0,
  failedChecks: { id: 0, author: 0, time: 0, text: 0 },
  childCountClass: 'absent' as
    'absent' | 'zero' | 'positive' | 'invalid' | 'mixed',
  capped: false,
  observationFailed: false,
});
export type ScriptReplyDiagnostic = ReturnType<typeof emptyScriptDiagnostic>;

/** Only exact focal parents, never free-standing children or parameters. */
export function scriptReplySource(
  values: readonly unknown[],
  match: ReplyMatch,
) {
  const diagnostic = emptyScriptDiagnostic(),
    objects: unknown[] = [];
  const classes = new Set<'zero' | 'positive' | 'invalid'>();
  const totals = new Set<number>();
  let conflict = false;
  let visits = 0;
  const walk = (input: unknown, depth: number) => {
    if (++visits > 100000 || depth > 40) {
      diagnostic.capped = true;
      return;
    }
    if (Array.isArray(input)) {
      for (const value of input) {
        if (diagnostic.capped) break;
        walk(value, depth + 1);
      }
      return;
    }
    const value = record(input);
    if (!Object.keys(value).length) return;
    diagnostic.objectsInspected++;
    const author = record(value.user ?? value.owner);
    const checks = {
      id: id(value.pk ?? value.id) === match.id,
      author: author.username === match.username,
      time:
        (value.created_at ?? value.created_at_utc) ===
        Date.parse(match.createdAt) / 1000,
      text:
        typeof value.text === 'string' &&
        normalize(value.text) === normalize(match.text),
    };
    // Describe comment-like candidates, not unrelated media/user objects.
    if (
      checks.id ||
      (typeof value.text === 'string' &&
        ('created_at' in value || 'created_at_utc' in value))
    ) {
      for (const key of ['id', 'author', 'time', 'text'] as const)
        if (!checks[key]) diagnostic.failedChecks[key]++;
      if (Object.values(checks).every(Boolean)) {
        diagnostic.focalMatches++;
        const threaded = record(value.edge_threaded_comments);
        const count = value.child_comment_count ?? threaded.count;
        const children =
          value.preview_child_comments ??
          value.child_comments ??
          threaded.edges;
        if (count !== undefined || children !== undefined) {
          diagnostic.qualified++;
          objects.push(value);
          if (
            typeof count === 'number' &&
            Number.isSafeInteger(count) &&
            count >= 0
          ) {
            totals.add(count);
            if (Array.isArray(children) && children.length > count)
              conflict = true;
          }
          classes.add(
            (count !== undefined &&
              (typeof count !== 'number' ||
                !Number.isSafeInteger(count) ||
                count < 0)) ||
              (children !== undefined && !Array.isArray(children))
              ? 'invalid'
              : typeof count === 'number'
                ? count === 0
                  ? 'zero'
                  : 'positive'
                : (children as unknown[]).length === 0
                  ? 'zero'
                  : 'positive',
          );
        }
      }
    }
    for (const [key, next] of Object.entries(value)) {
      if (diagnostic.capped) break;
      if (
        ['variables', 'params', 'instanceParams', 'route_match_infos'].includes(
          key,
        )
      ) {
        diagnostic.parameterObjectsSkipped += Number(
          !!next && typeof next === 'object',
        );
      } else if (next && typeof next === 'object') walk(next, depth + 1);
    }
  };
  for (const value of values) {
    if (diagnostic.capped) break;
    walk(value, 0);
  }
  diagnostic.childCountClass =
    classes.size > 1 ? 'mixed' : ([...classes][0] ?? 'absent');
  return { objects, diagnostic, conflict: conflict || totals.size > 1 };
}

/** HTML is data. Never evaluate scripts or admit external/executable scripts. */
export function parseReplyScripts(html: string) {
  const values: unknown[] = [];
  let scripts = 0,
    failed = false;
  // Skip comments and other raw-text elements before recognising script tags.
  // Caption strings and inert template children are not document script nodes.
  const token =
    /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([A-Za-z][A-Za-z0-9:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gu;
  let match: RegExpExecArray | null,
    templateDepth = 0,
    tokens = 0;
  while ((match = token.exec(html))) {
    if (++tokens > 100000) {
      failed = true;
      break;
    }
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    const closing = match[0].startsWith('</');
    if (name === 'template') {
      templateDepth = Math.max(0, templateDepth + (closing ? -1 : 1));
      continue;
    }
    if (closing) continue;
    if (name === 'plaintext') break;
    if (
      ![
        'script',
        'style',
        'textarea',
        'title',
        'xmp',
        'iframe',
        'noembed',
        'noframes',
      ].includes(name)
    )
      continue;
    const end = new RegExp(`</${name}\\s*>`, 'giu');
    end.lastIndex = token.lastIndex;
    const close = end.exec(html);
    const content = html.slice(token.lastIndex, close?.index ?? html.length);
    token.lastIndex = close ? end.lastIndex : html.length;
    if (name !== 'script' || templateDepth) continue;
    const attributes = new Map<string, string>();
    for (const attr of match[2]!.matchAll(
      /(?:^|\s)([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu,
    )) {
      const key = attr[1]!.toLowerCase();
      if (attributes.has(key)) {
        attributes.set('duplicate', 'true');
        break;
      }
      attributes.set(key, attr[2] ?? attr[3] ?? attr[4] ?? '');
    }
    if (
      attributes.get('type')?.trim().toLowerCase() !== 'application/json' ||
      attributes.has('src') ||
      attributes.has('duplicate')
    )
      continue;
    if (++scripts > 512) {
      failed = true;
      break;
    }
    try {
      values.push(JSON.parse(content) as unknown);
    } catch {
      failed = true;
    }
  }
  return { values, scripts: Math.min(scripts, 512), failed };
}
