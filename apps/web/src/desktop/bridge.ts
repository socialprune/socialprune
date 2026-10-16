import {
  DesktopRequestSchema,
  DesktopCommandSchema,
  parseDesktopReply,
  RunViewSchema,
} from '@socialprune/core/workspace/desktop-protocol';
import type {
  DesktopBridge,
  DesktopCommand,
  DesktopErrorCode,
  DesktopReplyFor,
  DesktopRequest,
  RunView,
} from '@socialprune/core/workspace/desktop-protocol';

export class BridgeError extends Error {
  readonly code: DesktopErrorCode;
  constructor(code: DesktopErrorCode) {
    super(code);
    this.code = code;
  }
}

export function desktopBridge(): DesktopBridge {
  // The Pages import diagnostic uses the same property name. Do not merge its
  // global declaration with the preload capability or assume it is a bridge.
  const value: unknown = Reflect.get(window, 'socialprune');
  if (
    !value ||
    typeof value !== 'object' ||
    !('request' in value) ||
    typeof value.request !== 'function' ||
    !('onRunView' in value) ||
    typeof value.onRunView !== 'function'
  )
    throw new BridgeError('ENGINE_UNAVAILABLE');
  return value as DesktopBridge;
}

export async function request<Request extends DesktopRequest>(
  bridge: DesktopBridge,
  input: Request,
): Promise<DesktopReplyFor<Request>> {
  DesktopRequestSchema.parse(input);
  const reply = parseDesktopReply(input, await bridge.request(input));
  if ('code' in reply && reply.type === 'desktopFailed')
    throw new BridgeError(reply.code);
  return reply;
}

type CommandInput = DesktopCommand extends infer Command
  ? Command extends DesktopCommand
    ? Omit<Command, 'requestId'>
    : never
  : never;
export function command(bridge: DesktopBridge, input: CommandInput) {
  return request(
    bridge,
    DesktopCommandSchema.parse({ ...input, requestId: crypto.randomUUID() }),
  );
}

export function subscribeRunView(
  bridge: DesktopBridge,
  listener: (view: RunView) => void,
  invalid: () => void,
) {
  return bridge.onRunView((raw) => {
    const parsed = RunViewSchema.safeParse(raw);
    if (parsed.success) listener(parsed.data);
    else invalid();
  });
}
