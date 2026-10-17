import { DesktopRequestSchema, parseDesktopReply } from '../protocol.ts';
import type { DesktopReply, DesktopRequest } from '../protocol.ts';
import { isAppDocument } from './policy.ts';

export type RejectionCode = 'SENDER_REJECTED' | 'MESSAGE_REJECTED';
export interface FrameIdentity {
  url: string;
  processId: number;
  routingId: number;
  parent: unknown;
}
export interface SenderIdentity {
  mainFrame: FrameIdentity;
  isDestroyed(): boolean;
  getURL(): string;
}
export interface SenderEvent {
  sender: SenderIdentity;
  senderFrame: FrameIdentity | null;
  processId: number;
  frameId: number;
}

export function authorizedSender(
  event: SenderEvent,
  owner: SenderIdentity,
): boolean {
  if (event.sender !== owner || owner.isDestroyed()) return false;
  const frame = event.senderFrame;
  const main = owner.mainFrame;
  return (
    frame !== null &&
    frame === main &&
    frame.parent === null &&
    event.processId === main.processId &&
    event.frameId === main.routingId &&
    isAppDocument(frame.url) &&
    isAppDocument(owner.getURL())
  );
}

export function createRouter(
  owner: SenderIdentity,
  dispatch: (request: DesktopRequest) => Promise<DesktopReply>,
  record: (code: RejectionCode) => void,
) {
  return (event: SenderEvent, message: unknown): Promise<DesktopReply> => {
    if (!authorizedSender(event, owner)) {
      record('SENDER_REJECTED');
      return Promise.reject(new Error('BRIDGE_REJECTED'));
    }
    const parsed = DesktopRequestSchema.safeParse(message);
    if (!parsed.success) {
      record('MESSAGE_REJECTED');
      return Promise.reject(new Error('BRIDGE_REJECTED'));
    }
    return dispatch(parsed.data).then((reply) =>
      parseDesktopReply(parsed.data, reply),
    );
  };
}
