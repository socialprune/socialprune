import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CliError } from '../../../cli/errors.ts';
export const FillOrderSchema = z.strictObject({
  scope: z.literal('originals-fill-x'),
  account: z.string().regex(/^[A-Za-z0-9_]{1,50}$/),
  givenAt: z.iso.datetime({ offset: true }),
  words: z.string().trim().min(1).max(10000),
  maxPages: z.number().int().min(1).max(200).optional(),
});
export interface FillOrder {
  value: z.infer<typeof FillOrderSchema>;
  sha256: string;
}
export async function readOrder(
  path: string,
  account: string,
  expectedPlan: string,
  actualPlan: string,
): Promise<FillOrder> {
  if (expectedPlan !== actualPlan) throw new CliError('STALE_PLAN');
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    throw new CliError('ORDER_INVALID');
  }
  if (bytes.length > 65536) throw new CliError('ORDER_INVALID');
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new CliError('ORDER_INVALID');
  }
  const parsed = FillOrderSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.account.toLowerCase() !== account.toLowerCase()
  )
    throw new CliError('ORDER_INVALID');
  return {
    value: parsed.data,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
