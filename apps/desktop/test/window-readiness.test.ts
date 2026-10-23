import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import { collectProof } from '../e2e/proof-collection.ts';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { testEnvironment } from './process-environment.ts';

test('all window probes share owned-desktop discovery, condition receipts and a measured deadline', async () => {
  for (const name of [
    'packaging/release-window.ps1',
    'packaging/smoke-window.ps1',
    'e2e/inactive-window-probe.ps1',
  ]) {
    const text = await readFile(join(directory, name), 'utf8');
    expect(text, name).toContain('Wait-AppWindow');
    expect(text, name).not.toMatch(
      /AddSeconds\(45\)|RootElement\.FindFirst|SetFocus\(/,
    );
  }
  const source = await readFile(
    join(directory, 'packaging/window-readiness.ps1'),
    'utf8',
  );
  expect(source).toContain('FromHandle');
  expect(source).toContain('focus-readback');
  expect(source).toContain("'Choose criteria'");
  expect(source).not.toContain("'^Keep(\\s|$)'");
  expect(source).toContain(
    '$last.invokeAvailable -and $last.keyboardFocusable',
  );
  expect(source).not.toContain('.Invoke()');
  const native = await readFile(
    join(directory, 'packaging/window-readiness.cs'),
    'utf8',
  );
  expect(native).toContain('EnumDesktopWindows');
  expect(native).toContain('GetThreadDesktop(GetCurrentThreadId())');
  expect(native).not.toMatch(
    /SetForegroundWindow|SwitchDesktop|SetThreadDesktop/,
  );
  expect(native).toContain('OpenOwned');
  const budget = await readFile(
    join(directory, 'packaging/window-readiness.ts'),
    'utf8',
  );
  expect(budget).toContain('4_472 * 3 + 50');
  for (const name of [
    'e2e/uninstall-controls.ts',
    'packaging/release-smoke.ts',
    'packaging/smoke.ts',
    'e2e/inactive-launch-trial.ts',
  ]) {
    expect(await readFile(join(directory, name), 'utf8'), name).toContain(
      'runWindowProbe(',
    );
  }
});

test.skipIf(process.platform !== 'win32')(
  'a noninteractive station exposes an enabled on-screen generated action by HWND, while failure conditions survive collection',
  async () => {
    const scratch = await mkdtemp(
      join(tmpdir(), 'socialprune-window-readiness-'),
    );
    try {
      const output = join(scratch, 'output');
      await mkdir(output);
      // The red copy changes only HWND-root binding back to the old desktop
      // root lookup. The expected UI controls come from the generated window.
      const readiness = await readFile(
        join(directory, 'packaging/window-readiness.ps1'),
        'utf8',
      );
      await writeFile(
        join(scratch, 'old-window.ps1'),
        readiness.replace(
          '[System.Windows.Automation.AutomationElement]::FromHandle($handle)',
          '[System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)',
        ),
      );
      await writeFile(
        join(scratch, 'window-readiness.cs'),
        await readFile(join(directory, 'packaging/window-readiness.cs')),
      );
      const noInvoke = readiness.replace(
        '$last.invokeAvailable = $action.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)',
        '$last.invokeAvailable = $false',
      );
      expect(noInvoke).not.toBe(readiness);
      await writeFile(join(scratch, 'no-invoke.ps1'), noInvoke);
      const ui = join(scratch, 'generated-window.ps1');
      await writeFile(
        ui,
        `param([string]$Mode)
Add-Type -AssemblyName PresentationFramework
$window=New-Object System.Windows.Window
$window.Title='SocialPrune'
[System.Windows.Automation.AutomationProperties]::SetName($window,'SocialPrune')
$window.Width=600;$window.Height=400
$button=New-Object System.Windows.Controls.Button
$button.Content=if($Mode-eq'title-only'){'Other action'}elseif($Mode-eq'ready-de'){'Kriterien w'+[char]0x00E4+'hlen'}elseif($Mode-eq'ready-selected'){'Change'}elseif($Mode-eq'ready-selected-de'){[string][char]0x00C4+'ndern'}else{'Choose criteria'}
$button.IsEnabled=($Mode-ne'disabled')
$button.Focusable=($Mode-ne'not-focusable')
$button.Visibility=if($Mode-eq'offscreen'){'Hidden'}else{'Visible'}
$window.Content=$button
$null=$window.ShowDialog()
`,
      );
      const child = join(scratch, 'child.mjs');
      await writeFile(
        child,
        `import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
 import{runPowerShell,WINDOWS_QUERY_TIMEOUT_MS,WINDOWS_POWERSHELL_EXECUTABLE}from ${JSON.stringify(pathToFileURL(join(directory, 'packaging/windows-powershell.ts')).href)};
 import{launchReviewApp}from ${JSON.stringify(pathToFileURL(join(directory, 'packaging/review-app-launch.ts')).href)};
 const missingReceipt=${JSON.stringify(join(scratch, 'release-window-native-failure.json'))};
 const missing=". '"+${JSON.stringify(join(directory, 'packaging/window-readiness.ps1').replaceAll("'", "''"))}+"';$station=$env:SP_PROOF_DESKTOP.Split([char]92)[0];$null=Wait-AppWindow -AppProcessId "+process.pid+" -Mode ReviewAction -TimeoutMs 1500 -DesktopPath ($station+[char]92+'SocialPrune-test-absent') -Receipt '"+missingReceipt.replaceAll("'","''")+"'";
 const missingExit=await runPowerShell(['-NoProfile','-NonInteractive','-Command',missing],{timeout:WINDOWS_QUERY_TIMEOUT_MS,windowsHide:true}).then(()=>0,()=>1);assert.equal(missingExit,1);
 const nativeFailure=JSON.parse(await readFile(missingReceipt,'utf8'));assert.deepEqual(nativeFailure.nativeFailure,{call:'OpenDesktopW',win32Error:2});assert.equal(nativeFailure.errorId,'READINESS_NATIVE_FAILED:OpenDesktopW:2');
  for(const mode of ['ready','ready-de','ready-selected','ready-selected-de','title-only','disabled','offscreen','not-focusable','no-invoke']){
 const app=await launchReviewApp(WINDOWS_POWERSHELL_EXECUTABLE,['-NoProfile','-NonInteractive','-STA','-File',${JSON.stringify(ui)},'-Mode',mode],${JSON.stringify(output)}+'/app-'+mode+'.json');
  const receipt=${JSON.stringify(scratch)}+'/release-window-'+mode+'.json';
  try{
   if(mode!=='ready'){
    const settle=". '"+${JSON.stringify(join(directory, 'packaging/window-readiness.ps1').replaceAll("'", "''"))}+"';$null=Wait-AppWindow -AppProcessId "+app.pid+" -Mode Close -TimeoutMs "+WINDOWS_QUERY_TIMEOUT_MS+" -Receipt '"+${JSON.stringify(join(output, 'release-window-settle.json').replaceAll("'", "''"))}+"'";
    await runPowerShell(['-NoProfile','-NonInteractive','-Command',settle],{timeout:WINDOWS_QUERY_TIMEOUT_MS*2,windowsHide:true});
   }
  const script=mode==='no-invoke'?${JSON.stringify(join(scratch, 'no-invoke.ps1'))}:${JSON.stringify(join(directory, 'packaging/window-readiness.ps1'))};
  const command=". '"+script.replaceAll("'","''")+"';$null=Wait-AppWindow -AppProcessId "+app.pid+" -Mode ReviewAction -TimeoutMs "+(mode.startsWith('ready')?WINDOWS_QUERY_TIMEOUT_MS:1500)+" -Receipt '"+receipt.replaceAll("'","''")+"'";
  const result=await runPowerShell(['-NoProfile','-NonInteractive','-Command',command],{timeout:WINDOWS_QUERY_TIMEOUT_MS,windowsHide:true}).then(()=>0,error=>{console.error(error.stderr);return 1;});
  console.error('GENERATED_WINDOW_RECEIPT',mode,await readFile(receipt,'utf8'));
   const expectedReady=mode.startsWith('ready');assert.equal(result,expectedReady?0:1);
   const value=JSON.parse(await readFile(receipt,'utf8'));assert.equal(value.last.windowFound,true);assert.equal(value.windowStationVisible,false);assert.equal(value.appObservation.alive,true);assert.ok(value.appObservation.windows.length>0);assert.ok(value.appObservation.threads.some(t=>t.matchesPublished===true));
   if(expectedReady){
    assert.equal(value.state,'ready');assert.equal(value.last.rootWindowFound,false);assert.equal(value.last.enabled,true);assert.equal(value.last.focusResult,true);assert.equal(value.last.offscreen,false);assert.equal(value.branch,'focus-readback');
    const redReceipt=${JSON.stringify(join(scratch, 'release-window-red.json'))};
    const red=". '"+${JSON.stringify(join(scratch, 'old-window.ps1').replaceAll("'", "''"))}+"';$null=Wait-AppWindow -AppProcessId "+app.pid+" -Mode ReviewAction -TimeoutMs 1500 -Receipt '"+redReceipt.replaceAll("'","''")+"'";
    const redExit=await runPowerShell(['-NoProfile','-NonInteractive','-Command',red],{timeout:WINDOWS_QUERY_TIMEOUT_MS,windowsHide:true}).then(()=>0,()=>1);
    assert.equal(redExit,1);const old=JSON.parse(await readFile(redReceipt,'utf8'));assert.equal(old.last.rootWindowFound,false);assert.equal(old.last.nativeWindowCount,1);assert.equal(old.last.windowFound,false);
   }
    else{assert.equal(value.state,'failed');if(mode==='title-only')assert.equal(value.last.actionCount,0);if(mode==='disabled')assert.equal(value.last.enabled,false);if(mode==='offscreen')assert.ok(value.last.actionCount===0||value.last.offscreen===true);if(mode==='no-invoke')assert.equal(value.last.invokeAvailable,false);if(mode==='not-focusable'){assert.equal(value.last.enabled,true);assert.equal(value.last.offscreen,false);assert.equal(value.last.focusResult,false);}}
 }finally{await app.close();}
}`,
      );
      await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'test/window-station-fixture.ps1'),
          '-Node',
          process.execPath,
          '-Entry',
          child,
          '-TimeoutMs',
          String(WINDOWS_QUERY_TIMEOUT_MS * 8),
        ],
        {
          timeout: WINDOWS_QUERY_TIMEOUT_MS * 9,
          env: testEnvironment(),
          windowsHide: true,
        },
      );
      const collected = await collectProof(scratch, output);
      expect(collected.collected.sort()).toEqual([
        'release-window-disabled.json',
        'release-window-native-failure.json',
        'release-window-no-invoke.json',
        'release-window-not-focusable.json',
        'release-window-offscreen.json',
        'release-window-ready-de.json',
        'release-window-ready-selected-de.json',
        'release-window-ready-selected.json',
        'release-window-ready.json',
        'release-window-red.json',
        'release-window-title-only.json',
      ]);
      const text = await readFile(
        join(output, 'release-window-ready.json'),
        'utf8',
      );
      expect(text).not.toContain(scratch);
      expect(text).not.toContain('Choose criteria');
      expect(JSON.parse(text)).toMatchObject({
        state: 'ready',
        branch: 'focus-readback',
        last: {
          actionCount: 1,
          actionKind: 'review-criteria',
          enabled: true,
          offscreen: false,
          invokeAvailable: true,
          keyboardFocusable: true,
        },
      });
      process.stdout.write(`WINDOW_READINESS_PROOF ${text}\n`);
      process.stdout.write(
        `WINDOW_READINESS_NATIVE_FAILURE ${await readFile(join(output, 'release-window-native-failure.json'), 'utf8')}\n`,
      );
      process.stdout.write(
        `WINDOW_READINESS_RED ${await readFile(join(output, 'release-window-red.json'), 'utf8')}\n`,
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  WINDOWS_QUERY_TIMEOUT_MS * 9 + 100,
);
