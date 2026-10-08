import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';

export function networkRecorder() {
  const calls: string[] = [];
  const restore: (() => void)[] = [];
  const probes: { name: string; invoke(): unknown }[] = [];
  let inboundListen = 0;
  const originalListen: (this: net.Server, ...args: unknown[]) => net.Server =
    Reflect.get(net.Server.prototype, 'listen') as (
      this: net.Server,
      ...args: unknown[]
    ) => net.Server;
  // Node calls dns.lookup even for an IP literal when binding a listener. That
  // synchronous resolution belongs to listen, not to an outbound connection.
  net.Server.prototype.listen = function (
    this: net.Server,
    ...args: unknown[]
  ) {
    const inbound = args[0] === 0 && args[1] === '127.0.0.1';
    if (inbound) inboundListen++;
    try {
      return Reflect.apply(originalListen, this, args);
    } finally {
      if (inbound) inboundListen--;
    }
  } as typeof originalListen;
  restore.push(() => {
    net.Server.prototype.listen = originalListen;
  });
  const install = (target: object, key: string, name: string): void => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor || typeof descriptor.value !== 'function') return;
    const original = descriptor.value as (
      this: object,
      ...args: unknown[]
    ) => unknown;
    const record = function (...args: unknown[]) {
      if (
        target === dns &&
        key === 'lookup' &&
        inboundListen &&
        args[0] === '127.0.0.1'
      )
        return Reflect.apply(original, target, args);
      calls.push(name);
      throw new Error('Network recorder stopped a call.');
    };
    Object.defineProperty(target, key, { ...descriptor, value: record });
    restore.push(() => {
      Object.defineProperty(target, key, descriptor);
    });
    probes.push({
      name,
      invoke: () => {
        const value: unknown = Reflect.get(target, key);
        if (typeof value !== 'function') throw new Error('Missing recorder.');
        const result: unknown = Reflect.apply(value, target, []);
        return result;
      },
    });
  };
  install(globalThis, 'fetch', 'fetch');
  install(globalThis, 'WebSocket', 'WebSocket');
  for (const [name, target, keys] of [
    ['http', http, ['request', 'get']],
    ['https', https, ['request', 'get']],
    ['http2', http2, ['connect']],
    ['net', net, ['connect', 'createConnection']],
    ['tls', tls, ['connect']],
    ['dgram', dgram, ['createSocket']],
  ] as const) {
    for (const key of keys) install(target, key, `${name}.${key}`);
  }
  for (const [name, target] of [
    ['dns', dns],
    ['dns/promises', dnsPromises],
  ] as const) {
    for (const key of Object.keys(target)) {
      if (
        key === 'lookup' ||
        key === 'lookupService' ||
        key.startsWith('resolve')
      )
        install(target, key, `${name}.${key}`);
    }
  }
  syncBuiltinESMExports();
  return {
    calls,
    probes,
    restore() {
      for (const undo of restore.reverse()) undo();
      syncBuiltinESMExports();
    },
  };
}
