import type { PlatformGuide } from '@socialprune/core/guide/types';
import { xGuide } from '@socialprune/adapter-x/guide';
import { instagramGuide } from '@socialprune/adapter-instagram/guide';

// Separate adapter subpaths keep guide copy out of the import worker.
export const guides: readonly PlatformGuide<'x' | 'instagram'>[] = [
  xGuide,
  instagramGuide,
];
