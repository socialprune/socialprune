import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { directory, dist, root } from './paths.ts';

const require = createRequire(import.meta.url);
const controls = [
  {
    name: 'production-test-exclusion',
    entry: join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'),
    args: [
      'run',
      '--config',
      'test/red/production.vitest.config.ts',
      '--maxWorkers=2',
    ],
    evidence: ['1 failed', 'PRODUCTION_TEST_IMPORT'],
  },
  {
    name: 'sender-zod',
    entry: join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'),
    args: [
      'run',
      '--config',
      'test/red/router.vitest.config.ts',
      '--maxWorkers=2',
    ],
    evidence: ['11 failed', 'instead of rejecting'],
  },
  {
    name: 'engine-error',
    entry: join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'),
    args: [
      'run',
      '--config',
      'test/red/workspace.vitest.config.ts',
      '--maxWorkers=2',
    ],
    evidence: ['1 failed', 'ENGINE_UNAVAILABLE'],
  },
  {
    name: 'renderer-fuses',
    entry: require.resolve('@playwright/test/cli'),
    args: [
      'test',
      '--config',
      'playwright.red.config.ts',
      '--grep',
      'RED planted',
      '--workers=1',
    ],
    evidence: [
      '7 failed',
      "process: 'object'",
      'CSP_VIOLATION',
      'connect-src',
      'script-src-elem',
      'FUSE_MISMATCH_0',
      'APP_LISTENER',
      'APP_CONNECTION',
      'BROWSER_PROCESS_REMAINS',
    ],
  },
];

interface DiagnosticPaths {
  repo: string;
  temp: string;
  home: string;
}

const diagnosticPaths = { repo: root, temp: tmpdir(), home: homedir() };
const outputDirectory = join(dist, 'red-controls');

