import { DesktopRequestSchema, parseDesktopReply } from '../protocol.ts';
import type { DesktopReply } from '../protocol.ts';
import { authorizedSender } from './router.ts';
import type { SenderEvent, SenderIdentity } from './router.ts';
import { importSelection } from './import-selection.ts';
import type { EngineFileSelection } from 'socialprune/engine';

export function createDropHandler(
  owner: SenderIdentity,
  send: (message: {
    request: Extract<
      import('../protocol.ts').DesktopRequest,
      { type: 'importExport' }
    >;
    selection: EngineFileSelection;
  }) => Promise<DesktopReply>,
  record: (code: string) => void,
) {
  return async (event: SenderEvent, raw: unknown): Promise<DesktopReply> => {
    if (!authorizedSender(event, owner)) {
      record('SENDER_REJECTED');
      throw new Error('BRIDGE_REJECTED');
    }
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('request' in raw) ||
      !('paths' in raw) ||
      Object.keys(raw).some((key) => !['request', 'paths'].includes(key))
    ) {
      record('MESSAGE_REJECTED');
      throw new Error('BRIDGE_REJECTED');
    }
    const request = DesktopRequestSchema.safeParse(raw.request);
    if (!request.success || request.data.type !== 'importExport') {
      record('MESSAGE_REJECTED');
      throw new Error('BRIDGE_REJECTED');
    }
    try {
      if (!Array.isArray(raw.paths) || !raw.paths.length)
        throw new Error('IMPORT_SELECTION_INVALID');
      const selection = await importSelection(raw.paths);
      return parseDesktopReply(
        request.data,
        await send({ request: request.data, selection }),
      );
    } catch {
      record('DROP_IMPORT_REJECTED');
      return {
        type: 'desktopFailed',
        requestId: request.data.requestId,
        code: 'INVALID_ARCHIVE_PATH',
      };
    }
  };
}
