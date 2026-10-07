import { base, workerURLs } from 'virtual:sp-build-info';

interface ScriptURLPolicy {
  createScriptURL(value: string): unknown;
}
interface TrustedTypesAPI {
  createPolicy(
    name: string,
    rules: { createScriptURL(value: string): string },
  ): ScriptURLPolicy;
}
let policy: ScriptURLPolicy | undefined;

export function checkExecutableURL(
  value: string | URL,
  origin: string,
  allowed: readonly string[],
): string {
  const url = new URL(value, origin);
  if (
    url.origin !== new URL(origin).origin ||
    url.search ||
    url.hash ||
    !allowed.includes(url.pathname)
  )
    throw new TypeError('Executable URL is not part of this build.');
  return url.href;
}

export function scriptURL(value: string | URL): string {
  if (import.meta.env.DEV) return new URL(value, location.href).href;
  const allowed = [`${base}sw.js`, ...workerURLs];
  const verified = checkExecutableURL(value, location.href, allowed);
  const api = (
    globalThis as typeof globalThis & { trustedTypes?: TrustedTypesAPI }
  ).trustedTypes;
  if (!api) return verified;
  policy ??= api.createPolicy('socialprune', {
    createScriptURL: (candidate) =>
      checkExecutableURL(candidate, location.href, allowed),
  });
  // DOM TypeScript overloads use string. The actual value remains the native
  // TrustedScriptURL object, never a string coercion or permissive default.
  return policy.createScriptURL(verified) as string;
}
