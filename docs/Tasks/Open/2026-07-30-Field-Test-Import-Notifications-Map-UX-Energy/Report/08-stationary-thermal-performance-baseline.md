# Ticket 08 — Stationary thermal / performance baseline

**Status:** software scaffolding complete; device thermal measurements **Unverified**  
**Date:** 2026-07-30  
**Code baseline (spec):** `ebeeb5487faf179ff752bb76226fa22a55b35d4d`  
**Diagnostic sample (from Spec):** development build 0.1.3, 2026-07-27 → 2026-07-30, 175 events / 19 sessions

## Protocol (fixed)

Record before each scenario:

| Field | Value (fill on device) |
|---|---|
| Device model / OS | _Unverified_ |
| Build SHA | _fill_ |
| Battery band | e.g. 40–60% |
| Brightness | fixed (e.g. 50%) |
| Network | Wi‑Fi / cellular |
| Foreground time | continuous |
| High Accuracy | on / off per scenario |
| Start thermal state | _Unverified_ |

### Scenarios

1. **Idle map** — Map open, no taps, 3–5 min  
2. **Continuous tap** — Sheet / buttons / list interaction, 3–5 min  
3. **In-journey stationary** — Active gathering, device not moving, 3–5 min  
4. **High Accuracy on/off** — Toggle precise location; compare callback rate  

### Metrics per scenario

CPU, thermal state, frame stall, memory, location callbacks / owner, route recalc, Realtime callbacks, render count, outbox enqueue / flush, network request count, Live Activity token register outcomes.

## Imported diagnostic evidence (Spec sample)

| Signal | Value | Interpretation |
|---|---|---|
| `background_op_timeline` / `outbox_flush` share | 87.4% of total stage time | Strong **correlation** with background cost |
| Background op median / p95 / max | 82 ms / 1964 ms / 2354 ms | p95 near 2s; 5 samples >1s |
| Location upload retry | 20 scheduled, 1 permanent reject | Retry backlog + occasional permanent discard |
| `live_activity_token_register` / `token_unique_unresolved` | 40 | Repeated RLS-hidden unique conflicts |
| `arrival_confirmed` | 13 | Normal journey activity |
| `previous_launch_incomplete` | 8 | **Not** proven crash — incomplete prior session only |
| Unknown native metrics | 9 | Unclassified; not root cause |

### Correlation vs root cause

- Outbox flush duration + token conflict **rank as investigation priorities**.  
- Sample lacks CPU, GPU, frame, thermal state, location owner, and network wake counts → **cannot** attribute hand-feel heat to a single FG UI/location/render owner.  
- `previous_launch_incomplete` must not be labeled crash without symbolicated evidence.

## Hotspot ranking (software-addressable)

| Rank | Hotspot | Evidence | Ticket entry |
|---|---|---|---|
| 1 | Live Activity token re-register / `token_unique_unresolved` | 40 events | **09 enter** |
| 2 | Location outbox flush p95 ~2s + upload retries | 87.4% stage share; 20 retries | **10 enter** |
| 3 | Foreground UI / map / location owner | **No** thermal/CPU/frame owner ranked in sample | **11 no-op** unless new device baseline names one |

## Entry conditions for tickets 09–11

### Ticket 09 — Live Activity token idempotency — **ENTER**

- Trigger: same `(user, device, token, enabled)` or RLS-hidden 23505 repeatedly from mount / push-to-start listener.  
- Success: no continuous `token_unique_unresolved`; permanent conflict stops auto-retry until token/user/device changes; rotation / disable still work.

### Ticket 10 — Location outbox flush/retry — **ENTER**

- Trigger: `outbox_flush` dominates background timelines; passive stationary should not force parallel flushes; force refresh remains immediate.  
- Success: single-flight flush; bounded backoff; passive 30s–1m cadence retained; p95 or >1s count drops **or** network wait is attributed and de-prioritized off hot path.

### Ticket 11 — Evidence-led FG energy fix — **NO-OP (default)**

- 08 evidence does **not** name a concrete FG location owner, map/route recompute storm, or React/Realtime render owner as the primary heat source.  
- Speculative memoization / blanket location off is forbidden.  
- If a future device baseline ranks a FG owner, re-open 11 with that evidence.

## Verification limits

Physical device thermal / symbolicated traces for this pack: **Unverified** (no hardware run in implementer environment). Software AC for 09/10 proceed from the imported diagnostic ranking above.

## Repro steps (device)

1. Install release-like build; note SHA, battery, brightness, network.  
2. Open active group map; enable location sharing.  
3. Run each scenario for 3–5 min; export diagnostics bundle.  
4. Compare `outbox_flush` p50/p95/max, `token_unique_unresolved` counts, and thermal/CPU if Instruments/Perfetto available.  
5. Attach traces next to this file or under `docs/qa/` when collected.
