const { TestEnvironment } = require('jest-environment-node');

module.exports = class DeviceEnvironment extends TestEnvironment {
  async setup() {
    await super.setup();
    // Jest deliberately replaces process.send and the process event emitter.
    this.global.__HEADLESS_IPC__ = {
      send: process.send?.bind(process),
      on: listener => process.on('message', listener),
      off: listener => process.off('message', listener),
    };
  }
};
