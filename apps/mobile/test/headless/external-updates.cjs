const assert = require('node:assert/strict');

exports.createExternalUpdates = ({ strict = (_name, value) => value, profile = {} } = {}) => {
  const state = { isEnabled: true, isEmbeddedLaunch: true, updateId: null, runtimeVersion: 'headless',
    isUpdateAvailable: false, isUpdatePending: false, check: { isAvailable: false }, fetch: { isNew: false },
    checkError: null, fetchError: null, reloadError: null };
  const receipts = [];
  const listeners = new Set();
  const held = new Map();
  let snapshot;
  const publish = () => {
    snapshot = { isUpdateAvailable: state.isUpdateAvailable, isUpdatePending: state.isUpdatePending };
    for (const listener of listeners) listener();
  };
  const configure = patch => {
    assert(patch && typeof patch === 'object' && !Array.isArray(patch));
    for (const [key, value] of Object.entries(patch)) {
      assert(Object.hasOwn(state, key), `Unsupported Updates fixture ${key}`);
      state[key] = structuredClone(value);
    }
    publish();
  };
  configure(profile);
  const call = async method => {
    receipts.push({ method });
    if (held.has(method)) await new Promise(resolve => held.get(method).push(resolve));
    const key = { checkForUpdateAsync: 'check', fetchUpdateAsync: 'fetch', reloadAsync: 'reload' }[method];
    if (state[`${key}Error`]) throw new Error(String(state[`${key}Error`]));
    return key === 'reload' ? undefined : structuredClone(state[key]);
  };
  const updates = strict('expo-updates', {
    get isEnabled() { return state.isEnabled; },
    get isEmbeddedLaunch() { return state.isEmbeddedLaunch; },
    get updateId() { return state.updateId; },
    get runtimeVersion() { return state.runtimeVersion; },
    checkForUpdateAsync: () => call('checkForUpdateAsync'),
    fetchUpdateAsync: () => call('fetchUpdateAsync'),
    reloadAsync: () => call('reloadAsync'),
    useUpdates: () => require('react').useSyncExternalStore(listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }, () => snapshot),
  });
  return {
    modules: { 'expo-updates': updates },
    handles: kind => ['updates.configure', 'updates.hold', 'updates.release'].includes(kind),
    input(input) {
      if (input.kind === 'updates.configure') configure(input.value);
      else if (input.kind === 'updates.hold') {
        assert(['checkForUpdateAsync', 'fetchUpdateAsync', 'reloadAsync'].includes(input.method));
        assert(!held.has(input.method), 'Updates method already held');
        held.set(input.method, []);
      } else if (input.kind === 'updates.release') {
        assert(held.has(input.method), 'Updates method is not held');
        const pending = held.get(input.method);
        held.delete(input.method);
        for (const resolve of pending) resolve();
      } else throw new Error(`Unsupported Updates input ${input.kind}`);
    },
    observe: () => ({ state: structuredClone(state), receipts: structuredClone(receipts), listeners: listeners.size,
      pending: [...held].map(([method, waiters]) => ({ method, count: waiters.length })) }),
  };
};
