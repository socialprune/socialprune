import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const enginePath = require.resolve('accessibility-checker-engine');
export async function checkAccessibility(page: Page, context: BrowserContext) {
  const requests: string[] = [];
  const record = (request: { url(): string }) => requests.push(request.url());
  context.on('request', record);
  try {
    await page.evaluate(await readFile(enginePath, 'utf8'));
    const report = await page.evaluate(async () => {
      const ace = Reflect.get(globalThis, 'ace') as {
        Checker: new () => {
          getGuidelineIds(): string[];
          check(
            root: Document,
            rules: string[],
          ): Promise<{
            numExecuted: number;
            results: {
              level: string;
              ruleId: string;
              message: string;
              path: { dom: string };
            }[];
          }>;
        };
      };
      const checker = new ace.Checker();
      const guidelines = checker.getGuidelineIds();
      const wcag = guidelines.find((id) => /WCAG.*2[_\.]?2/i.test(id));
      if (!wcag)
        throw new Error(
          `WCAG 2.2 rule set unavailable: ${guidelines.join(', ')}.`,
        );
      const result = await checker.check(document, [wcag]);
      return {
        ruleSet: wcag,
        executed: result.numExecuted,
        violations: result.results
          .filter(({ level }) => level === 'violation')
          .map(({ ruleId, message, path }) => ({
            ruleId,
            message,
            dom: path.dom,
          })),
      };
    });
    expect(report.executed).toBeGreaterThan(0);
    expect(report.violations, JSON.stringify(report)).toEqual([]);
    expect(requests).toEqual([]);
    return report;
  } finally {
    context.off('request', record);
  }
}
