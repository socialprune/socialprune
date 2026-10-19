import { join } from 'node:path';

let workspace: string | undefined;
export function setProofWorkspace(path: string) {
  workspace = path;
}
export function proofWorkspace() {
  if (!workspace) throw new Error('RESTRICTED_PROOF_WORKSPACE_REQUIRED');
  return workspace;
}
export const proofOutput = (name: string) =>
  join(proofWorkspace(), 'evidence', name);
