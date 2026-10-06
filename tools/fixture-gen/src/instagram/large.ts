import type { LargeOptions, ZipFileEntry } from '../shared/index.ts';
import { createRandom, writeZipFile } from '../shared/index.ts';
import { BASE_SECONDS, CURRENT, row } from './data.ts';

// The snapshot documents sharding without its threshold. 5,000 comments per
// post file and ten percent reels are explicit synthetic workload assumptions.
export const COMMENTS_PER_FILE = 5000;
export function generateLarge(options: LargeOptions): Promise<void> {
  if (
    !Number.isSafeInteger(options.count) ||
    options.count < 1 ||
    !Number.isSafeInteger(options.seed) ||
    options.seed < 0
  )
    throw new RangeError('Count and seed must be valid integers.');
  const random = createRandom(options.seed);
  const encoder = new TextEncoder();
  let next = 0;
  function content(count: number, wrapped = false): ReadableStream<Uint8Array> {
    let index = 0;
    let opened = false;
    let finished = false;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (finished) {
          controller.close();
          return;
        }
        if (!opened) {
          opened = true;
          controller.enqueue(
            encoder.encode(wrapped ? '{"comments_reels_comments":[' : '['),
          );
          return;
        }
        if (index === count) {
          finished = true;
          controller.enqueue(encoder.encode(wrapped ? ']}' : ']'));
          return;
        }
        const chunks: string[] = [];
        // Bounded chunks, no full file or archive-sized JSON buffer.
        for (
          let batch = 0;
          batch < 64 && index < count;
          batch++, index++, next++
        ) {
          const owner = `synth_owner_${Math.floor(random() * 1000)}`;
          const text = `Invented comment ${next}: ${Math.floor(random() * 100_000)} Grüße 🌿`;
          const data = row(text, owner, BASE_SECONDS + next, {
            mangled: next % 7 === 0,
          }).raw;
          chunks.push((index === 0 ? '' : ',') + JSON.stringify(data));
        }
        controller.enqueue(encoder.encode(chunks.join('')));
      },
    });
  }
  function* entries(): Iterable<ZipFileEntry> {
    const reelCount = Math.floor(options.count / 10);
    const postCount = options.count - reelCount;
    for (
      let offset = 0, part = 1;
      offset < postCount;
      offset += COMMENTS_PER_FILE, part++
    ) {
      yield {
        path: `${CURRENT}/post_comments_${part}.json`,
        content: content(Math.min(COMMENTS_PER_FILE, postCount - offset)),
      };
    }
    yield {
      path: `${CURRENT}/reels_comments.json`,
      content: content(reelCount, true),
    };
  }
  return writeZipFile(options.out, entries(), { zip64: options.zip64 });
}
