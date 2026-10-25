import { readFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCommand } from '@stricli/core';
import { dryRunFlag, jsonFlag, workspaceFlag } from '../cli/context.ts';
import type { CliContext, CommandRunContext } from '../cli/context.ts';
import { CliError } from '../cli/errors.ts';
import { requireWorkspaceNode } from '../workspace/node-version.ts';
import { workspacePath, assertOutput } from '../workspace/files.ts';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import {
  planDeletion,
  planSummary,
  planText,
  parseHandle,
  resolveAccountName,
  accountNameText,
} from '../browser/plan.ts';
import { productionPace } from '../browser/pace.ts';
import { xWarningNotice } from '../browser/copy.ts';
import { createInterface } from 'node:readline/promises';
import {
  readXWarningFile,
  requireXWarningFileClear,
  clearXWarningFile,
} from '../workspace/x-warning-file.ts';

export interface DeleteFlags {
  workspace: string;
  account: string;
  handle?: string;
  dryRun: boolean;
  json: boolean;
  verify: boolean;
  list?: string;
  include?: string;
  profile?: string;
  plan?: string;
  perDay?: string;
  browser?: 'chrome' | 'edge';
  lang: 'en' | 'de';
  withoutOriginals: boolean;
  acknowledgeWarning?: string;
}
export async function acknowledgeWarningCard(
  store: SQLiteStore,
  account: string,
  runId: string,
  at: string,
  zone: string,
  lang: 'en' | 'de',
  read: (prompt: string) => Promise<string>,
  profile?: string,
): Promise<void> {
  if (profile)
    await store.browserOutcomeWriter().mirrorXWarning(account, profile);
  let warning = await store.browserOutcomeWriter().xWarning(account);
  const mirrored = profile ? await readXWarningFile(profile) : null;
  if (
    mirrored &&
    (!warning ||
      (warning.at <= mirrored.createdAt && warning.runId !== mirrored.runId))
  ) {
    await store.browserOutcomeWriter().adoptXProfileWarning(account, mirrored);
    warning = await store.browserOutcomeWriter().xWarning(account);
  }
  if (
    mirrored?.runId === runId &&
    warning?.acknowledged &&
    warning.runId !== runId
  ) {
    await store.browserOutcomeWriter().adoptXProfileWarning(account, mirrored);
    warning = await store.browserOutcomeWriter().xWarning(account, runId);
  }
  if (
    (!warning && !mirrored) ||
    (warning && warning.runId !== runId) ||
    (mirrored && mirrored.runId !== runId)
  )
    throw new CliError('X_WARNING_CARD_REQUIRED');
  // Check the day before asking for input, without recording acknowledgement.
  try {
    await store.browserOutcomeWriter().requireXWarningClear(account, at, zone);
  } catch (error) {
    if (!(
      error instanceof CliError && error.code === 'X_WARNING_CARD_REQUIRED'
    ))
      throw error;
  }
  if (profile) {
    try {
      await requireXWarningFileClear(profile, at, zone);
    } catch (error) {
      if (!(
        error instanceof CliError && error.code === 'X_WARNING_CARD_REQUIRED'
      ))
        throw error;
    }
  }
  const phrase =
    lang === 'de'
      ? `Ich habe die Karte zu ${runId} gelesen`
      : `I read the card for ${runId}`;
  if (
    (
      await read(
        `${lang === 'de' ? 'Tippe genau' : 'Type exactly'}: ${phrase}\n> `,
      )
    ).trim() !== phrase
  )
    throw new CliError('X_WARNING_CARD_REQUIRED');
  await store
    .browserOutcomeWriter()
    .acknowledgeXWarning(account, runId, at, zone);
  if (profile) await clearXWarningFile(profile, runId);
}
export async function deleteHandler(flags: DeleteFlags, context: CliContext) {
  const flagHandle = parseHandle(flags.handle);
  if ((flags.dryRun && flags.verify) || (flags.json && flags.list))
    throw new CliError('INVALID_ARGUMENTS');
  if (!flags.dryRun && (flags.json || !context.stdoutIsTerminal))
    throw new CliError('NOT_INTERACTIVE');
  if (
    flags.acknowledgeWarning &&
    (flags.dryRun || flags.verify || flags.plan || !flags.profile)
  )
    throw new CliError('INVALID_ARGUMENTS');
  if (
    !flags.dryRun &&
    !flags.acknowledgeWarning &&
    (!flags.profile || (!flags.verify && !flags.plan))
  )
    throw new CliError('INVALID_ARGUMENTS');
  const perDay = flags.perDay === undefined ? undefined : Number(flags.perDay);
  productionPace(
    flags.verify ? 'verify' : 'delete',
    perDay === undefined ? {} : { perDay },
  );
  requireWorkspaceNode(context.nodeVersion ?? process.versions.node);
  const target = await workspacePath(flags.workspace, false);
  const store = await SQLiteStore.open(target.path, { readOnly: flags.dryRun });
  try {
    const include = new Set<string>();
    if (flags.include)
      for (const line of (await readFile(flags.include, 'utf8')).split(
        /\r?\n/,
      )) {
        if (!line.trim()) continue;
        if (!/^x:\d+$/.test(line.trim()))
          throw new CliError('INVALID_ARGUMENTS');
        include.add(line.trim());
      }
    const plan = await planDeletion(
      store,
      flags.account,
      include,
      context.now(),
    );
    const accountName = resolveAccountName(plan.handle, flagHandle);
    const text = planText(plan, flags.lang);
    if (flags.acknowledgeWarning) {
      if (!process.stdin.isTTY) throw new CliError('NOT_INTERACTIVE');
      const { validateProfile } = await import('../browser/profile.ts');
      await validateProfile(flags.profile!);
      await acknowledgeWarningCard(
        store,
        flags.account,
        flags.acknowledgeWarning,
        context.now().toISOString(),
        plan.timeZone,
        flags.lang,
        async (prompt) => {
          const input = createInterface({
            input: process.stdin,
            output: process.stderr,
          });
          try {
            return await input.question(prompt, { signal: context.signal });
          } finally {
            input.close();
          }
        },
        flags.profile,
      );
      return {
        data: { acknowledgedRun: flags.acknowledgeWarning },
        human:
          flags.lang === 'de'
            ? 'Karte bestätigt. Es wurde kein Browser geöffnet. Erstelle vor dem nächsten Löschlauf einen neuen Testlauf.'
            : 'Card acknowledged. No browser was opened. Make a new dry run before the next deletion run.',
      };
    }
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
      const workspace = await store.read(async (tx) => ({
        id: (await tx.meta.get()).id,
        revision: (await tx.runtime.get()).revision,
      }));
      return {
        workspace,
        data: {
          ...planSummary(plan, flags.lang),
          accountName: accountName.source,
        },
        human:
          accountNameText(accountName.source, flags.lang) +
          '\n' +
          (context.stdoutIsTerminal && !flags.list
            ? text
            : `${plan.rows.length} planned entries. Plan: ${plan.hash}. Use --list for the full list.\n${planSummary(plan, flags.lang).warning}`),
      };
    }
    if (!accountName.handle) throw new CliError('ACCOUNT_NAME_MISSING');
    if (!flags.verify && flags.plan !== plan.hash)
      throw new CliError('STALE_PLAN');
    if (!flags.verify && plan.originalsPending && !flags.withoutOriginals)
      throw new CliError('ORIGINALS_PENDING');
    if (!flags.verify) {
      try {
        await store
          .browserOutcomeWriter()
          .mirrorXWarning(flags.account, flags.profile!);
        await requireXWarningFileClear(
          flags.profile!,
          context.now().toISOString(),
          plan.timeZone,
        );
        await store
          .browserOutcomeWriter()
          .requireXWarningClear(
            flags.account,
            context.now().toISOString(),
            plan.timeZone,
          );
      } catch (error) {
        if (
          error instanceof CliError &&
          (error.code === 'X_WARNING_DAY' ||
            error.code === 'X_WARNING_CARD_REQUIRED')
        ) {
          const warning =
            (await readXWarningFile(flags.profile!)) ??
            (await store.browserOutcomeWriter().xWarning(flags.account));
          if (warning)
            context.io.stderr.write(
              xWarningNotice(error.code, warning.runId, flags.lang),
            );
        }
        throw error;
      }
    }
    const { validateProfile, installedBrowser } =
      await import('../browser/profile.ts');
    await validateProfile(flags.profile!);
    const executablePath = await installedBrowser(flags.browser);
    const { runBrowser } = await import('../browser/runner.ts');
    const list =
      flags.list ?? join(flags.workspace, `delete-x-${plan.hash}.txt`);
    await assertOutput(list, flags.workspace);
    try {
      const existing = await readFile(list, 'utf8');
      if (existing !== text) throw new CliError('STALE_PLAN');
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
    const data = await runBrowser({
      store,
      plan: { ...plan, handle: accountName.handle },
      profile: flags.profile!,
      executablePath,
      verify: flags.verify,
      perDay,
      list,
      include,
      lang: flags.lang,
      signal: context.signal,
      now: context.now,
      notice: (text) => context.io.stderr.write(text),
    });
    return {
      data,
      human: `${data.completed} entries completed. Run ended: ${data.endReason}.`,
    };
  } finally {
    await store.close();
  }
}
export const deleteXCommand = buildCommand({
  parameters: {
    flags: {
      workspace: workspaceFlag,
      account: {
        kind: 'parsed',
        parse: String,
        brief: 'X account key from the workspace',
      },
      handle: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'X account name when the export has none',
      },
      dryRun: dryRunFlag,
      json: jsonFlag,
      verify: {
        kind: 'boolean',
        default: false,
        brief:
          'Read back ambiguous attempts and deletions at least seven days old',
      },
      withoutOriginals: {
        kind: 'boolean',
        default: false,
        brief: 'Explicitly continue despite unsettled originals',
      },
      profile: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Dedicated SocialPrune profile directory',
      },
      plan: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Unchanged dry-run plan hash',
      },
      list: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Write the full dry-run list to a new file',
      },
      include: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief:
          'File naming previously failed or not-found item IDs; never resends an unresolved request',
      },
      perDay: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief:
          'Lower the daily cap (maximum 200 deletion or 100 verification entries)',
      },
      acknowledgeWarning: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief:
          'Acknowledge the parent card for this warned run by typing its exact phrase; opens no browser',
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
      'Delete human-marked X entries in your visible browser, or list them without network access',
  },
  async func(this: CommandRunContext, flags: DeleteFlags) {
    this.reply(await deleteHandler(flags, this));
  },
});
