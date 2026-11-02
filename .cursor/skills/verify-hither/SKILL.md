---
name: verify-hither
description: Verify Hither mobile user flows without an emulator using the real React App and the existing multi-device headless runner. Use for recorded feature proofs, cross-platform JavaScript behavior, and offline recovery checks.
---

# Verify Hither without an emulator

Read the [feature map](features/README.md) and the repository `AGENTS.md` first. This skill verifies the mobile App's React and JavaScript behavior. Native views, navigation infrastructure, hardware, and external services use the existing adapters. Screenshots, native hit testing, Swift and Kotlin execution, actual SQL and RLS, and device acceptance require separate runs on those targets.

## Launch

Use an isolated checkout of the intended revision. Preserve other worktrees and their dependencies. All commands below run in PowerShell from `apps/mobile` in that checkout.

```powershell
node --version
npm ci --no-audit --no-fund
```

Require Node >=22.16.0 for `node:sqlite`. Keep `patch-package` postinstall enabled. If the Windows npm shim cannot find `npm-cli.js`, invoke the `node_modules/npm/bin/npm-cli.js` beside the actual Node installation with that installation's `node.exe`.

There is no server, port, Expo Go, device, or emulator to keep alive. The Drive command launches the actual `App.tsx` in owned isolated Node processes. Each `World` starts with a new `hither-headless-*` temporary directory and runs production SQLite initialization. It supplies a fixture backend with a leader, member, group `TEST42`, and one stop. The recorded trip starts signed out, then creates a separate group through the guest and team screens. It needs no live account, `.env`, remote migration, or production credentials.

On Windows, use `test/headless/run.ps1` for the CPU budget. It caps its own launch and descendants with a 4.5% Windows Job CPU rate, restores the caller's environment and its own rate on exit, and writes actual CPU time, elapsed time and owned host CPU share to `-ResourceReport`. Other programs are outside that budget. Each device keeps its own process, globals, SDK fixtures and durable storage. Only source-derived compilation data is cached under this checkout's `node_modules/.cache/hither-headless`; input changes invalidate it. The first cold compilation can cost more than a warm iteration. V8 compilation caching is disabled when `NODE_V8_COVERAGE` is present. On other hosts, invoke the same Node drivers directly; the Windows resource cap is separate from functional verification.

`app.boot` alone is not usable readiness. Require an operable `onboarding-skip` host, successful guest confirmation, and `membership.confirmed` observations with route `Map`, membership, and `map-search`. `trio.roster` must show all three travelers. The runner exercises these controls and fails when the expected path is unavailable. World shutdown runs in `finally`, including after a failed drive.

## Doctor

Run this read-only preflight before driving, and rerun it when dependency resolution or source alignment looks wrong. It checks the actual checkout's dependencies, SQLite capability, production source fingerprints, registry anchors, and scenario references. It does not launch a shared instance or use the network.

```powershell
@'
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = process.cwd();
const [major, minor] = process.versions.node.split('.').map(Number);
assert(major > 22 || major === 22 && minor >= 16, 'Node >=22.16.0 required');
require('node:sqlite');
for (const name of ['jest/bin/jest', 'typescript', 'ts-jest', '@jest/fake-timers', 'jest-resolve', 'react', 'react-test-renderer']) {
	assert(require.resolve(name).startsWith(path.join(root, 'node_modules') + path.sep), `${name}: install dependencies in this checkout`);
}
const registry = require('./test/headless/actions.cjs');
const inventory = require('./test/headless/inventory.cjs');
const actions = inventory.audit(registry.inventoryEntries(), registry.exclusions());
const scenarios = inventory.auditScenarios(registry.scenarioEntries(), registry.exclusions());
assert.deepEqual(actions.errors, []);
assert.deepEqual(actions.missing, []);
assert.deepEqual(scenarios.errors, []);
assert.deepEqual(scenarios.missing, []);
const source = require('./test/headless/source-inventory.cjs');
assert.deepEqual(source.compare(require('./test/headless/source-inventory.json'), source.scan(root)), { added: [], removed: [] });
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
console.log(JSON.stringify({ ready: true, root, revision, node: process.version, actions: actions.actions, families: actions.families }));
'@ | node
if ($LASTEXITCODE -ne 0) { throw 'Hither doctor failed' }
```

