/**
 * FavoritePlacesService — account-owned places (cross-team).
 * Exact-match uniqueness enforced by DB unique (user_id, title_norm, lat_norm, lng_norm).
 */
import { supabase } from '../supabase';
import type { Coordinates } from '../../types';
import {
  normalizeCoordinate,
  normalizePlaceName,
  placeExactMatchKey,
} from '../../utils/placeIdentity';
import { orThrow, requireUserId } from './_helpers';

export interface FavoritePlace {
  id: string;
  userId: string;
  title: string;
  address?: string;
  coordinates: Coordinates;
  createdAt?: string;
}

interface FavoriteRow {
  id: string;
  user_id: string;
  title: string;
  address: string | null;
  latitude: number;
  longitude: number;
  lat_norm: number;
  lng_norm: number;
  title_norm: string;
  created_at?: string;
}

export function mapFavoritePlace(row: FavoriteRow): FavoritePlace {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    address: row.address ?? undefined,
    coordinates: {
      latitude: row.latitude,
      longitude: row.longitude,
    },
    createdAt: row.created_at,
  };
}

export async function listFavoritePlaces(): Promise<FavoritePlace[]> {
  const uid = await requireUserId();
  const { data, error } = await supabase
    .from('account_favorite_places')
    .select(
      'id, user_id, title, address, latitude, longitude, lat_norm, lng_norm, title_norm, created_at',
    )
    .eq('user_id', uid)
    .order('created_at', { ascending: false });
  orThrow(error);
  return ((data ?? []) as FavoriteRow[]).map(mapFavoritePlace);
}

export function findFavoriteByExactMatch(
  favorites: readonly FavoritePlace[],
  title: string,
  coordinates: Coordinates,
): FavoritePlace | null {
  const key = placeExactMatchKey(title, coordinates);
  return (
    favorites.find(
      (f) => placeExactMatchKey(f.title, f.coordinates) === key,
    ) ?? null
  );
}

export async function saveFavoritePlace(input: {
  title: string;
  address?: string;
  coordinates: Coordinates;
}): Promise<FavoritePlace> {
  const uid = await requireUserId();
  const title = normalizePlaceName(input.title);
  const latNorm = normalizeCoordinate(input.coordinates.latitude);
  const lngNorm = normalizeCoordinate(input.coordinates.longitude);
  const titleNorm = title.toLowerCase();

  const { data, error } = await supabase
    .from('account_favorite_places')
    .upsert(
      {
        user_id: uid,
        title,
        address: input.address ?? null,
        latitude: input.coordinates.latitude,
        longitude: input.coordinates.longitude,
        lat_norm: latNorm,
        lng_norm: lngNorm,
        title_norm: titleNorm,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,title_norm,lat_norm,lng_norm' },
    )
    .select(
      'id, user_id, title, address, latitude, longitude, lat_norm, lng_norm, title_norm, created_at',
    )
    .single();

  // Unique race / already exists — load matching row.
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      const { data: existing, error: loadErr } = await supabase
        .from('account_favorite_places')
        .select(
          'id, user_id, title, address, latitude, longitude, lat_norm, lng_norm, title_norm, created_at',
        )
        .eq('user_id', uid)
        .eq('title_norm', titleNorm)
        .eq('lat_norm', latNorm)
        .eq('lng_norm', lngNorm)
        .maybeSingle();
      orThrow(loadErr);
      if (existing) return mapFavoritePlace(existing as FavoriteRow);
    }
    orThrow(error);
  }
  return mapFavoritePlace(data as FavoriteRow);
}

export async function unsaveFavoritePlace(favoriteId: string): Promise<void> {
  const uid = await requireUserId();
  const { error } = await supabase
    .from('account_favorite_places')
    .delete()
    .eq('id', favoriteId)
    .eq('user_id', uid);
  orThrow(error);
}

/** Unsave by exact match for current owner only. */
export async function unsaveFavoriteByExactMatch(
  title: string,
  coordinates: Coordinates,
): Promise<boolean> {
  const uid = await requireUserId();
  const titleNorm = normalizePlaceName(title).toLowerCase();
  const latNorm = normalizeCoordinate(coordinates.latitude);
  const lngNorm = normalizeCoordinate(coordinates.longitude);
  const { data, error } = await supabase
    .from('account_favorite_places')
    .delete()
    .eq('user_id', uid)
    .eq('title_norm', titleNorm)
    .eq('lat_norm', latNorm)
    .eq('lng_norm', lngNorm)
    .select('id');
  orThrow(error);
  return (data?.length ?? 0) > 0;
}
