# OTA-07 Implementation Report — 2026-07-25

## Decision (Ticket 01)

**Reduced existing UI** on MapScreen (not a true second overlay shell / second navigation tree).

See [Plan/2026-07-25-passive-presentation-decision.md](../Plan/2026-07-25-passive-presentation-decision.md).

## What shipped (Ticket 02)

| Area | Change |
|---|---|
| Preference | `passiveCompanionMode` + `pref.passiveCompanionMode` AsyncStorage |
| Pure model | `utils/passiveCompanion.ts` — team phase, next point, coarse progress, allowed/forbidden actions |
| UI | `PassiveCompanionPanel` — switch-back always on; external maps; `need_help` |
| MapScreen | When passive: hide carousel/sheet/pills; show panel; loading path still has switch-back |
| Settings | Switch under 地圖與旅程 |
| i18n | zh + en keys under `passive.*` / `settings.passiveCompanionMode*` |
| Tests | `passiveCompanionPresentationContract.test.ts` (9 cases) |

## Verification

```bash
cd hither_app/apps/mobile
npx jest --config jest.config.js src/__tests__/passiveCompanionPresentationContract.test.ts --no-coverage
```

Manual: Settings → enable 被動同行者模式 → confirm panel → external nav / help / 切回完整介面 → kill app → relaunch still passive.
