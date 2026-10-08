import { buildChoiceParser, buildCommand } from '@stricli/core';
import type { GuideFact } from '@socialprune/core/guide/types';
import { CliError } from '../cli/errors.ts';
import { jsonFlag } from '../cli/context.ts';
import { plainText } from '../cli/output.ts';
import type {
  CliContext,
  CommandReply,
  CommandRunContext,
} from '../cli/context.ts';

export type GuidePlatform = 'x' | 'instagram';
export type GuideLanguage = 'en' | 'de';

export function guideHandler(
  platform: GuidePlatform,
  lang: GuideLanguage,
  context: CliContext,
): CommandReply {
  const guide = context.services.guides.find(
    (entry) => entry.platform === platform,
  );
  if (!guide) throw new CliError('GUIDE_UNAVAILABLE');
  const facts: readonly GuideFact[] = [
    guide.startUrl,
    ...(guide.paths?.desktop ?? []),
    ...(guide.paths?.mobile ?? []),
    ...guide.steps,
    ...guide.options,
    guide.waiting,
    guide.downloadWindow,
    guide.htmlExportHint,
  ];
  return {
    data: { platform, lang, guide },
    human: facts
      .map((fact) => {
        const source =
          lang === 'de' ? (fact.sourceDe ?? fact.source) : fact.source;
        return `${plainText(fact.text[lang])}\n${plainText(source.url)}\n${fact.verifiedOn === null ? (lang === 'de' ? 'Noch nicht von einer Person geprüft' : 'Not yet checked by a person') : `${lang === 'de' ? 'Geprüft am' : 'Checked on'} ${plainText(fact.verifiedOn)}`}`;
      })
      .join('\n\n'),
  };
}

export const guideCommand = buildCommand({
  parameters: {
    flags: {
      json: jsonFlag,
      lang: {
        kind: 'enum',
        values: ['en', 'de'],
        default: 'en',
        brief: 'Guide language',
      },
    },
    positional: {
      kind: 'tuple',
      parameters: [
        {
          parse: buildChoiceParser(['x', 'instagram']),
          placeholder: 'platform',
          brief: 'x or instagram',
        },
      ],
    },
  },
  docs: { brief: 'Export guide with sources and human-check status' },
  func(
    this: CommandRunContext,
    flags: { json: boolean; lang: GuideLanguage },
    platform: GuidePlatform,
  ) {
    this.reply(guideHandler(platform, flags.lang, this));
  },
});
