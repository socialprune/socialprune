import ts from 'typescript';
import {
  BACKUP_ALLOWLIST,
  COPY_SCOPE,
  ENGLISH_WORDS,
  EXEMPT_MARKDOWN_SECTIONS,
  EXEMPT_PATHS,
  EXEMPT_PREFIXES,
  FORBIDDEN_PHRASES,
  GERMAN_PREFIXES,
  GERMAN_WORDS,
  NON_MESSAGE_CODE,
  OFFICIAL_ALLOWLIST,
  OFFICIAL_PATTERNS,
} from './words.ts';

export interface CopyFinding {
  path: string;
  line: number;
  column: number;
  text: string;
  rule: 'forbidden-word' | 'forbidden-phrase' | 'official-context';
}

type CopyKind = 'markdown' | 'catalog' | 'source' | 'text';
interface Match {
  start: number;
  text: string;
  rule: CopyFinding['rule'];
}

const wholeWords = new Set<string>([...ENGLISH_WORDS, ...GERMAN_WORDS]);
const backups = new Set<string>(BACKUP_ALLOWLIST);
const officialWords = new Set<string>(OFFICIAL_PATTERNS);
const wordCharacters = /[\p{L}\p{N}\p{M}_]/u;

export function copyKind(path: string): CopyKind | null {
  const normalized = path.replaceAll('\\', '/');
  if (
    EXEMPT_PATHS.some((candidate) => normalized === candidate) ||
    EXEMPT_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  ) {
    return null;
  }
  if (COPY_SCOPE.readme.some((path) => path === normalized)) return 'markdown';
  if (COPY_SCOPE.adapterGuides.some((path) => path === normalized))
    return 'source';
  if (normalized.startsWith(COPY_SCOPE.docs)) {
    if (/\.mdx?$/i.test(normalized)) return 'markdown';
    if (/\.(?:txt|ics)$/i.test(normalized)) return 'text';
  }
  if (
    normalized.startsWith(COPY_SCOPE.catalogs) &&
    !normalized.slice(COPY_SCOPE.catalogs.length).includes('/') &&
    /\.json$/i.test(normalized)
  ) {
    return 'catalog';
  }
  if (normalized.startsWith(COPY_SCOPE.skill)) {
    if (/\.md$/i.test(normalized)) return 'markdown';
    if (/\.(?:txt|ics|json|ya?ml)$/i.test(normalized)) return 'text';
  }
  if (
    normalized.startsWith(COPY_SCOPE.cli) ||
    normalized.startsWith(COPY_SCOPE.guide)
  ) {
    if (NON_MESSAGE_CODE.test(normalized)) return null;
    if (/\.[cm]?[jt]sx?$/.test(normalized)) return 'source';
    if (/\.(?:json|ics|txt)$/i.test(normalized)) return 'text';
  }
  return null;
}

function phrases(text: string, candidates: readonly string[]): Match[] {
  const result: Match[] = [];
  for (const phrase of candidates) {
    const pattern = new RegExp(phrase.split(' ').join('[\\t\\r\\n ]+'), 'giu');
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (
        (start === 0 || !wordCharacters.test(text[start - 1]!)) &&
        (end === text.length || !wordCharacters.test(text[end]!))
      ) {
        result.push({ start, text: match[0], rule: 'forbidden-phrase' });
      }
    }
  }
  return result;
}

