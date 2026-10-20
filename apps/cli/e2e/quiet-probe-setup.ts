import type { FullConfig } from '@playwright/test';
import { quietWebKit } from './quiet-webkit.ts';

export default async function setup(config: FullConfig) {
  if (process.platform !== 'win32') return;
  const endpoint = config.projects.find(
    (project) => project.use.browserName === 'webkit',
  )?.use.connectOptions?.wsEndpoint;
  if (!endpoint) throw new Error('Probe WebKit endpoint is required');
  const server = await quietWebKit(endpoint);
  // Workers evaluate the config again; propagate the run-owned endpoint, not a
  // second random reservation. This setup is never loaded by the product.
  // eslint-disable-next-line no-restricted-properties -- Probe-only worker configuration.
  process.env['SP_PROBE_QUIET_ENDPOINT'] = endpoint;
  return () => server.close();
}
