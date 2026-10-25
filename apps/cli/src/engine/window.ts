import { z } from 'zod';
import { WindowBoundsSchema } from '../browser/owned-window.ts';
import type { OwnedWindow } from '../browser/owned-window.ts';

export const EngineWindowRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('current') }),
  z.strictObject({
    type: z.literal('move'),
    id: z.uuid(),
    expected: WindowBoundsSchema,
    bounds: WindowBoundsSchema,
    activate: z.literal(false),
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
]);
export const EngineWindowReplySchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('window'),
    value: z
      .strictObject({ id: z.uuid(), bounds: WindowBoundsSchema })
      .nullable(),
  }),
  z.strictObject({ type: z.literal('moved') }),
  z.strictObject({ type: z.literal('unavailable') }),
]);
export type EngineWindowRequest = z.infer<typeof EngineWindowRequestSchema>;
export type EngineWindowReply = z.infer<typeof EngineWindowReplySchema>;

export function createWindowOwner() {
  let owner: OwnedWindow | undefined;
  let active = false;
  let generation = 0;
  const untilClosed = (closed: Promise<void>, current: number) => {
    void closed.then(() => {
      if (generation === current) {
        owner = undefined;
        active = false;
      }
    });
  };
  return {
    started(closed?: Promise<void>) {
      owner = undefined;
      active = true;
      const next = ++generation;
      if (closed) untilClosed(closed, next);
    },
    register(value: OwnedWindow) {
      owner = value;
      active = true;
      untilClosed(value.closed, ++generation);
    },
    async request(raw: EngineWindowRequest): Promise<EngineWindowReply> {
      const parsed = EngineWindowRequestSchema.safeParse(raw);
      if (!parsed.success) return { type: 'unavailable' };
      const input = parsed.data,
        captured = owner,
        before = generation;
      if (!captured)
        return !active && input.type === 'current'
          ? { type: 'window', value: null }
          : { type: 'unavailable' };
      try {
        if (input.type === 'current') {
          const value = await captured.current();
          return before === generation
            ? EngineWindowReplySchema.parse({ type: 'window', value })
            : { type: 'unavailable' };
        }
        if (
          before !== generation ||
          input.expiresAt <= Date.now() ||
          input.expiresAt > Date.now() + 5000
        )
          return { type: 'unavailable' };
        await captured.move(
          input.id,
          input.expected,
          input.bounds,
          () =>
            before === generation &&
            owner === captured &&
            input.expiresAt > Date.now(),
        );
        return { type: 'moved' };
      } catch {
        return { type: 'unavailable' };
      }
    },
  };
}
