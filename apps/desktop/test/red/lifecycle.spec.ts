import { test } from '@playwright/test';
import { WINDOWS_QUERY_TIMEOUT_MS } from '../../packaging/windows-powershell.ts';
import {
  plantedConnection,
  plantedListener,
  plantedProcess,
} from '../../e2e/lifecycle-controls.ts';

test.setTimeout(WINDOWS_QUERY_TIMEOUT_MS * 2);
test('RED planted listener must fail process-owned listener check', () =>
  plantedListener(4668));
test('RED planted live PID must fail process cleanup check', plantedProcess);
test('RED planted outbound TCP must fail process-owned connection check', () =>
  plantedConnection(4668));
