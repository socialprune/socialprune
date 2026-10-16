import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';

export interface RendererState {
  require: string;
  process: string;
  node: string;
  electron: string;
  bridge: string[];
  frozen: boolean;
}
export function assertRenderer(state: RendererState): void {
  assert.deepEqual(state, {
    require: 'undefined',
    process: 'undefined',
    node: 'undefined',
    electron: 'undefined',
    bridge: ['onRunView', 'request'],
    frozen: true,
  });
}
export async function rendererState(page: Page): Promise<RendererState> {
  return page.evaluate(() => ({
    require: typeof Reflect.get(window, 'require'),
    process: typeof Reflect.get(window, 'process'),
    node: typeof Reflect.get(window, 'module'),
    electron: typeof Reflect.get(window, 'electron'),
    bridge: Object.keys(window.socialprune).sort(),
    frozen: Object.isFrozen(window.socialprune),
  }));
}
export interface PolicyEvent {
  directive: string;
  blocked: string;
}
export function assertPolicyEvents(
  events: PolicyEvent[],
  requests: string[],
): void {
  assert.deepEqual(events, [], 'CSP_VIOLATION');
  assert.deepEqual(
    requests.filter((url) => !url.startsWith('app://socialprune/')),
    [],
    'FOREIGN_REQUEST',
  );
}
export async function observePolicy(
  page: Page,
): Promise<() => Promise<PolicyEvent[]>> {
  await page.addInitScript(() => {
    const violations: { directive: string; blocked: string }[] = [];
    Object.assign(window, { desktopPolicyEvents: violations });
    document.addEventListener('securitypolicyviolation', (event) =>
      violations.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
      }),
    );
  });
  return () =>
    page.evaluate(
      () => Reflect.get(window, 'desktopPolicyEvents') as PolicyEvent[],
    );
}
