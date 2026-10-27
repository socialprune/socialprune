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
    expect(install).toContain('for duration in 16m 10m; do');
    expect(install).toContain(
      `timeout --signal=TERM --kill-after=30s "$duration" pnpm --filter ${filter} exec playwright install-deps chromium firefox webkit`,
    );
    expect(install).toContain(
      'if [ "$attempt" -eq 2 ]; then exit "$status"; fi',
    );
    expect(install).toContain(
      'timeout --signal=TERM --kill-after=10s 60s sudo dpkg --configure -a',
    );
    expect(install).not.toMatch(
      /continue-on-error|\|\| true|--allow-unauthenticated|trusted=yes/,
    );
    // The first attempt encloses the measured 14m09s successful install.
    // 16m + 10m + two 30s kill allowances + 70s dpkg + 10s pause < 30m.
    expect((16 + 10) * 60 + 2 * 30 + 60 + 10 + 10).toBeLessThan(30 * 60);
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
