# Realtime and location delivery decision

Issue #304 combined realtime efficiency fixes with a proposed passive foreground upload delay. The realtime fixes remain delivered: co-member profile subscriptions, a 120-second subscribed reload interval, a 30-second fallback that repeated channel errors cannot starve, and non-overlapping reloads.

Passive Map location uses the allDay policy. Its upload heartbeat is 120 seconds and its movement interval is 150 seconds. Adding a 20-second delay cannot combine successive normally eligible fixes under this policy. The earlier client experiments and reverted teardown-flush candidate are recorded in [the issue audit](https://github.com/Yupoer/hither_app/issues/304#issuecomment-6431622460). That candidate lost a queued event when stopping the screen invalidated location access. Those experiments are historical evidence, not a current device or battery measurement.

Keep immediate delivery after the existing cadence gate. All production callers already chose this path. Remove the unreachable delayed branch, timer ownership and the source-text test that asserted a delay without exercising it. Existing behavior tests cover real sample acceptance, debug-only samples, access changes, upload acknowledgements and cleanup. The durable outbox still batches accumulated events and retains its authorization and retry boundaries.

The proposed passive delay is not adopted. This does not claim that delayed batching was implemented, that uploads continue after consent or membership is revoked, or that a battery saving was measured. The completed realtime work and the rejected delay proposal can now be closed with their actual dispositions recorded.

Validation on the cleanup includes eight existing Jest suites with 80 passing tests covering location policy, foreground lifetimes, outbox persistence, unavailable access storage, passive ownership, group synchronization and realtime cadence. Typecheck, affected lint and test metadata also pass. Required CI validates the final integration separately.