export function inspectText(text: string): Match[] {
  const acceptedOfficial = phrases(text, OFFICIAL_ALLOWLIST);
  const matches = phrases(text, FORBIDDEN_PHRASES);
  for (const word of text.matchAll(/[\p{L}\p{N}\p{M}_]+/gu)) {
    const value = word[0].toLocaleLowerCase('de');
    if (backups.has(value)) continue;
    if (
      wholeWords.has(value) ||
      GERMAN_PREFIXES.some((prefix) => value.startsWith(prefix))
    ) {
      matches.push({
        start: word.index,
        text: word[0],
        rule: 'forbidden-word',
      });
    } else if (
      officialWords.has(value) &&
      !acceptedOfficial.some(
        (allowed) =>
          word.index >= allowed.start &&
          word.index + word[0].length <= allowed.start + allowed.text.length,
      )
    ) {
      matches.push({
        start: word.index,
        text: word[0],
        rule: 'official-context',
      });
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}

function blank(text: string): string {
  return text.replace(/[^\r\n]/g, ' ');
}

function removeRanges(
  text: string,
  ranges: readonly { start: number; end: number }[],
): string {
  let result = text;
  for (const { start, end } of [...ranges].sort((a, b) => b.start - a.start)) {
    result =
      result.slice(0, start) +
      blank(result.slice(start, end)) +
      result.slice(end);
  }
  return result;
}

export function markdownProse(text: string, path: string): string {
  const exemptHeadings: readonly string[] =
    EXEMPT_MARKDOWN_SECTIONS[path as keyof typeof EXEMPT_MARKDOWN_SECTIONS] ??
    [];
  const lines = text.match(/[^\n]*(?:\n|$)/g) ?? [];
  let fence: { marker: string; count: number } | null = null;
  let exemptLevel: number | null = null;
  const processed: string[] = [];
  for (const line of lines) {
    const opener = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      processed.push(blank(line));
      if (
        opener &&
        opener[1]![0] === fence.marker &&
        opener[1]!.length >= fence.count &&
        line.slice(opener[0].length).trim() === ''
      ) {
        fence = null;
      }
      continue;
    }
    if (opener) {
      fence = { marker: opener[1]![0]!, count: opener[1]!.length };
      processed.push(blank(line));
      continue;
    }
    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trimEnd());
    if (heading) {
      const level = heading[1]!.length;
      if (exemptLevel !== null && level <= exemptLevel) exemptLevel = null;
      if (exemptHeadings.includes(heading[2]!)) exemptLevel = level;
    }
    processed.push(exemptLevel === null ? line : blank(line));
  }
  let prose = processed.join('');
  const code: { start: number; end: number }[] = [];
  for (let cursor = 0; cursor < prose.length; cursor++) {
    if (prose[cursor] !== '`' || prose[cursor - 1] === '\\') continue;
    let count = 1;
    while (prose[cursor + count] === '`') count++;
    const marker = '`'.repeat(count);
    let close = prose.indexOf(marker, cursor + count);
    while (
      close !== -1 &&
      (prose[close - 1] === '`' || prose[close + count] === '`')
    ) {
      close = prose.indexOf(marker, close + count);
    }
    if (close !== -1) {
      code.push({ start: cursor, end: close + count });
      cursor = close + count - 1;
    } else {
      cursor += count - 1;
    }
  }
  prose = removeRanges(prose, code);
  const targets: { start: number; end: number }[] = [];
  for (const definition of prose.matchAll(
    /^ {0,3}\[[^\]\n]+\]:[\t ]*(?:<[^>\n]*>|[^\s]+)(?:[\t ]+[^\n]*)?/gm,
  )) {
    const start = definition.index + definition[0].indexOf(':') + 1;
    targets.push({ start, end: definition.index + definition[0].length });
  }
  for (const autolink of prose.matchAll(/<(?:https?:\/\/|mailto:)[^>\s]+>/gi)) {
    targets.push({
      start: autolink.index,
      end: autolink.index + autolink[0].length,
    });
  }
  for (let cursor = 0; cursor < prose.length - 1; cursor++) {
    if (prose.slice(cursor, cursor + 2) !== '](') continue;
    let depth = 1;
    let end = cursor + 2;
    for (; end < prose.length; end++) {
      if (prose[end] === '\\') {
        end++;
      } else if (prose[end] === '(') {
        depth++;
      } else if (prose[end] === ')' && --depth === 0) {
        break;
      }
    }
    if (depth === 0) {
      targets.push({ start: cursor + 2, end });
      cursor = end;
    }
  }
  return removeRanges(prose, targets);
}

function located(
  path: string,
  source: string,
  match: Match,
  offset = 0,
): CopyFinding {
  const before = source.slice(0, offset + match.start);
  const line = before.split('\n').length;
  const newline = before.lastIndexOf('\n');
  return {
    path,
    line,
    column: before.length - newline,
    text: match.text,
    rule: match.rule,
  };
}

function sourceFindings(path: string, text: string): CopyFinding[] {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings: CopyFinding[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isTypeNode(node)
    ) {
      return;
    }
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (
        (ts.isPropertyAssignment(node.parent) ||
          ts.isPropertyDeclaration(node.parent)) &&
        node.parent.name === node
      ) {
        return;
      }
      for (const match of inspectText(node.text)) {
        findings.push(located(path, text, match, node.getStart(source) + 1));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return findings;
}

export function inspectCopy(path: string, text: string): CopyFinding[] {
  const kind = copyKind(path);
  if (!kind) return [];
  if (kind === 'source') return sourceFindings(path, text);
  if (kind === 'catalog') {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`Catalog must be a flat object: ${path}`);
    }
    const findings: CopyFinding[] = [];
    for (const [id, message] of Object.entries(value)) {
      if (typeof message !== 'string') {
        throw new Error(`Catalog message must be text: ${path}`);
      }
      const key = text.indexOf(JSON.stringify(id));
      const start = text.indexOf(':', key) + 1;
      for (const match of inspectText(message)) {
        findings.push(located(path, text, match, start));
      }
    }
    return findings;
  }
  const prose = kind === 'markdown' ? markdownProse(text, path) : text;
  return inspectText(prose).map((match) => located(path, text, match));
}
