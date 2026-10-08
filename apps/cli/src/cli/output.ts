import { stripVTControlCharacters } from 'node:util';
import type { CliContext, CommandReply } from './context.ts';
import { CliError, errorObject } from './errors.ts';
import type { CliErrorCode, LabelFailureDetails } from './errors.ts';
import { CliResultSchema } from './schemas.ts';

export function plainText(text: string): string {
  return [...stripVTControlCharacters(text)]
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return (
        code >= 0x20 &&
        !(code >= 0x7f && code <= 0x9f) &&
        !(code >= 0x202a && code <= 0x202e) &&
        !(code >= 0x2066 && code <= 0x2069)
      );
    })
    .join('');
}

// Newlines are presentation delimiters; embedded terminal controls are data.
export function plainLines(text: string): string {
  return text.split('\n').map(plainText).join('\n');
}

export function writeReply(
  context: CliContext,
  command: string,
  json: boolean,
  reply: CommandReply,
): void {
  if (reply.silent) return;
  for (const notice of reply.notices ?? [])
    context.io.stderr.write(plainLines(notice) + '\n');
  if (json || reply.envelope) {
    const result = CliResultSchema.safeParse({
      schemaVersion: 1,
      command,
      status: reply.status ?? 'ok',
      data: reply.data,
      warnings: reply.warnings ?? [],
      ...(reply.workspace ? { workspace: reply.workspace } : {}),
    });
    if (!result.success) throw new CliError('CLI_ERROR');
    context.io.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
    if (!json && reply.envelope && reply.human)
      context.io.stderr.write(plainLines(reply.human) + '\n');
  } else {
    context.io.stdout.write(plainLines(reply.human) + '\n');
    for (const notice of reply.humanNotices ?? [])
      context.io.stderr.write(plainLines(notice) + '\n');
  }
  for (const warning of reply.warnings ?? [])
    context.io.stderr.write(plainLines(warning) + '\n');
}

export function writeFailure(
  context: CliContext,
  command: string,
  json: boolean,
  code: CliErrorCode,
  nodeVersion?: string,
  envelope = false,
  details?: LabelFailureDetails,
): void {
  const error = errorObject(code, nodeVersion, details);
  if (json || envelope) {
    context.io.stdout.write(
      JSON.stringify(
        CliResultSchema.parse({
          schemaVersion: 1,
          command,
          status: 'error',
          error,
          warnings: [],
        }),
      ) + '\n',
    );
  }
  context.io.stderr.write(`${error.code}: ${error.message}\n`);
}
