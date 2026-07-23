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
| Cold-launch crash | 0/10 | 1/1 smoke: no crash buffer; PID live; MainActivity focused |
| Map black screen | 0/10 | not fully exercised (needs signed-in map group session) |
| Full-app gray | 0/10 | not observed on cold launch smoke |
| Blue-dot flash/loss | 0/10 | pending map session + 10× loop |
| ⋯ menu cancel visible | 10/10 | unit contract pass; UI on emulator pending map |
| Frozen frame >700 ms | 0 | cold-launch gfxinfo: 1× ~1100 ms bucket (x86_64 ARM translate emulator — not release gate for physical Pixel) |
| S25F1 | estimate from worst Pixel run only | **未實測** |

### Emulator cold-launch gfxinfo (single run, not 10× matrix)

- Device: `sdk_gphone16k_x86_64` API 37
- Total frames: 333; janky: 36 (10.81%)
- p50 / p90 / p95: 24 / 40 / 65 ms
- Note: arm64-only APK via ARM translation; do **not** treat as Pixel physical baseline.

## Commits / OTA / APK

- Feature branch: `agent/android-map-menu-perf`
- Master SHA: `c4ac4c6`
- OTA production ios: group `0fe15594-36e8-4520-bc50-feda26edb046` — https://expo.dev/accounts/yupoer/projects/hither/updates/0fe15594-36e8-4520-bc50-feda26edb046
- OTA production android: group `8f355dcc-3615-49ad-a191-fc067bfe4db7` — https://expo.dev/accounts/yupoer/projects/hither/updates/8f355dcc-3615-49ad-a191-fc067bfe4db7
- OTA preview ios: group `7b45ad2a-6121-442b-b951-ad3a49b854e7` — https://expo.dev/accounts/yupoer/projects/hither/updates/7b45ad2a-6121-442b-b951-ad3a49b854e7
- OTA preview android: group `7c735a90-34ea-4c4c-b017-6ab4ada75d23` — https://expo.dev/accounts/yupoer/projects/hither/updates/7c735a90-34ea-4c4c-b017-6ab4ada75d23
- Runtime version: `0.1.3`
- Local APK: `C:\h\m\android\app\build\outputs\apk\release\app-release.apk` (also copied to `apps/mobile/dist-apk/hither-release-2026-07-23-map-menu-perf.apk`)
- Size: 36,189,910 bytes; arch: arm64-v8a; signing: debug keystore (sideload)
- SHA-256: `D37C881E45273E90328EA834CDA1519373660A709BB4CBE452636E3E264FA784`
