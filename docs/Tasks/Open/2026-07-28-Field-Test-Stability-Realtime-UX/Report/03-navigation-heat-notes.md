# 03 — Navigation heat / jank / audio notes

## Evidence basis

See `01-field-session-evidence-2026-07-28.md` and `01-outbound-write-inventory.md`. No production MetricKit/thermal series was available in the implement environment; fixes are limited to **code-verified** hot paths.

## Confirmed non-issues (code)

| Check | Result |
|-------|--------|
| Dual location owners FG+BG | MapScreen stops BG journey when `appState === 'active'` |
| Unbounded outbox flush | 20s coalesce; force-sync explicit |
| Continuous marker bitmap tracking | `useTracksViewChanges` clears after 500ms |
| Whole-screen GPS re-init | `mapInitialCenter` locked after first fix |

## Fixes / guards applied

1. **OTA single-flight** (ticket 02) — prevents reload thrash mistaken for crash/heat.
2. **Target pulse** (ticket 07) — 5s short pulse only; `tracksViewChanges` only during pulse capture window; stops on background / Reduce Motion / completed.
3. **Personal progress pure derivation** (ticket 04) — no extra watchers/polling for UI distance.
4. **Force refresh** uses existing `refreshDeviceLocation` one-shot (no second watch owner).

## Explicitly not changed

- Location heartbeat tables (inventory did not prove network dominance).
- Arrival / outbox / Live Activity / Realtime semantics.

## Device gates (ticket 11)

Use `docs/testflight/navigation-energy-acceptance.md` plus Podcast playback. Pass if no serious/critical thermal, no Hither-attributed audio interruption, no watchdog during 30 min smoke.

## Residual risk

Without the 7/28 live series, residual heat from map tile decode + GPU remains unquantified. Re-run energy acceptance after next TestFlight build.
