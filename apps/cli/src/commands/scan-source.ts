import { buildCommand } from '@stricli/core';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseSource, ScanError } from '@socialprune/classify';
import { inGitTree } from '@socialprune/classify/node';
import { jsonFlag } from '../cli/context.ts';
import type { CommandRunContext } from '../cli/context.ts';
import { CliError } from '../cli/errors.ts';

export function integerFlag(min: number, max: number) {
  return (value: string) => {
    const n = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max)
      throw new CliError('INVALID_ARGUMENTS');
    return n;
  };
}
export interface SourceFlags {
  json: boolean;
  out: string;
  baseUrl: string;
  model: string;
  name: string;
  keyFile?: string;
  profile: string;
  entriesPerRequest: number;
  parallelRequests: number;
  requestTimeoutSeconds: number;
  structuredOutput: string;
  cacheControl?: boolean;
  allowPaid: boolean;
}
export const scanSourceCommand = buildCommand({
  parameters: {
    flags: {
      json: jsonFlag,
      out: {
        kind: 'parsed',
        parse: String,
        brief: 'New source file outside repositories',
      },
      baseUrl: {
        kind: 'parsed',
        parse: String,
        brief: 'Explicit endpoint base URL',
      },
      model: {
        kind: 'parsed',
        parse: String,
        brief: 'Model chosen for this source',
      },
      name: {
        kind: 'parsed',
        parse: String,
        default: 'endpoint',
        brief:
          'Source name, lowercase letters, numbers, dot, underscore or hyphen',
      },
      keyFile: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Optional explicitly named key file; not opened during setup',
      },
      profile: {
        kind: 'parsed',
        parse: String,
        default: 'openai-compatible',
        brief: 'openai-compatible, llama-server, ollama or openrouter',
      },
      entriesPerRequest: {
        kind: 'parsed',
        parse: integerFlag(1, 50),
        brief:
          'Explicit batch size 1..50; no model-specific default has been measured',
      },
      parallelRequests: {
        kind: 'parsed',
        parse: integerFlag(1, 4),
        default: '1',
        brief: 'Parallel requests, 1..4',
      },
      requestTimeoutSeconds: {
        kind: 'parsed',
        parse: integerFlag(10, 600),
        default: '120',
        brief: 'Per-request deadline, 10..600 seconds',
      },
      structuredOutput: {
        kind: 'parsed',
        parse: String,
        default: 'json_schema',
        brief: 'json_schema, json_object or none',
      },
      cacheControl: {
        kind: 'boolean',
        optional: true,
        brief: 'Send ephemeral cache control; defaults on only for openrouter',
      },
      allowPaid: {
        kind: 'boolean',
        default: false,
        brief: 'Allow an openrouter source to omit its zero-price restriction',
      },
    },
  },
  docs: {
    brief:
      'Write a named endpoint source file without network or reading its key',
  },
  async func(this: CommandRunContext, flags: SourceFlags) {
    let config;
    try {
      config = parseSource({
        schemaVersion: 1,
        name: flags.name,
        baseUrl: flags.baseUrl,
        model: flags.model,
        ...(flags.keyFile === undefined ? {} : { keyFile: flags.keyFile }),
        profile: flags.profile,
        entriesPerRequest: flags.entriesPerRequest,
        parallelRequests: flags.parallelRequests,
        requestTimeoutSeconds: flags.requestTimeoutSeconds,
        structuredOutput: flags.structuredOutput,
        ...(flags.cacheControl === undefined
          ? {}
          : { cacheControl: flags.cacheControl }),
        allowPaid: flags.allowPaid,
      });
    } catch (error) {
      if (error instanceof ScanError) throw new CliError('SOURCE_FILE_INVALID');
      throw error;
    }
    const out = resolve(flags.out);
    try {
      const parent = await lstat(dirname(out));
      if (
        !parent.isDirectory() ||
        parent.isSymbolicLink() ||
        (await inGitTree(out)) ||
        (await inGitTree(resolve(await realpath(dirname(out)), 'source.json')))
      )
        throw new CliError('SOURCE_PATH_REFUSED');
      const handle = await open(out, 'wx', 0o600);
      try {
        this.signal.throwIfAborted();
        await handle.writeFile(JSON.stringify(config, null, 2) + '\n');
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch {
      throw new CliError('SOURCE_PATH_REFUSED');
    }
    this.reply({
      data: {
        sourceFile: out,
        origin: new URL(config.baseUrl).origin,
        model: config.model,
        entriesPerRequest: config.entriesPerRequest,
      },
      human:
        'Source file written. No network request was made and the key file was not opened.',
    });
  },
});
