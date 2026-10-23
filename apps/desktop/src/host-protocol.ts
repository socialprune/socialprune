import { z } from 'zod';
import {
  EngineHostMessageSchema,
  EngineOptionsSchema,
  EngineMediaRequestSchema,
  EngineMediaReplySchema,
} from 'socialprune/engine';
import { DesktopReplySchema, RunViewSchema } from './protocol.ts';

// These messages belong to the private main/utility channel, not the bridge.
export const HostCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('media'),
    id: z.uuid(),
    message: EngineMediaRequestSchema,
  }),
  z.strictObject({
    type: z.literal('initialize'),
    options: EngineOptionsSchema,
  }),
  z.strictObject({
    type: z.literal('request'),
    message: EngineHostMessageSchema,
  }),
  z.strictObject({ type: z.literal('shutdown') }),
]);
export const HostEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('media'),
    id: z.uuid(),
    reply: EngineMediaReplySchema,
  }),
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({ type: z.literal('reply'), reply: DesktopReplySchema }),
  z.strictObject({ type: z.literal('view'), view: RunViewSchema }),
  z.strictObject({ type: z.literal('closed') }),
  z.strictObject({ type: z.literal('failed') }),
]);
