import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { z } from 'zod';
import { checkPackage } from './pack-check.ts';
import { command, npm, packageDirectory, root } from './process.ts';

interface Envelope {
  command: string;
  status: string;
  data: unknown;
  error?: { code: string; exitCode: number };
}
interface DemoManifest {
  exports: {
    platform: string;
    directory: string;
    itemCount: number;
    account: { key: string };
  }[];
}
interface Batch {
  batchId: string;
  categories: string[];
  items: { itemId: string; contentHash: string }[];
}

async function validator(installed: string, name: string) {
  const schema = JSON.parse(
    await readFile(join(installed, `schemas/${name}.schema.json`), 'utf8'),
  ) as z.core.JSONSchema.JSONSchema;
  return z.fromJSONSchema(schema);
}

export async function smoke(olderNode?: string): Promise<void> {
  await checkPackage();
  const temp = await mkdtemp(join(tmpdir(), 'socialprune-packed-'));
  try {
    const packed = JSON.parse(
      npm(
        ['pack', '--json', '--ignore-scripts', '--pack-destination', temp],
        packageDirectory,
      ),
    ) as { filename: string }[];
    assert.equal(packed.length, 1);
    const install = join(temp, 'empty install');
    await mkdir(install);
    // Pack the already installed exact driver locally. Both tarballs are then
    // explicit install inputs, so an empty npm cache needs no registry lookup.
    const driver = JSON.parse(
      npm(
        [
          'pack',
          fileURLToPath(
            new URL('./', import.meta.resolve('playwright-core/package.json')),
          ),
          '--offline',
          '--json',
          '--ignore-scripts',
          '--pack-destination',
          temp,
        ],
        root,
      ),
    ) as { filename: string }[];
    assert.equal(driver.length, 1);
    const installedOutput = npm(
      [
        'install',
        '--offline',
        '--no-audit',
        '--no-fund',
        '--ignore-scripts',
        // Without --prefix, npm installs into the nearest parent folder with a
        // package.json or node_modules, for example a project in the home folder.
        '--prefix',
        install,
        '--cache',
        join(temp, 'empty-cache'),
        join(temp, driver[0]!.filename),
        join(temp, packed[0]!.filename),
      ],
      install,
    );
    const installed = join(install, 'node_modules/socialprune');
    const shim = join(
      install,
      'node_modules/.bin/socialprune' +
        (process.platform === 'win32' ? '.cmd' : ''),
    );
    if (process.platform !== 'win32')
      assert.equal(
        await realpath(shim),
        join(installed, 'bin/socialprune.mjs'),
      );
    else
      assert.match(
        await readFile(shim, 'utf8'),
        /socialprune[\\/]bin[\\/]socialprune\.mjs/,
      );
    const bin = join(installed, 'bin/socialprune.mjs');
    const envelopeSchema = await validator(installed, 'cli-result');
    const shimOutput =
      process.platform === 'win32'
        ? command('cmd.exe', ['/d', '/c', shim, '--help', '--json'], install)
        : command(shim, ['--help', '--json'], install);
    envelopeSchema.parse(JSON.parse(shimOutput));
    const run = (
      args: string[],
      code = 0,
      node = process.execPath,
    ): Envelope => {
      // npm's shim selects Node from PATH. Calling its verified target with the
      // current executable makes Node-floor proof independent of the host PATH.
      const output = command(node, [bin, ...args], install, code).trim();
      // JSON.parse consumes the whole stdout document, including pretty-printed
      // help; a second document or incidental text is rejected.
      envelopeSchema.parse(JSON.parse(output));
      const value = JSON.parse(output) as Envelope;
      assert.equal(value.status, code ? 'error' : 'ok');
      if (code) assert.equal(value.error?.exitCode, code);
      return value;
    };
    const results: { command: string; exit: number }[] = [
      { command: 'installed socialprune shim --help --json', exit: 0 },
    ];
    const checked = (args: string[], code = 0, node = process.execPath) => {
      const output = run(args, code, node);
      results.push({
        command: args.filter((arg) => !arg.includes(temp)).join(' '),
        exit: code,
      });
      return output;
    };
    const help = checked(['--help', '--json']);
    assert.throws(() =>
      envelopeSchema.parse({ ...help, privateText: 'planted' }),
    );
    assert.throws(() => envelopeSchema.parse({ ...help, status: 'complete' }));
    (await validator(installed, 'cli-help')).parse(help.data);
    assert.equal(help.command, 'socialprune');
    const structure = checked([
      'structure',
      resolve(root, 'fixtures/synthetic/x/current-minimal/archive'),
      '--json',
    ]);
    assert.equal(structure.command, 'structure');
    assert.ok((structure.data as { files: unknown[] }).files.length > 0);
    const guide = checked(['guide', 'x', '--json']);
    assert.equal(guide.command, 'guide');
    assert.equal((guide.data as { platform: string }).platform, 'x');
    const schemas = checked(['schemas', '--json']);
    assert.equal(schemas.command, 'schemas');
    const manifest = JSON.parse(
      await readFile(
        resolve(root, 'fixtures/synthetic/demo/manifest.json'),
        'utf8',
      ),
    ) as DemoManifest;
    const fixture = manifest.exports.find((entry) => entry.platform === 'x');
    assert.ok(fixture && fixture.itemCount > 0);
    // The ZIP is generated from the manifest's folder, outside the package.
    // zip.js's default Node entry is exercised by the packed import, not mocked.
    const { writeZipFile } =
      await import('../../../tools/fixture-gen/src/shared/zip.ts');
    const { filesIn } = await import('./inventory.ts');
    const directory = resolve(
      root,
      'fixtures/synthetic/demo',
      fixture.directory,
    );
    const zip = join(temp, 'demo.zip');
    await writeZipFile(
      zip,
      await Promise.all(
        (await filesIn(directory)).map(async (path) => ({
          path,
          content: await readFile(join(directory, path)),
        })),
      ),
    );
    const workspace = join(temp, 'workspace');
    const imported = checked([
      'import',
      zip,
      '--workspace',
      workspace,
      '--json',
    ]);
    assert.equal(imported.command, 'import');
    assert.equal((imported.data as { items: number }).items, fixture.itemCount);
    const deletePlan = checked([
      'delete',
      'x',
      '--workspace',
      workspace,
      '--account',
      fixture.account.key,
      '--dry-run',
      '--json',
    ]);
    assert.equal(deletePlan.command, 'delete.x');
    assert.equal((deletePlan.data as { planned: number }).planned, 0);
    const summary = checked(['summary', '--workspace', workspace, '--json']);
    (await validator(installed, 'summary')).parse(summary.data);
    assert.equal(
      (summary.data as { counts: { items: number } }).counts.items,
      fixture.itemCount,
    );
    const noNetwork = join(temp, 'no-network.mjs');
    // A test-only preload rejects every outbound primitive before the installed
    // command starts. It is never imported by a production entrypoint.
    await writeFile(
      noNetwork,
      `
import {syncBuiltinESMExports,registerHooks} from 'node:module';
import http from 'node:http'; import https from 'node:https'; import http2 from 'node:http2';
import net from 'node:net'; import tls from 'node:tls'; import dns from 'node:dns';
import dnsPromises from 'node:dns/promises'; import dgram from 'node:dgram';
const deny=()=>{throw Error('PACKED_NETWORK_FORBIDDEN');};
globalThis.fetch=deny; globalThis.WebSocket=deny;
for(const [target,names] of [[http,['request','get']],[https,['request','get']],[http2,['connect']],[net,['connect','createConnection']],[tls,['connect']],[dgram,['createSocket']]]) for(const name of names) target[name]=deny;
for(const target of [dns,dnsPromises]) for(const name of Object.keys(target)) if(name==='lookup'||name==='lookupService'||name.startsWith('resolve')) target[name]=deny;
syncBuiltinESMExports();
registerHooks({resolve(specifier,context,nextResolve){if(specifier==='playwright-core')throw Error('PACKED_BROWSER_FORBIDDEN');return nextResolve(specifier,context);}});
`,
    );
    // First prove the decoy is caught; never exercise this guard on a real host.
    assert.equal(
      command(
        process.execPath,
        [
          '--import',
          pathToFileURL(noNetwork).href,
          '--input-type=module',
          '-e',
          "fetch('https://generated.invalid/')",
        ],
        install,
        1,
      ),
      '',
    );
    const deletionOutput = command(
      process.execPath,
      [
        '--import',
        pathToFileURL(noNetwork).href,
        bin,
        'delete',
        'x',
        '--workspace',
        workspace,
        '--account',
        fixture.account.key,
        '--dry-run',
        '--json',
      ],
      install,
    );
    envelopeSchema.parse(JSON.parse(deletionOutput));
    const deletion = JSON.parse(deletionOutput) as Envelope & {
      data: { planned: number };
    };
    assert.equal(deletion.command, 'delete.x');
    assert.equal(deletion.status, 'ok');
    assert.equal(deletion.data.planned, 0);
    results.push({
      command: 'delete x --dry-run --json (network and browser import denied)',
      exit: 0,
    });
    const originalsOutput = command(
      process.execPath,
      [
        '--import',
        pathToFileURL(noNetwork).href,
        bin,
        'originals',
        'fetch',
        '--workspace',
        workspace,
        '--dry-run',
        '--json',
      ],
      install,
    );
    envelopeSchema.parse(JSON.parse(originalsOutput));
    const originals = JSON.parse(originalsOutput) as Envelope & {
      data: {
        dryRun: boolean;
        referenced: number;
        planned: number;
        attempted: number;
      };
    };
    assert.equal(originals.command, 'originals.fetch');
    assert.equal(originals.status, 'ok');
    assert.equal(originals.data.dryRun, true);
    assert.equal(originals.data.attempted, 0);
    const expectedDemo = JSON.parse(
      await readFile(
        resolve(root, 'fixtures/synthetic/demo/x/expected.json'),
        'utf8',
      ),
    ) as {
      items: {
        reference: { replyToId: string | null; quotedId: string | null };
      }[];
    };
    const expectedReferences = new Set(
      expectedDemo.items
        .flatMap((item) => [item.reference.replyToId, item.reference.quotedId])
        .filter((id) => id !== null),
    );
    assert.equal(originals.data.referenced, expectedReferences.size);
    assert.equal(originals.data.planned, expectedReferences.size);
    results.push({
      command: 'originals fetch --dry-run --json (outbound primitives denied)',
      exit: 0,
    });
    const batchResult = checked([
      'batch',
      'next',
      '--workspace',
      workspace,
      '--share-with-agent',
      '--size',
      '3',
      '--json',
    ]);
    (await validator(installed, 'batch')).parse(batchResult.data);
    const batch = batchResult.data as Batch;
    assert.equal(batch.items.length, 3);
    assert.ok(batch.categories.length);
    const labels = {
      schemaVersion: 1,
      submissionId: 'packed-smoke',
      source: { kind: 'agent', name: 'packed-smoke', version: null },
      labels: batch.items.map((item) => ({
        itemId: item.itemId,
        contentHash: item.contentHash,
        category: batch.categories[0],
        risk: 0,
        reason: 'Synthetic package smoke suggestion.',
        evidence: null,
        confidence: null,
      })),
    };
    (await validator(installed, 'label-file')).parse(labels);
    const labelFile = join(temp, 'labels.json');
    await writeFile(labelFile, JSON.stringify(labels));
    const submitted = checked([
      'labels',
      'submit',
      labelFile,
      '--workspace',
      workspace,
      '--dry-run',
      '--json',
    ]);
    (await validator(installed, 'label-submission')).parse(submitted.data);
    assert.equal(
      (submitted.data as { accepted: number; dryRun: boolean }).accepted,
      labels.labels.length,
    );
    assert.equal((submitted.data as { dryRun: boolean }).dryRun, true);
    const dry = checked([
      'review',
      '--workspace',
      workspace,
      '--dry-run',
      '--json',
    ]);
    assert.equal(
      (dry.data as { counts: { items: number } }).counts.items,
      fixture.itemCount,
    );
    await packedReview(
      bin,
      install,
      installed,
      temp,
      workspace,
      (summary.data as { workspaceId: string }).workspaceId,
      fixture.itemCount,
      envelopeSchema,
    );
    results.push({
      command:
        'review (recording opener, worker-only SQLite, authenticated open, shutdown)',
      exit: 0,
    });
    const after = checked(['summary', '--workspace', workspace, '--json']);
    (await validator(installed, 'summary')).parse(after.data);
    assert.equal(
      (
        after.data as {
          counts: { assessments: number; decisionEvents: number };
        }
      ).counts.assessments,
      0,
    );
    assert.equal(
      (after.data as { counts: { decisionEvents: number } }).counts
        .decisionEvents,
      0,
    );
    if (olderNode) {
      (await validator(installed, 'cli-help')).parse(
        checked(['--help', '--json'], 0, olderNode).data,
      );
      for (const args of [
        ['import', zip],
        ['summary'],
        ['batch', 'next', '--share-with-agent'],
        ['labels', 'submit', labelFile, '--dry-run'],
        ['review', '--dry-run'],
        ['originals', 'fetch', '--dry-run'],
        ['backup', 'export', '--out', join(temp, 'backup.json')],
        ['backup', 'restore', labelFile],
        [
          'export',
          'clicklist',
          '--account',
          fixture.account.key,
          '--out',
          join(temp, 'list.csv'),
        ],
      ]) {
        assert.equal(
          checked([...args, '--workspace', workspace, '--json'], 1, olderNode)
            .error?.code,
          'NODE_TOO_OLD',
        );
      }
    }
    console.log(
      JSON.stringify({
        smoke: 'pass',
        node: process.version,
        npm: npm(['--version'], install).trim(),
        platform: process.platform,
        offlineInstall: installedOutput.trim(),
        itemCount: fixture.itemCount,
        checks: results.length,
        results,
        cleanup:
          'temporary install, cache, tarball, fixture ZIP, workspace and recorder removed',
      }),
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function packedReview(
  bin: string,
  cwd: string,
  installed: string,
  temp: string,
  workspace: string,
  workspaceId: string,
  expectedItems: number,
  schema: z.ZodType,
): Promise<void> {
  const preload = join(temp, 'review-preload.mjs');
  const opener = join(temp, 'record-opener.mjs');
  const launchFile = join(temp, 'launch.txt');
  const trace = join(temp, 'sqlite-threads.jsonl');
  await writeFile(
    opener,
    `import {writeFileSync} from 'node:fs';\nconst file=${JSON.stringify(launchFile)};\nif(process.argv[2]) writeFileSync(file, process.argv[2]);\nelse {let text='';process.stdin.on('data',x=>text+=x);process.stdin.on('end',()=>writeFileSync(file,text.trim()));}\n`,
  );
  await writeFile(
    preload,
    `import cp from 'node:child_process';\nimport {appendFileSync} from 'node:fs';\nimport {registerHooks,syncBuiltinESMExports} from 'node:module';\nimport {isMainThread,threadId} from 'node:worker_threads';\nregisterHooks({resolve(specifier,context,next){if(specifier==='node:sqlite'){appendFileSync(${JSON.stringify(trace)},JSON.stringify({isMainThread,threadId})+'\\n');if(isMainThread)throw Error('SQLite reached review HTTP thread');}return next(specifier,context);}});\nconst start=cp.spawn;\ncp.spawn=(command,args,options)=>{if(['powershell.exe','xdg-open','open'].includes(command)){return start(process.execPath,[${JSON.stringify(opener)},...(command==='powershell.exe'?[]:[args[0]])],options);}return start(command,args,options);};\nsyncBuiltinESMExports();\n`,
  );
  // Prove the negative observer catches the defect it claims to prevent before
  // using its positive worker trace as evidence. The preload is test-only.
  const negative = command(
    process.execPath,
    [
      '--import',
      pathToFileURL(preload).href,
      '--input-type=module',
      '-e',
      "await import('node:sqlite')",
    ],
    cwd,
    1,
  );
  assert.equal(negative, '');
  assert.match(await readFile(trace, 'utf8'), /"isMainThread":true/);
  await rm(trace);
  const child = spawn(
    process.execPath,
    [
      '--import',
      pathToFileURL(preload).href,
      bin,
      'review',
      '--workspace',
      workspace,
      '--json',
    ],
    { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once('exit', (code) => resolve(code));
    child.once('error', reject);
  });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const deadline = AbortSignal.timeout(30_000);
  try {
    let complete = false;
    while (!complete) {
      assert.equal(child.exitCode, null, stderr);
      await once(child.stdout, 'data', { signal: deadline });
      try {
        JSON.parse(stdout);
        complete = true;
      } catch {
        /* Read the remaining document. */
      }
    }
    schema.parse(JSON.parse(stdout.trim()));
    const readiness = JSON.parse(stdout.trim()) as Envelope;
    assert.equal(readiness.command, 'review');
    assert.equal(
      (readiness.data as { lifecycle: string }).lifecycle,
      'running',
    );
    assert.equal(
      (readiness.data as { tokenDelivery: string }).tokenDelivery,
      'browser',
    );
    const { url } = readiness.data as { url: string };
    const launch = new URL(await readFile(launchFile, 'utf8'));
    assert.equal(launch.origin + '/', url);
    const token = new URLSearchParams(launch.hash.slice(1)).get('bootstrap');
    assert.ok(token);
    assert.ok(!stdout.includes(token) && !stderr.includes(token));
    const page = await fetch(url, { signal: deadline });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.equal(
      html,
      await readFile(join(installed, 'web/index.html'), 'utf8'),
    );
    for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
      const response = await fetch(new URL(match[1]!, url), {
        signal: deadline,
      });
      assert.equal(response.status, 200);
    }
    const exchange = await fetch(new URL('session', url), {
      method: 'POST',
      headers: {
        Origin: launch.origin,
        'Content-Type': 'application/json',
        'X-SocialPrune-Bootstrap': token,
      },
      body: '{}',
      signal: deadline,
    });
    assert.equal(exchange.status, 200);
    const session = (await exchange.json()) as { csrf: string };
    const cookie = exchange.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    const api = (type: string) =>
      fetch(new URL(`api/${type}`, url), {
        method: 'POST',
        headers: {
          Origin: launch.origin,
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-SocialPrune-CSRF': session.csrf,
        },
        body: JSON.stringify({
          type,
          requestId: `packed-${type}`,
          ...(type === 'open' ? { workspaceId } : {}),
        }),
        signal: deadline,
      });
    const opened = await api('open');
    assert.equal(opened.status, 200);
    const replies = (await opened.json()) as {
      summary: { counts: { items: number } };
    }[];
    assert.equal(replies[0]!.summary.counts.items, expectedItems);
    const stopped = await api('shutdown');
    assert.equal(stopped.status, 200);
    assert.deepEqual(await stopped.json(), [
      { type: 'done', requestId: 'packed-shutdown' },
    ]);
    const code = await exit;
    assert.equal(code, 0, stderr);
    schema.parse(JSON.parse(stdout.trim()));
    const threads = (await readFile(trace, 'utf8'))
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as { isMainThread: boolean; threadId: number },
      );
    assert.ok(
      threads.length > 0,
      'Real packed review must actually load SQLite.',
    );
    assert.ok(
      threads.every((thread) => !thread.isMainThread && thread.threadId > 0),
    );
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2000) }));
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await exit;
    }
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--older-node'))
    throw new Error('Usage: smoke.ts [--older-node <executable>]');
  await smoke(args[1]);
}
