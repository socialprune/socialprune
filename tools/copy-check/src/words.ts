// ADR-011: this file is the single authority for copy scope and vocabulary.
export const ENGLISH_WORDS = [
  'safe',
  'safely',
  'safer',
  'safest',
  'safety',
  'undetectable',
  'bypass',
  'bypasses',
  'bypassed',
  'bypassing',
  'guarantee',
  'guarantees',
  'guaranteed',
  'guaranteeing',
  'upload',
  'uploads',
  'uploaded',
  'uploading',
] as const;

export const GERMAN_WORDS = [
  'sicher',
  'sichere',
  'sicheren',
  'sicherer',
  'sicheres',
  'sicherem',
  'garantiert',
  'garantierte',
  'garantierten',
  'garantierter',
  'garantiertes',
  'garantiertem',
  'garantieren',
  'garantie',
  'garantien',
  'umgangen',
  'hochladen',
  'hochgeladen',
] as const;

export const GERMAN_PREFIXES = ['sicherheit', 'unentdeckbar', 'umgeh'] as const;

export const FORBIDDEN_PHRASES = [
  'deletes everything',
  'löscht alles',
  'lädt hoch',
] as const;

export const BACKUP_ALLOWLIST = [
  'sichern',
  'sicherst',
  'sichert',
  'gesichert',
  'sicherung',
  'sicherungen',
  'sicherungskopie',
  'sicherungskopien',
] as const;

export const OFFICIAL_PATTERNS = [
  'official',
  'offiziell',
  'offizielle',
  'offiziellen',
  'offizieller',
  'offizielles',
  'offiziellem',
] as const;

export const OFFICIAL_ALLOWLIST = [
  'official data export',
  'official export',
  'offizieller datenexport',
  'offiziellen export',
] as const;

export const COPY_SCOPE = {
  catalogs: 'apps/web/src/i18n/',
  cli: 'apps/cli/src/',
  guide: 'packages/core/src/guide/',
  adapterGuides: [
    'packages/adapter-x/src/guide.ts',
    'packages/adapter-instagram/src/guide.ts',
  ],
  skill: 'skills/socialprune/',
  readme: ['README.md', 'apps/cli/README.md'],
  docs: 'docs/',
} as const;

export const EXEMPT_PATHS = ['AGENTS.md'] as const;
export const EXEMPT_PREFIXES = ['.kilo/', 'tools/copy-check/'] as const;
export const EXEMPT_MARKDOWN_SECTIONS = {
  'docs/design/README.md': ['Forbidden words'],
} as const;

// Tests and declaration files are not CLI messages or guide content.
export const NON_MESSAGE_CODE =
  /(?:^|\/)(?:__tests__|test|tests|fixtures)\/|\.(?:test|spec|d)\.[cm]?[jt]sx?$/;
