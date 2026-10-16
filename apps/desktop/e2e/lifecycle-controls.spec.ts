import { expect, test } from '@playwright/test';
import { plantedListener, plantedProcess } from '../test/lifecycle-controls.ts';

test('positive control catches a live listener owned by the test', async () => {
  await expect(plantedListener()).rejects.toThrow('APP_LISTENER');
});
test('positive control catches a live decoy PID without stopping it', async () => {
  await expect(plantedProcess()).rejects.toThrow('BROWSER_PROCESS_REMAINS');
});
