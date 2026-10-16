import { chromium } from '@playwright/test';
import type { BrowserContext } from 'playwright-core';
import { createEngine } from '../src/engine/facade.ts';
import type { EngineOptions } from '../src/engine/host.ts';
import { productionDependencies } from '../src/engine/dependencies.ts';
import { runWithDependencies } from '../src/browser/runner.ts';
import { productionPace } from '../src/browser/pace.ts';
import { pageDriver } from '../src/browser/x/driver.ts';
import { runFillWithDependencies } from '../src/browser/x/fill/run.ts';
import { runContextWithDependencies } from '../src/browser/instagram/run.ts';
import { productionContext } from '../src/browser/instagram/driver.ts';
import { productionMedia } from '../src/originals/video.ts';
import { SyndicationClient } from '../src/originals/syndication.ts';
import { windowArguments, waitForBrowserClose } from '../src/browser/launch.ts';

export interface EngineTestOptions {
  xOrigin: string;
  instagramOrigin: string;
  now?: () => Date;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  launched?(context: BrowserContext): Promise<void>;
  beforeDelete?(): Promise<void>;
  session?(
    value: NonNullable<Parameters<typeof runWithDependencies>[0]['session']>,
  ): void;
}
/** Separate test bundle: only this entry selects generated hosts and Chromium. */
export function openTestEngine(
  options: EngineOptions,
  test: EngineTestOptions,
) {
  const now = test.now ?? (() => new Date());
  const sleep = test.sleep ?? (() => Promise.resolve());
  const launch = async (
    profile: string,
    executablePath: string,
    placement = options.windowPlacement,
    offline = false,
  ) => {
    const context = await chromium.launchPersistentContext(profile, {
      executablePath,
      headless: true,
      offline,
      chromiumSandbox: true,
      args: ['--enable-automation', ...windowArguments(placement)],
      serviceWorkers: 'block',
      ignoreDefaultArgs: ['--disable-infobars'],
    });
    await test.launched?.(context);
    return context;
  };
  return createEngine(options, {
    ...productionDependencies,
    now,
    browser: () => Promise.resolve(chromium.executablePath()),
    setup: () => Promise.resolve(),
    delete: (options) => {
      if (options.session) test.session?.(options.session);
      return runWithDependencies(options, {
        pace: productionPace(options.verify ? 'verify' : 'delete'),
        confirmationPort: 0,
        sleep,
        driver: async (configuration) => {
          const context = await launch(
            configuration.profile,
            configuration.executablePath,
            configuration.windowPlacement,
          );
          configuration.onLaunched?.(() => context.close());
          context.once('close', () => configuration.onClosed?.());
          const driver = await pageDriver({
            context,
            origin: test.xOrigin,
            allowedOrigins: [test.xOrigin],
            confirmationOrigin: configuration.confirmationOrigin,
            responseTimeoutMs: 3000,
            signal: configuration.signal,
            record: (request) => configuration.record(request),
            desktop: true,
          });
          return {
            ...driver,
            close: () => waitForBrowserClose(context),
            async delete(id, action) {
              await test.beforeDelete?.();
              return driver.delete(id, action);
            },
          };
        },
      });
    },
    fill: (options) => {
      if (options.session) test.session?.(options.session);
      return runFillWithDependencies(options, {
        origin: test.xOrigin,
        port: 0,
        responseMs: 3000,
        intervalMs: 30000,
        batch: 20,
        pauseMs: 900000,
        media: productionMedia,
        syndication: new SyndicationClient(),
        launch,
        sleep,
        close: (context, automatic) =>
          automatic ? context.close() : waitForBrowserClose(context),
      });
    },
    context: (options) => {
      if (options.session) test.session?.(options.session);
      return runContextWithDependencies(options, {
        ...productionContext,
        origin: test.instagramOrigin,
        port: 0,
        responseMs: 3000,
        policy: {
          platform: (url) => new URL(url).origin === test.instagramOrigin,
          image: (url) =>
            new URL(url).origin === test.instagramOrigin &&
            new URL(url).pathname.startsWith('/media/'),
        },
        launch: (profile, executable) =>
          launch(profile, executable, options.windowPlacement, true),
        sleep,
        close: (context, automatic) =>
          automatic ? context.close() : waitForBrowserClose(context),
      });
    },
  });
}
