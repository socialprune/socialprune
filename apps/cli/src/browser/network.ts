import type { BrowserContext } from 'playwright-core';

/** Abort foreign origins, keep counts only, never interpret a blocked request as an account action. */
export async function restrictOrigins(
  context: BrowserContext,
  allowed: readonly string[],
  abortedHosts: Record<string, number>,
): Promise<void> {
  const record = (url: URL) => {
    abortedHosts[url.host] = (abortedHosts[url.host] ?? 0) + 1;
  };
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!allowed.includes(url.origin)) {
      record(url);
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  await context.routeWebSocket('**/*', async (socket) => {
    const url = new URL(socket.url());
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    if (!allowed.includes(url.origin)) {
      record(url);
      await socket.close();
    } else socket.connectToServer();
  });
}
