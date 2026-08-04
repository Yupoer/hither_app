/**
 * The startup burst is deliberately finite.  The first sample is scheduled
 * with a zero-delay timer so callers can still cancel the whole burst during
 * the same lifecycle turn (for example on logout or unmount).
 */
export const ENERGY_STARTUP_SAMPLE_OFFSETS_MS = [0, 15_000, 30_000, 60_000, 120_000] as const;
export const ENERGY_STEADY_SAMPLE_INTERVAL_MS = 5 * 60_000;

export const ENERGY_APP_STATES = [
  'active',
  'background',
  'inactive',
  'unknown',
] as const;

export const ENERGY_TRACKING_MODES = [
  'unknown',
  'foreground',
  'manualHighAccuracy',
  'navigationMax',
  'teamNavigation',
  'passiveBackground',
  'sharingDisabled',
] as const;

export const ENERGY_SIGNPOST_NAMES = [
  'launch',
  'map_ready',
  'location_acquisition',
  'snapshot',
  'route_calculation',
  'marker_tracking',
  'background_transition',
] as const;

export type EnergySignpostName = (typeof ENERGY_SIGNPOST_NAMES)[number];
export type EnergySignpostPhase = 'begin' | 'end' | 'event';
export type NativeEnergySignpost = (
  name: string,
  phase: EnergySignpostPhase,
  token?: string,
) => Promise<void> | void;

export const ENERGY_COUNTER_NAMES = [
  'location_callback',
  'location_accepted',
  'route_recalc',
  'realtime_callback',
  'snapshot',
  'render',
  'network_request',
] as const;

export type EnergyCounterName = (typeof ENERGY_COUNTER_NAMES)[number];

type EnergyCounterValues = Record<EnergyCounterName, number>;

export interface EnergyCounterSnapshot {
  /** Counts since the previous sample, suitable for frequency comparisons. */
  delta: EnergyCounterValues;
  /** Counts since this observer session started. */
  cumulative: EnergyCounterValues;
  windowMs: number | null;
}

export interface EnergyObservationSample {
  kind: 'startup' | 'steady';
  startupOffsetMs: number | null;
  scheduledAt: number;
  appState: string;
  trackingMode: string;
  counters: EnergyCounterSnapshot;
}

export type EnergyObservationSampleHandler = (
  sample: EnergyObservationSample,
) => void | Promise<void>;

export interface EnergyObservabilityController {
  stop: () => void;
}

const ZERO_COUNTERS: EnergyCounterValues = {
  location_callback: 0,
  location_accepted: 0,
  route_recalc: 0,
  realtime_callback: 0,
  snapshot: 0,
  render: 0,
  network_request: 0,
};

let counters: EnergyCounterValues = { ...ZERO_COUNTERS };
let countersAtPreviousSample: EnergyCounterValues = { ...ZERO_COUNTERS };
let lastSampleAt: number | null = null;
let currentAppState = 'active';
let currentTrackingMode = 'unknown';
let activeController: EnergyObservabilityController | null = null;
let activeSession: EnergySession | null = null;
let spanSequence = 0;
let launchAt = Date.now();
const activeSpans = new Map<EnergySignpostName, string>();
let nativeEnergySignpost: NativeEnergySignpost = () => undefined;

interface EnergySession {
  stop: () => void;
  cancelPendingStartupSampling: () => void;
  pauseForBackground: () => void;
  resumeFromForeground: () => void;
}

function createZeroCounters(): EnergyCounterValues {
  return { ...ZERO_COUNTERS };
}

function isEnergySignpostName(value: string): value is EnergySignpostName {
  return (ENERGY_SIGNPOST_NAMES as readonly string[]).includes(value);
}

function isEnergyCounterName(value: string): value is EnergyCounterName {
  return (ENERGY_COUNTER_NAMES as readonly string[]).includes(value);
}

function boundedCategory(value: string, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 80) : fallback;
}

