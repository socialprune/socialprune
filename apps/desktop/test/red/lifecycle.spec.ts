import { test } from '@playwright/test';
import { WINDOWS_QUERY_TIMEOUT_MS } from '../../packaging/windows-powershell.ts';
import { BROWSER_CLEANUP_TIMEOUT_MS } from '../windows.ts';
import {
  plantedConnection,
  plantedListener,
  plantedProcess,
} from '../../e2e/lifecycle-controls.ts';

// Compiler setup, complete cleanup grace, and settlement of its last query.
test.setTimeout(WINDOWS_QUERY_TIMEOUT_MS * 2 + BROWSER_CLEANUP_TIMEOUT_MS);
test('RED planted listener must fail process-owned listener check', () =>
  plantedListener(4668));
test('RED planted live PID must fail process cleanup check', plantedProcess);
test('RED planted outbound TCP must fail process-owned connection check', () =>
  plantedConnection(4668));
