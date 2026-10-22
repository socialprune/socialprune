import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { testEnvironment } from './process-environment.ts';

test('diagnostic whole-second launcher limit encloses the exact remaining milliseconds', async () => {
  const source = await readFile(
    join(directory, 'e2e/desktop-diagnose.ts'),
    'utf8',
  );
  const expression = source.match(
    /const nativeTimeout = Math\.max\(1, Math\.(ceil|floor)\(ms \/ 1000\)\);/,
  );
  expect(expression).not.toBeNull();
  const rounding = expression![1] === 'ceil' ? Math.ceil : Math.floor;
  for (const remainder of [1, 999, 1001, 59_999, 239_999])
    expect(
      Math.max(1, rounding(remainder / 1000)) * 1000,
    ).toBeGreaterThanOrEqual(remainder);
});

test.skipIf(process.platform !== 'win32')(
  'native capture subtracts raw stopwatch ticks and diagnostic waits recheck the deadline clock after early delivery',
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'socialprune-timer-clocks-'));
    try {
      const capture = join(directory, 'packaging/uninstaller-capture.cs');
      const source = await readFile(
        join(directory, 'e2e/token-launch.cs'),
        'utf8',
      );
      const declaration =
        '[DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr p,uint ms);';
      expect(source).toContain(declaration);
      // Replace native wait/clock only in a compiled scratch copy. The actual
      // helper and every production entrypoint have no fault selector.
      const probe = join(scratch, 'probe.cs');
      const preamble =
        'using System;using System.Text;using System.IO;using System.ComponentModel;using System.Runtime.InteropServices;using System.Security.Principal;using System.Collections.Generic;\n';
      await writeFile(
        probe,
        preamble +
          source
            .replace(
              declaration,
              'static uint WaitForSingleObject(IntPtr p,uint ms) { return TimerProbe.Wait(ms); }',
            )
            .replaceAll(
              'DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()',
              'TimerProbe.Now',
            ) +
          '\n' +
          (await readFile(join(directory, 'e2e/limited-desktop.cs'), 'utf8')) +
          `
public static class TimerProbe {
  public static long Now=1000;
  public static List<uint> Durations=new List<uint>();
  public static bool Finish;
  public static uint Wait(uint ms) {
    Durations.Add(ms);
    if(Durations.Count==1) {Now=1099;return 258;}
    Now=1100;return Finish?0u:258u;
  }
  public static uint Run(bool finish) {
    Now=1000;Durations.Clear();Finish=finish;
    return (uint)typeof(TokenLaunch).GetMethod("WaitUntilExit",System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic).Invoke(null,new object[]{IntPtr.Zero,1100L});
  }
}`,
      );
      const script = join(scratch, 'probe.ps1');
      const q = (value: string) => value.replaceAll("'", "''");
      await writeFile(
        script,
        `$ErrorActionPreference='Stop'\nAdd-Type -Path '${q(capture)}'\nAdd-Type -Path '${q(probe)}'\n$exit=[TimerProbe]::Run($true);$exitWaits=@([TimerProbe]::Durations.ToArray())\n$timeout=[TimerProbe]::Run($false);$timeoutWaits=@([TimerProbe]::Durations.ToArray())\n@{raw=[UninstallerCapture]::ElapsedSince(900,67130000,1000000);legacy=([Math]::Floor(67130000/1000)-[Math]::Floor(900/1000));exit=$exit;exitWaits=$exitWaits;timeout=$timeout;timeoutWaits=$timeoutWaits}|ConvertTo-Json -Compress\n`,
      );
      const value = JSON.parse(
        (
          await runPowerShell(
            ['-NoProfile', '-NonInteractive', '-File', script],
            {
              timeout: WINDOWS_QUERY_TIMEOUT_MS,
              windowsHide: true,
              env: testEnvironment(),
            },
          )
        ).stdout,
      ) as { raw: number; legacy: number };
      expect(value).toMatchObject({
        legacy: 67130,
        exit: 0,
        exitWaits: [100, 1],
        timeout: 258,
        timeoutWaits: [100, 1],
      });
      expect(value.raw).toBeCloseTo(67129.1, 5);
      expect(value.raw).toBeLessThan(67130);
      console.log('TIMER_CLOCK_CLASS', JSON.stringify(value));
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  WINDOWS_QUERY_TIMEOUT_MS * 2,
);
