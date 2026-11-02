---
name: verify-location-sync-formally
description: Check Hither's mixed core/GPS sync partial-reply, retry and account-switch safety with bounded TLA+ and real TypeScript replay when changing groupSync or either outbox's exchange settlement.
---

Run from the repository root:

```powershell
node .cursor/skills/verify-location-sync-formally/scripts/check.cjs
```

Requires Node, this checkout's `apps/mobile/node_modules/typescript`, Java 21, and the [official TLA+ v1.7.4 release](https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4). Its `tla2tools.jar` reports TLC Version 2.19 of 08 August 2024. Install it once from the repository root:

```powershell
$formalTools = '.cursor/skills/verify-location-sync-formally/.tmp/tools/stable-v1.7.4'
New-Item -ItemType Directory -Force -Path $formalTools | Out-Null
Invoke-WebRequest -Uri 'https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar' -OutFile "$formalTools/tla2tools.jar"
```

You can instead set `TLA2TOOLS_JAR` to that artifact. SHA-256 must be `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`. The runner checks this digest and never downloads or accepts a different binary implicitly. Do not substitute the mutable rolling release.

The promise is that a partial or lost mixed reply cannot discard unacknowledged core/GPS data, and switching accounts cannot publish the previous account's snapshot into the new account. Breaking it loses offline edits/location delivery or exposes another actor's projection.

[source-map.json](source-map.json) records actual owning functions, source hashes and the last reviewed sync commit. The source mapping was reviewed at its recorded `syncCommit`. Source hashes use UTF-8 text with CRLF normalized to LF so the same checkout content works on Windows and Unix. This skill covers only the added mixed transport behavior. It does not certify the entire App.

The command checks all reachable states of [models/MixedSync.tla](models/MixedSync.tla) within two actors, one group, three core operations including one dependent pair, three GPS events, two exchanges and one A-to-B switch. Server responses may be lost or omit any ACK subset; core settlement can stop between operations and GPS settlement is one database transaction. Settlement is conservatively allowed across an account switch when an explicit ACK exists; the model does not make the guard and asynchronous database write one atomic action. `Publish` maps to the final actor check followed by the synchronous snapshot and pending-refresh listeners. `NoUnacknowledgedDeletion`, `NoCrossActorProjection`, and `Conservation` must pass. The ACK-all and removed-publish-fence variants must produce their named invariant violations and the pinned checker's safety-violation exit code `12`. An unexpected tool error is a failure, never a passing mutation.

The real-code replay runs `syncGroup`, core `flush`/settlement, and GPS exchange/settlement from this checkout. It enumerates 96 combinations of core ACK prefix, GPS ACK subset, reply loss and account-switch boundary, then retries the original IDs. An unswitched, received first reply must resolve and publish exactly once. A lost first reply must preserve the controlled transport's `lost_reply` error; a received reply with a reached account switch must reject with `account_changed`. Both publish zero times. Every successful retry must publish exactly once more. Each publication forwards the same reply's pending-refresh commands to the current actor's listener; command execution remains outside scope. These bounded replay checks establish successful publication for their scenarios. The model's safety invariants do not prove publication or liveness.

Auth/privacy, native packages, SQLite driver and the network are controlled external boundaries. The outbox algorithms are imported through TypeScript transpilation. One scratch source string changes GPS settlement to delete every selected row and must fail its durability assertion. A second removes the real `groupSync` listener dispatch and must fail the exact first-call publication-count assertion. An unmodified source run follows each mutation and must pass. Product files are never edited for mutation testing.

The replay fixes the external `AppState` boundary to background and calls the second exchange explicitly after advancing its controlled clock. The real queue selection and settlement code still runs. Queue-owned `scheduleLocationOutboxRetry`, timer firing, foreground retry cadence and delivery liveness are outside this check and belong in the owning outbox tests.

`exchangeGroup` is a mocked network boundary here. The model assumes the server executes each envelope as its captured actor and binds results to that actor. It does not verify `GroupSyncService.exchangeGroup`, lazy authenticated transport, or the SQL `sync_group` check that captured `p_actor_id` matches `auth.uid()` before any effects. If an A-owned draft reaches the RPC with B's credentials, this check cannot establish that the server rejects it. Independent security review found that separate race; this formal verification did not detect or prevent it. Verify that boundary with the owning transport/SQL cases.

Evidence is written to this skill's ignored `.tmp/summary.json` and per-model `tlc.log`, including current source hashes and counterexample traces. Read the first failed assertion or invariant and replay its ordering in the owning functions. If actual code breaks the promise, report the finding. If the model's atomic steps or mocks no longer match an intended implementation, correct that mapping without weakening the promise. Re-run the command after a correction.

After covered code changes, review the source/function mapping and the actual transaction/await/account boundaries, update the hashes, and move `syncCommit` forward only after integration and review. Keep the scratch mutation effective. Use `maintain-formal-verification-skill` for a broader drift audit when available.

The model and replay assume every selected GPS row remains unexpired according to its stored `expiresAt` throughout the run. Local TTL expiration may intentionally remove an unacknowledged row, including through `pruneExpired` before authentication. That policy is outside this bounded ACK/deletion promise and remains in the owning outbox tests; this replay does not establish TTL-pruning behavior.

The finite model proves safety only under its stated bounds and trusted UUID/actor-bound server result contract. It covers accepted and omitted results. Permanent GPS rejection and core conflict handling remain in the owning behavioral suites. It does not prove liveness, every queue size, FIFO/alias equivalence on the server, arbitrary local I/O crashes, repeated A-B-A sessions, privacy-consent generations independent of an account switch, exact refresh tokens/sample freshness, SQL authorization, hosted migrations, OS wakeups, native sampling or device delivery. Those remain separate verification work.
