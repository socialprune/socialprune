import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CliError } from '../../cli/errors.ts';

export const ContextOrderSchema = z.strictObject({
  scope: z.literal('context-instagram'),
  refreshLikes: z.boolean().optional(),
  account: z.string().regex(/^[A-Za-z0-9_.]{1,30}$/),
  givenAt: z.iso.datetime({ offset: true }),
  words: z.string().trim().min(1).max(10000),
  maxSteps: z.number().int().min(1).max(600).optional(),
  secondsPerStep: z.number().int().min(10).max(30).optional(),
  stepsPerDay: z.number().int().min(1).max(600).optional(),
  batchPause: z.boolean().default(true),
  acceptCanary: z.boolean().default(false),
});
export interface ContextOrder {
  value: z.input<typeof ContextOrderSchema> & { acceptCanary: boolean };
  sha256: string;
}
export async function readContextOrder(
  path: string,
  handle: string,
  expected: string,
  actual: string,
): Promise<ContextOrder> {
  if (expected !== actual) throw new CliError('STALE_PLAN');
  try {
    const bytes = await readFile(path);
    if (bytes.length > 65536) throw new Error('size');
    const value = ContextOrderSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    if (value.account.toLowerCase() !== handle.toLowerCase())
      throw new Error('account');
    return { value, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch {
    throw new CliError('CONTEXT_ORDER_INVALID');
  }
}
export function validateContextOrder(
  order: ContextOrder | undefined,
  handle: string,
  canary: boolean,
): void {
  if (!order) return;
  const parsed = ContextOrderSchema.safeParse(order.value);
  if (
    !parsed.success ||
    parsed.data.account.toLowerCase() !== handle.toLowerCase() ||
    !/^[a-f0-9]{64}$/.test(order.sha256)
  )
    throw new CliError('CONTEXT_ORDER_INVALID');
  if (canary && !parsed.data.acceptCanary)
    throw new CliError('CANARY_REQUIRED');
}
