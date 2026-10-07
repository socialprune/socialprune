import { afterEach, expect, test, vi } from 'vitest';
import type { Item } from '@socialprune/core';
import { ImportClient } from './client.ts';
import type { ImportMessage, ImportRequest } from './protocol.ts';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent<ImportMessage>) => void) | null = null;
  onerror: (() => void) | null = null;
  requests: ImportRequest[] = [];
  terminated = false;
  constructor() {
    TestWorker.instances.push(this);
  }
  postMessage(request: ImportRequest) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: ImportMessage) {
    this.onmessage?.({ data } as MessageEvent<ImportMessage>);
  }
}

function setup() {
  vi.stubGlobal('Worker', TestWorker);
  const client = new ImportClient(() => new Worker('test-only'));
  const worker = TestWorker.instances.at(-1)!;
  client.start([new File(['generated'], 'test.zip')]);
  return { client, worker };
}
const items = [{ id: 'invented' }] as Item[];
afterEach(() => {
  vi.unstubAllGlobals();
  TestWorker.instances = [];
});

test('retains real batches and ignores stale or post-terminal messages', () => {
  const { client, worker } = setup();
  worker.emit({ type: 'items', id: 0, items });
  expect(client.snapshot.items).toEqual([]);
  worker.emit({ type: 'items', id: 1, items });
  worker.emit({
    type: 'summary',
    id: 1,
    summary: { status: 'ok', records: [] },
  });
  worker.emit({ type: 'items', id: 1, items });
  expect(client.snapshot.phase).toBe('complete');
  expect(client.snapshot.items).toEqual(items);
  expect(client.snapshot.batches).toBe(1);
  client.dispose();
});

test('discards partial items only on the abort receipt and can start again', () => {
  const { client, worker } = setup();
  worker.emit({ type: 'items', id: 1, items });
  client.abort();
  expect(worker.requests.at(-1)).toEqual({ type: 'abort', id: 1 });
  expect(client.snapshot.phase).toBe('aborting');
  worker.emit({ type: 'aborted', id: 1 });
  expect(client.snapshot.phase).toBe('aborted');
  expect(client.snapshot.items).toEqual([]);
  client.start([new File(['generated'], 'second.zip')]);
  expect(worker.requests.at(-1)).toMatchObject({ type: 'import', id: 2 });
  client.dispose();
});

test('preserves queued final batches if completion wins the abort race', () => {
  const { client, worker } = setup();
  client.abort();
  worker.emit({ type: 'items', id: 1, items });
  worker.emit({
    type: 'summary',
    id: 1,
    summary: { status: 'ok', records: [] },
  });
  expect(client.snapshot.phase).toBe('complete');
  expect(client.snapshot.items).toEqual(items);
  client.dispose();
});

test('replaces a crashed worker on retry and terminates the owned worker on disposal', () => {
  const { client, worker } = setup();
  worker.onerror?.();
  expect(client.snapshot.phase).toBe('error');
  expect(worker.terminated).toBe(true);
  client.start([new File(['generated'], 'second.zip')]);
  const replacement = TestWorker.instances.at(-1)!;
  expect(replacement).not.toBe(worker);
  expect(replacement.requests.at(-1)).toMatchObject({ type: 'import', id: 2 });
  client.dispose();
  expect(replacement.terminated).toBe(true);
  expect(() => client.start([new File(['generated'], 'third.zip')])).toThrow(
    'disposed',
  );
});