For a custom scenario with a live `World`, the read-only instance check is `world.check()` followed by `await device.observe()`. Require its `pid` to equal the owned `device.child.pid`, its `generation` to equal `device.generation`, `fatal` to be empty, and the expected route, hydrated providers, and visible controls. Inspect `renderErrors` and `presentation.resolved` when diagnosing a mismatch. Do not drive an actor from another run or repair readiness by assigning internal state. The canned runner owns its entire lifetime, so use its recorded `app.boot` and `membership.confirmed` observations for diagnosis instead of attaching a second driver.

## Drive

When the request limits verification to changed behavior, select the affected named cases from the feature map. For the location exchange update, use `-Driver jest --runTestsByPath src/__tests__/headlessLocationSyncScenario.test.ts --testNamePattern="changed location exchange on"`. The suite driver already supplies all headless files; do not append the same file to it a second time. Do not run the recorded trip or full suite for that scoped request. A partial report has no complete functional denominator. Keep the same Doctor, evidence and cleanup requirements for the selected cases.

Run the recorded mixed-platform journey. This is the default proof for the first four mapped features. It does not cover every entry point in those features or the store feature. Read each feature's additional commands before claiming broader coverage.

```powershell
$verifyRunId = [guid]::NewGuid().ToString('N')
$verifyParent = Join-Path $PWD 'test-artifacts/verify-hither'
New-Item -ItemType Directory -Force -Path $verifyParent | Out-Null
$verifyOutput = Join-Path $verifyParent $verifyRunId
$verifyStdout = Join-Path $verifyParent ($verifyRunId + '.stdout.log')
$verifyStderr = Join-Path $verifyParent ($verifyRunId + '.stderr.log')
$verifyResources = Join-Path $verifyParent ($verifyRunId + '.resources.json')
$verifySource = [ordered]@{
	revision = (git rev-parse HEAD)
	worktree = (git rev-parse --show-toplevel)
	dirty = @(git status --porcelain)
	node = (node --version)
	lockSha256 = (Get-FileHash -Algorithm SHA256 package-lock.json).Hash
	featureIds = @('teams', 'itinerary', 'journey', 'members')
	command = @('./test/headless/run.ps1', '-Driver', 'trip', '-ResourceReport', $verifyResources, $verifyOutput)
}
./test/headless/run.ps1 -Driver trip -ResourceReport $verifyResources $verifyOutput 1> $verifyStdout 2> $verifyStderr
$verifyExit = $LASTEXITCODE
$verifySource.exitCode = $verifyExit
$verifySource | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $verifyParent ($verifyRunId + '.source.json'))
Write-Output $verifyOutput
Write-Output "Exit code $verifyExit"
```

Use a new output path on every attempt. The CLI refuses an existing directory. The sibling console and source files survive even if startup fails before the evidence directory is created. Keep the output path and exit code for Cleanup. An exit of 1 can be a behavior mismatch or a harness failure. Inspect both `failed` and `harnessFailure` in `summary.json`.

The runner clicks `onboarding-skip`, `login-guest`, `guest-confirm-button`, `role-create`, and `role-join`, then uses registry commands such as `team.create`, `team.join`, `map.pin.drop`, `map.place.first-stop`, and `map.journey.command`. These reach rendered production callbacks with visibility and disabled guards. `map-bottom-sheet` gestures invoke the actual registered callback phases. They do not reproduce physical touch or animation rendering.

