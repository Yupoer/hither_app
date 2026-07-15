import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';
import { updateMyLocation } from '../api/services/LocationService';
import { location } from '../native';

export const BACKGROUND_LOCATION_REFRESH_TASK =
  'hither-background-location-refresh';
const PENDING_LOCATION_REFRESH_KEY = '@hither/pending-location-refresh';
const PENDING_LOCATION_PERMISSION_KEY = '@hither/pending-location-permission';

interface LocationRefreshPayload {
  category?: string;
  groupId?: string;
}

function parsePayload(data: unknown): LocationRefreshPayload | null {
  const value = data as {
    data?: { dataString?: string } | LocationRefreshPayload;
    dataString?: string;
  } | null;
  const dataString = value?.data && 'dataString' in value.data
    ? value.data.dataString
    : value?.dataString;
  if (dataString) {
    try {
      return JSON.parse(dataString) as LocationRefreshPayload;
    } catch {
      return null;
    }
  }
  const direct = value?.data;
  return direct && typeof direct === 'object'
    ? direct as LocationRefreshPayload
    : null;
}

async function rememberPendingRefresh(groupId: string): Promise<void> {
  await AsyncStorage.setItem(
    PENDING_LOCATION_REFRESH_KEY,
    JSON.stringify({ groupId, requestedAt: Date.now() }),
  );
}

export async function rememberPendingLocationPermission(): Promise<void> {
  await AsyncStorage.setItem(PENDING_LOCATION_PERMISSION_KEY, '1');
}

if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_REFRESH_TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    BACKGROUND_LOCATION_REFRESH_TASK,
    async ({ data, error }) => {
      if (error || AppState.currentState === 'active') return;

      const payload = parsePayload(data);
      if (payload?.category !== 'location_refresh' || !payload.groupId) return;

      const fix = await location.getCurrentLocation(false).catch(() => null);
      if (!fix) {
        await rememberPendingRefresh(payload.groupId).catch(() => undefined);
        return;
      }

      try {
        await updateMyLocation(fix.coordinates, payload.groupId);
        await AsyncStorage.removeItem(PENDING_LOCATION_REFRESH_KEY);
      } catch {
        await rememberPendingRefresh(payload.groupId).catch(() => undefined);
      }
    },
  );
}

void Notifications.registerTaskAsync(BACKGROUND_LOCATION_REFRESH_TASK).catch(
  () => undefined,
);

export async function consumePendingLocationRefresh(
  groupId?: string | null,
): Promise<string | null> {
  const raw = await AsyncStorage.getItem(PENDING_LOCATION_REFRESH_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { groupId?: string };
    if (!value.groupId || (groupId && value.groupId !== groupId)) return null;
    await AsyncStorage.removeItem(PENDING_LOCATION_REFRESH_KEY);
    return value.groupId;
  } catch {
    await AsyncStorage.removeItem(PENDING_LOCATION_REFRESH_KEY);
    return null;
  }
}

export async function consumePendingLocationPermission(): Promise<boolean> {
  const pending = await AsyncStorage.getItem(PENDING_LOCATION_PERMISSION_KEY);
  if (!pending) return false;
  await AsyncStorage.removeItem(PENDING_LOCATION_PERMISSION_KEY);
  return true;
}
