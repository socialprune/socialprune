import type { Plugin } from 'vite';
import { PAGE_POLICY } from '../src/sw/policies.ts';

export function developmentPolicy(): Plugin {
  return {
    name: 'socialprune-development-policy',
    apply: 'serve',
    resolveId(id) {
      if (id === 'virtual:sp-build-info') return '\0sp-development-build';
    },
    load(id) {
      if (id === '\0sp-development-build')
        return 'export const buildId="development";export const base="/socialprune/";export const workerURLs=[];';
    },
    transformIndexHtml(html) {
      const policy = PAGE_POLICY.replace(
        "script-src 'self'",
        "script-src 'self' 'unsafe-inline'",
      )
        .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
        .replace(
          "connect-src 'none'",
          "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
        )
        .replace(
          "; require-trusted-types-for 'script'; trusted-types socialprune",
          '',
        );
      return html.replace(PAGE_POLICY, policy);
    },
  };
}
