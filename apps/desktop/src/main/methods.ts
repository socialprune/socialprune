import { resolveGuideLink } from '@socialprune/core/guide/link';
import {
  platformPostUrl,
  releasePageUrl,
} from '@socialprune/core/workspace/desktop-links';
import { DesktopAppInfoSchema } from '../protocol.ts';
import type { DesktopAppInfo } from '../protocol.ts';
import type { PlatformGuide } from '@socialprune/core/guide/types';
import type { DesktopRequest, DesktopReply } from '../protocol.ts';

export function mainMethods(options: {
  dataDirectory: string;
  guides: readonly PlatformGuide[];
  appInfo(): DesktopAppInfo;
  external(url: string): Promise<void>;
  folder(path: string): Promise<string>;
}) {
  return async (request: DesktopRequest): Promise<DesktopReply> => {
    const failed = (code: 'LINK_UNKNOWN' | 'NOT_AVAILABLE'): DesktopReply => ({
      type: 'desktopFailed',
      requestId: request.requestId,
      code,
    });
    try {
      if (request.type === 'appInfo') {
        const info = DesktopAppInfoSchema.parse(options.appInfo());
        return { type: 'appInfo', requestId: request.requestId, ...info };
      }
      if (request.type === 'openLink') {
        if (
          request.link.kind === 'app-releases' &&
          options.appInfo().build !== 'direct'
        )
          return failed('NOT_AVAILABLE');
        const url =
          request.link.kind === 'app-releases'
            ? releasePageUrl(request.link.url)
            : request.link.kind === 'platform-post'
              ? platformPostUrl(request.link.url)
              : resolveGuideLink(options.guides, request.link);
        if (!url) return failed('LINK_UNKNOWN');
        await options.external(url);
        return { type: 'linkOpened', requestId: request.requestId };
      }
      if (request.type === 'dataFolderOpen') {
        if (await options.folder(options.dataDirectory))
          return failed('NOT_AVAILABLE');
        return {
          type: 'dataFolderOpened',
          requestId: request.requestId,
          opened: true,
        };
      }
    } catch {
      return failed('NOT_AVAILABLE');
    }
    return failed('NOT_AVAILABLE');
  };
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function splitWorkArea(
  area: Bounds,
): { app: Bounds; browser: Bounds } | null {
  if (area.width < 1280) return null;
  const width = Math.floor(area.width / 2);
  return {
    app: { ...area, width },
    browser: { ...area, x: area.x + width, width: area.width - width },
  };
}
