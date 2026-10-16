import { runBrowser } from '../browser/runner.ts';
import { runFill } from '../browser/x/fill/run.ts';
import { runContext } from '../browser/instagram/run.ts';
import { installedBrowser } from '../browser/profile.ts';
import { ordinarySetup } from '../browser/setup.ts';

export interface EngineDependencies {
  delete: typeof runBrowser;
  fill: typeof runFill;
  context: typeof runContext;
  browser: typeof installedBrowser;
  setup: typeof ordinarySetup;
  now: () => Date;
}
export const productionDependencies: EngineDependencies = {
  delete: runBrowser,
  fill: runFill,
  context: runContext,
  browser: installedBrowser,
  setup: ordinarySetup,
  now: () => new Date(),
};
