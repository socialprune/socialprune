import { useEffect, useState } from 'react';
import type { WorkspaceClient } from '../workspace/client.ts';
import { requestId } from '../social/workspace.ts';
// Import the pure core module without the schema barrel: moving schemas into a
// shared lazy chunk can evaluate Zod before browser-init and violate page CSP.
import {
  popularIds,
  popularityThreshold,
} from '../../../../packages/core/src/workspace/popular.ts';
import type { PopularityItem } from '../../../../packages/core/src/workspace/popular.ts';

export function usePopularity(
  client: WorkspaceClient,
  accountKey: string,
  workspaceId: string | undefined,
  itemCount: number | undefined,
) {
  const [result, setResult] = useState<{
    accountKey: string;
    threshold: number | null;
    ids: Set<string>;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    let active = true;
    setResult(null);
    if (!accountKey || !workspaceId) return;
    void (async () => {
      const queryId = requestId();
      const filter = {
        kinds: ['post', 'reply', 'quote', 'comment'] as (
          'post' | 'reply' | 'quote' | 'comment'
        )[],
        likes: { min: null, max: null, unknown: 'exclude' as const },
      };
      const sorted = await client.request({
        type: 'query',
        requestId: requestId(),
        queryId,
        generation: 1,
        accountKey,
        filter,
        sort: [
          { by: 'likes', direction: 'desc' },
          { by: 'id', direction: 'asc' },
        ],
        search: '',
      });
      if (sorted.type !== 'queryResult')
        throw new Error('Popularity query rejected');
      const items: PopularityItem[] = [];
      for (let offset = 0; offset < sorted.total; offset += 200) {
        if (!active) return;
        const window = await client.request({
          type: 'window',
          requestId: requestId(),
          queryId,
          generation: 1,
          offset,
          limit: 200,
        });
        if (window.type !== 'rows')
          throw new Error('Popularity window rejected');
        for (let start = 0; start < window.rows.length; start += 12) {
          if (!active) return;
          const batch = await Promise.all(
            window.rows.slice(start, start + 12).map(async (row) => {
              const reply = await client.request({
                type: 'detail',
                requestId: requestId(),
                itemId: row.id,
              });
              if (reply.type !== 'itemDetail')
                throw new Error('Popularity item missing');
              const { id, platform, kind, account, engagement } = reply.item;
              return { id, platform, kind, account, engagement };
            }),
          );
          items.push(...batch);
        }
      }
      const threshold = popularityThreshold(items, accountKey);
      const ids = popularIds(items, accountKey, threshold);
      if (active) setResult({ accountKey, threshold, ids, error: false });
    })().catch(() => {
      if (active)
        setResult({ accountKey, threshold: null, ids: new Set(), error: true });
    });
    return () => {
      active = false;
    };
  }, [client, accountKey, workspaceId, itemCount]);
  return result?.accountKey === accountKey ? result : null;
}
