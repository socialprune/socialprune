export const REQUEST_CHANNEL = 'socialprune:request';
export const RUN_VIEW_CHANNEL = 'socialprune:run-view';
export * from '@socialprune/core/workspace/desktop-protocol';
import type { DesktopBridge } from '@socialprune/core/workspace/desktop-protocol';

declare global {
  interface Window {
    socialprune: DesktopBridge;
  }
}
