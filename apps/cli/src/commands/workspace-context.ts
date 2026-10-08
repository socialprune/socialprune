import type { CliContext } from '../cli/context.ts';
import { CliError } from '../cli/errors.ts';
import { requireWorkspaceNode } from '../workspace/node-version.ts';

export function workspaceService(context: CliContext) {
  requireWorkspaceNode(context.nodeVersion ?? '0.0.0');
  context.signal.throwIfAborted();
  const service = context.services.workspace;
  if (!service) throw new CliError('CLI_ERROR');
  return service;
}

export function workspaceCall(
  workspace: string,
  context: CliContext,
  dryRun = false,
) {
  return { workspace, dryRun, signal: context.signal, now: context.now };
}
