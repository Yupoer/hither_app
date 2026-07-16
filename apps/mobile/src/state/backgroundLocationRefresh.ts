import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';
import { location } from '../native';
import { LOCATION_SHARING_KEY } from './locationPrivacy';
import { diagnostics } from './diagnostics';
import {
  enqueueLocationOutbox,
  flushLocationOutbox,
  purgeLocationOutbox,
} from './locationOutbox';

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
      await diagnostics.write({
        event: 'refresh_request_received',
        success: !error,
        errorCode: error ? 'notification_task_error' : undefined,
        source: 'location_push',
      });
      if (error || AppState.currentState === 'active') return;

      const payload = parsePayload(data);
      if (payload?.category !== 'location_refresh' || !payload.groupId) return;
      const sharingEnabled = await AsyncStorage.getItem(LOCATION_SHARING_KEY) !== 'false';
      if (!sharingEnabled) {
        await purgeLocationOutbox();
        await diagnostics.write({
          event: 'location_rejected_sharing_disabled',
          source: 'location_push',
        });
        return;
      }

      const fix = await location.getCurrentLocation(false).catch(() => null);
      if (!fix) {
        await rememberPendingRefresh(payload.groupId).catch(() => undefined);
        return;
      }

      try {
        await enqueueLocationOutbox({
          id: Crypto.randomUUID(),
          groupId: payload.groupId,
          navigationSessionId: null,
          capturedAt: fix.timestamp,
          coords: {
            ...fix.coordinates,
            accuracy: Math.max(0, fix.accuracy ?? 0),
          },
          trackingMode: 'passiveBackground',
          source: 'refresh_request',
          sequence: fix.timestamp,
        });
        await diagnostics.write({
          event: 'location_outbox_enqueued',
          source: 'refresh_request',
          sequence: fix.timestamp,
        });
        const upload = await flushLocationOutbox();
        await diagnostics.write({
          event: 'refresh_request_completed',
          source: 'refresh_request',
          sent: upload.sent,
          remaining: upload.remaining,
        });
        await AsyncStorage.removeItem(PENDING_LOCATION_REFRESH_KEY);
        await diagnostics.flush().catch(() => undefined);
      } catch {
        await diagnostics.write({
          event: 'refresh_request_timeout',
          source: 'refresh_request',
          errorCode: 'refresh_failed',
        });
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
