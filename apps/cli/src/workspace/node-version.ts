import { CliError } from '../cli/errors.ts';

export const WORKSPACE_NODE_MINIMUM = '24.15.0';

export function requireWorkspaceNode(version: string): void {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z0-9.-]+)?$/.exec(version);
  const parts = match?.slice(1, 4).map(Number);
  if (!parts || parts[0]! < 24 || (parts[0] === 24 && parts[1]! < 15))
    throw new CliError('NODE_TOO_OLD', match ? version : '0.0.0');
}
