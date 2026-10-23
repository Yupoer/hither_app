# B7 workflows plan

Base c7b40b9; common foundation 72ea1a2. Product migration starts only after root start (received); dependency checks wait for private copy ready.

Scope is 14 MapScreen hooks with 26 direct effects and 3 featureTour files with 13. No effect-free hook changes. DeviceLocation, MapKitRoutes, JourneyNavigation and shared foreground/invites implementations remain their assigned owners.

## Small groups and validation

1. Draft/role ownership. Preserve draft buffers, reverse conflict rollback, handled receipts, scope reset and remote role Session writeback. Run routeDraft/groupRole/itineraryMutations/demoItineraryMutations and tsc.
2. Small Map UI resources. Carousel clamp/scroll, gather-card timer/reset, pending-place motion, member-presence hydration and reminder notifications. Keep stable selection/scroll/drafts/shared values. Run gatherCardExpansion/foregroundSheetLifecycle/meetTimeEditor/travelModePreference/mapExtractedHooks and tsc.
3. Workflow observations. Gathering mounted/context/channel ordered ownership, receipt compaction, completion, history, straggler RPC, entitlement fail-closed, coordination and subgroup sent-invites. Run gatheringWorkflow/mapExtractedHooks/useCoordinationRequests/subgroupActions plus source privacy/durable contracts and tsc. Compose shared foreground and invites lifecycle at nested consumers after owners provide APIs.
4. Tours. Committed input snapshot publication per domain job, group completion/eligibility/notification/prepare/measurement, route completion/eligible measurement, overlay keyboard/back/fade/focus. Keep generation, requested/committed snapshots and Next/Prev owners stable. Run groupFeatureTourOverlayFix/groupFeatureTourRound2/routeReorderTour/tourCardLayout plus source contracts and tsc.

Each dynamic resource uses explicit named previous-input React state, per-field Object.is and monotonic generation. Only that resource mounts again; no render external writes or generic deps runner. Native jobs keep original cleanup, no new cancellation of one-shot intent. Tour consumers need committed mirrors published within the same named job before use, avoiding sibling-order assumptions.

## Caller and integration patches

MapScreen invokes all 14 hooks and both tour hooks. It must unconditionally mount returned lifecycle elements next to existing screen content. Tests with null Harness/Probe must mount the matching resource; mapExtractedHooks shared Harness needs optional lifecycle handling for unaffected hooks. Nested useSubgroupActions must include useSubgroupInvites.lifecycle. Gathering/coordination must include useForegroundReconcile result. Root semantic-merges MapScreen and overlapping test fixtures, plus shared hook API updates from group/identity.

## Risks

Original callback/object identity must survive equal-value replacements and A/B/A. RouteDraft reset and gathering context reset precede setup in their domain lifetime. Role remote updates must still persist Session membership. Receipt compaction must preserve active undo tombstones. Entitlement same-team refresh must not flash locked state while new-team starts fail-closed. Tour committed callback snapshots, measurement generations, selection catch-up, rapid Next/Prev, geometry-only copy consistency and focus timer cancellation remain explicit. Runtime tests prove actual consumer installation, not just typed lifecycle fields.

No product tests run during preparation. Native iPhone keyboard, accessibility focus and UI-thread scheduling remain a device acceptance boundary. No push/cloud/dependency/global settings changes.
