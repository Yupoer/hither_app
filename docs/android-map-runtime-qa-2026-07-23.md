# Android Map Runtime QA — 2026-07-23

**Scope:** map crash / blue-dot flash / low FPS / black-gray screen / group menu cancel  
**S25F1:** 未實測性能目標 — 僅能依 Pixel 最差 envelope 做保守推估，不得標成 S25F1 已通過實機驗證。

## Device under test

| Field | Value |
|---|---|
| Emulator model | `sdk_gphone16k_x86_64` (Pixel-class AVD) |
| API | 37 |
| Physical Pixel | pending when connected |
| Package | `app.hither.mobile` |

Runtime artifacts (not committed): `.qa-runtime/android-map-2026-07-23/<device>/<run>/`

## Fixed repro (each run)

1. Location: precise / while-in-use; battery saver off.
2. `adb shell am force-stop app.hither.mobile`
3. Clear logcat + `dumpsys gfxinfo … reset`
4. Cold launch, stay on map 30 s
5. Sheet mid/full, three panes, ⋯ more → cancel
6. Pan/zoom 20 s, locate-me ×3
7. Background 10 s → foreground; note blue-dot, black/gray, crash

## Code delivered this session (pre-device A/B)

| Task | Change | Status |
|---|---|---|
| 2 | Android Alert: 設定 / 離開 / 取消 + `cancelable` | code + unit contract |
| 3 | `androidQa`/`diagnostic` `EXPO_PUBLIC_PERFORMANCE_TRACING=full`; map mount/ready/loaded | code + unit contract |
| 4 | iOS-only `onUserLocationChange`; `mapInitialCenter` locked | code + unit contract |
| 5–6 | Evidence-only renderer / marker / boundary | deferred until crash/tile evidence |
| 7 | Full 10× gate + Supabase | after APK install on emulator |

## Acceptance (Pixel/emulator)

| Gate | Target | Result |
|---|---|---|
| Cold-launch crash | 0/10 | pending APK |
| Map black screen | 0/10 | pending |
| Full-app gray | 0/10 | pending |
| Blue-dot flash/loss | 0/10 | pending |
| ⋯ menu cancel visible | 10/10 | pending |
| Frozen frame >700 ms | 0 | pending gfxinfo |
| S25F1 | estimate from worst Pixel run only | not measured |

## Commits / OTA / APK

Fill after ship:

- Feature branch:
- Master SHA:
- OTA production (ios / android):
- OTA preview (ios / android):
- Local APK path / size / arch:
