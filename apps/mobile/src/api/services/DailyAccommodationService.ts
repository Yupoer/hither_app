/**
 * DailyAccommodationService — team per-date stay snapshot CRUD + auto-add.
 * Independent of itinerary accommodation cards (deleting cards never clears this).
 */
import { supabase } from '../supabase';
import { isDemoGroup } from '../demo';
import type { Coordinates } from '../../types';
import { orThrow } from './_helpers';

export interface DailyAccommodation {
  id: string;
  groupId: string;
  /** Calendar date YYYY-MM-DD. */
  stayDate: string;
  title: string;
  address?: string;
  coordinates: Coordinates;
  sourceDestinationId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface DailyAccommodationRow {
  id: string;
  group_id: string;
  stay_date: string;
  title: string;
  address: string | null;
  latitude: number;
  longitude: number;
  source_destination_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export function mapDailyAccommodation(row: DailyAccommodationRow): DailyAccommodation {
  return {
    id: row.id,
    groupId: row.group_id,
    stayDate: typeof row.stay_date === 'string'
      ? row.stay_date.slice(0, 10)
      : String(row.stay_date).slice(0, 10),
    title: row.title,
    address: row.address ?? undefined,
    coordinates: {
      latitude: row.latitude,
      longitude: row.longitude,
    },
    sourceDestinationId: row.source_destination_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Load all daily accommodations for a group (one batch; filter by date client-side). */
export async function listDailyAccommodations(
  groupId: string,
): Promise<DailyAccommodation[]> {
  if (isDemoGroup(groupId)) return [];
  const { data, error } = await supabase
    .from('daily_accommodations')
    .select(
      'id, group_id, stay_date, title, address, latitude, longitude, source_destination_id, created_at, updated_at',
    )
    .eq('group_id', groupId)
    .order('stay_date', { ascending: true });
  orThrow(error);
  return ((data ?? []) as DailyAccommodationRow[]).map(mapDailyAccommodation);
}

export async function getDailyAccommodationForDate(
  groupId: string,
  stayDate: string,
): Promise<DailyAccommodation | null> {
  if (isDemoGroup(groupId)) return null;
  const { data, error } = await supabase
    .from('daily_accommodations')
    .select(
      'id, group_id, stay_date, title, address, latitude, longitude, source_destination_id, created_at, updated_at',
    )
    .eq('group_id', groupId)
    .eq('stay_date', stayDate)
    .maybeSingle();
  orThrow(error);
  if (!data) return null;
  return mapDailyAccommodation(data as DailyAccommodationRow);
}

export interface SetDailyAccommodationInput {
  title: string;
  address?: string;
  coordinates: Coordinates;
  sourceDestinationId?: string | null;
  /** Trip day number for auto-add card placement (1-based). */
  day?: number;
}

export interface SetDailyAccommodationResult {
  daily: DailyAccommodation;
  autoAdded: boolean;
  firstCardId?: string | null;
  lastCardId?: string | null;
}

/**
 * Save locally with its durable operation. The backend atomically disables
 * boundary auto-add while applying the stay; local completion never waits on it.
 */
export async function setDailyAccommodation(
  groupId: string,
  stayDate: string,
  input: SetDailyAccommodationInput,
): Promise<SetDailyAccommodationResult> {
  if (isDemoGroup(groupId)) {
    const daily: DailyAccommodation = {
      id: `demo-daily-${stayDate}`,
      groupId,
      stayDate,
      title: input.title,
      address: input.address,
      coordinates: input.coordinates,
      sourceDestinationId: input.sourceDestinationId ?? null,
    };
    return { daily, autoAdded: false };
  }

  const core = require('../../state/coreDataSync') as typeof import('../../state/coreDataSync');
  const crypto = require('expo-crypto') as typeof import('expo-crypto');
  const snapshot = await core.ensureCoreSnapshot(groupId);
  const daily: DailyAccommodation = {
    id: snapshot?.dailyAccommodations?.find(stay => stay.stayDate === stayDate)?.id ?? crypto.randomUUID(),
    groupId, stayDate, title: input.title, address: input.address,
    coordinates: input.coordinates, sourceDestinationId: input.sourceDestinationId ?? null,
  };
  await core.enqueueDailyAccommodation({ groupId, stayDate, daily, day: input.day });
  return { daily, autoAdded: false, firstCardId: null, lastCardId: null };
}

/**
 * Clear daily accommodation for a date. Does not delete itinerary cards.
 * Stay removal + anchor downgrade share the same local snapshot transaction
 * and backend receipt, so either both apply or neither applies.
 */
export async function clearDailyAccommodation(
  groupId: string,
  stayDate: string,
  day?: number,
): Promise<void> {
  if (isDemoGroup(groupId)) return;
  const core = require('../../state/coreDataSync') as typeof import('../../state/coreDataSync');
  await core.enqueueDailyAccommodation({ groupId, stayDate, day: typeof day === 'number' && day > 0 ? day : undefined });
}

/**
 * Team-shared auto-add switch. Routes through expiry-aware RPC so expired
 * anonymous leaders (role=leader retained, is_member false) cannot toggle
 * via the legacy groups UPDATE policy.
 */
export async function setAccommodationAutoAdd(
  groupId: string,
  enabled: boolean,
): Promise<void> {
  if (isDemoGroup(groupId)) return;
  const { error } = await supabase.rpc('set_accommodation_auto_add', {
    p_group_id: groupId,
    p_enabled: enabled,
  });
  orThrow(error);
}
