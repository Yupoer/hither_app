import { syncTimingScale, type LocationPowerMode } from '../utils/locationPolicy';
let current = syncTimingScale(false, 'allDay');
export function setSyncTimingProfile(highAccuracy: boolean, powerMode: LocationPowerMode): void {
  current = syncTimingScale(highAccuracy, powerMode);
}
export function currentSyncTimingScale(): number { return current; }
