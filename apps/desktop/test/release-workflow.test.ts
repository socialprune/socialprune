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

test('desktop CI automatically selects budget mode and publishes medians, using a digest-keyed archive cache', async () => {
  const source = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8');
  const desktop = source.slice(source.indexOf('  desktop:'));
  expect(desktop).not.toContain('--measure');
  expect(desktop).toContain('smoke:release');
  expect(desktop).toContain('release-smoke.json');
  expect(desktop).toContain('release-medians.json');
  expect(desktop).toMatch(/actions\/cache@[a-f0-9]{40} # v4\.2\.4/);
  expect(desktop).toContain('nsis-version.ts');
  const manifest = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };
  expect(manifest.scripts['smoke:desktop:release']).toContain(
    '--require-budgets',
  );
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
