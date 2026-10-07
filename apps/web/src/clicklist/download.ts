export interface DownloadEnvironment {
  pick?: (name: string) => Promise<{
    write(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
    close(): Promise<void>;
    abort(reason?: unknown): Promise<void>;
  }>;
  anchor: (blob: Blob, name: string) => void;
}
export function browserDownloadEnvironment(): DownloadEnvironment {
  const picker = (
    window as Window & {
      showSaveFilePicker?: (options: {
        suggestedName: string;
      }) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;
  return {
    pick: picker
      ? async (name) =>
          (await picker.call(window, { suggestedName: name })).createWritable()
      : undefined,
    anchor(blob, name) {
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    },
  };
}

/** Encode string chunks without stripping U+FEFF, unlike TextDecoder defaults. */
export async function saveTextDownload(
  name: string,
  mime: string,
  produce: (write: (chunk: string) => Promise<void>) => Promise<void>,
  environment: DownloadEnvironment = browserDownloadEnvironment(),
) {
  const sink = environment.pick ? await environment.pick(name) : null;
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const encoder = new TextEncoder();
  try {
    await produce(async (chunk) => {
      const bytes = encoder.encode(chunk);
      if (sink) await sink.write(bytes);
      else parts.push(bytes);
    });
    if (sink) await sink.close();
    else environment.anchor(new Blob(parts, { type: mime }), name);
  } catch (error) {
    if (sink) await sink.abort(error);
    throw error;
  }
}
