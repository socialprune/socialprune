// Node exposes MessagePort globally, but @types/node declares only its value.
// Keep the shared protocol's instance annotation in the Node type environment,
// without admitting DOM types into the CLI.
export {};
declare global {
  type MessagePort = import('node:worker_threads').MessagePort;
}