function isAllowedAppState(value: string): value is (typeof ENERGY_APP_STATES)[number] {
  return (ENERGY_APP_STATES as readonly string[]).includes(value);
}

function isAllowedTrackingMode(value: string): value is (typeof ENERGY_TRACKING_MODES)[number] {
  return (ENERGY_TRACKING_MODES as readonly string[]).includes(value);
}

function nextSpanToken(): string {
  spanSequence += 1;
  const runtimeCrypto = (globalThis as {
    crypto?: { randomUUID?: () => string };
  }).crypto;
  const randomUuid = runtimeCrypto?.randomUUID;
  // Signpost IDs never leave the device. This fallback keeps the bridge
  // usable in a partial native/test runtime without introducing PII.
  if (typeof randomUuid === 'function') {
    try {
      return randomUuid.call(runtimeCrypto);
    } catch {
      // Continue with an opaque local token in restricted runtimes.
    }
  }
  return `energy-span-${Date.now()}-${spanSequence}`;
}

function emitNativeSignpost(
  name: EnergySignpostName,
  phase: EnergySignpostPhase,
  token?: string,
): void {
  try {
    void Promise.resolve(nativeEnergySignpost(name, phase, token)).catch(() => undefined);
  } catch {
    // Native signposts are diagnostics-only and must never affect app flow.
  }
}

function snapshotCounterValues(): EnergyCounterValues {
  return { ...counters };
}

function resetCounterState(): void {
  counters = createZeroCounters();
  countersAtPreviousSample = createZeroCounters();
  lastSampleAt = null;
}

function takeCounterSnapshot(now: number = Date.now()): EnergyCounterSnapshot {
  const cumulative = snapshotCounterValues();
  const delta = {} as EnergyCounterValues;
  for (const name of ENERGY_COUNTER_NAMES) {
    delta[name] = Math.max(0, cumulative[name] - countersAtPreviousSample[name]);
  }
  const windowMs = lastSampleAt == null ? null : Math.max(0, now - lastSampleAt);
  countersAtPreviousSample = cumulative;
  lastSampleAt = now;
  return { delta, cumulative, windowMs };
}

function invokeSample(
  handler: EnergyObservationSampleHandler,
  kind: EnergyObservationSample['kind'],
  startupOffsetMs: number | null,
  scheduledAt: number,
): void {
  if (currentAppState !== 'active') return;
  const sample: EnergyObservationSample = {
    kind,
    startupOffsetMs,
    scheduledAt,
    appState: currentAppState,
    trackingMode: currentTrackingMode,
    counters: takeCounterSnapshot(),
  };
  void Promise.resolve(handler(sample)).catch(() => undefined);
}

function startSampling(handler: EnergyObservationSampleHandler): EnergySession {
  let stopped = false;
  let steadyTimer: ReturnType<typeof setInterval> | null = null;
  const startupTimers = new Set<ReturnType<typeof setTimeout>>();

  const cancelPendingStartupSampling = () => {
    for (const timer of startupTimers) clearTimeout(timer);
    startupTimers.clear();
  };

  const clearSteadyTimer = () => {
    if (steadyTimer) clearInterval(steadyTimer);
    steadyTimer = null;
  };

  const startSteadyTimer = () => {
    if (stopped || steadyTimer || currentAppState !== 'active') return;
    // Keep the established five-minute cadence. The finite startup burst does
    // not create a second steady timer or an eager network flush.
    steadyTimer = setInterval(() => {
      if (stopped) return;
      invokeSample(handler, 'steady', null, Date.now());
    }, ENERGY_STEADY_SAMPLE_INTERVAL_MS);
  };

  const pauseForBackground = () => {
    cancelPendingStartupSampling();
    clearSteadyTimer();
  };

  const resumeFromForeground = () => {
    if (stopped) return;
    startSteadyTimer();
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelPendingStartupSampling();
    clearSteadyTimer();
    if (activeSession?.stop === stop) activeSession = null;
    if (activeController?.stop === stop) activeController = null;
  };

  if (currentAppState === 'active') {
    for (const offsetMs of ENERGY_STARTUP_SAMPLE_OFFSETS_MS) {
      const targetAt = launchAt + offsetMs;
      const delayMs = Math.max(0, targetAt - Date.now());
      // A monitor enabled after a launch milestone must not backfill an old
      // sample. It may still observe the remaining milestones.
      if (targetAt < Date.now()) continue;
      let timer: ReturnType<typeof setTimeout>;
      timer = setTimeout(() => {
        startupTimers.delete(timer);
        if (stopped) return;
        invokeSample(handler, 'startup', offsetMs, targetAt);
      }, delayMs);
      startupTimers.add(timer);
    }
    startSteadyTimer();
  }

  return {
    stop,
    cancelPendingStartupSampling,
    pauseForBackground,
    resumeFromForeground,
  };
}

