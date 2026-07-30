# Ticket 11 — Evidence-led foreground energy fix: **NO-OP**

**Date:** 2026-07-30  
**Blocked by / source:** Ticket 08 baseline (`08-stationary-thermal-performance-baseline.md`)

## Decision

**No speculative foreground energy refactor** was applied in this pack.

## Evidence summary (from Ticket 08)

| Ranked hotspot | FG UI / location / map / React owner? |
|---|---|
| Live Activity `token_unique_unresolved` (40×) | No — token register path (Ticket **09**) |
| Outbox flush p95 ~2s + upload retries | No — location outbox (Ticket **10**) |
| CPU / thermal / frame / render owner | **Not present** in diagnostic sample |

Ticket 08 explicitly ranks FG UI/location/render as **not** the evidenced primary heat source. Spec forbids speculative memoization campaigns and blanket location disable when evidence is missing.

## What was done instead

- Ticket **09**: client token gate (idempotent cache + permanent conflict stop + durable TTL + throw recording).  
- Ticket **10**: outbox single-flight flush coordination.  
- Ticket **11**: this document only.

## Re-open criteria

Re-open Ticket 11 only when a device baseline under the Ticket 08 protocol ranks a concrete FG owner with:

1. Call frequency + shared callers  
2. CPU / frame / thermal impact  
3. Lowest shared seam (not per-screen guards)

Until then, claim: **no-op with evidence**.
