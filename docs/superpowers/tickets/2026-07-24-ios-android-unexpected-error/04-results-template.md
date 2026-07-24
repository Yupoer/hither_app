# Emulator gate results template

**Date:** YYYY-MM-DD  
**Operator:**  
**App version / buildNumber:**  
**runtimeVersion / updateId:**  
**iOS emulator:** (image / Xcode) — status: not_run | pass | fail  
**Android emulator:** (AVD / API) — status: not_run | pass | fail  

## Automated suite

```
command: npm test -- --testPathPattern="errorContextContract|apiErrorClassificationContract|recoveryContract|appErrorBoundary|instrumentedSupabase|uiActionContract|performanceTracingContract|performanceFlush|emulatorReleaseGateContract"
result: pass | fail
notes:
```

## Scripted flow log (no tokens / user IDs / coordinates / raw responses)

| # | Platform | Step | Pass? | route/action | operation | code/status | notes |
|---|----------|------|-------|--------------|-----------|-------------|-------|
| 1 | android | cold launch |  |  |  |  |  |
| 2 | android | map entry |  |  |  |  |  |
| 3 | android | map re-entry |  |  |  |  |  |
| 4 | android | role mismatch |  |  |  |  |  |
| 5 | android | maps unavailable |  |  |  |  |  |
| 6 | android | token conflict |  |  |  |  |  |
| 7 | android | action error |  |  |  |  |  |
| 8 | android | action timeout |  |  |  |  |  |
| 9 | android | banner retry |  |  |  |  |  |
| 10 | android | banner cancel |  |  |  |  |  |
| 11 | android | double tap |  |  |  |  |  |
| 12 | android | consent off |  |  |  |  |  |
| … | ios | (repeat) |  |  |  |  |  |

## Classification checks

- [ ] Offline / slow network → subsystem network or maps (not react_render)
- [ ] Leader role mismatch → authorization / leader_role_required
- [ ] Maps 503 → maps / upstream_unavailable
- [ ] Token 409 → registration / duplicate_key
- [ ] No contextless generic-only error when consent on
- [ ] Error events flush priority over normal traces (existing scheduler)

## Residual risks (local only)

| Risk | Evidence | Follow-up |
|------|----------|-----------|
| Native crash / ANR |  | physical device only if evidence |
| GPU / renderer |  |  |
| APNs Live Activity hardware |  |  |

## Phase conclusion

- App-level tickets 01–04: pass | fail  
- Physical device required: no | yes (why)  
