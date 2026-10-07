import { buildCommand } from '@stricli/core';
import { structureTree } from '../index.ts';
import { jsonFlag } from '../cli/context.ts';
import { plainText } from '../cli/output.ts';
import type {
  CliContext,
  CommandReply,
  CommandRunContext,
} from '../cli/context.ts';

export const reportNotice =
  'Key names are shown as they appear in the export. Check the report before you share it.';

export async function structureHandler(
  paths: readonly string[],
  context: CliContext,
): Promise<CommandReply> {
  const report = await context.services.describeStructure(
    paths,
    context.signal,
  );
  return {
    data: report,
    human: structureTree({
      ...report,
      files: report.files.map((file) => ({
        ...file,
        pattern: plainText(file.pattern),
        assignments: file.assignments.map(plainText),
        errors: file.errors.map(plainText),
        paths: file.paths.map((node) => ({
          ...node,
          path: plainText(node.path),
        })),
      })),
      otherFiles: report.otherFiles.map((file) => ({
        ...file,
        directory: plainText(file.directory),
        extension: plainText(file.extension),
      })),
    }),
    humanNotices: [reportNotice],
  };
}

export const structureCommand = buildCommand({
  parameters: {
    flags: { json: jsonFlag },
    positional: {
      kind: 'array',
      minimum: 1,
      parameter: {
        parse: String,
        placeholder: 'path',
        brief: 'Explicit ZIP file or export directory',
      },
    },
  },
  docs: {
    brief: 'Show export key paths and types without values',
    fullDescription: reportNotice,
  },
  async func(
    this: CommandRunContext,
    _flags: { json: boolean },
    ...paths: string[]
  ) {
    this.reply(await structureHandler(paths, this));
  },
});
