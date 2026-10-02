/** Original 800ms wave with 100ms stagger, driven by one continuous clock. */
export function loadingDotOffset(phase: number, index: number): number {
  'worklet';
  return -10 * (1 - Math.cos(2 * Math.PI * (phase - index / 8)));
}

/** Visible auth status may animate under the system sign-in sheet; never in background. */
export function authLoadingMotionAllowed(appState: string | null, thermalState: string | null, lowPowerMode: boolean | null): boolean {
  return (appState === 'active' || appState === 'inactive')
    && (thermalState == null || thermalState === 'nominal') && lowPowerMode !== true;
}
