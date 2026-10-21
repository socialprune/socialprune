import { readFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCommand } from '@stricli/core';
import { InstagramItemIdSchema } from '@socialprune/core';
import { workspaceFlag, dryRunFlag, jsonFlag } from '../cli/context.ts';
import type { CommandRunContext } from '../cli/context.ts';
import { CliError } from '../cli/errors.ts';
import { workspacePath, assertOutput } from '../workspace/files.ts';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import {
  contextSummary,
  contextList,
  planContext,
  instagramHandle,
} from '../browser/instagram/plan.ts';
import {
  readContextOrder,
  validateContextOrder,
} from '../browser/instagram/order.ts';
import { contextPace, paceText } from '../browser/instagram/pace.ts';

export const contextInstagramCommand = buildCommand({
  parameters: {
    flags: {
      workspace: workspaceFlag,
      account: {
        kind: 'parsed',
        parse: String,
        brief: 'Instagram export account key',
      },
      handle: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Instagram account name when the export has none',
      },
      dryRun: dryRunFlag,
      json: jsonFlag,
      include: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief:
          'Explicit file of Instagram item IDs to reconsider after earlier results',
      },
      exclude: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief:
          'Person-written file of Instagram item IDs to leave out of this plan',
      },
      list: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'New full-list file, never overwritten',
      },
      profile: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Dedicated Instagram profile',
      },
      plan: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Unchanged dry-run plan hash',
      },
      order: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief:
          'Written order for context-instagram only; acceptCanary explicitly permits automatic checks',
      },
      limit: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief:
          'Step limit, 1 to 200 without an order or up to 600 with an order',
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
        brief: 'Warning and status language',
      },
    },
  },
  docs: {
    brief:
      'Read the posts your Instagram comments belong to; agents need your exact written order for a run',
  },
  async func(
    this: CommandRunContext,
    flags: {
      workspace: string;
      account: string;
      handle?: string;
      dryRun: boolean;
      json: boolean;
      include?: string;
      exclude?: string;
      list?: string;
      profile?: string;
      plan?: string;
      order?: string;
      limit?: string;
      browser?: 'chrome' | 'edge';
      lang: 'en' | 'de';
    },
  ) {
    const handle = instagramHandle(flags.handle),
      limit = flags.limit === undefined ? 200 : Number(flags.limit);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > (flags.order ? 600 : 200) ||
      (flags.json && flags.list) ||
      (flags.order && flags.include)
    )
      throw new CliError('INVALID_ARGUMENTS');
    if (!flags.dryRun && !flags.order && (flags.json || !this.stdoutIsTerminal))
      throw new CliError('NOT_INTERACTIVE');
    const include = new Set<string>(),
      exclude = new Set<string>();
    for (const [file, ids] of [
      [flags.include, include],
      [flags.exclude, exclude],
    ] as const)
      if (file)
        for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
          const value = line.trim();
          if (!value) continue;
          if (!InstagramItemIdSchema.safeParse(value).success)
            throw new CliError('INVALID_ARGUMENTS');
          ids.add(value);
        }
    if ([...exclude].some((id) => include.has(id)))
      throw new CliError('INVALID_ARGUMENTS');
    const path = await workspacePath(flags.workspace, false),
      store = await SQLiteStore.open(path.path, { readOnly: flags.dryRun });
    try {
      const plan = await planContext(store, flags.account, include, exclude);
      if (
        plan.handle &&
        handle &&
        plan.handle.toLowerCase() !== handle.toLowerCase()
      )
        throw new CliError('ACCOUNT_MISMATCH');
      plan.handle ||= handle ?? '';
      if (flags.order && flags.plan !== plan.hash)
        throw new CliError('STALE_PLAN');
      const order = flags.order
        ? await readContextOrder(
            flags.order,
            plan.handle,
            flags.plan!,
            plan.hash,
          )
        : undefined;
      validateContextOrder(order, plan.handle, !flags.dryRun && plan.canary);
      const pace = contextPace(order, plan.canary);
      const data = contextSummary(plan, flags.lang, pace),
        text = contextList(plan);
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
          human: `${data.planned} planned, ${data.marked} marked for deletion. Manual: ${JSON.stringify(data.manual)}. Already confirmed: ${data.confirmed}. Earlier results left out: ${JSON.stringify(data.excluded)}. Person-excluded: ${data.personExcluded}. Exclusion IDs without a planned or manual entry: ${data.excludeUnmatched}.\nPlan: ${data.planHash}\nAt least ${data.steps} steps across ${data.days} days.\n${paceText(pace, flags.lang)}\n${data.warning}\n${flags.list ? '' : text}`,
        });
        return;
      }
      if (!plan.handle) throw new CliError('INSTAGRAM_ACCOUNT_NAME_MISSING');
      if (!flags.profile || flags.plan !== plan.hash)
        throw new CliError('STALE_PLAN');
      const { validateProfile, installedBrowser } =
        await import('../browser/profile.ts');
      await validateProfile(flags.profile, 'instagram');
      const executablePath = await installedBrowser(flags.browser),
        list =
          flags.list ??
          join(flags.workspace, `context-instagram-${plan.hash}.txt`);
      await assertOutput(list, flags.workspace);
      try {
        if ((await readFile(list, 'utf8')) !== text)
          throw new CliError('STALE_PLAN');
      } catch (caught) {
        if (!(
          caught &&
          typeof caught === 'object' &&
          'code' in caught &&
          caught.code === 'ENOENT'
        ))
          throw caught;
        const file = await open(list, 'wx');
        try {
          await file.writeFile(text);
          await file.sync();
        } finally {
          await file.close();
        }
      }
      const { runContext } = await import('../browser/instagram/run.ts');
      const result = await runContext({
        store,
        plan,
        workspace: flags.workspace,
        profile: flags.profile,
        executablePath,
        list,
        include,
        exclude,
        limit: flags.limit === undefined ? pace.perDay : limit,
        order,
        signal: this.signal,
        lang: flags.lang,
        now: () => this.now(),
        notice: (message) => this.io.stderr.write(message),
      });
      this.reply({
        data: result,
        human: `${result.completed} comments confirmed in ${result.steps} steps. Ended: ${result.endReason}.`,
      });
    } finally {
      await store.close();
    }
  },
});
