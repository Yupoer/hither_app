import * as Haptics from 'expo-haptics';

/**
 * Thin haptics wrapper. `expo-haptics` throws/no-ops on web and unsupported
 * devices, so every call is swallowed here — callers never need a try/catch.
 *
 * Rule: only ever call these for positive interactions (a choice made, a
 * step advanced, a slider tick). Never on an error/failure path.
 */

export function lightTap(): void {
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // no-op: unsupported platform (e.g. web)
  }
}

export function mediumTap(): void {
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    // no-op: unsupported platform (e.g. web)
  }
}

export function selectionTick(): void {
  try {
    void Haptics.selectionAsync();
  } catch {
    // no-op: unsupported platform (e.g. web)
  }
}

/** Stronger notification-style buzz — for an alert the user should feel (e.g. a
 *  gathering-point meet time arriving), not a routine tap. */
export function alertBuzz(): void {
  try {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // no-op: unsupported platform (e.g. web)
  }
}
