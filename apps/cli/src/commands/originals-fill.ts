import { readFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCommand } from '@stricli/core';
import { workspaceFlag, dryRunFlag, jsonFlag } from '../cli/context.ts';
import type { CommandRunContext } from '../cli/context.ts';
import { CliError } from '../cli/errors.ts';
import { workspacePath, assertOutput } from '../workspace/files.ts';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { planFill, fillSummary, fillList } from '../browser/x/fill/plan.ts';
import { finalNoticeText } from '../browser/x/fill/final-notice.ts';
export const originalsFillCommand = buildCommand({
  parameters: {
    flags: {
      workspace: workspaceFlag,
      account: { kind: 'parsed', parse: String, brief: 'X export account key' },
      dryRun: dryRunFlag,
      json: jsonFlag,
      include: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'ID file explicitly including already read originals',
      },
      list: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'New full-list file',
      },
      profile: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Dedicated profile',
      },
      plan: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Unchanged dry-run plan hash',
      },
      limit: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Lower the page count, up to 200',
      },
      'max-video-mb': {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Video limit in MiB, 1 to 16384',
      },
      'max-run-gb': {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'New media limit in GiB, 1 to 500',
      },
      browser: {
        kind: 'enum',
        values: ['chrome', 'edge'],
        optional: true,
        brief: 'Installed browser',
      },
      lang: {
        kind: 'enum',
        values: ['en', 'de'],
        default: 'en',
        brief: 'Warning language',
      },
    },
  },
  docs: {
    brief:
      'Read missing original content in your signed-in X window; agents may use only --dry-run',
  },
  async func(
    this: CommandRunContext,
    flags: {
      workspace: string;
      account: string;
      dryRun: boolean;
      json: boolean;
      include?: string;
      list?: string;
      profile?: string;
      plan?: string;
      limit?: string;
      'max-video-mb'?: string;
      'max-run-gb'?: string;
      browser?: 'chrome' | 'edge';
      lang: 'en' | 'de';
    },
  ) {
    if (flags.json && flags.list) throw new CliError('INVALID_ARGUMENTS');
    if (!flags.dryRun && (flags.json || !this.stdoutIsTerminal))
      throw new CliError('NOT_INTERACTIVE');
    const integer = (
      value: string | undefined,
      fallback: number,
      max: number,
    ) => {
      const result = value === undefined ? fallback : Number(value);
      if (!Number.isSafeInteger(result) || result < 1 || result > max)
        throw new CliError('INVALID_ARGUMENTS');
      return result;
    };
    const limit = integer(flags.limit, 200, 200),
      video = integer(flags['max-video-mb'], 1024, 16384),
      run = integer(flags['max-run-gb'], 20, 500),
      include = new Set<string>();
    if (flags.include)
      for (const line of (await readFile(flags.include, 'utf8')).split(
        /\r?\n/,
      )) {
        if (!line.trim()) continue;
        if (!/^\d{1,40}$/.test(line.trim()))
          throw new CliError('INVALID_ARGUMENTS');
        include.add(line.trim());
      }
    const path = await workspacePath(flags.workspace, false),
      store = await SQLiteStore.open(path.path, { readOnly: flags.dryRun });
    try {
      const plan = await planFill(store, flags.account, include),
        data = fillSummary(plan, flags.lang),
        text = fillList(plan);
      if (flags.dryRun) {
        if (flags.list) {
          await assertOutput(flags.list, flags.workspace);
          const file = await open(flags.list, 'wx');
          try {
            await file.writeFile(text);
            await file.sync();
          } finally {
            await file.close();
          }
        }
        this.reply({
          data,
          human: `${data.planned} originals planned. Hash: ${data.planHash}.\n${finalNoticeText(plan.finalNotices, flags.lang)}\n${data.warning}\n${flags.list ? '' : text}`,
        });
        return;
      }
      if (!flags.profile || !plan.handle || flags.plan !== plan.hash)
        throw new CliError('STALE_PLAN');
      const { validateProfile, installedBrowser } =
        await import('../browser/profile.ts');
      await validateProfile(flags.profile);
      const executablePath = await installedBrowser(flags.browser),
        list =
          flags.list ??
          join(flags.workspace, `originals-fill-${plan.hash}.txt`);
      await assertOutput(list, flags.workspace);
      try {
        if ((await readFile(list, 'utf8')) !== text)
          throw new CliError('STALE_PLAN');
      } catch (error) {
        if (!(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw error;
        const file = await open(list, 'wx');
        try {
          await file.writeFile(text);
          await file.sync();
        } finally {
          await file.close();
        }
      }
      const { runFill } = await import('../browser/x/fill/run.ts');
      const result = await runFill({
        store,
        plan,
        profile: flags.profile,
        executablePath,
        list,
        workspace: flags.workspace,
        signal: this.signal,
        limit,
        maxVideoBytes: video * 1024 ** 2,
        maxRunBytes: run * 1024 ** 3,
        include,
        lang: flags.lang,
        mediaNotice: ` This run allows at most ${video} MiB per video and ${run} GiB of new media. Limits above the defaults may use more local disk.`,
        now: () => this.now(),
        notice: (text) => this.io.stderr.write(text),
      });
      this.reply({
        data: result,
        human: `${result.completed} originals read. Ended: ${result.endReason}.`,
      });
    } finally {
      await store.close();
    }
  },
});
