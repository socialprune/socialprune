// A separate entry lets the gate track the demo instance without changing the
// real parser, archive codec, MessageChannel or import runner.
import '@socialprune/core/browser-init';
import './worker.ts';
