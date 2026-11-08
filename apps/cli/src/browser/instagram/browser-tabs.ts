import type { BrowserContext, CDPSession, Page } from 'playwright-core';
import { z } from 'zod';
import { ContextStop } from './report.ts';

const info = z.object({
  targetId: z.string().min(1),
  type: z.string(),
  browserContextId: z.string().optional(),
});
const targetList = z.object({ targetInfos: z.array(info) });
const windowSchema = z.object({ windowId: z.number().int() });
export type TabAudit = {
  closed: { page: number; tab: number };
  nonOwned: number;
  tabs: number;
};

/** A tab wrapper survives renderer disposal and need not have a Playwright Page. */
async function tabChildren(client: CDPSession, targetId: string) {
  const { sessionId } = z
    .object({ sessionId: z.string().min(1) })
    .parse(
      await client.send('Target.attachToTarget', { targetId, flatten: false }),
    );
  const children = new Set<string>();
  let receive!: (event: { sessionId: string; message: string }) => void;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('TAB_OBSERVATION_TIMEOUT')),
        1500,
      );
      receive = (event) => {
        if (event.sessionId !== sessionId) return;
        try {
          const message = z
            .object({
              id: z.number().optional(),
              error: z.unknown().optional(),
              method: z.string().optional(),
              params: z.object({ targetInfo: info }).optional(),
            })
            .parse(JSON.parse(event.message));
          if (message.error) throw new Error('TAB_OBSERVATION_PROTOCOL');
          if (
            message.method === 'Target.attachedToTarget' &&
            message.params?.targetInfo.type === 'page'
          )
            children.add(message.params.targetInfo.targetId);
          if (message.id === 1) {
            clearTimeout(timer);
            resolve();
          }
        } catch {
          clearTimeout(timer);
          reject(new Error('TAB_OBSERVATION_INVALID'));
        }
      };
      client.on('Target.receivedMessageFromTarget', receive);
      void client
        .send('Target.sendMessageToTarget', {
          sessionId,
          message: JSON.stringify({
            id: 1,
            method: 'Target.setAutoAttach',
            params: {
              autoAttach: true,
              waitForDebuggerOnStart: false,
              flatten: false,
            },
          }),
        })
        .catch(() => {
          clearTimeout(timer);
          reject(new Error('TAB_OBSERVATION_SEND'));
        });
    });
    return children;
  } finally {
    if (receive) client.off('Target.receivedMessageFromTarget', receive);
    await client.send('Target.detachFromTarget', { sessionId });
  }
}

export async function auditBrowserTabs(
  context: BrowserContext,
  owned: ReadonlySet<Page>,
  closeStartup: boolean,
): Promise<TabAudit> {
  const anchor = [...owned].find((page) => !page.isClosed());
  if (!anchor) throw new ContextStop('PLATFORM_CHECK', 'tab-inventory');
  const client = await context.newCDPSession(anchor);
  const result: TabAudit = {
    closed: { page: 0, tab: 0 },
    nonOwned: 0,
    tabs: 0,
  };
  try {
    const anchorInfo = z
      .object({ targetInfo: info })
      .parse(await client.send('Target.getTargetInfo')).targetInfo;
    const runWindow = windowSchema.parse(
      await client.send('Browser.getWindowForTarget'),
    ).windowId;
    const ids = new Set<string>();
    for (const page of owned) {
      if (page.isClosed()) continue;
      const session = await context.newCDPSession(page);
      try {
        const own = z
          .object({ targetInfo: info })
          .parse(await session.send('Target.getTargetInfo')).targetInfo;
        if (
          own.browserContextId !== anchorInfo.browserContextId ||
          windowSchema.parse(await session.send('Browser.getWindowForTarget'))
            .windowId !== runWindow
        )
          throw new Error('OWNED_TAB_IDENTITY');
        ids.add(own.targetId);
      } finally {
        await session.detach();
      }
    }
    const inspect = async () => {
      const targets = targetList.parse(
        await client.send('Target.getTargets', {
          filter: [{ type: 'tab' }, { type: 'page' }],
        }),
      ).targetInfos;
      const same = [];
      for (const value of targets) {
        if (value.browserContextId !== anchorInfo.browserContextId) continue;
        // An unobservable same-context target is not assumed foreign or closed.
        if (
          windowSchema.parse(
            await client.send('Browser.getWindowForTarget', {
              targetId: value.targetId,
            }),
          ).windowId === runWindow
        )
          same.push(value);
      }
      if ([...ids].some((id) => !same.some((value) => value.targetId === id)))
        throw new Error('OWNED_TAB_MISSING');
      const covered = new Set<string>(),
        nonOwned = [];
      let tabs = 0;
      for (const value of same.filter((value) => value.type === 'tab')) {
        tabs++;
        const children = await tabChildren(client, value.targetId);
        for (const child of children) covered.add(child);
        if (![...children].some((child) => ids.has(child)))
          nonOwned.push(value);
        else if (children.size !== 1) throw new Error('TAB_CHILD_AMBIGUOUS');
      }
      for (const value of same.filter(
        (value) => value.type === 'page' && !covered.has(value.targetId),
      )) {
        tabs++;
        if (!ids.has(value.targetId)) nonOwned.push(value);
      }
      return { tabs, nonOwned };
    };
    let state = await inspect();
    if (closeStartup) {
      for (const value of state.nonOwned) {
        await client.send('Target.closeTarget', { targetId: value.targetId });
        result.closed[value.type as 'page' | 'tab']++;
      }
      state = await inspect();
    }
    result.nonOwned = state.nonOwned.length;
    result.tabs = state.tabs;
    return result;
  } catch {
    throw new ContextStop('PLATFORM_CHECK', 'tab-inventory');
  } finally {
    await client.detach();
  }
}
