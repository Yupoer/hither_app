# CI node execution and advisory evidence

`npm run test:ci` in `apps/mobile` runs the complete default node Jest configuration once. It uses the existing changed-source coverage command with `--full-node-tests`. Qualifying sources use the original serial coverage flags and aggregate function threshold of 85. An empty qualifying set uses ordinary Jest workers and logging. `npm test` remains ordinary Jest. Standalone `npm run test:coverage:changed` still skips an empty qualifying set.

Coverage eligibility stays in `apps/mobile/scripts/check-changed-coverage.mjs`. The original base priority, triple-dot diff with endpoint fallback, newline/trim filename adapter, exclusions, deleted paths, collection arguments and aggregate percentage comparison remain authoritative. The advisory planner receives that exact list. It does not compute a second coverage policy. Missing or invalid fresh coverage fails. Jest failures take precedence over coverage, including when a passing summary exists. CI also requires a fresh successful Jest result with at least one suite.

The existing metadata lookup and checks run before the expensive suites. Component Jest, lint, typecheck, runtime/dependency checks, auth web, backend and both native runtime jobs retain their gates. The `scope` job runs tooling tests on Node 22 without mobile dependencies.

## Coarse module and contract registry

`scripts/ci-module-contracts.json` has schema version 1 and a separate reviewed content version. Modules declare exact paths or directory prefixes, complete current check groups, and downstream module consumers. Contracts declare producer paths and explicit consumer modules. Initial contracts cover core operations/SQLite, notification identity and vectors, Live Activity payloads, and the headless process/screen registry. These declarations describe cross-runtime relationships that import reachability cannot establish.

`scripts/ci-shadow-plan.mjs` reads declarations from both the pinned base and head and unions their edges. Rename destinations and old paths, and deleted producers, participate. Consumer expansion reaches a fixed point, including cycles. Each classified path records its owners, contracts and fallback reasons. Unsupported schemas, invalid references, missing base/head declarations, unknown owners, shared/configuration inputs, dynamic registry uncertainty and read/parse failures propose every existing check group with an explicit fallback reason. The first rollout normally falls back when the base predates the manifest.

The report is **shadow only**. It is written for observation and is never read by job conditions, `ci-required`, Jest selection or command routing. It names proposed groups, not executable arguments. Full current checks continue to run. No import parser, result cache, selection framework or scheduled workflow is added. This registry is not evidence that unknown dynamic dependencies are complete. Future selection needs a separate reviewed exclusion policy and measured regression corpus.

## Artifacts and evidence limits

The command clears its own artifacts before CI input validation and execution. It writes these local files under ignored `apps/mobile/test-artifacts/`.

- `node-jest.raw.json` is standard Jest JSON for local comparison. It can contain assertion messages and console output and must remain local.
- `node-receipt.json` contains allowlisted source/config/lock identities, the runner name, repository-relative suite paths, statuses and counts, exit status, coverage eligibility and numeric function coverage.
- `ci-shadow-plan.json` contains only source/manifest identities, repository-relative change paths, module/contract IDs, group proposals and enumerated reasons.

The workflow upload names only the safe plan, safe receipt and current `coverage-changed/coverage-summary.json`. It never uploads an artifact directory or raw Jest JSON. Receipts omit test names, assertion messages, stacks, console output, arbitrary diagnostics, environment values, credentials and user/device data. Other runner case evidence is explicitly unavailable. A parent node suite receipt does not establish the child actor's case inventory or merge its coverage. Existing backend/native jobs do not gain fabricated suite receipts.

Behavior fixtures prove command branching, argument policy, freshness and failure propagation. Full suite and per-file function-count equivalence require actual Jest runs on identical sources, Node/dependency/config identities and worker policies. A one-shot timing is an observation, not a measured performance improvement. Neither a Jest result nor a native probe establishes release or physical-device acceptance.
