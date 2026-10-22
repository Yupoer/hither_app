const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: realTimeout, clearTimeout: clearRealTimeout } = require('node:timers');
const { Backend, EPOCH } = require('./backend.cjs');

class World {
  constructor() {
    this.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hither-headless-'));
    this.devices = new Map();
    this.fatals = [];
    this.revision = 0;
    this.held = [];
    this.holds = new Map();
    this.events = [];
    this.realtimeTrace = [];
    this.now = EPOCH;
    this.backend = new Backend(event => this.events.push(event));
  }
  check() { assert.equal(this.fatals.length, 0, this.fatals.join('\n')); }
  async device({ id, userId, platform = 'ios' }) {
    assert(!this.closed, 'World is closed');
    assert(/^[a-zA-Z0-9_-]+$/.test(id), 'Safe device id required');
    assert(!this.devices.has(id), `Duplicate device ${id}`);
    const device = new Device(this, { id, userId, platform });
    this.devices.set(id, device);
    await device.boot();
    return device;
  }
  hold(rpcName, { phase = 'execution', deviceId } = {}) {
    assert(['execution', 'delivery'].includes(phase));
    this.holds.set(rpcName, { phase, deviceId });
  }
  async release(rpcName) {
    this.holds.delete(rpcName);
    const ready = this.held.filter(item => item.operation.name === rpcName);
    this.held = this.held.filter(item => item.operation.name !== rpcName);
    for (const item of ready) this.respond(item);
    await this.settle();
  }
  execute(device, operation) {
    return device.online ? this.backend.execute(device.spec.id, operation)
      : { data: null, error: { message: 'Network request failed', code: 'NETWORK_ERROR' } };
  }
  respond(item) {
    const { device, generation, id, operation } = item;
    if (device.generation !== generation || !device.child?.connected) return;
    let result;
    let fatal;
    try {
      result = Object.hasOwn(item, 'result') ? item.result : this.execute(device, operation);
    } catch (error) {
      fatal = error.stack ?? String(error);
      this.fatals.push(fatal);
      result = { data: null, error: { message: fatal } };
    }
    device.child.send({ type: 'response', generation, id, result, fatal });
    this.revision++;
  }
  async settle() {
    for (let round = 0; round < 30; round++) {
      this.check();
      const before = this.revision;
      for (const event of this.events.splice(0)) for (const device of this.devices.values()) {
        if (device.online && device.realtime && device.child?.connected) {
          this.realtimeTrace.push({ deviceId: device.spec.id, event: structuredClone(event) });
          await device.command({ kind: 'event', event });
        }
      }
      const barriers = await Promise.all([...this.devices.values()].filter(d => d.child?.connected)
        .map(device => device.command({ kind: 'barrier' }).then(result => ({ device, result }))));
      const pending = barriers.some(({ device, result }) => result.pending.some(id =>
        !this.held.some(item => item.device === device && item.generation === device.generation && item.id === id)));
      if (!pending && before === this.revision && this.events.length === 0) {
        this.check();
        return;
      }
    }
    throw new Error(`Headless settle exceeded 30 turns; held=${this.held.length}, events=${this.events.length}`);
  }
  async advance(ms) {
    assert(Number.isSafeInteger(ms) && ms >= 0);
    this.now += ms;
    this.backend.now = this.now;
    for (const device of this.devices.values()) await device.command({ kind: 'advance', ms });
    await this.settle();
  }
  async waitFor(device, predicate, description = 'device observation') {
    let value;
    for (let round = 0; round < 30; round++) {
      await this.settle();
      value = await device.observe();
      if (predicate(value)) return value;
    }
    throw new Error(`Did not observe ${description}: ${JSON.stringify(value)}`);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    const errors = [];
    for (const device of this.devices.values()) {
      try { await device.dispose(); } catch (error) { errors.push(error); }
    }
    const resolved = path.resolve(this.directory);
    assert(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`) && path.basename(resolved).startsWith('hither-headless-'));
    fs.rmSync(resolved, { recursive: true, force: true });
    try { this.check(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, `Headless disposal failed: ${errors.map(error => error.stack ?? error).join('\n')}`);
  }
}

class Device {
  constructor(world, spec) {
    this.world = world;
    this.spec = spec;
    this.generation = 0;
    this.online = true;
    this.realtime = true;
    this.nextCommand = 0;
    this.pending = new Map();
    this.context = null;
  }
  async boot() {
    this.generation++;
    const directory = path.join(this.world.directory, this.spec.id);
    fs.mkdirSync(directory, { recursive: true });
    const generation = this.generation;
    this.logs = '';
    this.child = fork(require.resolve('jest/bin/jest'), ['--config', 'test/headless/actor.config.cjs', '--runInBand', '--silent'], {
      cwd: path.dirname(require.resolve('../../package.json')),
      env: { ...process.env, HITHER_HEADLESS_DEVICE: JSON.stringify({ ...this.spec, directory, generation, now: this.world.now }) },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    this.child.stdout.on('data', chunk => { this.logs = (this.logs + chunk).slice(-16000); });
    this.child.stderr.on('data', chunk => { this.logs = (this.logs + chunk).slice(-16000); });
    let ready;
    let failed;
    const boot = new Promise((resolve, reject) => { ready = resolve; failed = reject; });
    this.exited = new Promise(resolve => this.child.once('exit', (code, signal) => {
      for (const { reject, timer } of this.pending.values()) {
        clearRealTimeout(timer);
        reject(new Error(`Device ${this.spec.id} exited (${code}/${signal}): ${this.logs}`));
      }
      this.pending.clear();
      failed(new Error(`Device ${this.spec.id} failed boot (${code}/${signal}): ${this.logs}`));
      resolve({ code, signal });
    }));
    this.child.on('error', failed);
    this.child.on('message', wire => {
      const message = JSON.parse(JSON.stringify(wire));
      if (message.generation !== generation) return;
      if (message.type === 'stage') { this.logs += `\n${message.value}`; return; }
      if (message.type === 'ready') { ready(); return; }
      if (message.type === 'request') {
        const item = { device: this, generation, id: message.id, operation: message.operation };
        this.world.revision++;
        const hold = this.world.holds.get(message.operation.name);
        if (hold && (!hold.deviceId || hold.deviceId === this.spec.id)) {
          if (hold.phase === 'delivery') {
            try { item.result = this.world.execute(this, item.operation); }
            catch (error) { this.world.fatals.push(error.stack ?? String(error)); }
          }
          this.world.held.push(item);
        } else this.world.respond(item);
        return;
      }
      if (message.type === 'cancel') {
        this.world.held = this.world.held.filter(item => !(item.device === this && item.generation === generation && item.id === message.id));
        this.world.revision++;
        return;
      }
      if (message.type === 'result') {
        const pending = this.pending.get(message.id);
        if (!pending) { this.world.fatals.push(`Unexpected result ${message.id}`); return; }
        this.pending.delete(message.id);
        clearRealTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error));
        else pending.resolve(message.result);
        return;
      }
      this.world.fatals.push(`Unexpected child message ${message.type}`);
    });
    await deadline(boot, 20000, `Boot ${this.spec.id}`).catch(error => { throw new Error(`${error.message}: ${this.logs}`); });
  }
  command(command) {
    assert(this.child?.connected, `Device ${this.spec.id} is closed`);
    const id = ++this.nextCommand;
    return new Promise((resolve, reject) => {
      const timer = realTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Device ${this.spec.id} ${command.kind} deadline: ${this.logs}`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.send({ type: 'command', generation: this.generation, id, command });
    });
  }
  async perform(name, input = {}) {
    if (name === 'group.observe') this.context = input.groupId;
    return this.command({ kind: 'perform', name, input });
  }
  input(input) { return this.command({ kind: 'input', input }); }
  gps(latitude, longitude, options = {}) { return this.input({ kind: 'gps', latitude, longitude, ...options }); }
  async observe() { this.world.check(); return this.command({ kind: 'observe' }); }
  async restart() {
    await this.dispose();
    await this.boot();
    if (this.context) await this.perform('group.observe', { groupId: this.context });
    await this.world.settle();
  }
  async dispose() {
    if (!this.child) return;
    const child = this.child;
    try {
      if (child.connected) {
        const receipt = await this.command({ kind: 'close' });
        this.disposal = receipt;
        assert.equal(receipt.pending, 0, 'Unresolved SDK requests during disposal');
        child.disconnect();
      }
      const exit = await deadline(this.exited, 5000, `Exit ${this.spec.id}`);
      assert.equal(exit.code, 0, this.logs);
      assert.deepEqual(this.disposal?.fatal ?? [], [], 'Sticky external failure');
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await deadline(this.exited, 5000, `Kill ${this.spec.id}`);
      }
      this.child = null;
    }
  }
}

function deadline(promise, ms, description) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = realTimeout(() => reject(new Error(`${description} deadline`)), ms);
  })]).finally(() => clearRealTimeout(timer));
}

module.exports = { World };