For an entry point outside this trip, use the corresponding feature's exact Jest command or extend a `World` scenario through the registry. `node test/headless/run.cjs --list` prints the current commands, sources, input shapes, levels, and completion contracts. A service call or standalone component receipt does not prove its parent screen path. `perform()` can return before persistence or acknowledgment. Use `world.waitFor()` for the durable result and recipient convergence, and always `finally { await world.close(); }`.

`world.advance(ms)` advances virtual milliseconds: `world.advance(120000)` runs two minutes of timers without waiting two real minutes. Retain the existing bounded steps, timer ordering, and checks before and at expiry or retry boundaries. Drive the next action as soon as its completion event or observable precondition permits; do not insert human reaction delays or fixed sleeps. Complete or cancel animations through the host event so production callbacks still run. Real timeouts are failure ceilings for stuck work, not required waits. Do not multiply logical time, skip due timers, or assign successful state to accelerate a scenario.

For a slow or CPU-heavy run, measure owned process startup, App loading, command execution and cleanup before changing the runner. Separate test CPU from other programs, record CPU time and elapsed time, and compare identical work with independent device processes and retained evidence. A shorter simulated duration or fewer checks is not a performance improvement.

## Evidence

Keep proof under `apps/mobile/test-artifacts/verify-hither`. These ignored artifacts remain local. Do not commit fixture sessions or raw actor logs as public evidence.

Each recorded trip produces these files.

| File | Proof |
| --- | --- |
| `inputs.jsonl` | Exact commands, actor, platform, process generation, and logical time. |
| `observations.jsonl` | Action, input, result, every connected traveler's rendered hosts, routes, provider values, and SQLite rows. |
| `backend-evidence.json` | Fixture server rows, accepted sessions, location state, request receipts, and Realtime trace. |
| `summary.json` | Named behavior checks, platform roles, failures, and explicit limits. |
| `transcript.md` | Readable chronological actions and resulting states. |
| `leader.log`, `memberA.log`, `memberB.log` | Actor diagnostics. |
| Sibling `<run-id>.source.json`, `.stdout.log`, `.stderr.log` | Source revision and dirty paths, lock hash, command, runtime, exit code, and CLI output. |
| Sibling `<run-id>.resources.json` | Owned launcher and child CPU time, elapsed time, measured host CPU share, configured rate, native exit and launcher errors. |

For other Jest scenarios, set `HITHER_HEADLESS_EVIDENCE` using the map index recipe. Every World writes a unique directory with `world.json` identifying its test and scratch path, `events.jsonl` pairing commands and returned observations by actor, generation and command ID, `backend.json` preserving final fixture state, and `cleanup.json` reporting scratch removal, child disposal, and failures. Recording adds no app actions or observation requests. Native adapter unit cases that do not create a World retain their Jest assertions as boundary evidence.

Require the action and resulting state together. For mutations, require production SQLite state or a recipient view alongside fixture server receipts. Inspect `presentation.resolved` for the actual platform file chosen. Mock only at the production SDK, native, hardware, navigation, or backend boundary already represented by this harness. Keep `src/**` real. Never replace a missing precondition with direct state changes, empty successful responses, skipped assertions, or a different entry point.

This mode creates local files and child processes. It is not a no-effect dry-run. The runtime rejects accidental network calls and unsupported external contracts, including failures caught by production code. These sticky failures must fail cleanup. Local notification scheduling does not prove push delivery. A fixture wallet change does not prove a live store or SSV service. The trip's powered-off 24-hour clock gap does not prove OS background endurance. List these substitutions when reporting a stand-in proof.

## Cleanup

The trip's `finally` calls `World.close()`. That unmounts the real React tree, checks pending work and resource disposal, closes SQLite, waits for its own children, and removes its own temporary directory. A shutdown failure becomes `harnessFailure`. `World` uses its owned child handles, never a process name. Evidence is outside that temporary directory.

Run this after every attempt, including failed attempts. It confirms that proof survived the runner's cleanup and reads the actual result. It does not delete evidence.

