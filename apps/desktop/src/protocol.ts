export const REQUEST_CHANNEL = 'socialprune:request';
export const RUN_VIEW_CHANNEL = 'socialprune:run-view';
// Private native-File handoff. No renderer bridge method accepts a path.
export const DROP_CHANNEL = 'socialprune:native-drop';
export const LOCALE_CHANNEL = 'socialprune:document-language';
export * from '@socialprune/core/workspace/desktop-protocol';
import type { DesktopBridge } from '@socialprune/core/workspace/desktop-protocol';

declare global {
  interface Window {
    socialprune: DesktopBridge;
  }
}
