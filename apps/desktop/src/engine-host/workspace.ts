import { DatabaseSync } from 'node:sqlite';
import type { DesktopReply, DesktopRequest } from '../protocol.ts';

// A bounded compatibility read, not a second workspace implementation. Lane E
// replaces this adapter with socialprune/engine after the runtime gate passes.
export function openFoundationWorkspace(path: string) {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
    db.prepare('SELECT count(*) AS count FROM items').get();
  } catch {
    db?.close();
    db = undefined;
  }
  return {
    read(request: DesktopRequest): DesktopReply {
      if (!db)
        return {
          requestId: request.requestId,
          type: 'rejected',
          code: 'WORKSPACE_OPEN_FAILED',
        };
      try {
        const items = db.prepare('SELECT count(*) AS count FROM items').get();
        const version = db.prepare('SELECT sqlite_version() AS version').get();
        if (
          typeof items?.count !== 'number' ||
          typeof version?.version !== 'string'
        )
          throw new Error('WORKSPACE_INVALID');
        return {
          requestId: request.requestId,
          type: 'foundationSummary',
          items: items.count,
          sqliteVersion: version.version,
        };
      } catch {
        return {
          requestId: request.requestId,
          type: 'rejected',
          code: 'WORKSPACE_OPEN_FAILED',
        };
      }
    },
    close() {
      db?.close();
      db = undefined;
    },
  };
}
