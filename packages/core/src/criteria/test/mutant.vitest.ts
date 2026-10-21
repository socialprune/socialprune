// Test-only mutation entrypoint. Never imported by a production entrypoint.
import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const mutations: Record<string, { file: string; from: string; to: string }> = {
  presets: {
    file: 'presets.ts',
    from: "['racist', 'Racist',",
    to: "['racist-broken', 'Racist',",
  },
  hash: {
    file: 'hash.ts',
    from: 'new TextEncoder().encode(text)',
    to: "new TextEncoder().encode(text + 'broken')",
  },
  custom: {
    file: 'presets.ts',
    from: '`custom-${criteria.nextCustom}`',
    to: '`custom-${criteria.custom.length + 1}`',
  },
  room: {
    file: 'presets.ts',
    from: 'categories.length < 32',
    to: 'categories.length < 33',
  },
  noRoom: {
    file: 'presets.ts',
    from: "if (settings.categories.length >= 32) throw new Error('NO_ROOM');",
    to: "if (settings.categories.length >= 33) throw new Error('NO_ROOM');",
  },
  customMax: {
    file: 'presets.ts',
    from: 'criteria.custom.length >= 8',
    to: 'criteria.custom.length >= 9',
  },
  ruleMax: {
    file: 'schema.ts',
    from: 'z.array(KeepRuleSchema).max(16)',
    to: 'z.array(KeepRuleSchema).max(17)',
  },
  top: {
    file: 'keep-rules.ts',
    from: 'return isPopular(item, item.account.key, popularThreshold)',
    to: 'return false',
  },
  likes: {
    file: 'keep-rules.ts',
    from: "rule.kind === 'likes-at-least' ? item.engagement.likes : item.engagement.reposts",
    to: "rule.kind === 'likes-at-least' ? 0 : item.engagement.reposts",
  },
  reposts: {
    file: 'keep-rules.ts',
    from: "rule.kind === 'likes-at-least' ? item.engagement.likes : item.engagement.reposts",
    to: "rule.kind === 'likes-at-least' ? item.engagement.likes : 0",
  },
  unknown: {
    file: 'keep-rules.ts',
    from: 'value === null ? rule.alsoWhenUnknown',
    to: 'value === null ? false',
  },
  unknownAlways: {
    file: 'keep-rules.ts',
    from: 'value === null ? rule.alsoWhenUnknown',
    to: 'value === null ? true',
  },
  nonHit: {
    file: 'feed.ts',
    from: "check.status === 'hit'",
    to: 'true',
  },
  applicability: {
    file: 'keep-rules.ts',
    from: "if (item.platform !== 'x' || item.kind === 'repost') return false;",
    to: 'if (false) return false;',
  },
  date: {
    file: 'keep-rules.ts',
    from: 'dayKey(item.createdAt, timeZone)',
    to: "dayKey(item.createdAt, 'UTC')",
  },
  or: {
    file: 'keep-rules.ts',
    from: '.map((rule) => rule.id)',
    to: '.slice(0, 1).map((rule) => rule.id)',
  },
  enabled: {
    file: 'keep-rules.ts',
    from: 'if (!rule.enabled) return false;',
    to: 'if (false) return false;',
  },
  tabs: {
    file: 'feed.ts',
    from: "decision === 'later' ? 'unclear'",
    to: "decision === 'later' ? 'suggested'",
  },
  markedOrder: {
    file: 'feed.ts',
    from: "decision === 'delete' ? 'marked'",
    to: "decision === 'delete' ? 'held'",
  },
  keptOrder: {
    file: 'feed.ts',
    from: "decision === 'keep' ? 'kept'",
    to: "decision === 'keep' ? 'held'",
  },
  latest: {
    file: 'suggestions.ts',
    from: 'for (const submission of workspace.submissions)',
    to: 'for (const submission of [...workspace.submissions].reverse())',
  },
  fixture: {
    file: 'suggestions.ts',
    from: 'for (const label of sources.values())',
    to: 'for (const label of [...sources.values()].slice(0, 0))',
  },
  hit: {
    file: 'feed.ts',
    from: 'check.assessment!.risk >= criteria.level',
    to: 'check.assessment!.risk >= 0',
  },
  ticked: {
    file: 'feed.ts',
    from: 'criteria.selected.includes(check.criterion)',
    to: 'true',
  },
  perCriterion: {
    file: 'suggestions.ts',
    from: 'first.source.name, criterion.id',
    to: "first.source.name, 'all'",
  },
  perSource: {
    file: 'suggestions.ts',
    from: 'first.source.kind, first.source.name, criterion.id',
    to: "'all', 'all', criterion.id",
  },
  currentHash: {
    file: 'suggestions.ts',
    from: 'if (criterion.hash !== criterionHash(criterion.id, workspace.settings)) continue;',
    to: 'if (false) continue;',
  },
};
// Test-only mutation selector, never credentials or production configuration.
// eslint-disable-next-line no-restricted-properties
const selected = process.env['SP_CRITERIA_MUTANT'];
if (!selected || !mutations[selected])
  throw new Error('Choose a declared test mutation');
const mutation = mutations[selected];
const root = fileURLToPath(new URL('../../../', import.meta.url));
let applied = false;
export default defineConfig({
  root,
  plugins: [
    {
      name: 'criteria-test-only-mutation',
      enforce: 'pre',
      async load(id) {
        if (
          !id.replaceAll('\\', '/').endsWith(`/src/criteria/${mutation.file}`)
        )
          return;
        const text = await readFile(id, 'utf8');
        const anchor = new RegExp(
          [...mutation.from.replace(/\s/g, '')]
            .map((character) =>
              character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            )
            .join('\\s*'),
        );
        if (!anchor.test(text))
          throw new Error(`Mutation anchor missing: ${selected}`);
        applied = true;
        return text.replace(anchor, mutation.to);
      },
    },
  ],
  test: {
    environment: 'node',
    include: [
      'src/criteria/acceptance.test.ts',
      'src/criteria/rules-red.test.ts',
    ],
    maxWorkers: 1,
    reporters: ['default'],
    onConsoleLog() {
      return false;
    },
  },
});
process.on('exit', () => {
  if (!applied) console.error(`MUTATION_NOT_APPLIED ${selected}`);
});
