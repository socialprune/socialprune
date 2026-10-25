import type { BrowserContext, Page } from 'playwright-core';
import { z } from 'zod';

export const WindowBoundsSchema = z.strictObject({
  x: z.number().int().min(-1_000_000).max(1_000_000),
  y: z.number().int().min(-1_000_000).max(1_000_000),
  width: z.number().int().min(1).max(100_000),
  height: z.number().int().min(1).max(100_000),
});
export type WindowBounds = z.infer<typeof WindowBoundsSchema>;
export interface OwnedWindow {
  closed: Promise<void>;
  current(): Promise<{ id: string; bounds: WindowBounds }>;
  move(
    id: string,
    expected: WindowBounds,
    bounds: WindowBounds,
    stillOwned: () => boolean,
  ): Promise<void>;
}
const browserBounds = z.object({
  left: z.number().int(),
  top: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  windowState: z.literal('normal'),
});
const failed = () => new Error('OWNED_WINDOW_UNAVAILABLE');

/** Only the caller's freshly launched context/page is eligible. No discovery,
 * focus, target enumeration or reconnect fallback belongs to this capability. */
export async function captureOwnedWindow(
  context: BrowserContext,
  page: Page,
): Promise<OwnedWindow> {
  if (page.context() !== context || page.isClosed()) throw failed();
  let revoked = false;
  let finish!: () => void;
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  context.once('close', () => {
    revoked = true;
    finish();
  });
  page.once('close', () => {
    revoked = true;
  });
  const cdp = await context.newCDPSession(page);
  const first = z
    .object({ windowId: z.number().int().positive() })
    .parse(await cdp.send('Browser.getWindowForTarget'));
  const id = crypto.randomUUID();
  const current = async () => {
    if (revoked || page.isClosed()) throw failed();
    const target = await cdp.send('Browser.getWindowForTarget');
    if (target.windowId !== first.windowId) {
      revoked = true;
      throw failed();
    }
    const value = browserBounds.parse(
      (await cdp.send('Browser.getWindowBounds', { windowId: first.windowId }))
        .bounds,
    );
    if (revoked || page.isClosed()) throw failed();
    return {
      id,
      bounds: WindowBoundsSchema.parse({
        x: value.left,
        y: value.top,
        width: value.width,
        height: value.height,
      }),
    };
  };
  return {
    closed,
    current,
    async move(requested, expected, raw, stillOwned) {
      const bounds = WindowBoundsSchema.parse(raw);
      const before = await current();
      if (
        !stillOwned() ||
        requested !== id ||
        JSON.stringify(before.bounds) !==
          JSON.stringify(WindowBoundsSchema.parse(expected))
      )
        throw failed();
      // Browser.setWindowBounds changes geometry only. Never activate/restore
      // a window or choose a replacement target; non-normal states refuse above.
      await cdp.send('Browser.setWindowBounds', {
        windowId: first.windowId,
        bounds: {
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
      });
    },
  };
}

export function browserClosed(context: BrowserContext): Promise<void> {
  return new Promise((resolve) => {
    context.once('close', () => resolve());
  });
}
