# Team Navigation / Diagnostics TestFlight Matrix

Use a `diagnostic` EAS build on two physical iPhones (leader + member). Record the
build number, iOS version, device model, start/end time, callback count, accepted
upload count, error count, and battery delta for every row. Do not paste raw APNs
tokens, coordinates, email addresses, or exported JSON into this document.

## Acceptance gates

- Navigation remains usable locally when team location sharing is disabled.
- The server never accepts location events while `sharing_enabled = false`.
- Realtime loss or force quit must not be treated as session cancellation; server
  state remains authoritative until complete, cancel, or expiry.
- SQLite outbox replay is idempotent and preserves sequence order after reconnect.
- Permanent RPC rejects are discarded (not retried for 24h); only transport failures back off.
- Arrival requires two qualifying fixes (accuracy <= 50 m) without route-progress
  regression greater than 0.03.
- Push-to-start, update, and end are verified on lock screen and Dynamic Island.
- Exported diagnostics contain no coordinates, tokens, email, or free-form errors.
- Walking team navigation defaults to High + Fitness activity with auto-pause;
  never `BestForNavigation` unless explicitly re-enabled after measurement.
- iOS foreground map uses MapKit `showsUserLocation` as the single continuous
  location owner (no second Expo `watchPositionAsync` while the map is active).
- Energy acceptance: see `navigation-energy-acceptance.md` (30 min smoke / 90 min gate).

## Execution matrix

| ID | Mode / scenario | Network / device state | Procedure | Expected result | Build / iOS / device | Duration | Callbacks | Uploads | Errors | Battery Δ |
|---|---|---|---|---|---|---:|---:|---:|---:|---:|
| 01 | `hidden` | Wi-Fi, foreground | Disable location sharing; start local route | No team position upload; local route continues; `sharing_disabled` ACK |  |  |  |  |  |  |
| 02 | `passiveBackground` | 5G, screen locked | No active route; background app for 30 min | Low-cadence valid callbacks; bounded battery use |  |  |  |  |  |  |
| 03 | `foreground` | Wi-Fi, app active | Open map and move for 15 min | Foreground owner only; no duplicate background task callbacks |  |  |  |  |  |  |
| 04 | `teamNavigation` | 5G, member app background | Leader starts shared navigation | Member ACKs, shares at team cadence, local route is not overwritten |  |  |  |  |  |  |
| 05 | `navigationMax` | 5G, high accuracy on | Navigate actively for 20 min | High-accuracy cadence only while eligible; clean downgrade on stop |  |  |  |  |  |  |
| 06 | Offline outbox | Airplane mode → Wi-Fi | Move while offline, then reconnect | SQLite queue survives restart and batch replay is ordered/idempotent |  |  |  |  |  |  |
| 07 | Force quit | 5G, active shared session | Force quit member app, reopen | Server session remains active; client rehydrates and ACKs once |  |  |  |  |  |  |
| 08 | Permission denied | Location permission denied | Receive shared navigation | Local session UI remains stable; no GPS upload; actionable permission state |  |  |  |  |  |  |
| 09 | Push-to-start | Device locked, app terminated | Leader starts shared navigation | ActivityKit Live Activity starts from APNs push-to-start |  |  |  |  |  |  |
| 10 | Live Activity update/end | Device locked | Change progress, then cancel/complete | Lock screen updates; all matching activities end without orphan |  |  |  |  |  |  |
| 11 | Two-fix arrival | Wi-Fi or 5G | Enter radius with one poor and two accurate fixes | Poor fix rejected; first accurate fix is candidate; second confirms arrival |  |  |  |  |  |  |
| 12 | Route regression guard | Wi-Fi or 5G | Enter radius while route progress regresses > 0.03 | Arrival is not confirmed until progress is stable |  |  |  |  |  |  |
| 13 | JSON export | Diagnostic build | Open Settings → Diagnostics → export | Summary fields present; sensitive values absent; share sheet opens |  |  |  |  |  |  |
| 14 | MetricKit delivery | Diagnostic build, next day | Use app, induce normal workload, reopen after iOS delivery | Metric/diagnostic payload spooled atomically, uploaded once, then removed |  |  |  |  |  |  |
| 15 | APNs fallback | Invalid ActivityKit token | Start shared navigation | Exact dead token pruned; regular notification fallback is sent |  |  |  |  |  |  |
| 16 | Energy smoke | Fixed 50% brightness, no full tracing | 30 min team navigation on fixed route | See `navigation-energy-acceptance.md` smoke gates |  |  |  |  |  |  |
| 17 | Energy acceptance | Same device as baseline | 90 min route (FG continuous; FG+lock split) | See `navigation-energy-acceptance.md` acceptance gates |  |  |  |  |  |  |

## Result sign-off

- Tester:
- Diagnostic EAS build URL / ID:
- Production candidate build URL / ID:
- Supabase migration version: `20260716214247`
- Blocking failures:
- Non-blocking observations:
- Approved for production TestFlight: yes / no
