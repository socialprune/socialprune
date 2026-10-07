import { importArchive, openZipArchives } from '@socialprune/core';
import type { PlatformAdapter } from '@socialprune/core';
import type { ImportMessage, ImportRequest } from './protocol.ts';

interface RunnerOptions {
  adapters: readonly PlatformAdapter[];
  post: (message: ImportMessage) => void;
  onItems?: (
    items: import('@socialprune/core').Item[],
    id: number,
  ) => Promise<void>;
  open?: typeof openZipArchives;
}

// Yield to the worker's message queue between batches, including when the
// adapter's async iterator has already buffered its next items.
const yieldToMessages = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw new DOMException('Operation aborted.', 'AbortError');
}

export function createImportRunner({
  adapters,
  post,
  onItems,
  open = openZipArchives,
}: RunnerOptions) {
  let active: { id: number; controller: AbortController } | null = null;
  let settled = Promise.resolve();

  async function run(files: File[], id: number, controller: AbortController) {
    let archive: Awaited<ReturnType<typeof open>> | undefined;
    let terminal: ImportMessage;
    try {
      archive = await open(
        files.map((file) => ({ name: file.name, blob: file })),
        { signal: controller.signal, allowDeflate64: false },
      );
      const summary = await importArchive(archive, adapters, {
        signal: controller.signal,
        onProgress: ({ items }) => post({ type: 'progress', id, items }),
        onItems: async (items) => {
          throwIfAborted(controller.signal);
          if (onItems) await onItems(items, id);
          else post({ type: 'items', id, items });
          await yieldToMessages();
          throwIfAborted(controller.signal);
        },
      });
      throwIfAborted(controller.signal);
      terminal = { type: 'summary', id, summary };
    } catch {
      // Parser errors are already represented in the core summary. Do not put
      // arbitrary exception strings, which may contain export text, in the UI.
      terminal = controller.signal.aborted
        ? { type: 'aborted', id }
        : { type: 'error', id, message: 'The archive could not be imported.' };
    }
    try {
      await archive?.close();
    } catch {
      terminal = {
        type: 'error',
        id,
        message: 'The archive could not be released.',
      };
    }
    if (controller.signal.aborted && terminal.type === 'summary')
      terminal = { type: 'aborted', id };
    active = null;
    // Terminal messages are receipts for released resources, not just parsing.
    post(terminal);
  }

  return {
    handle(request: ImportRequest): void {
      if (request.type === 'attach') return;
      if (request.type === 'abort') {
        if (active?.id === request.id) active.controller.abort();
        return;
      }
      if (active) {
        post({
          type: 'error',
          id: request.id,
          message: 'An import is already running.',
        });
        return;
      }
      if (!request.files.length) {
        post({
          type: 'error',
          id: request.id,
          message: 'Choose at least one ZIP file.',
        });
        return;
      }
      const controller = new AbortController();
      active = { id: request.id, controller };
      post({ type: 'progress', id: request.id, items: 0 });
      settled = run(request.files, request.id, controller);
    },
    settled: () => settled,
  };
}
