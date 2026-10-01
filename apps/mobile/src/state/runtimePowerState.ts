/** Notification-driven system safety state; independent of diagnostic consent. */
export interface RuntimePowerState {
  lowPowerMode: boolean | null;
  thermalState: string | null;
}
let state: RuntimePowerState = { lowPowerMode: null, thermalState: null };
const listeners = new Set<() => void>();
export function getRuntimePowerState(): RuntimePowerState { return state; }
export function subscribeRuntimePowerState(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function updateRuntimePowerState(sample: RuntimePowerState | null): void {
  if (!sample || (sample.lowPowerMode == null && sample.thermalState == null)) return;
  const next = { lowPowerMode: sample.lowPowerMode ?? state.lowPowerMode,
    thermalState: sample.thermalState ?? state.thermalState };
  if (state.lowPowerMode === next.lowPowerMode && state.thermalState === next.thermalState) return;
  state = next;
  for (const listener of listeners) listener();
}

/** Unknown native state is static; stop optional work at the first thermal warning. */
export function optionalVisualsAllowed(power: RuntimePowerState): boolean {
  return power.thermalState === 'nominal' && power.lowPowerMode === false;
}
