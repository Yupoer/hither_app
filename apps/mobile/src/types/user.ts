/**
 * Shared geographic coordinate.
 * Mirrors `Coordinates` in the Vapor API (Models/Coordinates.swift).
 */
export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Public-facing user, as returned by the API's `PublicUser`
 * (Models/PublicUser.swift). The server never exposes the password hash.
 *
 * `id` is the stringified Mongo ObjectId (`_id`).
 * Per the MVP design, `name` is an anonymous nickname.
 */
export interface User {
  id: string;
  name: string;
  email: string;
  currentLocation?: Coordinates;
}
