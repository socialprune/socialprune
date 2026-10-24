import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { parse } from 'yaml';
import { appxPhase } from '../e2e/appx-phase.ts';
import { setProofWorkspace } from '../e2e/proof-context.ts';
import {
  compareSystemSnapshots,
  type SystemSnapshot,
} from '../packaging/system-check.ts';
import { directory } from '../packaging/paths.ts';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { testEnvironment } from './process-environment.ts';
import { appxReadout } from '../e2e/appx-readout.ts';

test('diagnostic phases are inert by default and restricted receipts stay in the child workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'socialprune-appx-phase-'));
  try {
    vi.stubEnv('SP_APPX_DIAGNOSTIC_ROOT', undefined);
    vi.stubEnv('GITHUB_ACTIONS', 'false');
    await appxPhase('invented-default');
    // The restricted branch must not consult a workspace or validate/write any
    // marker when opt-in is absent, even with an otherwise invalid phase.
    await appxPhase('../inert-without-workspace', true);
    expect(await readdir(root)).toEqual([]);
    vi.stubEnv('SP_APPX_DIAGNOSTIC_ROOT', root);
    vi.stubEnv('GITHUB_ACTIONS', 'false');
    await expect(appxPhase('refused')).rejects.toThrow(
      'APPX_DIAGNOSTIC_RUNNER_REQUIRED',
    );
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('RUNNER_OS', 'Windows');
    await expect(appxPhase('../refused')).rejects.toThrow(
      'APPX_DIAGNOSTIC_PHASE_REFUSED',
    );
    const child = join(root, 'child');
    await mkdir(join(child, 'evidence'), { recursive: true });
    setProofWorkspace(child);
    await appxPhase('generated-parent');
    await appxPhase('generated-child', true);
    const parentFiles = (await readdir(root)).filter((name) =>
      name.endsWith('.json'),
    );
    const childFiles = await readdir(join(child, 'evidence'));
    expect(parentFiles).toHaveLength(1);
    expect(childFiles).toHaveLength(1);
    expect(
      JSON.parse(
        await readFile(join(child, 'evidence', childFiles[0]!), 'utf8'),
      ),
    ).toMatchObject({
      diagnosticOnly: true,
      acceptanceProof: false,
      phase: 'generated-child',
    });
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

test('readout distinguishes initial presence, idle appearance, product overlap and observation gaps', () => {
  const row = {
    key: 'generated',
    count: 1,
    row: { package: 'NarratorQuickStart', owner: 'system' },
  };
  const initial = {
    kind: 'firewall',
    at: 10,
    endedAt: 20,
    initial: true,
    changes: [],
  };
  const appeared = {
    kind: 'firewall',
    at: 100,
    endedAt: 110,
    initial: false,
    changes: [{ reason: 'added', entry: row }],
  };
  const idle = appxReadout([initial, appeared], [], 'idle');
  expect(idle.firstProductStep).toBeNull();
  expect(idle.packages[0]?.appearedWithoutProduct).toBe(
    'yes-during-observation-or-already-present',
  );
  expect(idle.appearances[0]).toMatchObject({
    intervalStart: 10,
    intervalEnd: 110,
    beforeFirstProduct: 'no-product-step-in-arm',
  });
  expect(
    appxReadout(
      [initial, appeared],
      [{ phase: 'desktop-build-start', at: 200 }],
      'installed',
    ).appearances[0]?.beforeFirstProduct,
  ).toBe('yes');
  expect(
    appxReadout(
      [initial, appeared],
      [{ phase: 'restricted-launch', at: 50 }],
      'restricted',
    ).appearances[0]?.beforeFirstProduct,
  ).toBe('interval-overlaps-product-step');
  expect(
    appxReadout(
      [initial, { kind: 'observation-error', at: 25, operation: 'firewall' }],
      [],
      'idle',
    ).packages[0]?.appearedWithoutProduct,
  ).toBe('unknown-observation-gap');
  expect(
    appxReadout(
      [{ ...initial, changes: [{ reason: 'added', entry: row }] }],
      [],
      'idle',
    ).packages[0]?.initialCount,
  ).toBe(1);
  expect(
    idle.history.runs.filter((run) => run.outcome === 'success'),
  ).toHaveLength(3);
});

test('inbox, SocialPrune, folder-named and unknown added or removed firewall groups all remain failures', () => {
  const empty: SystemSnapshot = {
    version: 2,
    services: [],
    tasks: [],
    runKeys: [],
    firewall: [],
    listeners: [],
    startup: [],
  };
  for (const name of [
    'Microsoft.Windows.NarratorQuickStart_10.0.26100.1',
    'Microsoft.WindowsFeedbackHub_1.2512.16303.0',
    'SocialPrune',
    'generated-program-folder',
    'unknown-owner',
  ]) {
    const row = {
      name,
      count: 1,
      strict: false,
      appReference: name === 'SocialPrune',
      fields: {},
    };
    const added = { ...empty, firewall: [row] };
    expect(compareSystemSnapshots(empty, added)).toEqual({
      failures: [{ inventory: 'firewall', name, fields: [], reason: 'added' }],
      diagnostics: [],
    });
    expect(compareSystemSnapshots(added, empty).failures[0]?.reason).toBe(
      'removed',
    );
  }
});

test('only the exact diagnostic PR branch admits the three fresh-VM arms, never other PRs or acceptance CI', async () => {
  const workflow = await readFile(
    join(directory, '../../.github/workflows/desktop-appx-diagnose.yml'),
    'utf8',
  );
  const config = parse(workflow) as {
    on: object;
    jobs: {
      observe: {
        if: string;
        'timeout-minutes': number;
        strategy: { matrix: { arm: string[] } };
      };
    };
  };
  expect(Object.keys(config.on)).toEqual(['pull_request']);
  expect(config.jobs.observe.if).toBe(
    "github.head_ref == 'diag/appx-firewall'",
  );
  for (const head of [
    'main',
    'wave/7',
    'diag/appx-firewall-extra',
    'foreign/diag/appx-firewall',
  ])
    expect(head === 'diag/appx-firewall').toBe(false);
  expect(config.jobs.observe.strategy.matrix.arm).toEqual([
    'idle',
    'restricted',
    'installed',
  ]);
  expect(config.jobs.observe['timeout-minutes']).toBe(30);
  const source = await readFile(
    join(directory, 'e2e/appx-diagnose.ts'),
    'utf8',
  );
  expect(source).toContain('acceptanceProof: false');
  expect(source).toContain('APPX_DIAGNOSTIC_PROOF_FAILED');
  expect(source).toContain('limited-token.ps1');
  expect(source).not.toMatch(
    /diagnose-launch|DiagnosticVariant|compareSystemSnapshots/,
  );
  const observer = await readFile(
    join(directory, 'e2e/appx-observe.ps1'),
    'utf8',
  );
  expect(observer).not.toMatch(
    /(?:Add|Remove|Set|Register|Enable|Disable)-(?:AppxPackage|NetFirewallRule|WinEvent)|\.Rules\.(?:Add|Remove)|wevtutil\s+sl/i,
  );
  expect(observer).toContain('APPX_DIAGNOSTIC_RUNNER_REQUIRED');
  expect(observer).toContain('observation-error');
  expect(observer).toContain('installTime=');
  const ci = await readFile(
    join(directory, '../../.github/workflows/ci.yml'),
    'utf8',
  );
  expect(ci).not.toContain('appx-diagnose');
  expect(ci).not.toContain('SP_APPX_DIAGNOSTIC_ROOT');
  for (const file of [
    'src/main/index.ts',
    'packaging/release.ts',
    'packaging/package.ts',
  ]) {
    const entry = await readFile(join(directory, file), 'utf8');
    expect(entry).not.toMatch(/appx-(?:phase|diagnose|observe|readout)/);
  }
});

test.skipIf(process.platform !== 'win32')(
  'the observer parses and refuses workstation execution before any Windows inventory read',
  async () => {
    const source = join(directory, 'e2e/appx-observe.ps1');
    const result = await runPowerShell(
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$tokens=$null; $errors=$null; [void][Management.Automation.Language.Parser]::ParseFile('${source.replaceAll("'", "''")}',[ref]$tokens,[ref]$errors); if($errors.Count){throw "APPX_PARSE_FAILED"}; "APPX_PARSE_OK"`,
      ],
      { timeout: WINDOWS_QUERY_TIMEOUT_MS, windowsHide: true },
    );
    expect(result.stdout).toContain('APPX_PARSE_OK');
    await expect(
      runPowerShell(
        ['-NoProfile', '-NonInteractive', '-File', source, '-Seconds', '1'],
        {
          timeout: WINDOWS_QUERY_TIMEOUT_MS,
          windowsHide: true,
          env: testEnvironment({ GITHUB_ACTIONS: 'false' }),
        },
      ),
    ).rejects.toMatchObject({ code: 1 });
  },
  WINDOWS_QUERY_TIMEOUT_MS * 2 + 1000,
);

test.skipIf(process.platform !== 'win32')(
  'observer executes against generated cmdlet and COM inputs without reading the workstation stores',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'socialprune-appx-observer-'));
    try {
      const source = await readFile(
        join(directory, 'e2e/appx-observe.ps1'),
        'utf8',
      );
      const release =
        '[void][Runtime.InteropServices.Marshal]::ReleaseComObject($policy)';
      expect(source.split(release)).toHaveLength(2);
      const fixture = join(root, 'generated.ps1');
      await writeFile(
        fixture,
        `
function New-Object([string]$ComObject) { if($ComObject -cne 'HNetCfg.FwPolicy2'){throw 'GENERATED_COM_REFUSED'}; [pscustomobject]@{Rules=@([pscustomobject]@{Name='Microsoft.Windows.NarratorQuickStart-generated';ApplicationName='';LocalUserOwner='S-1-5-18';Direction=1;Protocol=6;Action=1;Enabled=$true;Profiles=7})} }
function Get-CimInstance([string]$ClassName) { switch($ClassName) { 'Win32_OperatingSystem' {[pscustomobject]@{LastBootUpTime=[DateTime]::UtcNow}} 'Win32_Process' {[pscustomobject]@{ProcessId=42;ParentProcessId=1;SessionId=2;CreationDate=[DateTime]::UtcNow;ExecutablePath='';Name='generated.exe'}} 'Win32_LogonSession' {[pscustomobject]@{LogonId='42';LogonType=2;StartTime=[DateTime]::UtcNow;AuthenticationPackage='generated'}} default {throw 'GENERATED_CIM_REFUSED'} } }
function Get-AppxPackage([switch]$AllUsers,[string]$Name) { [pscustomobject]@{Name=$Name;PackageFullName=$Name+'-generated';PackageFamilyName=$Name+'-generated';PublisherId='generated';SignatureKind='System';Status='Ok';PackageUserInformation=@()} }
function Get-WinEvent($ListLog,$FilterHashtable,$MaxEvents) { if($ListLog){return [pscustomobject]@{IsEnabled=$true}}; $event=[pscustomobject]@{Id=2004;RecordId=42;TimeCreated=[DateTime]::UtcNow}; $event|Add-Member ScriptMethod ToXml {'<Event><System><Execution ProcessID="42"/><Correlation ActivityID="generated"/></System><EventData><Data Name="ProcessId">42</Data><Data Name="RuleName">Microsoft.Windows.NarratorQuickStart-generated</Data></EventData></Event>'}; $event }
& {
${source.replace(release, '$script:generatedComReleased=$true')}
} -Seconds 1
if(-not $script:generatedComReleased){throw 'GENERATED_COM_NOT_RELEASED'}
`,
      );
      const { stdout } = await runPowerShell(
        ['-NoProfile', '-NonInteractive', '-File', fixture],
        {
          timeout: WINDOWS_QUERY_TIMEOUT_MS,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
          env: testEnvironment({
            GITHUB_ACTIONS: 'true',
            RUNNER_OS: 'Windows',
          }),
        },
      );
      const rows = stdout
        .trim()
        .split(/\r?\n/)
        .map(
          (line) =>
            JSON.parse(line) as { kind: string; [key: string]: unknown },
        );
      expect(rows.filter((row) => row.kind === 'observation-error')).toEqual(
        [],
      );
      expect(rows).toContainEqual(
        expect.objectContaining({
          kind: 'settled',
          diagnosticOnly: true,
          acceptanceProof: false,
        }),
      );
      const firewall = rows.find((row) => row.kind === 'firewall');
      expect(firewall).toMatchObject({
        initial: true,
        rules: 1,
        changes: [
          {
            reason: 'added',
            entry: { row: { package: 'NarratorQuickStart', owner: 'system' } },
          },
        ],
      });
      expect(rows.find((row) => row.kind === 'event')).toMatchObject({
        pid: '42',
        fields: [
          expect.objectContaining({ number: '42' }),
          expect.objectContaining({ package: 'NarratorQuickStart' }),
        ],
      });
      expect(stdout).not.toContain('RuleName":"Microsoft.Windows');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  WINDOWS_QUERY_TIMEOUT_MS + 1000,
);
