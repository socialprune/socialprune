import { buildCommand } from '@stricli/core';
import { jsonFlag } from '../cli/context.ts';
import type {
  CliContext,
  CommandReply,
  CommandRunContext,
} from '../cli/context.ts';

export async function schemasHandler(
  context: CliContext,
): Promise<CommandReply> {
  const schemas = await context.services.listSchemas(context.signal);
  return {
    data: { schemas },
    human: schemas.map((schema) => `${schema.id}\n  ${schema.path}`).join('\n'),
  };
}

export const schemasCommand = buildCommand({
  parameters: { flags: { json: jsonFlag } },
  docs: { brief: 'List the current JSON schemas and package-relative paths' },
  async func(this: CommandRunContext, _flags: { json: boolean }) {
    this.reply(await schemasHandler(this));
  },
});
