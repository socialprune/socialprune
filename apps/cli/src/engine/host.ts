import { z } from 'zod';
import { isAbsolute } from 'node:path';
import { DesktopRequestSchema } from '@socialprune/core/workspace/desktop-protocol';
import type {
  DesktopRequest,
  DesktopReply,
  RunView,
} from '@socialprune/core/workspace/desktop-protocol';
import type { EngineMediaRequest, EngineMediaReply } from './media.ts';
import type { EngineWindowRequest, EngineWindowReply } from './window.ts';

export type EngineRequest = Exclude<
  DesktopRequest,
  { type: 'openLink' | 'dataFolderOpen' }
>;
export const EngineRequestSchema = DesktopRequestSchema.refine(
  (value) => value.type !== 'openLink' && value.type !== 'dataFolderOpen',
  'This method belongs to main.',
);
const path = z
  .string()
  .min(1)
  .max(32767)
  .refine((value) => !value.includes('\0') && isAbsolute(value));
/** Main supplies dialog results through this interface, never renderer paths. */
export const EngineFileSelectionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('scanKey'), path: path.nullable() }),
  z.strictObject({
    type: z.literal('importExport'),
    paths: z.array(path).min(1).max(32).nullable(),
  }),
  z.strictObject({ type: z.literal('backupExport'), path: path.nullable() }),
  z.strictObject({ type: z.literal('backupRestore'), path: path.nullable() }),
]);
export type EngineFileSelection = z.infer<typeof EngineFileSelectionSchema>;
export const EngineHostMessageSchema = z
  .strictObject({
    request: EngineRequestSchema,
    selection: EngineFileSelectionSchema.optional(),
  })
  .refine(
    (value) => !value.selection || value.selection.type === value.request.type,
    'Dialog method differs.',
  );
export type EngineHostMessage = {
  request: EngineRequest;
  selection?: EngineFileSelection;
};
export const EngineOptionsSchema = z.strictObject({
  dataFolder: path,
  storeBuild: z.boolean().default(false),
  lang: z.enum(['en', 'de']).default('en'),
  windowPlacement: z
    .strictObject({
      x: z.number().int(),
      y: z.number().int(),
      width: z.number().int().min(1),
      height: z.number().int().min(1),
    })
    .optional(),
});
export type EngineOptions = z.input<typeof EngineOptionsSchema>;
export interface DesktopEngine {
  window(message: EngineWindowRequest): Promise<EngineWindowReply>;
  media(message: EngineMediaRequest): Promise<EngineMediaReply>;
  request(message: EngineRequest): Promise<DesktopReply>;
  handleHost(message: EngineHostMessage): Promise<DesktopReply>;
  onRunView(listener: (view: RunView) => void): () => void;
  close(): Promise<void>;
}