export function controlOutputExcerpt(
  output: string,
  paths: DiagnosticPaths = diagnosticPaths,
): string[] {
  let text = stripVTControlCharacters(output).replace(/\\+/g, '/');
  text = text
    .replace(/file:\/\/\/[^\s"'<>]+/gi, (url) => {
      try {
        return decodeURIComponent(url);
      } catch {
        return url;
      }
    })
    .replace(/file:\/\/\/(?=[a-z]:\/)/gi, '')
    .replace(/file:\/\/(?=\/)/gi, '');
  // Longest first: a checkout or TEMP may itself be inside the user profile.
  const roots: [string, string][] = [
    ['repo', paths.repo],
    ['temp', paths.temp],
    ['home', paths.home],
  ];
  for (const [kind, path] of roots.sort(
    ([, left], [, right]) => right.length - left.length,
  )) {
    const normalized = path.replace(/\\+/g, '/').replace(/\/$/, '');
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(
      new RegExp(escaped + '(?=/|[\\s"\'():]|$)', 'gi'),
      `<${kind}>`,
    );
  }
  // Also cover other profiles and GitHub's long/8.3 runner path spellings.
  text = text
    .replace(/[a-z]:\/a\/_temp\b/gi, '<temp>')
    .replace(/[a-z]:\/a\/[^/\s"']+\/[^/\s"']+(?=\/)/gi, '<repo>')
    .replace(/\/(?:home|Users)\/[^/\n"']+\/work\/_temp\b/g, '<temp>')
    .replace(
      /\/(?:home|Users)\/[^/\n"']+\/work\/[^/\s"']+\/[^/\s"']+(?=\/)/g,
      '<repo>',
    )
    .replace(
      /(?:[a-z]:)?\/Users\/[^/\n"']+\/AppData\/Local\/Temp\b/gi,
      '<temp>',
    )
    .replace(/(?:[a-z]:)?\/Users\/[^/\n"']+(?=\/|$)/gim, '<home>')
    .replace(/\/home\/[^/\s"']+(?=\/|$)/gm, '<home>');
  // Redact before cutting, so neither a truncated prefix nor a split escape leaks.
  return text
    .replace(/\r\n?/g, '\n')
    .trimEnd()
    .split('\n')
    .slice(-200)
    .map((line) =>
      [...line]
        .filter(
          (character) =>
            character === '\t' ||
            (character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127),
        )
        .join('')
        .slice(0, 400),
    );
}

export function classifyControlFailure(
  output: string,
  missingEvidence: string[],
) {
  const text = stripVTControlCharacters(output).replaceAll('\\', '/');
  const sections = text.split(/(?=^\s+\d+\) .+$)/m);
  const targets = missingEvidence.flatMap((evidence) => {
    if (evidence === "process: 'object'") return ['node'];
    if (evidence === 'connect-src') return ['network'];
    if (evidence === 'script-src-elem') return ['inline'];
    if (evidence === 'CSP_VIOLATION') return ['inline', 'network'];
    return [];
  });
  const relevant = targets.length
    ? sections.filter((section) =>
        targets.some((kind) =>
          new RegExp('^\\s+\\d+\\) [^\\n]*RED planted ' + kind + '\\b').test(
            section,
          ),
        ),
      )
    : sections;
  // Stack frames and focal source lines are evidence; nearby unexecuted source
  // snippets and the deliberately failing lifecycle controls are not.
  if (
    relevant.some(
      (section) =>
        /^\s+at (?:async )?(?:Object\.)?close \([^\n]*\/e2e\/helpers\.ts:\d+:\d+\)/m.test(
          section,
        ) ||
        /^\s*>\s*\d+\s*\|[^\n]*(?:app\.close\(|probe\.close\()/m.test(section),
    )
  )
    return 'cleanup-replaced-assertion';
  if (
    relevant.some((section) =>
      /(?:Error: (?:electron\.launch|electronApplication\.firstWindow|page\.reload)|Error: expect\([^\n]*\)\.toBeVisible\()/m.test(
        section,
      ),
    )
  )
    return 'failed-before-decoy';
  if (
    missingEvidence.length &&
    relevant.some(
      (section) =>
        /AssertionError:/.test(section) &&
        /^\s+at (?:assertRenderer|assertPolicyEvents) \(/m.test(section),
    )
  )
    return 'different-assertion';
  return 'unknown';
}

interface Control {
  name: string;
  entry: string;
  args: string[];
  evidence: string[];
}

export async function runRedControl(
  control: Control,
  options: {
    outputDirectory?: string;
    paths?: DiagnosticPaths;
    stdout?: (value: string) => void;
    stderr?: (value: string) => void;
  } = {},
) {
  const folder = options.outputDirectory ?? outputDirectory;
  const paths = options.paths ?? diagnosticPaths;
  const stdout =
    options.stdout ??
    ((value: string) => {
      console.log(value);
    });
  const stderr =
    options.stderr ??
    ((value: string) => {
      process.stderr.write(value);
    });
  const outputFile = join(folder, `${control.name}.txt`);
  const failureFile = join(folder, `${control.name}.failure.json`);
  let output = '';
  let exitCode: number | null = null;
  let outputSaved = false;
  try {
    await mkdir(folder, { recursive: true });
    await rm(failureFile, { force: true });
    const child = spawn(process.execPath, [control.entry, ...control.args], {
      cwd: directory,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      output += data.toString();
    });
    exitCode = await new Promise<number | null>((resolve, reject) => {
      let launchError: Error | undefined;
      child.once('error', (error) => {
        launchError = error;
      });
      // close, unlike exit, waits for the last stdout/stderr bytes as well.
      child.once('close', (code) => {
        if (launchError) reject(launchError);
        else resolve(code);
      });
    });
    await writeFile(outputFile, output);
    outputSaved = true;
    assert.equal(exitCode, 1, `${control.name}: expected assertion failure`);
    for (const evidence of control.evidence)
      assert.ok(
        output.includes(evidence),
        `${control.name}: missing ${evidence}`,
      );
    stdout(
      JSON.stringify({
        control: control.name,
        expectedExit: 1,
        exitCode,
        assertionsObserved: control.evidence,
      }),
    );
  } catch (error) {
    const message = (value: unknown) =>
      controlOutputExcerpt(
        value instanceof Error
          ? `${value.name}: ${value.message}`
          : String(value),
        paths,
      ).slice(0, 1)[0];
    let outputSaveError: string | undefined;
    if (!outputSaved) {
      try {
        await mkdir(folder, { recursive: true });
        await writeFile(outputFile, output);
        outputSaved = true;
      } catch (saveError) {
        outputSaveError = message(saveError);
      }
    }
    const missingEvidence = control.evidence.filter(
      (evidence) => !output.includes(evidence),
    );
    const record = {
      control: control.name,
      state: 'failed',
      branch: classifyControlFailure(output, missingEvidence),
      expectedExit: 1,
      exitCode,
      missingEvidence,
      outputFile: `${control.name}.txt`,
      outputSaved,
      error: message(error),
      ...(outputSaveError ? { outputSaveError } : {}),
    };
    let recordSaveError: string | undefined;
    try {
      await writeFile(failureFile, JSON.stringify(record) + '\n');
    } catch (saveError) {
      recordSaveError = message(saveError);
    }
    try {
      stderr(
        JSON.stringify({
          ...record,
          ...(recordSaveError ? { recordSaveError } : {}),
        }) + '\n',
      );
      stderr(
        'RED_CONTROL_OUTPUT_BEGIN\n' +
          controlOutputExcerpt(output, paths).join('\n') +
          '\nRED_CONTROL_OUTPUT_END\n',
      );
    } catch (writeError) {
      // A diagnostic I/O failure must not replace the original rejection.
      await writeFile(
        failureFile,
        JSON.stringify({
          ...record,
          diagnosticWriteError: message(writeError),
        }) + '\n',
      ).catch(() => undefined);
    }
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  for (const control of controls) await runRedControl(control);
