import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { directory, root } from '../packaging/paths.ts';

const planted = {
  repo: 'D:/a/generated-project/generated-project',
  temp: 'C:/Users/Generated Person/AppData/Local/Temp',
  home: 'C:/Users/Generated Person',
};

async function diagnostics() {
  // The old module runs controls on import. Fail before importing it until the
  // implementation exposes the guarded, dependency-injected wrapper.
  expect(
    await readFile(join(directory, 'packaging/red-controls.ts'), 'utf8'),
  ).toContain('export async function runRedControl(');
  return import('../packaging/red-controls.ts');
}

const beforeDecoy = `  5) test\\red\\renderer.spec.ts:5:3 > RED planted node must fail the acceptance observer
    Error: electron.launch: Timeout 30000ms exceeded.
        at launch (D:/a/generated-project/generated-project/apps/desktop/e2e/helpers.ts:53:10)
  7 failed
`;
const differentAssertion = `  5) test\\red\\renderer.spec.ts:5:3 > RED planted node must fail the acceptance observer
    AssertionError: Expected values to be strictly deep-equal:
    + bridge: []
        at assertRenderer (D:/a/generated-project/generated-project/apps/desktop/test/controls.ts:13:10)
        at exerciseControl (D:/a/generated-project/generated-project/apps/desktop/e2e/controls.spec.ts:54:16)
  7 failed
`;
const cleanup = `  5) test\\red\\renderer.spec.ts:5:3 > RED planted node must fail the acceptance observer
    Error: EBUSY: resource busy, rmdir 'C:\\Users\\Generated Person\\AppData\\Local\\Temp\\generated-proof'
        at async Object.close (D:/a/generated-project/generated-project/apps/desktop/e2e/helpers.ts:91:10)
        at async exerciseControl (D:/a/generated-project/generated-project/apps/desktop/e2e/controls.spec.ts:103:5)
  7 failed
`;
const unknown = `  5) test\\red\\renderer.spec.ts:5:3 > RED planted node must fail the acceptance observer
    Error: worker exited without an error record
  7 failed
`;

test('excerpts redact planted profile and runner paths before bounding lines and columns', async () => {
  const { controlOutputExcerpt } = await diagnostics();
  const input = [
    'discard this old line',
    ...Array.from({ length: 196 }, (_, index) => `generated line ${index}`),
    '\u001b[31mC:\\Users\\Generated Person\\notes.txt\u001b[0m',
    'file:///D:/a/generated-project/generated-project/apps/desktop/test.ts:9:1',
    'c:\\users\\generated person\\appdata\\local\\temp\\probe.txt',
    'x'.repeat(900),
  ].join('\r\n');
  const excerpt = controlOutputExcerpt(input, planted);
  expect(excerpt).toHaveLength(200);
  expect(excerpt).not.toContain('discard this old line');
  expect(excerpt.every((line) => line.length <= 400)).toBe(true);
  expect(excerpt.slice(-4)).toEqual([
    '<home>/notes.txt',
    '<repo>/apps/desktop/test.ts:9:1',
    '<temp>/probe.txt',
    'x'.repeat(400),
  ]);
  for (const forbidden of [
    'Generated Person',
    'generated person',
    'D:/a/',
    '\u001b',
  ])
    expect(excerpt.join('\n')).not.toContain(forbidden);
});

test('excerpts classify foreign runner/profile roots, escaped paths and file URLs without reading them', async () => {
  const { controlOutputExcerpt } = await diagnostics();
  const excerpt = controlOutputExcerpt(
    [
      'C:\\\\Users\\\\GeneratedOther\\\\file.txt',
      'file:///C:/Users/GeneratedOther/file.txt',
      'D:\\a\\foreign-project\\foreign-project\\apps\\desktop\\test.ts:1:2',
      '/home/generated-runner/work/foreign-project/foreign-project/apps/desktop/test.ts',
      '/home/generated-runner/work/_temp/step.txt',
      '/home/generated-runner/private.txt',
      '/Users/GeneratedMac/private.txt',
      'C:/Users/GeneratedOther/AppData/Local/Temp/probe.txt',
      'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\step.txt',
      'file:///C:/Users/Generated%20Other/profile.txt',
      'D:/a/_temp/step.txt',
    ].join('\n'),
    planted,
  );
  expect(excerpt).toEqual([
    '<home>/file.txt',
    '<home>/file.txt',
    '<repo>/apps/desktop/test.ts:1:2',
    '<repo>/apps/desktop/test.ts',
    '<temp>/step.txt',
    '<home>/private.txt',
    '<home>/private.txt',
    '<temp>/probe.txt',
    '<temp>/step.txt',
    '<home>/profile.txt',
    '<temp>/step.txt',
  ]);
  for (const forbidden of [
    'GeneratedOther',
    'generated-runner',
    'GeneratedMac',
    'foreign-project',
  ])
    expect(excerpt.join('\n')).not.toContain(forbidden);
});

