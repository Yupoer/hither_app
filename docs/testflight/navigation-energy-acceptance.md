# Navigation Energy Acceptance Gate

Use the same physical device and OS as the pre-change baseline. Low Power Mode off,
battery 80–100% at start, fixed route, fixed 50% brightness, same network type
(Wi‑Fi or cellular — do not mix mid-route). Do **not** set
`EXPO_PUBLIC_PERFORMANCE_TRACING=full` during measurement; full API tracing
pollutes battery and radio.

## Routes

| Route | Purpose | Duration | Screen |
|---|---|---:|---|
| Smoke | Catch telemetry / GPS regressions quickly | 30 min | Continuously on |
| Acceptance | Ship gate for energy + reliability | 90 min | Once continuous; once 30 min FG + 60 min locked/background |

Record: build number, iOS version, device model, route start/end (Asia/Taipei),
battery start/end, thermal notes, Instruments Power Profiler screenshot links
(private), MetricKit day if available.

## Pass / fail thresholds

| Gate | 30-minute smoke | 90-minute acceptance |
|---|---:|---:|
| Battery delta, fixed 50% brightness | ≤10% | ≤25% |
| Thermal | no `serious`/`critical` | no `serious`/`critical`; `fair` cumulative ≤10 min |
| Self blue-dot visual latency | P95 ≤1 s | P95 ≤1 s |
| Stop/resume visual response | ≤2 s | ≤2 s |
| Valid fix horizontal accuracy | median ≤15 m, P95 ≤50 m | same |
| False arrival | 0 | 0 |
| `BestAccuracyForNavigation` | 0 by default | 0 by default |
| Location outbox remaining | ≤10 | ≤20 and falling after reconnect |
| Location upload terminal retry | 0 | 0 |
| `destination_arrivals` with no DB changes | initial load only | ≤3 total |
| Hither logical writes | ≤35 MB | ≤100 MB |
| Hither network excluding map tiles | ≤5 MB | ≤15 MB |
| Peak memory | ≤350 MB | ≤350 MB |
| Watchdog / crash / memory pressure | 0 | 0 |

If the 30-minute smoke fails any gate, fix the measured stack before attempting
the 90-minute acceptance route.

## Instruments checklist (smoke)

With Xcode Instruments on the same device:

1. **Power Profiler** — location accuracy tier time (expect zero
   `BestAccuracyForNavigation` for default walking team navigation).
2. **CPU Profiler** — top stacks during navigation; SQLite write stacks should
   not dominate.
3. **Network Connections / HTTP Traffic** — Hither HTTP request count by endpoint.
4. **Allocations / VM Tracker** — resident/physical footprint trend.

## Supabase verification queries

Replace `:route_started_at` / `:route_ended_at` with the recorded window
(timestamptz, ideally Asia/Taipei converted to UTC).

### API rate by operation

```sql
select operation,
       count(*) as calls,
       min(occurred_at) at time zone 'Asia/Taipei' as first_taipei,
       max(occurred_at) at time zone 'Asia/Taipei' as last_taipei
from public.performance_events
where occurred_at >= :route_started_at
  and occurred_at < :route_ended_at
group by operation
order by calls desc;
```

Expect sparse `navigation.energy.sample` (about one per 5 minutes while active)
and no unbounded per-API success flood.

### Location upload quality

```sql
select tracking_mode,
       count(*) as uploads,
       round(avg(horizontal_accuracy)::numeric, 1) as avg_accuracy_m,
       percentile_cont(0.95) within group (order by horizontal_accuracy) as p95_accuracy_m,
       round(
         extract(epoch from (max(captured_at) - min(captured_at)))::numeric /
         nullif(count(*) - 1, 0),
         1
       ) as avg_interval_s
from public.location_upload_events
where captured_at >= :route_started_at
  and captured_at < :route_ended_at
group by tracking_mode;
```

### Retry / discard diagnostics

```sql
select event,
       coalesce(payload->>'errorCode', '') as error_code,
       count(*) as count,
       max(nullif(payload->>'remaining', '')::int) as max_remaining
from public.diagnostic_events
where occurred_at >= :route_started_at
  and occurred_at < :route_ended_at
group by event, error_code
order by count desc;
```

`location_upload_failed` with `retry_scheduled` should be rare and falling.
`location_upload_discarded` with `permanent_reject` should not reappear as retries.

## Result sign-off

- Tester:
- Build number:
- Device / iOS:
- Smoke battery Δ / thermal:
- Acceptance battery Δ / thermal:
- BestAccuracyForNavigation seconds:
- Outbox remaining end:
- Blocking failures:
- Approved: yes / no
