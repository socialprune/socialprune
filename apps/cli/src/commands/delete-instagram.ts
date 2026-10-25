import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { buildCommand } from '@stricli/core';
import type { CliContext, CommandRunContext } from '../cli/context.ts';
import { workspaceFlag, dryRunFlag, jsonFlag } from '../cli/context.ts';
import { CliError } from '../cli/errors.ts';
import { workspacePath, assertOutput } from '../workspace/files.ts';
import { requireWorkspaceNode } from '../workspace/node-version.ts';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import {
  planInstagramDeletion,
  instagramDeleteSummary,
} from '../browser/instagram/delete-plan.ts';
import { instagramHandle } from '../browser/instagram/plan.ts';
import { resolveAccountName } from '../browser/plan.ts';
import { acknowledgeWarningCard } from './delete.ts';

export interface InstagramDeleteFlags {
  workspace: string;
  account: string;
  handle?: string;
  profile?: string;
  plan?: string;
  list?: string;
  perDay?: string;
  browser?: 'chrome' | 'edge';
  lang: 'en' | 'de';
  json: boolean;
  dryRun: boolean;
  verify: boolean;
  acknowledgeWarning?: string;
}
export async function deleteInstagramHandler(
  flags: InstagramDeleteFlags,
  context: CliContext,
) {
  if (
    (flags.dryRun && flags.verify) ||
    (flags.json && flags.list) ||
    (flags.acknowledgeWarning &&
      (flags.dryRun || flags.verify || flags.plan || !flags.profile))
  )
    throw new CliError('INVALID_ARGUMENTS');
  if (!flags.dryRun && flags.list) throw new CliError('INVALID_ARGUMENTS');
  if (!flags.dryRun && (flags.json || !context.stdoutIsTerminal))
    throw new CliError('NOT_INTERACTIVE');
  if (
    !flags.dryRun &&
    (!flags.profile ||
      (!flags.verify && !flags.plan && !flags.acknowledgeWarning))
  )
    throw new CliError('INVALID_ARGUMENTS');
  const perDay = flags.perDay === undefined ? 50 : Number(flags.perDay);
  if (!Number.isInteger(perDay) || perDay < 1 || perDay > 50)
    throw new CliError('INVALID_ARGUMENTS');
  const handle = instagramHandle(flags.handle);
  requireWorkspaceNode(context.nodeVersion ?? process.versions.node);
  const target = await workspacePath(flags.workspace, false);
  const store = await SQLiteStore.open(target.path, { readOnly: flags.dryRun });
  try {
    const plan = await planInstagramDeletion(
      store,
      flags.account,
      context.now(),
    );
    const account = resolveAccountName(plan.handle, handle);
    if (flags.verify) {
      const { verificationRows } =
        await import('../browser/instagram/delete-run.ts');
      plan.rows = (
        await verificationRows(store, flags.account, context.now())
      ).map((entry) => entry.row);
      plan.canary = false;
    }
    const summary = instagramDeleteSummary(plan, flags.lang);
    const text = `${summary.planned} Instagram comments planned. Plan: ${plan.hash}\n${summary.warning}\n${plan.rows.map((row) => `${row.item.id}\t${row.item.createdAt}\t${row.item.text.split(/\r?\n/, 1)[0]!.replace(/[\u0000-\u001f\u007f]/g, ' ')}`).join('\n')}\n`;
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
      return {
        data: summary,
        human:
          context.stdoutIsTerminal && !flags.list
            ? text
            : `${summary.planned} comments planned. Plan: ${plan.hash}\n${summary.warning}`,
      };
    }
    const { validateProfile, installedBrowser } =
      await import('../browser/profile.ts');
    await validateProfile(flags.profile!, 'instagram');
    if (flags.acknowledgeWarning) {
      if (!process.stdin.isTTY) throw new CliError('NOT_INTERACTIVE');
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
        'instagram',
      );
      return {
        data: { acknowledgedRun: flags.acknowledgeWarning },
        human:
          flags.lang === 'de'
            ? 'Karte bestätigt. Kein Browser geöffnet, keine Löschung gestartet. Erstelle einen neuen Testlauf.'
            : 'Card acknowledged. No browser opened and no deletion started. Make a fresh dry run.',
      };
    }
    if (!account.handle) throw new CliError('ACCOUNT_NAME_MISSING');
    if (!flags.verify && flags.plan !== plan.hash)
      throw new CliError('STALE_PLAN');
    const executablePath = await installedBrowser(flags.browser);
    const { runInstagramDeletion } =
      await import('../browser/instagram/delete-run.ts');
    const data = await runInstagramDeletion({
      store,
      workspace: flags.workspace,
      plan: { ...plan, handle: account.handle },
      profile: flags.profile!,
      executablePath,
      lang: flags.lang,
      verify: flags.verify,
      perDay,
      list: text,
      now: context.now,
      signal: context.signal,
      notice: (value) => context.io.stderr.write(value),
    });
    return {
      data,
      human: `${data.completed} comments completed; ${data.unverified} remain unverified. Run ended: ${data.endReason}.`,
    };
  } finally {
    await store.close();
  }
}
export const deleteInstagramCommand = buildCommand({
  parameters: {
    flags: {
      workspace: workspaceFlag,
      account: {
        kind: 'parsed',
        parse: String,
        brief: 'Instagram account key in the workspace',
      },
      handle: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Expected Instagram account when the export has no name',
      },
      dryRun: dryRunFlag,
      json: jsonFlag,
      verify: {
        kind: 'boolean',
        default: false,
        brief:
          'Read only: reconcile ambiguous attempts and check deletions at least seven days old',
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
        brief: 'Unchanged day-bound dry-run plan hash',
      },
      list: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Write the full dry-run list to a new file',
      },
      perDay: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Lower the deletion attempt cap, 1 through 50',
      },
      acknowledgeWarning: {
        kind: 'parsed',
        parse: String,
        optional: true,
        brief: 'Person-only run-named card acknowledgement; opens no browser',
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
        brief: 'SocialPrune language; Instagram must be in English',
      },
    },
  },
  docs: {
    brief:
      'Plan or delete only human-marked, post-confirmed Instagram comments in your visible browser',
  },
  async func(this: CommandRunContext, flags: InstagramDeleteFlags) {
    this.reply(await deleteInstagramHandler(flags, this));
  },
});
