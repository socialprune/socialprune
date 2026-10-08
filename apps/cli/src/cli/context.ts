import type { CommandContext } from '@stricli/core';
import type { StructureReport } from '@socialprune/core';
import type { PlatformGuide } from '@socialprune/core/guide/types';
import type { ExitCode } from './errors.ts';
import type { WorkspaceServices } from '../workspace/services.ts';

export interface CliStream {
  write(text: string): void;
}

export interface SchemaEntry {
  id: string;
  path: string;
}

export interface CliServices {
  describeStructure(
    paths: readonly string[],
    signal: AbortSignal,
  ): Promise<StructureReport>;
  listSchemas(signal: AbortSignal): Promise<readonly SchemaEntry[]>;
  readonly guides: readonly PlatformGuide[];
  readonly workspace?: WorkspaceServices;
}

export interface CliContext {
  readonly io: { stdout: CliStream; stderr: CliStream };
  readonly now: () => Date;
  readonly signal: AbortSignal;
  readonly services: CliServices;
  readonly nodeVersion?: string;
  readonly openBrowser?: (url: string) => Promise<void>;
}

export interface CommandReply {
  data: unknown;
  human: string;
  warnings?: readonly string[];
  humanNotices?: readonly string[];
  status?: 'ok' | 'partial';
  exitCode?: ExitCode;
  workspace?: { id: string; revision: number };
  envelope?: boolean;
}

export interface CommandRunContext extends CommandContext, CliContext {
  reply(result: CommandReply): void;
}

export const jsonFlag = {
  kind: 'boolean',
  brief: 'Print one JSON document',
  default: false,
} as const;

export const workspaceFlag = {
  kind: 'parsed',
  parse: String,
  brief: 'Workspace directory on a local disk',
} as const;
export const dryRunFlag = {
  kind: 'boolean',
  brief: 'Describe without writing or creating files',
  default: false,
} as const;
