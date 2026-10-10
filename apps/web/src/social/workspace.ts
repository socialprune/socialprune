import { useEffect, useState } from 'react';
import type { WorkspaceSummary } from '@socialprune/core/workspace/protocol';
import type { WorkspaceClient } from '../workspace/client.ts';

export const requestId = () => crypto.randomUUID();

export function useWorkspace(client: WorkspaceClient) {
  const [summary, setSummary] = useState<WorkspaceSummary | null>(
    client.summary,
  );
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () => {
      void client
        .open()
        .then((reply) => {
          if (!active) return;
          if (reply.type === 'opened') setSummary(reply.summary);
          else setError(true);
        })
        .catch(() => active && setError(true));
    };
    const stop = client.subscribe((notice) => {
      if (notice.type === 'changed') {
        setRevision(notice.revision);
        load();
      }
    });
    load();
    return () => {
      active = false;
      stop();
    };
  }, [client]);
  return { summary, revision, error };
}
