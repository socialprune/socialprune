import { z } from 'zod';

z.config({ jitless: true });

export const REQUEST_CHANNEL = 'socialprune:request';
export const RUN_VIEW_CHANNEL = 'socialprune:run-view';

// D0 deliberately admits one read only. The engine facade supplies the real
// review/run union in D1; there is no generic dispatch or filesystem method.
export const DesktopRequestSchema = z.strictObject({
  requestId: z.string().uuid(),
  type: z.literal('foundationRead'),
});
export type DesktopRequest = z.infer<typeof DesktopRequestSchema>;

export const DesktopReplySchema = z.discriminatedUnion('type', [
  z.strictObject({
    requestId: z.string().uuid(),
    type: z.literal('foundationSummary'),
    items: z.number().int().nonnegative(),
    sqliteVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  }),
  z.strictObject({
    requestId: z.string().uuid(),
    type: z.literal('rejected'),
    code: z.enum(['WORKSPACE_OPEN_FAILED', 'ENGINE_UNAVAILABLE']),
  }),
]);
export type DesktopReply = z.infer<typeof DesktopReplySchema>;
export const RunViewSchema = z.strictObject({ phase: z.literal('idle') });
export type RunView = z.infer<typeof RunViewSchema>;

export interface DesktopBridge {
  request(message: DesktopRequest): Promise<DesktopReply>;
  onRunView(listener: (view: RunView) => void): () => void;
}

declare global {
  interface Window {
    socialprune: DesktopBridge;
  }
}
