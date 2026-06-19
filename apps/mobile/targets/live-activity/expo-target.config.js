/**
 * Widget Extension target for the Hither Live Activity, built by
 * `@bacons/apple-targets` (expo-apple-targets) during `expo prebuild`.
 *
 * Renders `HitherGroupAttributes` on the lock screen + Dynamic Island while the
 * group journey is "going". The app target (HitherLiveActivity Expo module)
 * starts/updates/ends the activity; this target only draws it.
 *
 * NOTE: the shared `HitherGroupAttributes` type must be identical to the one in
 * the module (apps/mobile/modules/hither-live-activity/ios). A copy lives in
 * this folder so the widget target compiles standalone — keep the two in sync.
 */
module.exports = (config) => ({
  type: 'widget',
  name: 'HitherLiveActivity',
  deploymentTarget: '16.2',
  // Live Activities require this Info.plist flag on the widget target.
  infoPlist: {
    NSSupportsLiveActivities: true,
  },
});
