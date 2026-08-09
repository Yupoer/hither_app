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
 * Upsert daily accommodation. On none→some with team auto-add on, the RPC
 * also inserts first+last accommodation cards atomically.
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

  const { data, error } = await supabase.rpc(
    'set_daily_accommodation_with_auto_add',
    {
      p_group_id: groupId,
      p_stay_date: stayDate,
      p_title: input.title,
      p_address: input.address ?? null,
      p_latitude: input.coordinates.latitude,
      p_longitude: input.coordinates.longitude,
      p_source_destination_id: input.sourceDestinationId ?? null,
      p_day: input.day ?? null,
    },
  );
  orThrow(error);

  const payload = data as {
    daily?: DailyAccommodationRow;
    auto_added?: boolean;
    first_card_id?: string | null;
    last_card_id?: string | null;
  } | null;

  if (!payload?.daily) {
    throw new Error('set_daily_accommodation_empty');
  }

  return {
    daily: mapDailyAccommodation(payload.daily),
    autoAdded: Boolean(payload.auto_added),
    firstCardId: payload.first_card_id ?? null,
    lastCardId: payload.last_card_id ?? null,
  };
}

/** Clear daily accommodation for a date. Does not delete itinerary cards. */
export async function clearDailyAccommodation(
  groupId: string,
  stayDate: string,
): Promise<void> {
  if (isDemoGroup(groupId)) return;
  const { error } = await supabase
    .from('daily_accommodations')
    .delete()
    .eq('group_id', groupId)
    .eq('stay_date', stayDate);
  orThrow(error);
}

export async function setAccommodationAutoAdd(
  groupId: string,
  enabled: boolean,
): Promise<void> {
  if (isDemoGroup(groupId)) return;
  const { error } = await supabase
    .from('groups')
    .update({ accommodation_auto_add: enabled })
    .eq('id', groupId);
  orThrow(error);
}
