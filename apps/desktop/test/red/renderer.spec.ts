import { test } from '@playwright/test';
import { exerciseControl } from '../../e2e/controls.spec.ts';

for (const kind of ['node', 'inline', 'network'] as const)
  test(`RED planted ${kind} must fail the acceptance observer`, async () =>
    exerciseControl(kind, true));
