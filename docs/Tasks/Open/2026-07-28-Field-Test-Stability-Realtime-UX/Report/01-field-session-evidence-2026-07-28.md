# 01 — Field session evidence (2026-07-28 09:00–13:00 Asia/Taipei)

**Window:** 01:00–05:00 UTC (09:00–13:00 Asia/Taipei)  
**Status:** code-anchored inventory + query templates. Live Supabase / MetricKit rows for this window were **not** queryable from the implement environment (no production credentials). Treat rows below as the correlation plan + code-verified cadences, not as claimed telemetry facts.

## Crash class separation

| Class | Definition | How to identify in logs |
|-------|------------|-------------------------|
| Intentional OTA reload | `Updates.reloadAsync` after apply | `settings applyOta` / bootstrap; next launch has new update id; no MetricKit abnormal exit |
| JS error | Unhandled JS exception / ErrorBoundary | `unhandled_exception`, `react_render` performance ops |
| Native signal | EXC_BAD_ACCESS / SIGABRT etc. | MetricKit / Xcode crash, `crash_class` diagnostic |
| Watchdog | Jetsam / 0x8badf00d / ~8s main hang | `watchdog_budget`, background op timeline near 8s |
| Memory pressure | Jetsam memory | MetricKit memory metrics; diagnostic `memory` samples |

**Do not** treat app backgrounding or user swipe-away as crash.

## Correlation query templates (01:00–05:00 UTC)

```sql
-- Performance ops in window
select operation, count(*) as calls,
       min(occurred_at) as first_at, max(occurred_at) as last_at
from public.performance_events
where occurred_at >= '2026-07-28 01:00:00+00'
  and occurred_at <  '2026-07-28 05:00:00+00'
group by 1 order by calls desc;

-- Diagnostic events (allow-listed) by crash / thermal / screen
select event, error_code, count(*)
from public.diagnostic_events
where occurred_at >= '2026-07-28 01:00:00+00'
  and occurred_at <  '2026-07-28 05:00:00+00'
group by 1, 2 order by count(*) desc;
```

Join keys when present: `update_id`, `runtime_version`, `app_version`, `device` hash, `navigation_session_id`, `screen`, `action_id`.

**Privacy:** never log raw coordinates, tokens, or unhashed PII in reports.

## Code-verified hot-path anchors (starting evidence)

| Subsystem | Cadence / behavior | Source |
|-----------|-------------------|--------|
| Location UI gate | distance + interval (mode-dependent) | `locationPolicy` + `useDeviceLocation` |
| Location upload heartbeat | moving/stationary heartbeats; 15s evaluator tick | `HEARTBEAT_TICK_MS = 15_000` |
| Location outbox flush coalesce | 20s delay; force-sync immediate | `OUTBOX_FLUSH_DELAY_MS` |
| Live Activity native update | rounded distance/10m, ETA/15s, progress/20 | `useLiveActivity` |
| Live Activity DB persist | min 30s | `PERSIST_MIN_MS = 30_000` |
| Diagnostic batch | 100 records or 15 min scheduler | diagnostics + logBatchScheduler |
| Core outbox | coalesce + retry with backoff | `coreOperationOutbox` |
| Foreground/background GPS | single owner: FG stops BG task | MapScreen `startBackgroundJourney` / `stopBackgroundJourney` |
| Marker bitmaps | `tracksViewChanges` true ≤500ms then false | `GroupMap.useTracksViewChanges` |

## Most likely hypotheses for field heat / jank (ranked, with counter-evidence)

1. **Map open + high-accuracy FG GPS + route recompute + Live Activity** concurrent CPU (not necessarily Supabase write storm).  
   - Counter: if performance_events show sparse uploads, network is not dominant.
2. **Intentional OTA reload misread as crash** after Settings「立即更新」.  
   - Counter: if MetricKit shows abnormal exit after reload, investigate native termination instead.
3. **Team entry after OTA** race (membership hydration / Live Activity cleanup / map mount).  
   - Mitigated in ticket 02 (single-flight OTA + idempotent enter).

## Missing evidence (residual)

- Actual thermal / CPU / frame-stall series for the Taipei window  
- MetricKit day payloads for the two reported “leave app” events  
- Per-device update id ↔ crash class join  

## Measurable fix gates (for ticket 03 / 11)

| Metric | Gate |
|--------|------|
| Watchdog / unexpected termination during OTA apply→reload | 0 (reload is intentional) |
| Team entry after OTA | no blank hang, no native kill |
| Navigation 30 min smoke (Podcast on) | no serious/critical thermal; no audio ducking from Hither |
| Location upload storm | no unbounded retry; heartbeat respects motion policy |

## Anti-pattern rejected

Blanket reduction of all backend frequencies **without** this inventory is out of scope and was not applied.
