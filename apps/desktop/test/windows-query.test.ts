import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, connect } from 'node:net';
import type { Socket } from 'node:net';
import { createSocket } from 'node:dgram';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directory } from '../packaging/paths.ts';
import {
  appProcesses,
  processIdentities,
  matchingProcessIdentities,
  assertNoRemainingProcesses,
} from './windows.ts';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { windowsTestBudget } from './windows-test-budgets.ts';

test.skipIf(process.platform !== 'win32')(
  'native identities retain exact creation times, exclude reused PIDs, and observe only the generated child lifecycle',
  async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'process.stdout.write("ready\\n");setInterval(()=>{},1000)'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    await once(child.stdout, 'data');
    try {
      const first = await processIdentities([child.pid!]);
      expect(first).toHaveLength(1);
      expect(first[0]!.born).toMatch(/^\d+$/);
      expect(await processIdentities([child.pid!])).toEqual(first);
      const baseline = await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-Process -Id ${child.pid!}).StartTime.ToUniversalTime().ToFileTimeUtc().ToString()`,
        ],
        {
          timeout: WINDOWS_QUERY_TIMEOUT_MS,
          queryClass: 'generated-identity-parity',
        },
      );
      expect(first[0]!.born).toBe(baseline.stdout.trim());
      expect(
        matchingProcessIdentities([{ pid: child.pid!, born: '0' }], first),
      ).toEqual([]);
      const exited = once(child, 'exit');
      child.kill();
      await exited;
      await assertNoRemainingProcesses(first);
    } finally {
      if (child.exitCode === null && !child.killed) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    }
  },
  windowsTestBudget(2),
);

test.skipIf(process.platform !== 'win32')(
  'native process snapshots match the exact generated executable, with PID and creation time, not another image with the same name',
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'socialprune-process-table-'));
    const executable = join(scratch, 'SocialPrune.exe');
    await copyFile(process.execPath, executable);
    const child = spawn(
      executable,
      ['-e', 'process.stdout.write("ready\\n");setInterval(()=>{},1000)'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    await once(child.stdout, 'data');
    try {
      const rows = await appProcesses(executable);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        ProcessId: child.pid,
        ParentProcessId: process.pid,
        ExecutablePath: executable,
      });
      expect(rows[0]!.born).toBe(
        (await processIdentities([child.pid!]))[0]!.born,
      );
      expect(
        await appProcesses(join(scratch, 'absent', 'SocialPrune.exe')),
      ).toEqual([]);
    } finally {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
      await rm(scratch, { recursive: true, force: true });
    }
  },
  windowsTestBudget(1),
);

test.skipIf(process.platform !== 'win32')(
  'native tables detect generated IPv4 and IPv6 TCP listeners, UDP endpoints and outbound TCP without counting foreign PIDs',
  async () => {
    const { windowsQuery } = await import('../packaging/windows-query.ts');
    for (const host of ['127.0.0.1', '::1']) {
      const tcp = createServer();
      tcp.listen(0, host);
      await once(tcp, 'listening');
      const udp = createSocket(host === '::1' ? 'udp6' : 'udp4');
      udp.bind(0, host);
      await once(udp, 'listening');
      const address = tcp.address();
      if (!address || typeof address === 'string')
        throw new Error('GENERATED_ADDRESS_MISSING');
      const accepted = once(tcp, 'connection');
      const client = connect(address.port, host);
      await once(client, 'connect');
      const server = (await accepted)[0] as Socket;
      try {
        const listeners = JSON.parse(
          await windowsQuery('listeners', String(process.pid)),
        ) as { tcp: number; udp: number };
        expect(listeners.tcp).toBeGreaterThan(0);
        expect(listeners.udp).toBeGreaterThan(0);
        const connections = JSON.parse(
          await windowsQuery('connections', String(process.pid)),
        ) as { processId: number; remotePort: number }[];
        expect(
          connections.some(
            (row) =>
              row.processId === process.pid && row.remotePort === address.port,
          ),
        ).toBe(true);
        const ps = await runPowerShell(
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `$ids=@(${process.pid}); $l=& '${join(directory, 'packaging/listeners.ps1').replaceAll("'", "''")}' -ProcessIds $ids; $c=& '${join(directory, 'packaging/connections.ps1').replaceAll("'", "''")}' -ProcessIds $ids; $connections=$c|ConvertFrom-Json; @{listeners=($l|ConvertFrom-Json);connections=@($connections)} | ConvertTo-Json -Depth 5 -Compress`,
          ],
          {
            timeout: WINDOWS_QUERY_TIMEOUT_MS,
            queryClass: 'generated-native-ps-parity',
          },
        );
        const parity = JSON.parse(ps.stdout) as {
          listeners: { tcp: number; udp: number };
          connections: { processId: number; remotePort: number }[];
        };
        expect(parity.listeners).toEqual(listeners);
        expect(
          parity.connections.some(
            (row) =>
              row.processId === process.pid && row.remotePort === address.port,
          ),
        ).toBe(true);
        expect(
          JSON.parse(await windowsQuery('listeners', '4294967295')),
        ).toEqual({ tcp: 0, udp: 0 });
      } finally {
        client.destroy();
        server.destroy();
        udp.close();
        await new Promise<void>((resolve) => tcp.close(() => resolve()));
      }
    }
  },
  windowsTestBudget(3),
);

test('owned process/socket queries no longer invoke CIM or NetTCPIP and cleanup cannot use the old bare predicate deadline', async () => {
  const windows = await readFile(join(directory, 'test/windows.ts'), 'utf8');
  expect(windows).not.toMatch(
    /Get-CimInstance|Get-Process|listeners\.ps1|connections\.ps1|controller\.abort/,
  );
  const helper = await readFile(join(directory, 'e2e/helpers.ts'), 'utf8');
  expect(helper).not.toMatch(/\.poll\(async \(\) => \(await appProcesses/);
});
