import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parseDocument } from 'yaml';
import { root, directory } from '../packaging/paths.ts';
import { inspectText } from '../../../tools/copy-check/src/index.ts';

test('release workflow parses offline, is manual only and pins every action', async () => {
  const source = await readFile(
    join(root, '.github/workflows/release-desktop.yml'),
    'utf8',
  );
  const parsed = parseDocument(source);
  expect(parsed.errors).toEqual([]);
  const workflow = parsed.toJS() as {
    on: {
      workflow_dispatch: {
        inputs?: object;
      } | null;
    };
    jobs: Record<
      string,
      {
        if?: string;
        'runs-on': string;
        steps: { uses?: string; if?: string; run?: string }[];
      }
    >;
  };
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
  expect(workflow.on.workflow_dispatch?.inputs).toBeUndefined();
  for (const job of Object.values(workflow.jobs)) {
    expect(job['runs-on']).toBe('windows-latest');
    for (const step of job.steps)
      if (step.uses) {
        expect(step.uses).toMatch(/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
        expect(source).toMatch(
          new RegExp(step.uses + ' # v\\d+\\.\\d+\\.\\d+'),
        );
      }
  }
  const build = workflow.jobs['build-and-smoke']!;
  const guide = build.steps.findIndex((step) =>
    step.run?.includes('guide:check --max-age 120 --release'),
  );
  const packaging = build.steps.findIndex(
    (step) => step.run === 'pnpm release:desktop',
  );
  expect(guide).toBeGreaterThan(-1);
  expect(guide).toBeLessThan(packaging);
  expect(build.steps[guide]!.run).toContain('--release');
  expect(build.steps[guide]!.if).toBeUndefined();
  expect(build.if).not.toContain('refs/heads/main');
  expect(source).not.toContain('inputs.measure');
  expect(source).not.toContain('--measure');
  expect(
    build.steps.find((step) => step.if?.includes("SIGNPATH_ENABLED == 'true'"))
      ?.run,
  ).toContain('throw');
  const release = workflow.jobs['draft-release']!;
  expect(release.if).toContain("DESKTOP_RELEASE_ENABLED == 'true'");
  expect(release.if).toContain("github.ref == 'refs/heads/main'");
  expect(release.if).not.toContain('inputs.measure');
  expect(release.steps.at(-1)!.run).toContain('--draft');
  expect(release.steps.at(-1)!.run).toContain('gh release view');
  expect(release.steps.at(-1)!.run).toContain('download-notice.de.md');
  expect(release.steps.at(-1)!.run).toContain('## Deutsch');
  expect(release.steps.at(-1)!.run).toContain('asset.digest');
  expect(
    workflow.jobs.attest!.steps.some((step) =>
      step.uses?.startsWith('actions/attest-build-provenance@'),
    ),
  ).toBe(true);
  expect(source).not.toMatch(/secrets\.|SIGNPATH_API|signtool sign|schedule:/);
});

test('desktop CI enforces runner budgets and publishes medians, using a digest-keyed archive cache', async () => {
  const source = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8');
  const desktop = source.slice(source.indexOf('  desktop:'));
  expect(desktop).not.toContain('--measure');
  expect(desktop).toContain('pnpm smoke:desktop:release');
  expect(desktop).not.toContain(
    'pnpm --filter @socialprune/desktop smoke:release',
  );
  expect(desktop).toContain('release-smoke.json');
  expect(desktop).toContain('release-medians.json');
  expect(desktop).toMatch(/actions\/cache@[a-f0-9]{40} # v4\.2\.4/);
  expect(desktop).toContain('nsis-version.ts');
  const workflow = parseDocument(source).toJS() as {
    jobs: {
      desktop: {
        steps: {
          uses?: string;
          if?: string;
          name?: string;
          id?: string;
          run?: string;
          with?: Record<string, unknown>;
        }[];
      };
    };
  };
  const evidence = workflow.jobs.desktop.steps.find(
    (step) => step.with?.name === 'desktop-installed-measurements',
  );
  expect(evidence?.if).toBe('always()');
  expect(evidence?.with?.['if-no-files-found']).toBe('warn');
  const steps = workflow.jobs.desktop.steps;
  const pin = steps.findIndex((step) => step.id === 'nsis');
  const cache = steps.findIndex(
    (step) => step.with?.path === 'apps/desktop/dist/nsis-3.13.zip',
  );
  const verify = steps.findIndex(
    (step) => step.run === 'node apps/desktop/packaging/nsis-cache.ts',
  );
  const units = steps.findIndex((step) =>
    step.run?.includes('vitest run --project desktop'),
  );
  expect(pin).toBeGreaterThan(0);
  expect(cache).toBeGreaterThan(pin);
  expect(verify).toBeGreaterThan(cache);
  expect(units).toBeGreaterThan(verify);
  expect(steps[verify]?.if).toBeUndefined(); // A cache hit still verifies the digest.
  expect(steps[cache]?.with?.key).toBe('nsis-${{ steps.nsis.outputs.sha256 }}');
  expect(steps.filter((step) => step.id === 'nsis')).toHaveLength(1);
  const manifest = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };
  expect(manifest.scripts['smoke:desktop:release']).toContain(
    '--require-budgets',
  );
  expect(manifest.scripts['smoke:desktop:release']).toBe(
    'pnpm --filter @socialprune/desktop run smoke:release --require-budgets',
  );
  const packageManifest = JSON.parse(
    await readFile(join(directory, 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };
  expect(packageManifest.scripts['smoke:release']).toBe(
    'node e2e/installed-proof.ts smoke',
  );
});

test('Linux browser jobs bound the measured apt bottleneck separately from browser downloads and leave time for tests', async () => {
  const source = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8');
  const parsed = parseDocument(source);
  expect(parsed.errors).toEqual([]);
  const workflow = parsed.toJS() as {
    jobs: Record<
      string,
      {
        'timeout-minutes': number;
        steps: {
          name?: string;
          run?: string;
          uses?: string;
          shell?: string;
          'timeout-minutes'?: number;
        }[];
      }
    >;
  };
  for (const [name, filter, minutes] of [
    ['e2e', '@socialprune/web', 60],
    ['review-e2e', 'socialprune', 40],
    ['e2e-layout', '@socialprune/web', 60],
    ['e2e-builds', '@socialprune/web', 50],
  ] as const) {
    const job = workflow.jobs[name]!;
    expect(job['timeout-minutes']).toBe(minutes);
    const dependencies = job.steps.findIndex(
      (step) => step.name === 'Install browser system dependencies',
    );
    const browsers = job.steps.findIndex(
      (step) => step.name === 'Install pinned browsers',
    );
    expect(dependencies).toBeGreaterThan(0);
    expect(browsers).toBe(dependencies + 1);
    expect(job.steps[dependencies]).toMatchObject({
      'timeout-minutes': 30,
      shell: 'bash',
    });
    const install = job.steps[dependencies]!.run!;
    const guardPath = '.github/scripts/playwright-deps.py';
    expect(install).toContain(`sudo python3 -B ${guardPath}`);
    expect(install).toContain('--node "$(command -v node)" --cli "$cli"');
    const guard = await readFile(join(root, guardPath), 'utf8');
    const bounds = JSON.parse(guard.match(/^BOUNDS = (\{[^\n]+\})$/m)![1]!) as {
      installSeconds: number[];
      lockSeconds: number;
      probeSeconds: number;
      recoverySeconds: number;
      terminateSeconds: number;
      reapSeconds: number;
      pollSeconds: number;
      pauseSeconds: number;
      totalSeconds: number;
    };
    expect(bounds.installSeconds.length).toBeGreaterThan(0);
    expect(bounds.installSeconds.length).toBeLessThanOrEqual(2);
    for (const value of [
      ...bounds.installSeconds,
      bounds.lockSeconds,
      bounds.probeSeconds,
      bounds.recoverySeconds,
      bounds.terminateSeconds,
      bounds.reapSeconds,
      bounds.pollSeconds,
      bounds.totalSeconds,
    ])
      expect(value).toBeGreaterThan(0);
    expect(bounds.pauseSeconds).toBe(0);
    const attempts = bounds.installSeconds.length;
    const recoveries = attempts - 1;
    const commands = attempts + recoveries;
    const cleanup =
      bounds.terminateSeconds + bounds.reapSeconds + bounds.pollSeconds;
    const nominal =
      bounds.installSeconds.reduce((sum, seconds) => sum + seconds, 0) +
      (attempts + recoveries) * (bounds.lockSeconds + bounds.probeSeconds) +
      recoveries * (bounds.recoverySeconds + bounds.pauseSeconds) +
      commands * cleanup;
    // The shared deadline truncates later allowances; include the last probe
    // and cleanup overrun instead of assuming every nominal maximum can fit.
    const worstCase = Math.min(
      nominal,
      bounds.totalSeconds + bounds.probeSeconds + cleanup,
    );
    const stepSeconds = job.steps[dependencies]!['timeout-minutes']! * 60;
    expect(worstCase).toBeLessThan(stepSeconds);
    expect(
      stepSeconds + job.steps[browsers]!['timeout-minutes']! * 60,
    ).toBeLessThan(job['timeout-minutes'] * 60);
    expect(guard).toContain("enumerate(BOUNDS['installSeconds'], 1)");
    expect(guard).toContain("deadline = clock() + BOUNDS['totalSeconds']");
    expect(guard).toContain('min(allowance, remaining)');
    expect(guard).toContain("min(BOUNDS['recoverySeconds'], remaining)");
    expect(guard).toContain(
      "if attempt == len(BOUNDS['installSeconds']):\n            raise RuntimeError('APT_INSTALL_FAILED')",
    );
    expect(guard).toContain('raise SystemExit(1)');
    expect(guard).toContain('child.wait(timeout=seconds)');
    expect(guard).toContain("timeout=BOUNDS['probeSeconds']");
    expect(guard).toContain("clock() + BOUNDS['lockSeconds']");
    expect(guard).toContain("time.sleep(BOUNDS['terminateSeconds'])");
    expect(guard).toContain(
      "deadline = time.monotonic() + BOUNDS['reapSeconds']",
    );
    expect(guard).toContain("child.wait(timeout=BOUNDS['reapSeconds'])");
    expect(guard).toContain("raise RuntimeError('APT_CLEANUP_TIMEOUT')");
    expect(guard).toContain(
      "path.write_text('https://archive.ubuntu.com/ubuntu/\\n')",
    );
    expect(guard).not.toMatch(/path\.write_text\(['"]http:/);
    expect(guard.match(/path\.write_text\(/g)).toHaveLength(1);
    expect(
      install + guard + JSON.stringify(job.steps[dependencies]),
    ).not.toMatch(
      /continue-on-error|\|\| true|--allow-unauthenticated|trusted=yes|AllowUnauthenticated|AllowInsecureRepositories|Check-Valid-Until|--no-check-certificate/,
    );
    expect(job.steps[browsers]).toMatchObject({
      'timeout-minutes': 5,
      run: `pnpm --filter ${filter} exec playwright install chromium firefox webkit`,
    });
    expect(job['timeout-minutes'] - 30 - 5).toBeGreaterThanOrEqual(5);
    expect(job.steps.some((step) => step.run?.includes('--with-deps'))).toBe(
      false,
    );
    for (const step of job.steps)
      if (step.uses) expect(step.uses).toMatch(/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
  }
});

test('German temp notice uses the second-person verb and the license asset names NSIS', async () => {
  const german = await readFile(
    join(directory, 'packaging/download-notice.de.md'),
    'utf8',
  );
  expect(german).toContain('entfernst');
  const release = await readFile(
    join(directory, 'packaging/release.ts'),
    'utf8',
  );
  expect(release).toContain('NSIS-NOTICE.txt');
});

test('download notice preserves ADR English text and exact German Windows labels', async () => {
  const adr = await readFile(
    join(root, 'docs/architecture/adrs/ADR-031-desktop-app.md'),
    'utf8',
  );
  const paragraph = adr
    .split('\n')
    .find((line) => line.startsWith('> Windows shows'))!
    .slice(2);
  const english = await readFile(
    join(directory, 'packaging/download-notice.en.md'),
    'utf8',
  );
  const german = await readFile(
    join(directory, 'packaging/download-notice.de.md'),
    'utf8',
  );
  expect(english.split('\n')[0]).toBe(paragraph);
  for (const label of [
    'Der Computer wurde durch Windows geschützt',
    'Weitere Informationen',
    'Trotzdem ausführen',
  ])
    expect(german).toContain(label);
  for (const text of [english, german]) {
    expect(inspectText(text)).toEqual([]);
    expect(text).toContain('SHA256SUMS.txt');
    expect(text).toContain('gh attestation verify');
  }
});

test('MSIX template declares only desktop full trust and no startup or service extensions', async () => {
  const xml = await readFile(
    join(directory, 'packaging/AppxManifest.xml'),
    'utf8',
  );
  expect(xml.match(/\{\{VERSION\}\}/g)).toHaveLength(1);
  expect(xml).toContain(
    'xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"',
  );
  expect(xml).toContain('EntryPoint="Windows.FullTrustApplication"');
  expect(xml).toContain('ProcessorArchitecture="x64"');
  expect(xml).toContain('<Resource Language="de-de"');
  expect(xml).toContain('<rescap:Capability Name="runFullTrust"');
  expect(xml).not.toMatch(
    /startupTask|Service|internetClient|unvirtualizedResources|FileSystemWriteVirtualization/,
  );
});
