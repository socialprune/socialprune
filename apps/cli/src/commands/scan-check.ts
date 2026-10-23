import { buildCommand } from '@stricli/core';
import { jsonFlag } from '../cli/context.ts';
import type { CommandRunContext } from '../cli/context.ts';
import { workspaceService } from './workspace-context.ts';
import { plainLines } from '../cli/output.ts';

export const scanCheckCommand = buildCommand({
  parameters: {
    flags: {
      json: jsonFlag,
      source: {
        kind: 'parsed',
        parse: String,
        brief: 'Source file the person explicitly named',
      },
    },
  },
  docs: {
    brief:
      'Check the named endpoint with one invented entry, without a workspace',
  },
  async func(
    this: CommandRunContext,
    flags: { json: boolean; source: string },
  ) {
    const result = await workspaceService(this).checkScanSource({
      source: flags.source,
      signal: this.signal,
      progress: (text) => this.io.stderr.write(plainLines(text) + '\n'),
    });
    this.reply({ ...result, human: JSON.stringify(result.data) });
  },
});
