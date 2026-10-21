import { expect, test } from 'vitest';
import { StartupLog } from '../packaging/startup-log.ts';

test('repeated timestamped startup lines retain counts, distinct early errors and the raw tail', () => {
  const log = new StartupLog(4096, 256);
  log.append(
    '[101:1021/081000.100:ERROR:gpu_process_host.cc:77] first failure\n',
  );
  for (let n = 0; n < 1000; n++) {
    log.append(
      `[101:1021/081001.${String(n).padStart(3, '0')}:ERROR:cache.cc:153] cache sharing violation 0x20\n`,
    );
  }
  log.append(
    '[101:1021/081003.000:ERROR:renderer.cc:99] final distinct failure\n',
  );
  const value = log.snapshot();
  expect(value.lines).toHaveLength(3);
  expect(value.lines[0]?.message).toContain('first failure');
  expect(value.lines[1]).toMatchObject({
    count: 1000,
    firstTimestamp: '1021/081001.000',
    lastTimestamp: '1021/081001.999',
  });
  expect(value.tail).toContain('final distinct failure');
  expect(value.omittedDistinct).toBe(0);
});

test('chunk boundaries and overflowing distinct messages have explicit evidence loss', () => {
  const log = new StartupLog(100, 40);
  log.append('partial');
  log.append(' line\n');
  for (let n = 0; n < 30; n++) log.append(`distinct-${n}\n`);
  const value = log.snapshot();
  expect(value.lines[0]?.message).toBe('partial line');
  expect(value.omittedDistinct).toBeGreaterThan(0);
  expect(value.tail).toContain('distinct-29');
  expect(value.totalLines).toBe(31);
});
