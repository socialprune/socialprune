import type { Original } from '../model/original.ts';
import type { ReadTransaction } from './store.ts';
export interface ConversationLink {
  id: string;
  original: Original | null;
  ownItemId: string | null;
}
export async function conversation(
  tx: ReadTransaction,
  originalId: string,
  accountKey: string,
): Promise<{
  chain: ConversationLink[];
  state: 'complete' | 'partial' | 'not-read';
}> {
  const focal = await tx.originals.get(originalId);
  if (
    focal?.signedIn?.status !== 'read' &&
    focal?.anonymous?.status !== 'fetched'
  )
    return { chain: [], state: 'not-read' };
  if (!focal?.parentId)
    return {
      chain: [],
      state: focal?.chainAbove === 'complete' ? 'complete' : 'not-read',
    };
  const own = new Map<string, { id: string; parent: string | null }>();
  for await (const { item } of tx.items.iterate())
    if (item.platform === 'x' && item.account.key === accountKey)
      own.set(item.id.slice(2), {
        id: item.id,
        parent: item.reference.replyToId,
      });
  let id: string | null = focal.parentId;
  const seen = new Set([originalId]),
    chain: ConversationLink[] = [];
  let state: 'complete' | 'partial' | 'not-read' = 'complete';
  while (id && chain.length < 20) {
    if (seen.has(id)) {
      state = 'partial';
      break;
    }
    seen.add(id);
    const item = own.get(id);
    if (item) {
      chain.push({ id, original: null, ownItemId: item.id });
      id = item.parent;
      continue;
    }
    const original = await tx.originals.get(id);
    if (!original) {
      state = chain.length ? 'partial' : 'not-read';
      break;
    }
    chain.push({ id, original, ownItemId: null });
    if (
      original.signedIn?.status !== 'read' &&
      original.anonymous?.status !== 'fetched'
    ) {
      state = 'partial';
      break;
    }
    id = original.parentId;
  }
  if (id && chain.length >= 20) state = 'partial';
  return { chain: chain.reverse(), state };
}
