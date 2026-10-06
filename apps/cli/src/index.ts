import { CORE_VERSION } from '@socialprune/core';
import type { StructureReport } from '@socialprune/core';

export function helpText(): string {
  return [
    `SocialPrune (core ${CORE_VERSION})`,
    '',
    'Usage: socialprune [command] [options]',
    '',
    'Commands:',
    '  structure <path...> [--json]  Show export key paths and types without values',
    '',
    'Options:',
    '  -h, --help  Show this help',
  ].join('\n');
}

export function structureTree(report: StructureReport): string {
  const lines: string[] = [];
  for (const file of report.files) {
    lines.push(
      `${file.pattern} (${file.count} files, ${file.parsed} parsed, ${file.unparsed} unparsed)`,
    );
    for (const target of file.assignments) lines.push(`  assignment ${target}`);
    for (const node of file.paths)
      lines.push(`  ${node.path}: ${node.types.join(' | ')}`);
    for (const error of file.errors) lines.push(`  unparsed (${error})`);
  }
  for (const other of report.otherFiles)
    lines.push(
      `${other.directory}/ *.${other.extension || '(none)'} (${other.count} files)`,
    );
  lines.push(`Private entries skipped: ${report.skippedPrivate}`);
  lines.push(`Rejected archive entries: ${report.rejectedEntries}`);
  return lines.join('\n');
}
