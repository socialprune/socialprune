import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSource, nodeTransport } from '../src/node.ts';
import { EndpointSource } from '../src/endpoint.ts';
import { measureBatches } from '../src/measurement.ts';
import { loopback } from '../src/config.ts';
import { ScanError } from '../src/source.ts';

export async function main(args: string[]) {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (
      !['--source', '--confirm-endpoint', '--confirm-model'].includes(
        args[i]!,
      ) ||
      !args[i + 1] ||
      flags.has(args[i]!)
    )
      throw new ScanError('SOURCE_FILE_INVALID');
    flags.set(args[i]!, args[i + 1]!);
  }
  const path = flags.get('--source');
  if (!path) throw new ScanError('SOURCE_FILE_INVALID');
  const { config, key, keyPath } = await loadSource(path);
  const origin = new URL(config.baseUrl).origin;
  const model = flags.get('--confirm-model');
  if (flags.get('--confirm-endpoint') !== origin || model !== config.model)
    throw new ScanError('ENDPOINT_NOT_CONFIRMED');
  const signal = new AbortController();
  const stop = () => signal.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const transport = nodeTransport(origin);
  try {
    const share = loopback(new URL(origin).hostname)
      ? `Your entries' text and your criteria go to ${origin}, a program on this computer, for the model ${model}. SocialPrune cannot see where that program sends them. If it passes them to a service on the internet, they leave your computer and can count against your plan or cost money there.`
      : `Your entries' text and your criteria leave your computer for ${origin}, for the model ${model}. That service handles them under its own terms and can charge your account. SocialPrune cannot see or limit what happens to them there.`;
    process.stderr.write(
      `Generated entries only: 1000 at each of 10, 25 and 50 entries per request.\n${share}\nThe terms of the service behind ${origin} apply to what you send there, and so do the terms of X and Instagram. SocialPrune does not check them for you.\n${keyPath === null ? 'Without a key.' : `Key file: ${keyPath}. SocialPrune reads a key only from this file.`}\n`,
    );
    const source = new EndpointSource(config, transport.transport, key);
    const result = await measureBatches({
      source,
      answeringModel: model,
      confirmedOrigin: origin,
      signal: signal.signal,
      progress: (value) => process.stderr.write(JSON.stringify(value) + '\n'),
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    transport.close();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((error) => {
    const code =
      error instanceof ScanError ? error.code : 'ENDPOINT_RESPONSE_INVALID';
    process.stderr.write(JSON.stringify({ code }) + '\n');
    process.exitCode = 1;
  });
}
