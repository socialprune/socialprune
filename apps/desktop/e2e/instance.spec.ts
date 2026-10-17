import { spawn } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { executable } from '../packaging/paths.ts';
import { launch } from './helpers.ts';

test('a second instance exits without another window or workspace owner', async () => {
  const app = await launch();
  const second = spawn(executable('test'), [`--data-dir=${app.data}`], {
    stdio: 'ignore',
    windowsHide: false,
  });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      second.once('exit', resolve);
      second.once('error', reject);
    });
    expect(code).toBe(0);
    expect(app.application.windows()).toHaveLength(1);
    expect(app.application.process().exitCode).toBeNull();
  } finally {
    if (second.exitCode === null) second.kill();
    await app.close();
  }
});
