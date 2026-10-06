import { CORE_VERSION } from '@socialprune/core';

export function helpText(): string {
  return [
    `SocialPrune (core ${CORE_VERSION})`,
    '',
    'Usage: socialprune [command] [options]',
    '',
    'Planned commands:',
    '  structure  Show export key paths and types without values (N1)',
    '',
    'Options:',
    '  -h, --help  Show this help',
  ].join('\n');
}
