import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { testEnvironment } from './process-environment.ts';

test.skipIf(process.platform !== 'win32')(
  'a window appearing after a negative diagnostic sample has a fresh owned-window observation when focus readiness returns',
  async () => {
    const scratch = await mkdtemp(
      join(tmpdir(), 'socialprune-window-observation-'),
    );
    try {
      const output = join(scratch, 'output');
      await mkdir(output);
      const original = await readFile(
        join(directory, 'packaging/window-readiness.ps1'),
        'utf8',
      );
      // Test-only clock separation: suppress periodic refresh after the first
      // negative sample. The live window opens only on the second poll below.
      const planted = original.replace(
        '$nextAppObservationMs = $clock.ElapsedMilliseconds + 1000',
        '$nextAppObservationMs = $clock.ElapsedMilliseconds + 60000',
      );
      expect(planted).not.toBe(original);
      await writeFile(join(scratch, 'window-readiness.ps1'), planted);
      await writeFile(
        join(scratch, 'window-readiness.cs'),
        await readFile(join(directory, 'packaging/window-readiness.cs')),
      );
      const order = join(scratch, 'show-order');
      const ui = join(scratch, 'window.ps1');
      await writeFile(
        ui,
        `param([string]$Order)
Add-Type -AssemblyName PresentationFramework
while (-not [IO.File]::Exists($Order)) { Start-Sleep -Milliseconds 25 }
$window=[System.Windows.Window]::new()
$window.Title='SocialPrune'
[System.Windows.Automation.AutomationProperties]::SetName($window,'SocialPrune')
$window.Width=600;$window.Height=400
$button=[System.Windows.Controls.Button]::new();$button.Content='Choose criteria';$window.Content=$button
$null=$window.ShowDialog()
`,
      );
      const entry = join(scratch, 'child.mjs');
      await writeFile(
        entry,
        `import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
import{runPowerShell,WINDOWS_QUERY_TIMEOUT_MS,WINDOWS_POWERSHELL_EXECUTABLE}from ${JSON.stringify(pathToFileURL(join(directory, 'packaging/windows-powershell.ts')).href)};
import{launchReviewApp}from ${JSON.stringify(pathToFileURL(join(directory, 'packaging/review-app-launch.ts')).href)};
const app=await launchReviewApp(WINDOWS_POWERSHELL_EXECUTABLE,['-NoProfile','-NonInteractive','-STA','-File',${JSON.stringify(ui)},'-Order',${JSON.stringify(order)}],${JSON.stringify(join(output, 'app.json'))});
try{
const receipt=${JSON.stringify(join(scratch, 'receipt.json'))};
const command=". '"+${JSON.stringify(join(scratch, 'window-readiness.ps1').replaceAll("'", "''"))}+"';$null=Wait-AppWindow -AppProcessId "+app.pid+" -Mode ReviewAction -TimeoutMs "+WINDOWS_QUERY_TIMEOUT_MS+" -Receipt '"+receipt.replaceAll("'","''")+"' -OnPoll { if ($iterations -eq 2) { [IO.File]::WriteAllText('"+${JSON.stringify(order.replaceAll("'", "''"))}+"','show') } }";
await runPowerShell(['-NoProfile','-NonInteractive','-Command',command],{timeout:WINDOWS_QUERY_TIMEOUT_MS*2,windowsHide:true});
const value=JSON.parse(await readFile(receipt,'utf8'));
console.error('FORCED_WINDOW_OBSERVATION_RECEIPT',JSON.stringify(value));
assert.equal(value.state,'ready');assert.equal(value.branch,'focus-readback');assert.equal(value.firstAppObservation.windows.length,0);assert.equal(value.last.nativeWindowCount,1);assert.equal(value.last.enabled,true);assert.equal(value.last.focusResult,true);assert.equal(value.last.offscreen,false);
assert.ok(value.appObservation.windows.length>0);
assert.ok(value.appObservation.observedAt>value.firstAppObservation.observedAt);
}finally{await app.close()}
`,
      );
      const { stderr } = await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'test/window-station-fixture.ps1'),
          '-Node',
          process.execPath,
          '-Entry',
          entry,
          '-TimeoutMs',
          String(WINDOWS_QUERY_TIMEOUT_MS * 3),
        ],
        {
          timeout: WINDOWS_QUERY_TIMEOUT_MS * 4,
          windowsHide: true,
          env: testEnvironment(),
        },
      );
      const row = stderr
        .split('\n')
        .find((line) => line.startsWith('FORCED_WINDOW_OBSERVATION_RECEIPT '));
      expect(row).toBeDefined();
      const value = JSON.parse(
        row!.slice('FORCED_WINDOW_OBSERVATION_RECEIPT '.length),
      ) as {
        branch: string;
        firstAppObservation: { observedAt: number; windows: unknown[] };
        appObservation: { observedAt: number; windows: unknown[] };
        last: { nativeWindowCount: number };
      };
      process.stdout.write(
        'WINDOW_OBSERVATION_ORDER ' +
          JSON.stringify({
            branch: value.branch,
            firstWindows: value.firstAppObservation.windows.length,
            terminalWindows: value.appObservation.windows.length,
            firstAt: value.firstAppObservation.observedAt,
            terminalAt: value.appObservation.observedAt,
            nativeWindowCount: value.last.nativeWindowCount,
          }) +
          '\n',
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  WINDOWS_QUERY_TIMEOUT_MS * 4 + 100,
);
