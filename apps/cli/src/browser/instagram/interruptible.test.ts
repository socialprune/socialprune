import { expect, test } from 'vitest';
import { interruptibleWork } from './interruptible.ts';

test('C35 completed, rejected, active and later operations keep interruption semantics', async () => {
  const signal = interruptibleWork();
  expect(await signal.until(Promise.resolve(1))).toBe(1);
  await expect(
    signal.until(Promise.reject(new Error('Generated failure'))),
  ).rejects.toThrow('Generated failure');
  const active = signal.until(new Promise<void>(() => {}));
  signal.interrupt();
  expect(await active).toBeNull();
  expect(await signal.until(new Promise<void>(() => {}))).toBeNull();
});
