import { WorkspaceClient } from '../workspace/client.ts';

export class LocalReviewClient extends WorkspaceClient {
  // The shared review's storage-error action must point at the CLI backup,
  // never try the worker-only streaming backup request in local-review mode.
  override downloadBackup(): Promise<void> {
    location.hash = '#/backup';
    return Promise.resolve();
  }
}
