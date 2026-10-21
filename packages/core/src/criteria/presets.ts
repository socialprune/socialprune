import { DEFAULT_CATEGORIES as OLD_CATEGORIES } from '../model/v1.ts';
import type { WorkspaceMeta } from '../model/index.ts';
import { CriteriaSettingsSchema, CustomCriterionSchema } from './schema.ts';
import type { CriteriaSettings } from './schema.ts';
import { definitionHash } from './hash.ts';
export { definitionHash } from './hash.ts';

const definitions = [
  [
    'toxic',
    'Toxic',
    'Hostile language aimed at neither a person nor a group. Reporting, condemning or quoting hostility to criticise it does not apply.',
  ],
  [
    'personal-attack',
    'Personal attack',
    'Insults, belittles or threatens a particular person. Reporting or condemning an attack and disagreement with an idea alone do not apply.',
  ],
  [
    'political',
    'Political',
    'Expresses a political position or partisan argument that could draw conflict. Neutral reporting and criticism quoted only to reject it do not apply.',
  ],
  [
    'sexual',
    'Sexual',
    'Contains explicit sexual content or sexual remarks. Neutral health information and reporting or condemning harassment do not apply.',
  ],
  [
    'drugs-illegal',
    'Drugs or illegal activity',
    'Promotes or describes personal involvement with illegal activity or recreational drugs. Neutral reporting, prevention and condemnation do not apply.',
  ],
  [
    'personal-info',
    'Personal information',
    'Reveals private contact, identity, location or other sensitive personal information. Public institutional contacts and invented examples do not apply.',
  ],
  [
    'embarrassing',
    'Embarrassing',
    'Contains a personal disclosure or remark likely to embarrass its author later. Ordinary self-description and neutral reporting alone do not apply.',
  ],
  [
    'empty',
    'Empty',
    'Has no meaningful content beyond filler or a contextless reaction. A short but meaningful answer does not apply.',
  ],
  ['harmless', 'Harmless', 'None of the checked content criteria applies.'],
  [
    'unclear',
    'Unclear',
    'The available text or context does not support judging the checked criteria.',
  ],
  [
    'racist',
    'Racist',
    'Puts people down for their origin or skin colour. Reporting, condemning or quoting racism to criticise it, reclaimed self-description and neutral mention of origin do not apply. Criticism of a government, party or religious institution alone does not apply.',
  ],
  [
    'misogynistic',
    'Misogynistic',
    'Puts women down for being women. Reporting, condemning or quoting misogyny to criticise it, reclaimed self-description and neutral mention of gender do not apply.',
  ],
  [
    'group-hostility',
    'Hostile to groups',
    'Puts people down for religion, sexuality, gender identity, disability or age. Reporting, condemning or quoting hostility to criticise it, reclaimed self-description and neutral mention do not apply. Criticism of a government, party or religious institution alone does not apply.',
  ],
  [
    'politically-incorrect',
    'Politically incorrect',
    'Jokes or remarks about groups that many find demeaning today, without open hostility. Reporting, condemning or quoting to criticise, reclaimed self-description, neutral mention and criticism of a government, party or religious institution alone do not apply.',
  ],
] as const;
export const PRESETS = definitions.map(([id, label, definition]) => ({
  id,
  label,
  definition,
  hash: definitionHash(definition),
}));
export const PRESET_IDS: readonly string[] = PRESETS.map((value) => value.id);
export const DEFAULT_CATEGORIES = [
  ...OLD_CATEGORIES,
  'racist',
  'misogynistic',
  'group-hostility',
  'politically-incorrect',
] as const;
export const earlierHash = (id: string) =>
  definitionHash(`socialprune:earlier-category:v1:${id}`);
export function criterionHash(
  id: string,
  settings?: WorkspaceMeta['settings'],
): string {
  const own = settings?.criteria?.custom.find((value) => value.id === id);
  return own
    ? definitionHash(own.description)
    : (PRESETS.find((value) => value.id === id)?.hash ?? earlierHash(id));
}
export function criterionRoom(existing: readonly string[]) {
  const categories = [...new Set(existing)];
  if (categories.length > 32) throw new Error('NO_ROOM');
  const unavailable: string[] = [];
  for (const id of PRESET_IDS)
    if (!categories.includes(id)) {
      if (categories.length < 32) categories.push(id);
      else unavailable.push(id);
    }
  return { categories, unavailable };
}
export function addCustomCriterion(
  settings: WorkspaceMeta['settings'],
  input: { label: string; description: string; createdAt: string },
): WorkspaceMeta['settings'] & { criteria: CriteriaSettings } {
  const criteria = CriteriaSettingsSchema.parse(settings.criteria);
  if (criteria.custom.length >= 8) throw new Error('CUSTOM_LIMIT');
  if (settings.categories.length >= 32) throw new Error('NO_ROOM');
  if (criteria.nextCustom >= Number.MAX_SAFE_INTEGER)
    throw new Error('CUSTOM_LIMIT');
  const custom = CustomCriterionSchema.parse({
    ...input,
    id: `custom-${criteria.nextCustom}`,
  });
  if (settings.categories.includes(custom.id))
    throw new Error('CUSTOM_ID_USED');
  return {
    ...settings,
    categories: [...settings.categories, custom.id],
    criteria: {
      ...criteria,
      custom: [...criteria.custom, custom],
      nextCustom: criteria.nextCustom + 1,
    },
  };
}
