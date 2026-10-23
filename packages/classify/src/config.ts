import { ScanError } from './source.ts';
import { object } from './normalize.ts';

export interface SourceConfig {
  schemaVersion: 1;
  name: string;
  baseUrl: string;
  model: string;
  keyFile?: string;
  profile: 'openai-compatible' | 'llama-server' | 'ollama' | 'openrouter';
  structuredOutput: 'json_schema' | 'json_object' | 'none';
  cacheControl: boolean;
  entriesPerRequest: number;
  parallelRequests: number;
  requestTimeoutSeconds: number;
  allowPaid: boolean;
}
export function loopback(hostname: string) {
  return (
    hostname === '[::1]' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname)
  );
}
export function parseSource(input: unknown): SourceConfig {
  const value = object(input);
  const allowed = [
    'schemaVersion',
    'name',
    'baseUrl',
    'model',
    'keyFile',
    'profile',
    'structuredOutput',
    'cacheControl',
    'entriesPerRequest',
    'parallelRequests',
    'requestTimeoutSeconds',
    'allowPaid',
  ];
  if (
    !value ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    value.schemaVersion !== 1 ||
    typeof value.name !== 'string' ||
    !/^[a-z0-9._-]{1,32}$/.test(value.name) ||
    typeof value.model !== 'string' ||
    !value.model.trim() ||
    value.model.length > 200 ||
    /[\r\n]/.test(value.model) ||
    typeof value.baseUrl !== 'string'
  )
    throw new ScanError('SOURCE_FILE_INVALID');
  let url: URL;
  try {
    url = new URL(value.baseUrl);
  } catch {
    throw new ScanError('SOURCE_FILE_INVALID');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.hostname === 'localhost' ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && loopback(url.hostname)))
  )
    throw new ScanError('SOURCE_FILE_INVALID');
  const profile = value.profile ?? 'openai-compatible';
  const structuredOutput = value.structuredOutput ?? 'json_schema';
  if (
    typeof profile !== 'string' ||
    typeof structuredOutput !== 'string' ||
    !['openai-compatible', 'llama-server', 'ollama', 'openrouter'].includes(
      profile,
    ) ||
    !['json_schema', 'json_object', 'none'].includes(structuredOutput)
  )
    throw new ScanError('SOURCE_FILE_INVALID');
  const number = (key: string, min: number, max: number, fallback?: number) => {
    const n = value[key] ?? fallback;
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min || n > max)
      throw new ScanError('SOURCE_FILE_INVALID');
    return n;
  };
  for (const key of ['cacheControl', 'allowPaid'])
    if (value[key] !== undefined && typeof value[key] !== 'boolean')
      throw new ScanError('SOURCE_FILE_INVALID');
  if (
    value.keyFile !== undefined &&
    (typeof value.keyFile !== 'string' || !value.keyFile.trim())
  )
    throw new ScanError('SOURCE_FILE_INVALID');
  return {
    schemaVersion: 1,
    name: value.name,
    model: value.model,
    baseUrl: url.href.replace(/\/$/, ''),
    ...(typeof value.keyFile === 'string' ? { keyFile: value.keyFile } : {}),
    profile: profile as SourceConfig['profile'],
    structuredOutput: structuredOutput as SourceConfig['structuredOutput'],
    cacheControl:
      (value.cacheControl as boolean | undefined) ?? profile === 'openrouter',
    // No unmeasured batch-size default: the source file must name it.
    entriesPerRequest: number('entriesPerRequest', 1, 50),
    parallelRequests: number('parallelRequests', 1, 4, 1),
    requestTimeoutSeconds: number('requestTimeoutSeconds', 10, 600, 120),
    allowPaid: value.allowPaid === true,
  };
}
