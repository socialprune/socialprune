import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullConfig } from '@playwright/test';
import { assertBuildIdentity, readBuildId } from '../tooling/build-identity.ts';

export default async function setup(config: FullConfig): Promise<void> {
  const metadata = config.metadata as {
    outputDirectory?: string;
    identityPath?: string;
  };
  const output =
    metadata.outputDirectory ??
    fileURLToPath(new URL('../dist/', import.meta.url));
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL)
    throw new Error('E2E baseURL is required for build identity validation.');
  const path = metadata.identityPath ?? '/socialprune/build-info.js';
  const response = await fetch(new URL(path, baseURL), { cache: 'no-store' });
  if (!response.ok)
    throw new Error(
      `E2E identity read failed at ${baseURL}: HTTP ${response.status}.`,
    );
  assertBuildIdentity(
    readBuildId(await readFile(resolve(output, 'build-info.js'), 'utf8')),
    readBuildId(await response.text()),
    baseURL,
  );
  console.log(`E2E server identity verified at ${baseURL}.`);
}
