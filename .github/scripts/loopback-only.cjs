/* global __dirname */
// Test-process preload only. Normal CLI/browser entrypoints never load this.
const net = require('node:net');
const { createRequire, syncBuiltinESMExports } = require('node:module');
const { resolve } = require('node:path');
const { appendFileSync } = require('node:fs');
const process = require('node:process');
const allowed = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const value = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = value && typeof value === 'object' ? value : {};
  // Node/Chromium IPC uses pipes. TCP defaults to localhost when host is absent.
  const pipe =
    (typeof value === 'string' && !/^\d+$/.test(value)) ||
    typeof options.path === 'string';
  const host =
    options.host ?? (typeof args[1] === 'string' ? args[1] : 'localhost');
  if (!pipe && !allowed.has(host)) {
    if (process.env.SP_SUITE_NETWORK_FAILURE)
      appendFileSync(
        process.env.SP_SUITE_NETWORK_FAILURE,
        'NON_LOOPBACK_TCP\n',
      );
    throw new Error('BROWSER_SUITE_NON_LOOPBACK_TCP');
  }
  return connect.apply(this, args);
};
syncBuiltinESMExports();

// Browser traffic also fails closed before a foreign host is contacted, even
// if a test's own route guard regresses. The deliberately closed proxy is local;
// literal loopback hosts go straight to the generated fakes on their ports.
const requireCli = createRequire(
  resolve(__dirname, '../../apps/cli/package.json'),
);
const { chromium } = requireCli('playwright-core');
const proxy = {
  server: 'http://127.0.0.1:9',
  bypass: 'localhost,127.0.0.1,[::1]',
};
for (const method of ['launch', 'launchPersistentContext']) {
  const original = chromium[method].bind(chromium);
  chromium[method] =
    method === 'launch'
      ? (options = {}) => original({ ...options, proxy })
      : (directory, options = {}) => original(directory, { ...options, proxy });
}
