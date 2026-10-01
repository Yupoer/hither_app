// Node CPU/retention pressure only. Does not measure iPhone GPU, FPS or thermal state.
// Run: node --expose-gc scripts/pressure-foreground-ui.cjs [seconds=300]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const seconds = Number(process.argv[2] ?? 300);
assert(Number.isFinite(seconds) && seconds > 0 && seconds <= 1800);
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText, filename);
const nativeListeners = new Set();
const appState = { currentState: 'active', addEventListener: (_, callback) => {
  nativeListeners.add(callback); return { remove: () => nativeListeners.delete(callback) };
} };
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  return name === 'react-native' ? { AppState: appState } : originalLoad.call(this, name, ...args);
};
const { isForegroundUi, subscribeForegroundUi } = require('../src/state/foregroundUi.ts');
const { energyObservability: energy } = require('../src/state/energyObservability.ts');
const { displayRoutePoints } = require('../src/utils/routeLod.ts');
const { advanceRouteToCoordinate } = require('../src/utils/advanceRouteToCoordinate.ts');
const { memberMotionDuration } = require('../src/utils/memberMotion.ts');
const { createStarfieldParticles } = require('../src/utils/starfieldParticles.ts');
const { advanceStarfieldPosition } = require('../src/utils/starfieldPhase.ts');
const route = Array.from({ length: 2000 }, (_, i) => ({
  latitude: 25 + i * 0.000003 + Math.sin(i / 13) * 0.0001,
  longitude: 121 + i * 0.000006,
}));
const stars = createStarfieldParticles(390, 844, false);
let releases = [], positions = [], cycles = 0, operations = 0, checksum = 0;
const latencies = [];
const reconcile = () => {
  for (const release of releases) release();
  releases = []; positions = [];
  if (!isForegroundUi()) return;
  for (let i = 0; i < 12; i++) {
    releases.push(energy.mountWorkload({ starfieldCanvasCount: 1, animatedCanvasCount: 1 }));
    positions.push(stars.map(star => star.x));
  }
};
const unsubscribe = subscribeForegroundUi(reconcile);
reconcile();
function transition(state) {
  appState.currentState = state;
  for (const listener of nativeListeners) listener(state);
}
global.gc?.();
const initial = process.memoryUsage();
const cpuStart = process.cpuUsage();
const started = performance.now();
let peakRss = initial.rss, peakHeap = initial.heapUsed;
async function run() {
  while (performance.now() - started < seconds * 1000) {
    const elapsed = performance.now() - started;
    const active = elapsed % 500 < 300;
    transition(active ? 'active' : 'inactive');
    transition(active ? 'active' : 'background'); // repeated native states must be idempotent
    if (active) {
      assert.equal(energy.workloadSnapshot().animatedCanvasCount, 12);
      const before = performance.now();
      const current = route[operations % 1000];
      const projected = displayRoutePoints(advanceRouteToCoordinate(route, current), {
        latitude: 25, longitudeDelta: 0.08, widthPx: 390,
      });
      checksum += projected.length;
      for (let member = 0; member < 100; member++) checksum += memberMotionDuration(
        { coordinates: route[member], sampledAt: 1000 },
        { coordinates: route[member + 10], sampledAt: 6000 }, 6000, true,
      );
      for (const canvas of positions) for (let i = 0; i < stars.length; i++) {
        canvas[i] = advanceStarfieldPosition(canvas[i], 50, stars[i].velocity, 390);
      }
      latencies[operations % 4096] = performance.now() - before;
      operations++;
    } else {
      assert.equal(releases.length, 0);
      assert.equal(positions.length, 0);
      assert.equal(energy.workloadSnapshot().animatedCanvasCount, 0);
      cycles++;
      // The idle phase intentionally yields; no decorative work executes.
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const memory = process.memoryUsage();
    peakRss = Math.max(peakRss, memory.rss); peakHeap = Math.max(peakHeap, memory.heapUsed);
    assert.equal(nativeListeners.size, 1);
    await new Promise(resolve => setImmediate(resolve));
  }
  transition('background'); unsubscribe();
  assert.equal(nativeListeners.size, 0);
  assert.equal(energy.workloadSnapshot().animatedCanvasCount, 0);
  assert.equal(positions.length, 0);
  const cpu = process.cpuUsage(cpuStart), wallMs = performance.now() - started;
  global.gc?.();
  const retained = process.memoryUsage();
  const sorted = latencies.sort((a, b) => a - b);
  console.log(JSON.stringify({ environment: 'Node CPU only; simulated AppState, no native rendering',
    node: process.version, secondsRequested: seconds, wallMs, cpuMs: (cpu.user + cpu.system) / 1000,
    cpuCorePercent: (cpu.user + cpu.system) / (wallMs * 10), operations, idleChecks: cycles,
    routePoints: route.length, memberSamplesPerOperation: 100, concurrentCanvasModels: 12,
    particlesPerCanvas: stars.length, p95RecentOperationMs: sorted[Math.floor((sorted.length - 1) * 0.95)],
    initialRssMb: initial.rss / 1048576, peakRssMb: peakRss / 1048576,
    retainedRssMb: retained.rss / 1048576, initialHeapMb: initial.heapUsed / 1048576,
    peakHeapMb: peakHeap / 1048576, retainedHeapMb: retained.heapUsed / 1048576,
    retainedWorkloads: energy.workloadSnapshot().animatedCanvasCount, retainedListeners: nativeListeners.size,
    retainedParticleArrays: positions.length, boundedLatencySamples: latencies.length,
    checksum, nativeFps: null, nativeThermalState: null,
  }, null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
