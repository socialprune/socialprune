import { expect, test } from 'vitest';
import { parseLinuxProcess, linuxOwnedMemory } from '../e2e/scale-host.ts';
test('Linux measurement counts only the owned root and its descendants', () => {
  const processes = [
    parseLinuxProcess(41, 'PPid:\t1\nVmRSS:\t100 kB'),
    parseLinuxProcess(42, 'PPid:\t41\nVmRSS:\t25 kB'),
    parseLinuxProcess(43, 'PPid:\t42\nVmRSS:\t5 kB'),
    parseLinuxProcess(99, 'PPid:\t1\nVmRSS:\t9999 kB'),
  ];
  expect(linuxOwnedMemory(41, processes)).toEqual({
    processCount: 3,
    workingSetBytes: 130 * 1024,
  });
  expect(() => parseLinuxProcess(41, 'VmRSS:\t10 kB')).toThrow(
    'Invalid proc status',
  );
});
