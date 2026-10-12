import { rm } from 'node:fs/promises';
import { buildCommand } from '@stricli/core';
import { jsonFlag } from '../cli/context.ts';
import type { CommandRunContext } from '../cli/context.ts';
import { CliError } from '../cli/errors.ts';

const profileFlag = {
  kind: 'parsed',
  parse: String,
  brief: 'Dedicated SocialPrune profile directory',
} as const;
export const browserSetupCommand = buildCommand({
  parameters: {
    flags: {
      profile: profileFlag,
      json: jsonFlag,
      platform: {
        kind: 'enum',
        values: ['x'],
        brief: 'Platform for this profile',
      },
      browser: {
        kind: 'enum',
        values: ['chrome', 'edge'],
        optional: true,
        brief: 'Installed browser',
      },
    },
  },
  docs: {
    brief: 'Create a dedicated profile; sign in yourself in its visible window',
  },
  async func(
    this: CommandRunContext,
    flags: {
      profile: string;
      platform: 'x';
      browser?: 'chrome' | 'edge';
      json: boolean;
    },
  ) {
    if (!this.stdoutIsTerminal || flags.json)
      throw new CliError('NOT_INTERACTIVE');
    const { createProfile, installedBrowser } =
      await import('../browser/profile.ts');
    const executablePath = await installedBrowser(flags.browser);
    await createProfile(flags.profile);
    const { ordinarySetup } = await import('../browser/setup.ts');
    await ordinarySetup({
      profile: flags.profile,
      executablePath,
      signal: this.signal,
      notice: (text) => this.io.stderr.write(text),
    });
    this.reply({
      data: { platform: flags.platform },
      human: 'Profile setup window closed.',
    });
  },
});
export const browserForgetCommand = buildCommand({
  parameters: { flags: { profile: profileFlag, json: jsonFlag } },
  docs: {
    brief:
      'Remove a dedicated profile after confirmation; sign out in it first',
  },
  async func(
    this: CommandRunContext,
    flags: { profile: string; json: boolean },
  ) {
    if (!this.stdoutIsTerminal || flags.json)
      throw new CliError('NOT_INTERACTIVE');
    const { validateProfile, installedBrowser } =
      await import('../browser/profile.ts');
    await validateProfile(flags.profile);
    const { startConfirmation } = await import('../browser/confirmation.ts');
    const confirmation = await startConfirmation({
      phase: 'start',
      warning:
        'Remove this dedicated browser profile, including its signed-in session and local browser data. Sign out on X first. This cannot be undone.',
      profileWarning: flags.profile,
      planned: 0,
      bulk: 0,
      estimateMs: 0,
      list: flags.profile,
      rows: [],
      completed: 0,
      result: 'Start confirms removal of the named folder. Stop cancels.',
    });
    const { chromium } = await import('playwright-core');
    const context = await chromium.launch({
      executablePath: await installedBrowser(),
      headless: false,
    });
    try {
      const started = confirmation.wait('start');
      const page = await context.newPage();
      await page.goto(confirmation.launchUrl);
      const closed = new Promise<false>((resolve) =>
        context.once('disconnected', () => resolve(false)),
      );
      if (await Promise.race([started, closed])) {
        await validateProfile(flags.profile);
        await rm(flags.profile, { recursive: true });
        this.reply({
          data: { removed: true },
          human: 'Dedicated profile removed.',
        });
      } else
        this.reply({
          data: { removed: false },
          human: 'Profile removal cancelled.',
        });
    } finally {
      await confirmation.close();
      await context.close();
    }
  },
});
