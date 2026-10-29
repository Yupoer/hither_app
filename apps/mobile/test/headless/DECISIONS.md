# Headless operation expansion

Issue [320](https://github.com/Yupoer/hither_app/issues/320) expands the initial nine entries from PR 319. The requested boundary is application code running without a mobile operating system, with external hardware, SDKs and backend responses simulated.

## Execution model

We compared extracting screen controllers with mounting the existing screens through external native host adapters. The host approach keeps private callbacks, React state, providers, disabled controls and production wrappers together. It avoids maintaining another implementation of the same business flow. Controller extraction remains appropriate only when production itself benefits from a shared API.

Each actor retains its own child process and persistence. Sharing production singletons between virtual users would hide account and lifecycle defects. Only React act scopes serialize inside an actor; IPC and held network responses remain concurrent so a callback can wait for an external event without blocking that event.

Platform selection includes module resolution. An iOS run must load its actual `.ios` source where present, while Android resolves its own or shared implementation. Native execution is still simulated. Neither result establishes Swift, Kotlin, MapKit, OS permission or physical-device correctness.

## Coverage accounting

The source inventory records behavior families. The callable registry records individual entry points, including form fields and service helpers. Lifecycle effects are separate entries, and a reviewed source path without a production caller is separate from both. These counts cannot substitute for assertions in passing scenarios.

Actual screen scenarios prove internal parent callbacks. Standalone component scenarios prove validation and callback output only when a parent is represented by a receipt collector. A service scenario proves the service path and does not establish its screen caller's guards.

Source anchors and the source fingerprint make new or changed operations require review. Updating the fingerprint without examining the changed callbacks defeats the gate. Exclusions need source evidence; missing mocks, private closures and implementation effort are not exclusions.

## Independent checks

Backend review found permissive fixture contracts despite passing contract tests. Fixes therefore compare permission, original navigation session, arrival ordering, history correction, receipt identity and privacy behavior against the effective SQL migrations. The regression suite includes both allowed and rejected transitions. This remains simulated backend evidence, not a PostgreSQL or RLS test.

Host review checks hidden and non-editable controls, account navigation reset, unknown external calls and listener disposal. Cleanup observes residual subscriptions after real unmount; clearing fixture collections first would conceal leaks.

Production defects discovered by these scenarios need a focused regression and a minimal fix, or an explicit unresolved issue. Tests must not change external event ordering or grant premium fixtures merely to avoid a failing application path.

## Findings from complete callers

The real Map add-place callback invokes a remote refresh after its durable write. That refresh exposed a missing pending-itinerary projection in the durable snapshot. A service-only enqueue check had not exercised this caller. The fix must retain pending intent across cold reads and remain correct when the foreground hook projects the same operations again.

Session entitlement refreshes must belong to the account and membership that created their callback, including callbacks invoked only after a team switch. Personal profile refresh can still update the same account while discarding obsolete team projections. Real provider and purchase-recovery integration checks guard against refresh callback identity causing subscription loops.

Native support follows the repository's actual platform exports. An available iOS native background path and Android's Expo fallback are different scenarios. A platform flag alone cannot establish that either branch ran.

Destination snapshots retain the IDs of local commands already represented by their destination array. Hydration, ACK replacement, alias rewriting and SQLite round trips preserve or clear this provenance with that array. Other state slices still replay their pending commands. This avoids applying an insertion or reorder twice without changing insertion semantics or discarding a server-accepted order.

Arrival receipt compaction retains the newest accepted receipt until older superseded receipts have disappeared from the next durable read. This keeps an interrupted cleanup from reviving an older undo. Switching targets reads open-point status from the durable itinerary because the authoritative gathering projection can include only its current target.

## Recorded trip and disconnection tolerance

The Tokyo acceptance mounts three full Apps so receiver notifications and committed map inputs are checked together. Disk snapshots remain separate evidence because live peer patches can precede persistence. Profile restoration runs its deferred turn before display-name assertions. Every external action and process generation can be retained in a fresh output directory.

The clock advances in bounded segments with IPC settlement and actor-stamped backend requests. A single large fake timer jump previously manufactured request timeouts and incorrect server offsets. Powered-off gaps test persistence and expiry, not overnight operating-system execution.

Pending privacy hydration suspends acquisition and preserves durable fixes. Confirmed revocation still purges them. Registered GPS and push callbacks exercise the distinction. Journey and participation receivers check concrete payloads; versioned identities retain an explicit legacy envelope for clients awaiting OTA. New Edge table reads require explicit service-role grants in the disabled-default replay.

The reviewed source fingerprint includes the changed Map location owner, privacy/outbox boundaries, team entry, notification producer, native JavaScript presentation wrapper and message identities. Focused regression tests, the full App trip and the 58-family execution matrix provide evidence. Function fingerprints and registry counts alone do not establish passed scenarios.
