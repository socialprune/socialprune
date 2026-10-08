/** A strict structure reader for this one block-style workflow, not a YAML parser. */
export type Value =
  string | number | boolean | null | Value[] | { [key: string]: Value };
interface Line {
  indent: number;
  text: string;
}

export function readWorkflow(source: string): Value {
  if (/\t|\r/.test(source))
    throw new Error('Only LF and spaces are supported.');
  const lines: Line[] = source
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const indent = line.length - line.trimStart().length;
      if (indent % 2) throw new Error('Indentation must use pairs of spaces.');
      return { indent, text: line.slice(indent) };
    });
  let cursor = 0;
  const scalar = (text: string): Value => {
    if (text === 'null') return null;
    if (text === 'true' || text === 'false') return text === 'true';
    if (/^\d+$/.test(text)) return Number(text);
    if (/^'(?:[^']|'')*'$/.test(text))
      return text.slice(1, -1).replaceAll("''", "'");
    if (/^\$\{\{ [a-zA-Z0-9_.]+ \}\}$/.test(text)) return text;
    if (!/^[A-Za-z0-9_][A-Za-z0-9_ .\/@:='-]*$/.test(text) || /:\s/.test(text))
      throw new Error(`Unsupported scalar or YAML construct: ${text}`);
    return text;
  };
  const field = (
    map: { [key: string]: Value },
    text: string,
    indent: number,
  ) => {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?: (.+))?$/.exec(text);
    if (!match || Object.hasOwn(map, match[1]!))
      throw new Error(`Invalid or duplicate mapping: ${text}`);
    const key = match[1]!,
      value = match[2];
    if (value === '|') {
      const content: string[] = [];
      while (cursor < lines.length && lines[cursor]!.indent > indent) {
        const line = lines[cursor++]!;
        if (line.indent < indent + 2) throw new Error('Invalid block scalar.');
        content.push(' '.repeat(line.indent - indent - 2) + line.text);
      }
      if (!content.length) throw new Error('Empty block scalar.');
      map[key] = content.join('\n') + '\n';
    } else if (value !== undefined) map[key] = scalar(value);
    else if (cursor < lines.length && lines[cursor]!.indent > indent) {
      if (lines[cursor]!.indent !== indent + 2)
        throw new Error('Invalid child indentation.');
      map[key] = block(indent + 2);
    } else map[key] = null;
  };
  const block = (indent: number): Value => {
    if (lines[cursor]?.text.startsWith('- ')) {
      const array: Value[] = [];
      while (
        cursor < lines.length &&
        lines[cursor]!.indent === indent &&
        lines[cursor]!.text.startsWith('- ')
      ) {
        const line = lines[cursor++]!;
        const text = line.text.slice(2);
        if (/^[A-Za-z][A-Za-z0-9_-]*:/.test(text)) {
          const map: { [key: string]: Value } = {};
          field(map, text, indent + 2);
          while (
            cursor < lines.length &&
            lines[cursor]!.indent === indent + 2
          ) {
            const next = lines[cursor++]!;
            field(map, next.text, next.indent);
          }
          array.push(map);
        } else array.push(scalar(text));
      }
      return array;
    }
    const map: { [key: string]: Value } = {};
    while (cursor < lines.length && lines[cursor]!.indent === indent) {
      const line = lines[cursor++]!;
      field(map, line.text, indent);
    }
    return map;
  };
  if (!lines.length || lines[0]!.indent !== 0)
    throw new Error('Missing root mapping.');
  const value = block(0);
  if (cursor !== lines.length)
    throw new Error('Unconsumed or unsupported structure.');
  return value;
}
