const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const babel = require('@babel/core');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
const { createRoot } = require('react-dom/client');
const { flushSync } = require('react-dom');
const appRoot = path.resolve(path.dirname(process.argv[1]), '..');
const sourcePath = path.join(appRoot, 'src/components/GroupMap.tsx');
const current = fs.readFileSync(sourcePath, 'utf8');
const meterInstallation = 'const commitMeter = useGroupMapCommitMeter();';
assert.equal(current.split(meterInstallation).length, 2, 'the actual GroupMap has one unconditional meter installation');
// The scratch baseline restores the original no-deps telemetry in the actual owner.
const baseline = current.replace(meterInstallation, "React.useEffect(() => { energyObservability.increment('render'); }); const commitMeter = null;");
const tick = () => new Promise(resolve => setImmediate(resolve));
const output = [];

async function run(candidate, compiled, strict, sessionBoundary) {
  const events = [];
  const context = React.createContext(0);
  const colors = new Proxy({}, { get: (_, key) => key === 'accent' ? '#f00' : '#fff' });
  const theme = { colors, themeName: 'day' };
  const preferences = { dayColors: {} };
  const insets = { top: 0, bottom: 0, left: 0, right: 0 };
  const power = {};
  const listeners = new Set();
  let surface = null;
  let mounts = 0;
  let unmounts = 0;
  let subscriptions = 0;
  let activeSession = null;
  let controller = null;
  const pendingRoute = [{ latitude: 99, longitude: 99 }];
  const pending = { then() { subscriptions++; } };
  const cache = new Map();
  function local(relative) { return load(path.join(appRoot, 'src', relative)); }
  const energy = local('state/energyObservability.ts').energyObservability;
  const increment = energy.increment;
  energy.increment = (name, amount) => {
    if (name === 'render') events.push(`render:${activeSession ?? 'inactive'}`);
    increment(name, amount);
  };
  const start = user => {
    controller = energy.start(() => {}, { startupOffsetsMs: [], steadyIntervalMs: null });
    activeSession = user;
    events.push(`start:${user}`);
  };
  const stop = () => {
    controller?.stop(); controller = null;
    events.push(`stop:${activeSession}`); activeSession = null;
  };
  class NativeSurface extends React.Component {
    state = { failed: false };
    componentDidMount() { surface = this; mounts++; }
    componentWillUnmount() { if (surface === this) surface = null; unmounts++; }
    animateToRegion() {}
    fitToCoordinates() {}
    animateCamera() {}
    setCamera() {}
    async getCamera() { return {}; }
    render() {
      if (this.state.failed) throw new Error('test map failure');
      return React.createElement('div', { 'data-native-map': true }, this.props.children);
    }
  }
  const View = ({ children }) => React.createElement('div', null, children);
  const Pressable = ({ children, onPress, accessibilityLabel }) => React.createElement('button', { onClick: onPress, 'data-label': accessibilityLabel }, children);
  function load(filename) {
    filename = path.resolve(filename);
    if (!path.extname(filename)) filename += fs.existsSync(filename + '.ts') ? '.ts' : '.tsx';
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} }; cache.set(filename, mod);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'module', 'exports', code)(name => {
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name));
      return require(name);
    }, mod, mod.exports);
    return mod.exports;
  }
  const mockImports = {
    './useMemberMarkerMotion': { useMemberMarkerMotion: () => null },
    'react-native': { View, Text: View, Pressable, AccessibilityInfo: {
      isReduceMotionEnabled: async () => false,
      addEventListener: (_, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; },
    }, StyleSheet: { absoluteFill: {}, create: value => value }, useWindowDimensions: () => ({ height: 844, width: 390 }) },
    '@expo/vector-icons': { Ionicons: () => null },
    'react-native-maps': { __esModule: true, default: NativeSurface, Marker: View, Polyline: () => null },
    '../state/PreferencesContext': { useTheme: () => { React.useContext(context); return theme; }, usePreferences: () => preferences },
    'react-native-safe-area-context': { useSafeAreaInsets: () => insets },
    '../glass': { memberColor: () => '#fff' },
    './HitherText': { HitherText: View },
    '../utils/activityLog': { logEvent() {}, logError() {} },
    '../i18n': { useTranslation: () => ({ t: key => key }) },
    '../native/maps': { platformizedMapViewProps: () => ({}), platformizedMapLifecycle: () => () => {} },
    '../native/mapTransitDefaults': { defaultMapTransitProps: () => ({}) },
    '../state/runtimePowerState': { getRuntimePowerState: () => power, subscribeRuntimePowerState: () => () => {}, optionalVisualsAllowed: () => true },
    '../state/foregroundUi': { useForegroundUi: () => true, useVisibleUi: () => true, isVisibleUi: () => true },
    '../state/energyObservability': { energyObservability: energy },
    '../utils/routeLod': { ...local('utils/routeLod.ts'), displayRoutePoints: points => {
      if (points === pendingRoute) throw pending;
      return points;
    } },
  };
  const compiledSource = babel.transformSync(candidate ? current : baseline, {
    filename: sourcePath, configFile: false, babelrc: false,
    plugins: [
      [require('@babel/plugin-transform-typescript'), { isTSX: true }],
      ...(compiled ? [[require('babel-plugin-react-compiler'), { target: '19' }]] : []),
      [require('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require('@babel/plugin-transform-modules-commonjs'),
    ],
  }).code;
  const owner = compiledSource.slice(compiledSource.indexOf('function GroupMap('));
  const ownerCompiled = /_compilerRuntime.c\)/.test(owner);
  if (compiled && candidate) assert.match(owner, /useGroupMapCommitMeter\(\)/, 'actual GroupMap calls the opaque fixed meter hook');
  const product = { exports: {} };
  new Function('require', 'module', 'exports', compiledSource)(name => {
    if (mockImports[name]) return mockImports[name];
    if (name.startsWith('.')) return load(path.resolve(path.dirname(sourcePath), name));
    return require(name);
  }, product, product.exports);
  const GroupMapOwner = product.exports.default;
  const useMountEffect = local('hooks/useMountEffect.ts').useMountEffect;
  function Session({ user, consent }) {
    useMountEffect(() => {
      let cancelled = false;
      if (user && consent) void Promise.resolve().then(() => Promise.resolve()).then(() => { if (!cancelled) start(user); });
      return () => { cancelled = true; if (activeSession) stop(); };
    });
    return null;
  }
  const baseProps = { members: [], routePoints: [], active: true, currentUserId: 'u1' };
  let props = baseProps;
  let revision = 0;
  let user = 'u1';
  let consent = true;
  const container = document.createElement('div');
  const root = createRoot(container, { onCaughtError() {} });
  const render = () => {
    const tree = React.createElement(context.Provider, { value: revision },
      sessionBoundary ? React.createElement(Session, { key: `${user}:${consent}`, user, consent }) : null,
      React.createElement(React.Suspense, { fallback: React.createElement('div', null, 'pending') }, React.createElement(GroupMapOwner, props)));
    root.render(strict ? React.createElement(React.StrictMode, null, tree) : tree);
  };
  const cumulative = () => energy.snapshotCounters().cumulative.render;
  const counts = [];
  const capture = label => counts.push({ label, count: cumulative(), mounts, unmounts, events: [...events] });
  if (!sessionBoundary) start('always');
  flushSync(render); await tick(); capture('mount');
  const initial = strict && process.env.NODE_ENV === 'development' ? 2 : 1;
  if (!sessionBoundary) assert.equal(cumulative(), initial);
  else assert.equal(cumulative(), 0, 'async session starts after mount reports, then resets');
  const initialCount = cumulative();
  flushSync(render); await tick(); capture('memo-bailout');
  assert.equal(cumulative(), initialCount);
  const nativeMounts = mounts;
  flushSync(() => { for (const fn of listeners) fn(true); }); await tick(); capture('same-output-own-state');
  assert.equal(cumulative(), initialCount + 1);
  flushSync(() => { revision++; render(); }); await tick(); capture('same-output-context');
  assert.equal(cumulative(), initialCount + 2);
  flushSync(() => { props = { ...props, currentUserId: 'u2' }; render(); });
  flushSync(() => { props = { ...props, currentUserId: 'u3' }; render(); });
  await tick(); capture('two-consecutive-commits');
  assert.equal(cumulative(), initialCount + 4);
  assert.equal(mounts, nativeMounts, 'metric samples do not remount the native map');
  const beforeAbort = cumulative();
  React.startTransition(() => { props = { ...props, routePoints: pendingRoute }; render(); });
  for (let attempt = 0; attempt < 30 && subscriptions === 0; attempt++) await tick();
  assert.ok(subscriptions > 0, 'the pending owner render actually started');
  assert.equal(cumulative(), beforeAbort, 'uncommitted render is not counted');
  flushSync(() => { props = { ...props, routePoints: baseProps.routePoints, currentUserId: 'urgent' }; render(); });
  await tick(); capture('aborted-transition');
  assert.equal(cumulative(), beforeAbort + 1);
  flushSync(() => surface.setState({ failed: true })); await tick(); capture('fallback');
  assert.equal(container.querySelector('[data-native-map]'), null);
  flushSync(() => { props = { ...props, active: false }; render(); }); await tick(); capture('inactive');
  flushSync(() => { props = { ...props, active: true }; render(); }); await tick(); capture('fallback-return');
  const retry = container.querySelector('[data-label="interaction.mapReload"]');
  assert.ok(retry);
  flushSync(() => retry.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  await tick(); capture('native-retry');
  assert.ok(container.querySelector('[data-native-map]'));
  if (sessionBoundary) {
    let startAt = events.length;
    flushSync(() => { user = 'u2'; props = { ...props, currentUserId: user }; render(); });
    await tick(); capture('user-switch');
    assert.deepEqual(events.slice(startAt), ['stop:u1', 'render:inactive', 'start:u2']);
    assert.equal(cumulative(), 0);
    flushSync(() => { revision++; render(); }); await tick();
    const beforeRevoke = cumulative(); startAt = events.length;
    flushSync(() => { consent = false; props = { ...props, topOverlap: 1 }; render(); });
    await tick(); capture('same-commit-revoke');
    assert.deepEqual(events.slice(startAt), ['stop:u2', 'render:inactive']);
    assert.equal(cumulative(), beforeRevoke);
    flushSync(() => { consent = true; props = { ...props, topOverlap: 2 }; render(); }); await tick();
    flushSync(() => { revision++; render(); }); await tick();
    const beforeLogout = cumulative(); startAt = events.length;
    flushSync(() => { user = null; props = { ...props, currentUserId: undefined }; render(); });
    await tick(); capture('same-commit-logout');
    assert.deepEqual(events.slice(startAt), ['stop:u2', 'render:inactive']);
    assert.equal(cumulative(), beforeLogout);
  }
  const beforeUnmount = cumulative();
  flushSync(() => root.unmount()); await tick(); capture('unmount');
  assert.equal(cumulative(), beforeUnmount);
  assert.equal(listeners.size, 0);
  assert.equal(energy.workloadSnapshot().mapCount, 0);
  controller?.stop();
  return { candidate, compiled, strict, sessionBoundary, ownerCompiled, counts };
}

(async () => {
  for (const compiled of [false, true]) for (const strict of [false, true]) for (const sessionBoundary of [false, true]) {
    const before = await run(false, compiled, strict, sessionBoundary);
    const after = await run(true, compiled, strict, sessionBoundary);
    assert.equal(after.ownerCompiled, before.ownerCompiled, 'the migration adds no GroupMap Compiler bailout');
    assert.deepEqual(after.counts, before.counts, 'actual GroupMap preserves baseline counts, session phase and native identity');
    output.push(after);
  }
  console.log(JSON.stringify({ mode: process.env.NODE_ENV, cases: output.length, ownerCompiled: output.some(run => run.ownerCompiled), passed: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
