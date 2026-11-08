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
/** Closed stage names only; no target IDs, URLs or protocol text. */
export const TAB_FAILURE_STAGES = [
  'inherited-window',
  'anchor',
  'owned-identity',
  'owned-missing',
  'list',
  'window',
  'children-attach',
  'children-timeout',
  'children-protocol',
  'children-ambiguous',
  'run-window-closed',
  'tab-count',
  'close',
  'settle',
] as const;
export type TabFailureStage = (typeof TAB_FAILURE_STAGES)[number];
export class TabInventoryStop extends ContextStop {
  readonly stage: TabFailureStage;
  constructor(stage: TabFailureStage) {
    super('TAB_INVENTORY', 'tab-inventory');
    this.stage = stage;
  }
}
const childStage = (error: unknown): TabFailureStage => {
  const message = error instanceof Error ? error.message : '';
  if (message === 'TAB_OBSERVATION_TIMEOUT') return 'children-timeout';
  if (
    message === 'TAB_OBSERVATION_PROTOCOL' ||
    message === 'TAB_OBSERVATION_INVALID' ||
    message === 'TAB_OBSERVATION_SEND'
  )
    return 'children-protocol';
  return 'children-attach';
};

export async function sameWindowPage(
  context: BrowserContext,
  anchor: Page,
  page: Page,
) {
  const first = await context.newCDPSession(anchor);
  try {
    const second = await context.newCDPSession(page);
    try {
      return (
        windowSchema.parse(await first.send('Browser.getWindowForTarget'))
          .windowId ===
        windowSchema.parse(await second.send('Browser.getWindowForTarget'))
          .windowId
      );
    } finally {
      await second.detach();
    }
  } finally {
    await first.detach();
  }
}

/** A restored window in the same context is not the run's window. */
export async function inheritedWindowPages(context: BrowserContext) {
  const inherited = context.pages();
  const anchor = inherited[0];
  if (!anchor) throw new TabInventoryStop('inherited-window');
  const first = await context.newCDPSession(anchor);
  try {
    const windowId = windowSchema.parse(
      await first.send('Browser.getWindowForTarget'),
    ).windowId;
    const same: Page[] = [];
    for (const page of inherited) {
      const client = await context.newCDPSession(page);
      try {
        if (
          windowSchema.parse(await client.send('Browser.getWindowForTarget'))
            .windowId === windowId
        )
          same.push(page);
      } finally {
        await client.detach();
      }
    }
    return same;
  } catch {
    throw new TabInventoryStop('inherited-window');
  } finally {
    await first.detach();
  }
}

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
  { settleMs = 5000 }: { settleMs?: number } = {},
): Promise<TabAudit> {
  const anchor = [...owned].find((page) => !page.isClosed());
  if (!anchor) throw new TabInventoryStop('anchor');
  let stage: TabFailureStage = 'anchor';
  let client: CDPSession;
  try {
    client = await context.newCDPSession(anchor);
  } catch {
    throw new TabInventoryStop(stage);
  }
  const result: TabAudit = {
    closed: { page: 0, tab: 0 },
    nonOwned: 0,
    tabs: 0,
  };
  const listTargets = async () =>
    targetList.parse(
      await client.send('Target.getTargets', {
        filter: [{ type: 'tab' }, { type: 'page' }],
      }),
    ).targetInfos;
  try {
    const anchorInfo = z
      .object({ targetInfo: info })
      .parse(await client.send('Target.getTargetInfo')).targetInfo;
    if (!anchorInfo.browserContextId) throw new Error('TAB_CONTEXT_MISSING');
    const runWindow = windowSchema.parse(
      await client.send('Browser.getWindowForTarget'),
    ).windowId;
    stage = 'owned-identity';
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
      stage = 'list';
      const targets = await listTargets();
      const same: z.infer<typeof info>[] = [];
      stage = 'window';
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
      stage = 'owned-missing';
      if ([...ids].some((id) => !same.some((value) => value.targetId === id)))
        throw new Error('OWNED_TAB_MISSING');
      const pages = same.filter((value) => value.type === 'page'),
        wrappers = same.filter((value) => value.type === 'tab');
      // Every tab holds one page and each owned page sits in its own tab. So
      // the window holds max(tabs, pages) tabs, and the ones that are not ours
      // are that count minus the owned pages. This needs no attach to a tab,
      // which real Edge refused (run de31b06a, children-attach).
      stage = 'tab-count';
      if (wrappers.length && wrappers.length < ids.size)
        throw new Error('TAB_COUNT');
      const tabs = Math.max(wrappers.length, pages.length);
      return {
        tabs,
        nonOwned: tabs - ids.size,
        nonOwnedPages: pages.filter((value) => !ids.has(value.targetId)),
        pageless: Math.max(0, wrappers.length - pages.length),
        wrappers,
      };
    };
    /** closeTarget returns before the browser destroys the tab. */
    const contextTabs = (listed: z.infer<typeof info>[]) =>
      listed.filter(
        (value) =>
          value.type === 'tab' &&
          value.browserContextId === anchorInfo.browserContextId,
      ).length;
    const closeAll = async (targets: z.infer<typeof info>[]) => {
      if (!targets.length) return 0;
      stage = 'list';
      const tabsBefore = contextTabs(await listTargets());
      stage = 'close';
      for (const value of targets)
        await client.send('Target.closeTarget', { targetId: value.targetId });
      // Wait for the closed targets, and the tab of each closed page, to
      // leave the list, then run the same strict inspection; a target still
      // present stays counted.
      const gone = new Set(targets.map((value) => value.targetId));
      const pending = (listed: z.infer<typeof info>[]) =>
        listed.some((value) => gone.has(value.targetId)) ||
        (tabsBefore > 0 && contextTabs(listed) > tabsBefore - targets.length);
      stage = 'settle';
      const deadline = Date.now() + settleMs;
      let listed = await listTargets();
      while (pending(listed) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        listed = await listTargets();
      }
      return targets.filter(
        (value) => !listed.some((entry) => entry.targetId === value.targetId),
      ).length;
    };
    let state = await inspect();
    if (closeStartup) {
      if (state.nonOwnedPages.length) {
        result.closed.page += await closeAll(state.nonOwnedPages);
        state = await inspect();
      }
      if (state.nonOwned && state.pageless) {
        // A tab without a page target can only be told apart by its child
        // page, read through an attach. Where the browser refuses the
        // attach, the run stops rather than guess which tab is ours.
        const unowned: z.infer<typeof info>[] = [];
        for (const value of state.wrappers) {
          let children: Set<string>;
          try {
            children = await tabChildren(client, value.targetId);
          } catch (error) {
            throw new TabInventoryStop(childStage(error));
          }
          stage = 'children-ambiguous';
          if (![...children].some((child) => ids.has(child)))
            unowned.push(value);
          else if (children.size !== 1) throw new Error('TAB_CHILD_AMBIGUOUS');
        }
        result.closed.tab += await closeAll(unowned);
        state = await inspect();
      }
    }
    result.nonOwned = state.nonOwned;
    result.tabs = state.tabs;
    return result;
  } catch (error) {
    throw error instanceof TabInventoryStop
      ? error
      : new TabInventoryStop(stage);
  } finally {
    await client.detach();
  }
}
