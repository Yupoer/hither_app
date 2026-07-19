# iOS Runtime Crash Regression

Device: iPhone13,3
OS: iOS 26.5.2
Distribution: TestFlight Release

Record for every candidate before marking PASS:

- Git SHA:
- TestFlight build:
- Runtime fingerprint:
- Expo / RN / engine / Reanimated / Worklets:
- Podfile.lock Hermes tag or JSC marker:

## Procedure

- [ ] 50 次 force-quit 後 cold launch；每次等待 30 秒。
- [ ] 已登入 session cold launch 20 次。
- [ ] 未登入／onboarding cold launch 10 次。
- [ ] 進入 Map、開關 BottomSheet、拖曳、切換前後景各 20 次。
- [ ] 開始／停止導航各 10 次，含背景 2 分鐘後恢復。
- [ ] 連續使用 30 分鐘；至少觸發 onboarding animation、Map animation、通知註冊與 MetricKit drain。
- [ ] Settings > Privacy & Security > Analytics & Improvements > Analytics Data 無新增 Hither EXC_BAD_ACCESS。
- [ ] TestFlight crash count 在 24 小時觀察窗為 0。

## Release evidence

- Git SHA:
- TestFlight build:
- Runtime fingerprint:
- Expo / RN / engine / Reanimated / Worklets:
- Podfile.lock Hermes tag or JSC marker:
- Original-device 50 cold launches: PASS / FAIL
- 30-minute mixed flow: PASS / FAIL
- 24-hour TestFlight crash observation: PASS / FAIL
- Previous-launch incomplete breadcrumb count:

## Rules

- Any change to engine, RN, Expo, Reanimated, Worklets, native modules, or Podfile.lock requires a full re-run of this script on the original device.
- Pure JS OTA still requires confirming the fingerprint runtime target matches the installed binary.
- Simulator, Expo Go, and Debug results are informational only and cannot set RESOLVED.
