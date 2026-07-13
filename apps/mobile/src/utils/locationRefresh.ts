import type { Coordinates } from '../types';

export type LocationRefreshResult = 'ok' | 'location-failed' | 'reload-failed';

export async function refreshLocations(
  refreshOwn: () => Promise<Coordinates | null>,
  reloadGroup: () => Promise<boolean>,
): Promise<LocationRefreshResult> {
  const ownLocation = await refreshOwn().catch(() => null);
  const reloaded = await reloadGroup().catch(() => false);

  if (!reloaded) return 'reload-failed';
  return ownLocation ? 'ok' : 'location-failed';
}