test.each([
  ['failed-before-decoy', beforeDecoy],
  ['different-assertion', differentAssertion],
  ['cleanup-replaced-assertion', cleanup],
  ['unknown', unknown],
] as const)(
  'output identifies %s without assuming that a failed test reached its decoy',
  async (branch, output) => {
    const { classifyControlFailure } = await diagnostics();
    expect(classifyControlFailure(output, ["process: 'object'"])).toBe(branch);
  },
);

test('classification ignores expected lifecycle assertions and source snippets of unexecuted steps', async () => {
  const { classifyControlFailure } = await diagnostics();
  const lifecycle = `  3) test\\red\\lifecycle.spec.ts:10:1 > RED planted live PID must fail process cleanup check
    AssertionError: BROWSER_PROCESS_REMAINS
        at assertNoRemainingProcesses (D:/a/generated-project/generated-project/apps/desktop/test/windows.ts:115:10)
`;
  expect(
    classifyControlFailure(lifecycle + beforeDecoy, ["process: 'object'"]),
  ).toBe('failed-before-decoy');
  expect(
    classifyControlFailure(
      unknown + '\n  103 | await app.close();\n  104 | // plant Node decoy\n',
      ["process: 'object'"],
    ),
  ).toBe('unknown');
  expect(classifyControlFailure(lifecycle, ["process: 'object'"])).toBe(
    'unknown',
  );
  expect(classifyControlFailure(differentAssertion, [])).toBe('unknown');
  expect(classifyControlFailure(cleanup, [])).toBe(
    'cleanup-replaced-assertion',
  );
});

test('a timed-out navigation and cleanup after an assertion take their branch from executed frames', async () => {
  const { classifyControlFailure } = await diagnostics();
  const navigation = beforeDecoy.replace(
    'electron.launch: Timeout 30000ms exceeded.',
    'expect(locator).toBeVisible() failed: Timeout 10000ms exceeded.',
  );
  expect(classifyControlFailure(navigation, ["process: 'object'"])).toBe(
    'failed-before-decoy',
  );
  expect(
    classifyControlFailure(differentAssertion + cleanup, ["process: 'object'"]),
  ).toBe('cleanup-replaced-assertion');
});

