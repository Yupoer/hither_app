# Hither iOS — UI Kit

Interactive click-through of the Hither iPhone app. Liquid Glass controls floating
over a dark Apple-Maps basemap, with the playful, rounded Hither type + accent system.

## Screens
- **Onboarding.jsx** — 3-step Duolingo-style welcome (shepherd metaphor, ProgressDots).
- **MapHome.jsx** — leader's primary view: GroupChip + RolePill, member markers, gather beacon, map controls, search sheet peek.
- **MembersSheet.jsx** — the expandable bottom sheet: members list, 獨自行動 / 建立小隊, group code, gather-point rows, KML import. Mirrors the live app.
- **SetGatherPoint.jsx** — leader drops the next beacon and notifies the group.
- **FollowerNav.jsx** — follower's "which way, how far" readout with dashed path.

## Helpers
- **frame.jsx** — `PhoneFrame`, `StatusBar`, `MapBg` (fake navy basemap), `AppleMapsTag`.

## Run
Open `index.html`. It loads `../../_ds_bundle.js` (compiled design-system components),
then each screen. Use the tab row under the phone to jump between screens; the flow is
also wired end-to-end (onboarding → map → sheet → set gather → follower nav).

## Notes
- The basemap is a stylized stand-in (gradient + SVG landmasses), not real Apple Maps.
- Emoji are used as member avatars/markers, matching the live app.