export const energyObservability = {
  increment(name: EnergyCounterName, amount = 1): void {
    if (!isEnergyCounterName(name)) return;
    if (!Number.isFinite(amount) || amount <= 0) return;
    counters[name] += amount;
  },

  setAppState(state: string): void {
    currentAppState = isAllowedAppState(state)
      ? state
      : boundedCategory(state, 'unknown') === 'active'
        ? 'active'
        : 'unknown';
    if (currentAppState !== 'active') {
      // Background/inactive must cancel startup and steady timers so sampling
      // itself is not a fixed energy cost while the app is not foreground.
      activeSession?.pauseForBackground();
    } else {
      activeSession?.resumeFromForeground();
    }
  },

  getAppState(): string {
    return currentAppState;
  },

  setTrackingMode(mode: string): void {
    currentTrackingMode = isAllowedTrackingMode(mode) ? mode : 'unknown';
  },

  getTrackingMode(): string {
    return currentTrackingMode;
  },

  snapshotCounters(): EnergyCounterSnapshot {
    return takeCounterSnapshot();
  },

  event(name: EnergySignpostName): void {
    if (!isEnergySignpostName(name)) return;
    emitNativeSignpost(name, 'event');
  },

  beginSpan(name: EnergySignpostName): string | null {
    if (!isEnergySignpostName(name)) return null;
    const token = nextSpanToken();
    activeSpans.set(name, token);
    emitNativeSignpost(name, 'begin', token);
    return token;
  },

  endSpan(name: EnergySignpostName, token?: string): void {
    if (!isEnergySignpostName(name)) return;
    const activeToken = token ?? activeSpans.get(name);
    if (!activeToken) return;
    if (activeSpans.get(name) === activeToken) activeSpans.delete(name);
    emitNativeSignpost(name, 'end', activeToken);
  },

  start(handler: EnergyObservationSampleHandler): EnergyObservabilityController {
    activeController?.stop();
    resetCounterState();
    const session = startSampling(handler);
    activeSession = session;
    activeController = session;
    return session;
  },

  markLaunch(at: number = Date.now()): void {
    if (Number.isFinite(at)) launchAt = at;
  },
};

/** Bind the optional native os_signpost bridge from the app root. */
export function configureEnergySignpost(signpost: NativeEnergySignpost | null): void {
  nativeEnergySignpost = signpost ?? (() => undefined);
}

/**
 * Test-only reset that also models the privacy boundary at logout/unmount.
 * Production callers should stop the controller returned by `start`.
 */
export function __resetEnergyObservabilityForTests(): void {
  activeController?.stop();
  activeController = null;
  activeSession = null;
  resetCounterState();
  currentAppState = 'active';
  currentTrackingMode = 'unknown';
  nativeEnergySignpost = () => undefined;
  launchAt = Date.now();
  activeSpans.clear();
  spanSequence = 0;
}
