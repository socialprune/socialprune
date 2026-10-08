import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { observeImport, waitForApp } from './helpers.ts';

test('I1 observeImport rejects a real request to a second loopback origin from a test-only page action', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  await waitForApp(page);
  await audit.assert();
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(200, {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-store',
    });
    response.end(
      '<!doctype html><title>Generated audit control</title><p>Generated audit control</p>',
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Audit control needs a loopback port.');
  const target = `http://127.0.0.1:${address.port}/generated-audit-control`;
  const control = await context.newPage();
  try {
    // Only this spec creates the extra page and origin. No production route,
    // flag, fetch replacement, CSP relaxation or outbound internet request.
    expect(new URL(target).origin).not.toBe(
      new URL(test.info().project.use.baseURL!).origin,
    );
    await control.goto(target);
    await expect(
      control.getByText('Generated audit control', { exact: true }),
    ).toBeVisible();
    expect(requests).toBeGreaterThan(0);
    let receipt: unknown;
    try {
      await audit.assert();
    } catch (error) {
      receipt = error;
    }
    expect(receipt).toBeInstanceOf(Error);
    expect((receipt as Error).message).toContain(target);
    console.log(
      `I1_OFF_ORIGIN_AUDIT_RECEIPT rejected=${target} serverRequests=${requests}`,
    );
    console.log((receipt as Error).message);
  } finally {
    await control.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
