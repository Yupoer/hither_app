# Hither Release Queue

## 尚未 OTA

| Task | Commit | Platforms | Summary |
|---|---|---|---|
| `docs/Tasks/Completed/2026-07-26-sheet-settings-tools-ui` | `PENDING-COMMIT` | iOS / Android | Sheet 直接開設定、整合個人與工具偏好，移除脫隊設定 UI，主 selector 套用既有 Liquid Glass boundary。 |

## Native / Build / Submit / APK

目前沒有本 task 的 native、config 或 dependency 變更。

## Supabase / Device gates

| Task | Branch | Required before release |
|---|---|---|
| `apps/mobile` Amicro UI / account linking | `master` @ `0a27447` | No OTA/EAS yet; enable Allow manual linking in hosted Supabase Auth and complete iOS/Android dev-client UI verification. |
| `docs/Tasks/Open/2026-07-29-Gathering-Route-Arrival-Integration` | `agent/hither/260729-arrmap` | 套用 `20260729113543_request_start_command.sql`、部署 `send-push`、執行 Deno tests；iOS 驗證 MapKit/transit/Apple Maps/抵達通知，Android 驗證路線與抵達通知。 |