```powershell
if (-not (Test-Path -LiteralPath $verifyOutput)) { throw "Startup failed. Retain $verifyStdout and $verifyStderr" }
foreach ($verifyName in @('inputs.jsonl', 'observations.jsonl', 'backend-evidence.json', 'summary.json', 'transcript.md')) {
	if (-not (Test-Path -LiteralPath (Join-Path $verifyOutput $verifyName))) { throw "Missing proof $verifyName" }
}
$verifySummary = Get-Content -Raw (Join-Path $verifyOutput 'summary.json') | ConvertFrom-Json
$verifyResourceSummary = Get-Content -Raw $verifyResources | ConvertFrom-Json
if ($verifyResourceSummary.exitCode -ne 0) { throw 'Verification launcher failed; retain its resource report' }
if ($verifyExit -ne 0 -or $verifySummary.failed -ne 0 -or $null -ne $verifySummary.harnessFailure) {
	$verifySummary | Select-Object passed, failed, harnessFailure
	throw 'Hither verification failed. Inspect retained evidence before retrying.'
}
$verifySummary | Select-Object passed, failed, steps, harnessFailure
Get-Item -LiteralPath (Join-Path $verifyOutput 'summary.json')
```

For recorded World directories, check `cleanup.json` and the scratch path from `world.json` after the suite finishes. Require all user-flow actors to be closed and their scratch state removed. Harness contract tests deliberately provoke unsupported calls, crashes, and shutdown failures. Their failure records must agree with the named Jest assertions; an expected contract failure is not a failed user journey.

Let a failing runner finish its `finally` rather than killing its parent. If forcibly interrupted, establish ownership from the actual parent-child PID tree before stopping any remaining actor, and remove only that run's known scratch directory. Do not guess an old scratch directory from its prefix, stop all Node processes, or clean another run's state. Preserve failed proof and retry with a new output path.

## Helpers

This skill reuses maintained helpers in `apps/mobile/test/headless`.

```powershell
node test/headless/run.cjs --list
node test/headless/run.cjs --inventory
./test/headless/run.ps1 -Driver trip -ResourceReport "${verifyOutput}.resources.json" $verifyOutput
```

The last command is the recorded driver used above. For mapped Jest suites, use the exact commands in the feature files and require matching executed cases in the JSON report. A successful command with every case skipped is not a pass. Do not run `actor.cjs` directly because it needs World IPC. For a full headless execution report, allocate `$verifySuiteOutput` with the map index recipe, then run these commands. Never feed the coverage reporter a partial suite as complete coverage.

```powershell
./test/headless/run.ps1 -ResourceReport "${verifySuiteOutput}.resources.json" --json --outputFile="$verifySuiteOutput"
if ($LASTEXITCODE -ne 0) { throw 'Headless suite failed' }
node test/headless/scenario-coverage.cjs $verifySuiteOutput "${verifySuiteOutput}.coverage.md"
if ($LASTEXITCODE -ne 0) { throw 'Functional scenario coverage failed' }
node -e "const assert=require('node:assert/strict'); const report=require('./test/headless/scenario-coverage.cjs').evaluate(require(process.argv[1])); assert.equal(report.passed,report.total);" $verifySuiteOutput
if ($LASTEXITCODE -ne 0) { throw 'Complete verification requires every functional family' }
```

For maintenance, use `pstack:maintain-verification-skill` and update this map when a route, callback, fixture contract, or observable result changes. Inventory alignment and executed feature coverage remain separate claims.

Location exchange maintenance covers only [journey](features/journey.md) and [members](features/members.md). Both have outcome `changed`: eight unique iOS/Android cases passed against product commit `9cfcd9b46926cf55b33a809015897b9238c1e1f5` on 2026-11-03. The local proof index is `.audit/location-sync/headless-retry-result.md`; it retains earlier failures and the passing evidence for each case. All recorded Worlds removed their scratch state and closed their children. This scoped result does not establish a complete feature denominator, native OS behavior or hosted delivery. Review source drift before reusing it.
