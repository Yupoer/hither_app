# 01 — Outbound write inventory (client → backend)

Complete inventory of **passive and user-triggered** writes from the mobile app. Cadences are from code review of `apps/mobile` (2026-07-28). Foreground = app active; background = BG journey / headless notification task.

| # | Trigger | FG/BG | Destination | Min / heartbeat | Batch | Retry / backoff | Wakes GPS? | Payload class |
|---|---------|-------|-------------|-----------------|-------|-----------------|------------|---------------|
| 1 | Location sample (UI-gated) | FG | local state only | uiMinDistance / uiMinInterval | n/a | n/a | No (consumes sample) | coords (device) |
| 2 | Location upload enqueue | FG/BG | `location_outbox` → `member_locations` | uploadMin + heartbeat (mode/motion) | 1 row/enqueue; flush coalesce 20s FG | outbox retry | Moving heartbeats may | coords + accuracy + group |
| 3 | Force location refresh (self) | FG | immediate outbox flush + `member_locations` | on tap | 1 | user retry | **Yes** one-shot | coords |
| 4 | Force location refresh (peers) | FG | RPC `request_group_location_refresh` | cooldown server-side | fan-out push | cooldown alert | No (sender) | group id |
| 5 | Peer push → headless refresh | BG | outbox + upload | on notification | 1 | outbox | **Yes** getCurrent | coords |
| 6 | Background journey sample | BG | outbox + LA update + optional ack | journey policy heartbeats | 1 | outbox | **Yes** (journey denser) | coords + session |
| 7 | Navigation session start/end/ack | FG | `navigation_sessions` RPCs | on action | 1 | session retry | No | session ids |
| 8 | Gathering start/end/complete/switch | FG | core outbox → RPCs | on leader action | 1 op | outbox backoff | No | gathering state |
| 9 | Destination arrival mark | FG | `destination_arrivals` | on arrive | 1 | retry later | No | dest + user |
| 10 | Live Activity session upsert | FG | `live_activity_sessions` | ≥30s | 1 | soft fail | No | activity + distances |
| 11 | Live Activity token register | FG | device activity tokens | on token / enable change | 1 | soft / reclaim | No | token metadata (no raw in diag) |
| 12 | Core operation outbox flush | FG | various RPCs | on enqueue + reconnect | multi | exponential | No | ops |
| 13 | Diagnostic batch upload | FG/BG | `diagnostic_events` | 100 rec or ~15 min | ≤100 | resolve accept/fail | No | allow-listed events |
| 14 | Performance events | FG | `performance_events` | sampling policy | batch | soft | No | ops / durations |
| 15 | Quick command | FG | `commands` + push fan-out | on tap | 1 | user retry | No | command type/label |
| 16 | Coordination request/vote | FG | coordination tables | on action | 1 | soft | No | request payload |
| 17 | Profile / prefs / avatar | FG | `profiles` | on save | 1 | soft | No | prefs |
| 18 | Straggler / meet-time writes | FG | related tables | on action | 1 | soft | No | flags/times |
| 19 | Push token / FCM-APNs register | FG | tokens table | on permission / launch | 1 | soft | No | token |
| 20 | Google Maps directions proxy | FG | Edge `google-maps` | route recompute gates | 1 | cooldown on 503/quota | No | origin/dest (approx) |

## Heartbeat detail (location)

| Power mode | Moving heartbeat | Stationary heartbeat | Notes |
|------------|------------------|----------------------|-------|
| foreground (balanced) | 45s | 90s | default map open |
| foreground (high accuracy) | 30s | 60s | user toggle |
| journey (balanced) | 45s | 90s | BG navigating |
| journey (high accuracy) | 25s | 60s | opt-in |
| allDay | 180s | 300s | locked presence |

Evaluator tick: **15s** (`HEARTBEAT_TICK_MS`) — does not force GPS every tick when stationary / MapKit-owned.

## Request-storm risks (do not blanket-throttle)

- Dual FG watch + BG task → already stopped by single GPS owner.
- Continuous `tracksViewChanges=true` on custom markers → already gated ≤500ms.
- Per-sample outbox flush → coalesced 20s.
- Live Activity DB upsert every UI frame → throttled 30s; native updates use rounded buckets.

## Changes applied after inventory (tickets 02–03)

- OTA manual/auto single-flight (no double reload storm).
- Force refresh: self one-shot before peer fan-out; no success alert.
- No blanket reduction of heartbeats without measured dominance.
