import { test } from '@playwright/test';
import {
  plantedConnection,
  plantedListener,
  plantedProcess,
} from '../../e2e/lifecycle-controls.ts';

test('RED planted listener must fail process-owned listener check', () =>
  plantedListener(4668));
test('RED planted live PID must fail process cleanup check', plantedProcess);
test('RED planted outbound TCP must fail process-owned connection check', () =>
  plantedConnection(4668));
