# Straggler leader APN + Arrival page + Peek solo Implementation Plan

> **For agentic workers:** Execute task-by-task. Checkboxes track progress.

**Goal:** Leader-only 1:N straggler distance → APN fan-out; optimistic straggler toggle; arrival management as its own overlay; peek solo chrome balance.

**Architecture:** Pure `findStragglers` uses leader GPS as target and excludes the leader. Only the leader device runs the hook and calls RPC `report_straggler` → `notify_push`. Edge includes sender for `straggler`. Route sheet keeps one entry row into `arrivalManage`; per-destination `arrival` returns to it. Peek hides「成員」when alone and vertically centers action buttons.

**Tech Stack:** React Native / Expo, Supabase RPC + Edge Functions, Jest.

**Spec:** `docs/superpowers/specs/2026-07-16-straggler-leader-apn-arrival-peek-design.md`

---

### Task 1: findStragglers + tests
### Task 2: migration + Edge
### Task 3: client reportStraggler + MapScreen leader path
### Task 4: toggle no-refresh
### Task 5: arrivalManage overlay
### Task 6: peek solo layout
### Task 7: verify tests
