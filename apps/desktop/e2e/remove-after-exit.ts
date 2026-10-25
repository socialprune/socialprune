import { setTimeout as sleep } from 'node:timers/promises';

export interface RemovalReceipt {
  version: 1;
  state: 'removed' | 'failed';
  exitConfirmed: boolean;
  attempts: number;
  retryCodes: string[];
  failureCode: string | null;
}

/** Final filesystem settling only. A failed exit check never reaches remove. */
export async function removeAfterExit(options: {
  wait: () => Promise<void>;
  remove: () => Promise<void>;
  record: (receipt: RemovalReceipt) => Promise<void>;
  sleep?: () => Promise<void>;
}): Promise<void> {
  const receipt: RemovalReceipt = {
    version: 1,
    state: 'failed',
    exitConfirmed: false,
    attempts: 0,
    retryCodes: [],
    failureCode: null,
  };
  try {
    await options.wait();
    receipt.exitConfirmed = true;
    for (;;) {
      receipt.attempts++;
      try {
        await options.remove();
        receipt.state = 'removed';
        break;
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : 'UNKNOWN';
        if (!['EBUSY', 'EPERM'].includes(code) || receipt.attempts >= 4)
          throw error;
        receipt.retryCodes.push(code);
        await (options.sleep?.() ?? sleep(100 * receipt.attempts));
      }
    }
  } catch (error) {
    receipt.failureCode =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'EXIT_OR_REMOVE_FAILED';
    await options.record(receipt);
    throw error;
  }
  await options.record(receipt);
}
