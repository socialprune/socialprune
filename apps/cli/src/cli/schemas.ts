import { z } from 'zod';
import { CLI_ERRORS, EXIT_MEANINGS, LABEL_FAILURE_CODES } from './errors.ts';

const base = 'https://socialprune.github.io/socialprune/schemas/';
export const CLI_SCHEMA_IDS = {
  result: `${base}cli-result.schema.json`,
  error: `${base}cli-error.schema.json`,
  help: `${base}cli-help.schema.json`,
} as const;

export const CliErrorSchema = z.union(
  Object.entries(CLI_ERRORS).map(([code, error]) =>
    z.strictObject({
      code: z.literal(code),
      message:
        code === 'NODE_TOO_OLD'
          ? z
              .string()
              .regex(
                /^SocialPrune needs Node\.js 24\.15 or newer for workspaces\. You have \d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\.$/,
              )
          : z.literal(error.message),
      exitCode: z.literal(error.exitCode),
      retryable: z.literal(error.retryable),
      ...(code === 'INVALID_LABELS'
        ? {
            details: z
              .strictObject({
                failures: z.array(
                  z.strictObject({
                    index: z.int().min(-1),
                    code: z.enum(LABEL_FAILURE_CODES),
                  }),
                ),
              })
              .optional(),
          }
        : {}),
    }),
  ),
);

const command = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/);
export const CliResultSchema = z.union([
  z.strictObject({
    schemaVersion: z.literal(1),
    command,
    status: z.enum(['ok', 'partial']),
    data: z.json(),
    warnings: z.array(z.string()),
    workspace: z
      .strictObject({ id: z.string().min(1), revision: z.int().nonnegative() })
      .optional(),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    command,
    status: z.literal('error'),
    error: CliErrorSchema,
    warnings: z.array(z.string()),
  }),
]);

const helpOption = z.strictObject({
  name: z.string(),
  description: z.string(),
  type: z.enum(['boolean', 'string']),
  default: z.json(),
  required: z.boolean(),
  values: z.array(z.string()).optional(),
});
const helpPositional = z.strictObject({
  name: z.string(),
  description: z.string(),
  type: z.literal('string'),
  required: z.boolean().optional(),
  variadic: z.boolean().optional(),
  minimum: z.int().nonnegative().optional(),
});
export const CliHelpSchema = z.strictObject({
  commandPath: z.array(z.string()),
  description: z.string(),
  commands: z.array(
    z.strictObject({
      path: z.array(z.string()).min(1),
      description: z.string(),
      positionals: z.array(helpPositional),
      options: z.array(helpOption),
      outputSchemaIds: z.array(z.url()),
      writes: z.boolean(),
      dryRun: z.boolean(),
      available: z.boolean(),
    }),
  ),
  options: z.array(
    z.strictObject({
      name: z.string(),
      alias: z.string().optional(),
      type: z.literal('boolean'),
      default: z.boolean(),
    }),
  ),
  outputSchemaIds: z.array(z.url()),
  errorSchemaId: z.url().nullable(),
  exitCodes: z.strictObject({
    '0': z.literal(EXIT_MEANINGS[0]),
    '1': z.literal(EXIT_MEANINGS[1]),
    '2': z.literal(EXIT_MEANINGS[2]),
    '3': z.literal(EXIT_MEANINGS[3]),
    '4': z.literal(EXIT_MEANINGS[4]),
  }),
});

export type CliResult = z.infer<typeof CliResultSchema>;
export type CliHelp = z.infer<typeof CliHelpSchema>;

export const CLI_SCHEMA_MODELS = {
  'cli-result.schema.json': {
    id: CLI_SCHEMA_IDS.result,
    schema: CliResultSchema,
  },
  'cli-error.schema.json': { id: CLI_SCHEMA_IDS.error, schema: CliErrorSchema },
  'cli-help.schema.json': { id: CLI_SCHEMA_IDS.help, schema: CliHelpSchema },
};
