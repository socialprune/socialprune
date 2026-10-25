import { createEngine } from './facade.ts';
import { productionDependencies } from './dependencies.ts';
import type { EngineOptions, DesktopEngine } from './host.ts';
export {
  EngineHostMessageSchema,
  EngineFileSelectionSchema,
  EngineOptionsSchema,
} from './host.ts';
export type {
  EngineRequest,
  EngineHostMessage,
  EngineFileSelection,
  EngineOptions,
  DesktopEngine,
} from './host.ts';
export { guides } from './facade.ts';
export { EngineMediaRequestSchema, EngineMediaReplySchema } from './media.ts';
export type { EngineMediaRequest, EngineMediaReply } from './media.ts';
export {
  EngineWindowRequestSchema,
  EngineWindowReplySchema,
} from './window.ts';
export type { EngineWindowRequest, EngineWindowReply } from './window.ts';

export function openEngine(options: EngineOptions): Promise<DesktopEngine> {
  return createEngine(options, productionDependencies);
}
