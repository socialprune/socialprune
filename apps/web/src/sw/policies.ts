export const PAGE_POLICY =
  "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'none'; style-src 'self'; img-src 'self'; font-src 'none'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'; trusted-types socialprune";
export const DOCUMENT_POLICY = `${PAGE_POLICY}; frame-ancestors 'none'`;
export const DATA_WORKER_POLICY =
  "default-src 'none'; script-src 'self'; connect-src 'none'; worker-src 'none'";

export interface BuildManifest {
  buildId: string;
  base: string;
  files: { url: string; sha256: string }[];
  workerPolicies: Record<string, string>;
}
