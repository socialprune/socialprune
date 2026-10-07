import { parse, TYPE } from '@formatjs/icu-messageformat-parser';
import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { inspectText } from '../../../tools/copy-check/src/index.ts';
import { format } from 'prettier';

export type Catalog = Record<string, string>;
export function argumentsOf(message: string): Record<string, string> {
  const args: Record<string, string> = {};
  function visit(elements: MessageFormatElement[]) {
    for (const element of elements) {
      if (element.type === TYPE.literal) continue;
      if (element.type === TYPE.tag) {
        visit(element.children);
        continue;
      }
      if (element.type === TYPE.pound) continue;
      const type =
        element.type === TYPE.number || element.type === TYPE.plural
          ? 'number'
          : element.type === TYPE.date || element.type === TYPE.time
            ? 'Date | number'
            : 'string';
      if (args[element.value] && args[element.value] !== type)
        throw new Error(`Inconsistent argument ${element.value}.`);
      args[element.value] = type;
      if (element.type === TYPE.select || element.type === TYPE.plural) {
        if (
          !element.options.other ||
          (element.type === TYPE.plural && !element.options.one)
        )
          throw new Error('Plural/select branches are incomplete.');
        for (const option of Object.values(element.options))
          visit(option.value);
      }
    }
  }
  visit(parse(message));
  return Object.fromEntries(
    Object.entries(args).sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function validateCatalogs(en: Catalog, de: Catalog) {
  const keys = Object.keys(en).sort();
  if (JSON.stringify(keys) !== JSON.stringify(Object.keys(de).sort()))
    throw new Error('Catalog keys differ.');
  for (const key of keys) {
    if (inspectText(en[key]!).length || inspectText(de[key]!).length)
      throw new Error(`Forbidden copy in ${key}.`);
    if (
      JSON.stringify(argumentsOf(en[key]!)) !==
      JSON.stringify(argumentsOf(de[key]!))
    )
      throw new Error(`Catalog arguments differ for ${key}.`);
  }
}

export async function generateTypes(en: Catalog): Promise<string> {
  const keys = Object.keys(en).sort();
  const rows = keys.map((id) => {
    const args = Object.entries(argumentsOf(en[id]!));
    return `    ${JSON.stringify(id)}: ${args.length ? `{ ${args.map(([name, type]) => `${JSON.stringify(name)}: ${type}`).join('; ')} }` : 'Record<never, never>'};`;
  });
  return format(
    `// Generated from en.json. Run pnpm i18n:generate.\nexport {};\ndeclare global {\n  namespace FormatjsIntl {\n    interface Message { ids: keyof MessageArguments }\n  }\n  interface MessageArguments {\n${rows.join('\n')}\n  }\n}\n`,
    { parser: 'typescript', singleQuote: true, printWidth: 78 },
  );
}