test.each([
  ['missing-evidence', 1, beforeDecoy, 'failed-before-decoy'],
  ['unexpected-exit', 0, differentAssertion, 'different-assertion'],
  ['cleanup-exception', 1, cleanup, 'cleanup-replaced-assertion'],
] as const)(
  'a rejected %s preserves full output and emits a bounded, redacted JSON record and excerpt',
  async (_name, exit, output, branch) => {
    const { runRedControl } = await diagnostics();
    const scratch = await mkdtemp(join(tmpdir(), 'socialprune-red-output-'));
    try {
      const entry = join(scratch, 'generated.mjs');
      await writeFile(
        entry,
        `process.stderr.write(${JSON.stringify(output)}); process.exitCode=${exit};`,
      );
      const stderr: string[] = [];
      const stdout: string[] = [];
      await expect(
        runRedControl(
          {
            name: 'generated',
            entry,
            args: [],
            evidence: ["process: 'object'"],
          },
          {
            outputDirectory: scratch,
            paths: planted,
            stderr: (value) => {
              stderr.push(value);
            },
            stdout: (value) => {
              stdout.push(value);
            },
          },
        ),
      ).rejects.toThrow(exit === 1 ? 'missing' : 'expected assertion failure');
      expect(await readFile(join(scratch, 'generated.txt'), 'utf8')).toBe(
        output,
      );
      const record: unknown = JSON.parse(stderr.join('').split('\n')[0]!);
      expect(record).toMatchObject({
        control: 'generated',
        state: 'failed',
        branch,
        exitCode: exit,
        expectedExit: 1,
        missingEvidence: ["process: 'object'"],
        outputSaved: true,
      });
      expect(
        JSON.parse(
          await readFile(join(scratch, 'generated.failure.json'), 'utf8'),
        ),
      ).toEqual(record);
      expect(stderr.join('')).toContain('RED_CONTROL_OUTPUT_BEGIN');
      expect(stderr.join('')).toContain('RED_CONTROL_OUTPUT_END');
      expect(stderr.join('')).not.toContain('Generated Person');
      expect(stderr.join('')).not.toContain('D:/a/');
      expect(stdout).toEqual([]);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
);

test('any wrapper exception retains its original identity and durable diagnostic output', async () => {
  const { runRedControl } = await diagnostics();
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-red-exception-'));
  try {
    const entry = join(scratch, 'generated.mjs');
    await writeFile(
      entry,
      'console.log("GENERATED_ASSERTION"); process.exitCode=1;',
    );
    const failure = new Error('C:/Users/Generated Person/report failed');
    const stderr: string[] = [];
    await expect(
      runRedControl(
        {
          name: 'generated',
          entry,
          args: [],
          evidence: ['GENERATED_ASSERTION'],
        },
        {
          outputDirectory: scratch,
          paths: planted,
          stdout: () => {
            throw failure;
          },
          stderr: (value) => {
            stderr.push(value);
          },
        },
      ),
    ).rejects.toBe(failure);
    expect(await readFile(join(scratch, 'generated.txt'), 'utf8')).toBe(
      'GENERATED_ASSERTION\n',
    );
    expect(stderr.join('')).toContain('<home>/report failed');
    expect(stderr.join('')).not.toContain('Generated Person');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('diagnostic stderr failure is recorded without replacing the original rejection', async () => {
  const { runRedControl } = await diagnostics();
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-red-stderr-'));
  try {
    const entry = join(scratch, 'generated.mjs');
    await writeFile(
      entry,
      'console.log("GENERATED_ASSERTION"); process.exitCode=0;',
    );
    await expect(
      runRedControl(
        {
          name: 'generated',
          entry,
          args: [],
          evidence: ['GENERATED_ASSERTION'],
        },
        {
          outputDirectory: scratch,
          paths: planted,
          stderr: () => {
            throw new Error('C:/Users/Generated Person/stderr failed');
          },
        },
      ),
    ).rejects.toThrow('expected assertion failure');
    const receipt = await readFile(
      join(scratch, 'generated.failure.json'),
      'utf8',
    );
    expect(JSON.parse(receipt)).toMatchObject({
      exitCode: 0,
      branch: 'unknown',
      outputSaved: true,
      diagnosticWriteError: 'Error: <home>/stderr failed',
    });
    expect(receipt).not.toContain('Generated Person');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('an unavailable output folder still prints diagnostics and the original filesystem rejection', async () => {
  const { runRedControl } = await diagnostics();
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-red-save-'));
  try {
    const folder = join(scratch, 'not-a-directory');
    await writeFile(folder, 'generated obstruction');
    const stderr: string[] = [];
    await expect(
      runRedControl(
        {
          name: 'generated',
          entry: 'never-started.mjs',
          args: [],
          evidence: ['GENERATED_ASSERTION'],
        },
        {
          outputDirectory: folder,
          stderr: (value) => {
            stderr.push(value);
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(JSON.parse(stderr.join('').split('\n')[0]!)).toMatchObject({
      state: 'failed',
      branch: 'unknown',
      exitCode: null,
      outputSaved: false,
    });
    expect(stderr.join('')).toContain('RED_CONTROL_OUTPUT_BEGIN');
    expect(stderr.join('')).not.toContain(scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('the wrapper drains piped output before judging its final evidence', async () => {
  const { runRedControl } = await diagnostics();
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-red-drain-'));
  try {
    const entry = join(scratch, 'generated.mjs');
    const output = 'x'.repeat(200_000) + '\nFINAL_GENERATED_ASSERTION\n';
    await writeFile(
      entry,
      `process.stdout.write(${JSON.stringify(output)}); process.exitCode=1;`,
    );
    await runRedControl(
      {
        name: 'generated',
        entry,
        args: [],
        evidence: ['FINAL_GENERATED_ASSERTION'],
      },
      { outputDirectory: scratch, stdout: () => undefined },
    );
    expect(await readFile(join(scratch, 'generated.txt'), 'utf8')).toBe(output);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('successful evidence keeps the existing pass condition and success record without diagnostics', async () => {
  const { runRedControl } = await diagnostics();
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-red-pass-'));
  try {
    const entry = join(scratch, 'generated.mjs');
    await writeFile(
      entry,
      'console.log("GENERATED_ASSERTION"); process.exitCode=1;',
    );
    const stderr: string[] = [];
    const stdout: string[] = [];
    await runRedControl(
      { name: 'generated', entry, args: [], evidence: ['GENERATED_ASSERTION'] },
      {
        outputDirectory: scratch,
        stderr: (value) => {
          stderr.push(value);
        },
        stdout: (value) => {
          stdout.push(value);
        },
      },
    );
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(''))).toEqual({
      control: 'generated',
      expectedExit: 1,
      exitCode: 1,
      assertionsObserved: ['GENERATED_ASSERTION'],
    });
    expect(await readFile(join(scratch, 'generated.txt'), 'utf8')).toBe(
      'GENERATED_ASSERTION\n',
    );
    expect(await readdir(scratch)).not.toContain('generated.failure.json');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('desktop CI uploads the fixed red-control directory only on failure with the existing pinned action', async () => {
  const workflow = await readFile(
    join(root, '.github/workflows/ci.yml'),
    'utf8',
  );
  const desktop = workflow.slice(workflow.indexOf('\n  desktop:'));
  expect(desktop).toMatch(
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02[^\n]*\n\s+if: failure\(\)\n\s+with:\n\s+name: desktop-red-control-outputs\n\s+if-no-files-found: warn\n\s+path: apps\/desktop\/dist\/red-controls\//,
  );
  expect(desktop.match(/name: desktop-red-control-outputs/g)).toHaveLength(1);
});
