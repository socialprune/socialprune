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
  const install = (target: object, key: string, name: string): void => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor || typeof descriptor.value !== 'function') return;
    const record = function () {
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
