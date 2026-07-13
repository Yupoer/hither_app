export interface LocationPolicy {
  accuracy: 'balanced' | 'high';
  distanceInterval: number;
  timeInterval: number;
}

export function locationPolicy(highAccuracy: boolean): LocationPolicy {
  return highAccuracy
    ? { accuracy: 'high', distanceInterval: 10, timeInterval: 5_000 }
    : { accuracy: 'balanced', distanceInterval: 50, timeInterval: 30_000 };
}

export function shouldWatchLocation(groupId: string | null, appState: string): boolean {
  return Boolean(groupId) && appState === 'active';
}
