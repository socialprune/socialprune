import type { Plugin } from 'vite';
import { PAGE_POLICY } from '../src/sw/policies.ts';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function developmentPolicy(): Plugin {
  return {
    name: 'socialprune-development-policy',
    apply: 'serve',
    configureServer(server) {
      // Freeze metadata when this server starts. A foreign dev server cannot
      // inherit a later run's freshly overwritten dist identity on request.
      const identity = readFile(
        resolve(server.config.root, 'dist/build-info.js'),
        'utf8',
      );
      server.middlewares.use(
        '/socialprune/__e2e-build-identity',
        (_request, response) => {
          void identity
            .then((body) => {
              response.setHeader('Content-Type', 'text/javascript');
              response.end(body);
            })
            .catch(() => {
              response.statusCode = 503;
              response.end('Build identity unavailable.');
            });
        },
      );
    },
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
