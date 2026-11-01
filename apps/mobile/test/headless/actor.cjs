const path = require('node:path');
const fs = require('node:fs');
const { setTimeout: realTimeout, clearTimeout: clearRealTimeout } = require('node:timers');

if (process.env.NODE_ENV == null) process.env.NODE_ENV = 'test';
if (process.env.JEST_WORKER_ID == null) process.env.JEST_WORKER_ID = '1';

function fail(error) {
  fs.writeSync(2, `[headless-actor] ${error?.stack ?? String(error)}\n`);
  process.exit(1);
}

process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
const lifetimeMs = require('./actor.config.cjs').testTimeout;
const lifetimeTimer = realTimeout(() => fail(new Error(`Headless actor lifetime exceeded ${lifetimeMs} ms`)), lifetimeMs);

async function main() {
  const mobileRoot = path.resolve(__dirname, '../..');
  const { NullConsole } = require('@jest/console');
  const originalConsole = globalThis.console;
  globalThis.console = new NullConsole(process.stdout, process.stderr);
  const loader = require('./loader.cjs').install({ mobileRoot });
  globalThis.__HEADLESS_IPC__ = {
    send: process.send.bind(process),
    on: listener => process.on('message', listener),
    off: listener => process.off('message', listener),
  };
  const disconnected = new Promise(resolve => process.once('disconnect', resolve));
  try {
    await require('./runtime.cjs').run(loader.jest);
    // The owner disconnects only after receiving the close result.
    await disconnected;
  } finally {
    clearRealTimeout(lifetimeTimer);
    loader.cleanup();
    globalThis.console = originalConsole;
    delete globalThis.__HEADLESS_IPC__;
  }
}

void main().catch(fail);
