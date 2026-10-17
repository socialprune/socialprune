import { expect, test } from '@playwright/test';
import {
  plantedListener,
  plantedProcess,
  plantedConnection,
} from '../test/lifecycle-controls.ts';

test('positive control catches a live listener owned by the test', async () => {
  await expect(plantedListener()).rejects.toThrow('APP_LISTENER');
});
test('positive control catches a live decoy PID without stopping it', async () => {
  await expect(plantedProcess()).rejects.toThrow('BROWSER_PROCESS_REMAINS');
});

test('positive control catches an outbound connection to an owned local decoy', async () => {
  await expect(plantedConnection(4644)).rejects.toThrow('APP_CONNECTION');
});
