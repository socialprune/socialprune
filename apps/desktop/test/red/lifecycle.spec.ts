import { test } from '@playwright/test';
import { WINDOWS_QUERY_TIMEOUT_MS } from '../../packaging/windows-powershell.ts';
import { PROCESS_POLL_TIMEOUT_MS } from '../../packaging/query-poll.ts';
import {
  plantedConnection,
  plantedListener,
  plantedProcess,
} from '../../e2e/lifecycle-controls.ts';

// Compiler setup, complete derived poll, and settlement of its last query.
test.setTimeout(WINDOWS_QUERY_TIMEOUT_MS * 2 + PROCESS_POLL_TIMEOUT_MS);
test('RED planted listener must fail process-owned listener check', () =>
  plantedListener(4668));
test('RED planted live PID must fail process cleanup check', plantedProcess);
test('RED planted outbound TCP must fail process-owned connection check', () =>
  plantedConnection(4668));
