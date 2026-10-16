import { test } from '@playwright/test';
import { plantedListener, plantedProcess } from '../lifecycle-controls.ts';

test(
  'RED planted listener must fail process-owned listener check',
  plantedListener,
);
test('RED planted live PID must fail process cleanup check', plantedProcess);
