# Security hardening verification

Baseline: `14dff6ef2abb5b6f873221a578351a918e41ee63`. Work is delivered directly on master at the user's request. This report separates source remediation, local verification, and deployment; it is not a claim that all vulnerabilities have been found.

## Database boundary

- Removed client membership INSERT/UPDATE grants and their permissive policies; DELETE is self-only. Joining and changing membership use existing authorized RPCs, and removing someone else uses the atomic kick RPC with invite rotation.
- Profile INSERT/UPDATE privileges now allow only client-owned fields (`id`, nickname, avatar, avatar color, onboarding, preferences). Premium fields, timestamps, and anonymous expiry are not client-writable. `UPDATE(id)` preserves the existing upsert contract; the own-profile RLS check still prevents identity reassignment.
- Anonymous-expiry helpers reject unauthorized cross-user requests; trigger-only functions no longer have unnecessary client EXECUTE grants. Navigation startup retains actor/leader checks and explicitly checks expiry-aware membership before operating with definer privileges.
- Existing same-group full-profile SELECT remains for client compatibility, including private preferences/onboarding. This is a residual data-minimization concern needing a separate public-profile projection/client contract; it is not silently declared fixed here.
- Catalog inspection also found authenticated EXECUTE on `effective_live_activity_entitlement(uuid, uuid)` with arbitrary IDs. Data-dependent disclosure was not reproduced, so this remains a follow-up candidate rather than a confirmed exploit. The inspected Storage bucket is private with owner-scoped INSERT and no client SELECT/UPDATE policy; future read/upsert flows and hosted configuration were not verified.
- The old expiry test was not executable evidence: it used invalid UUIDs, an obsolete profile column, and expiry setup that triggers could overwrite. Its corrected 17 assertions pass. This does not retroactively prove the earlier claim that every raw membership subquery bypassed expiry; nested membership RLS must be evaluated per operation.
- The CLI-created migration is `20260918180948_database_security_hardening.sql`. It sorts before the existing future-dated destination-pool migration, which does not replace these ACLs/helpers/navigation startup. If a target already recorded the later migration, inspect migration history and a `supabase db push --include-all --dry-run` before an explicitly authorized deployment. Do not rewrite old migration history or apply unrelated pending migrations automatically. No remote push was performed here.

## Client privacy

- Optional `store_ad_*` diagnostics previously bypassed diagnostic consent. Collection and upload now use the same consent gate as other diagnostics. Revoking consent purges pending records when flushing, including legacy queued ad records. Consent is checked again after the asynchronous pending-batch read; an already dispatched request cannot be recalled.
- An initial asynchronous settings read can no longer restore stale consent after the user has revoked it. The new regression failed before the shared consent-reader correction and passed afterward.
- Raw SDK `errMsg` text is omitted from new persisted diagnostic payloads. The allowlist is also reapplied on list/export/upload so previously queued SDK text or unknown payload fields cannot escape. Truncation is not redaction; structured error codes and flow steps remain available with consent.
- Removed 15 tracked browser snapshots containing screen, nickname, and location data, and ignored future `.playwright-cli` output. Existing Git history is unchanged; deletion from the current tree does not retract copies or historical data.
- Regression tests cover collection without consent, revocation, the pending-read race, successful consented uploads, SDK message exclusion, and parameterized SQLite purge operations. The SQLite adapter tests are unit tests, not device SQLite verification.

## Verification boundaries

- Local PostgreSQL with all repository migrations and the new hardening migration: **7 pgTAP files / 143 assertions passed** through `supabase test db --local`, not just a successful `psql` exit code. This includes the new authorization matrix, corrected anonymous-expiry fixture, kick/remove, account deletion, StoreKit ledger, premium projection, and anonymous-premium cleanup tests. Production state was not inspected or changed.

- Dependency remediation uses compatible upstream Navigation/Metro updates and a scoped `xcode → uuid@11.1.1` npm override. No native module or Expo-major upgrade was introduced. `npm ci` (including existing postinstall patches), typecheck, and caller probes passed; a fresh `npm audit` reports **0 vulnerabilities**. This is an advisory-database result, not a proof of absence of vulnerabilities.

- Subscription sync now rejects expired/not-yet-valid dynamically signed service JWTs, handles malformed credentials without granting service access, and preserves configured legacy/modern service-key callers. User authorization and purchase ownership checks remain in place. This is not evidence that a third party can forge a service signature.
- The write-capable Claude workflow is maintainer-dispatched rather than issue-event-triggered, pins action commits, and does not persist checkout credentials. This is defense in depth: maintainer-selected untrusted content and allowed package/git commands still require review, and prompt text is not a security sandbox.
- Focused Deno Edge fixtures: 51 passed, including subscription auth and StoreKit/notification/AdMob replay checks. Review found and fixed a mixed-credential case: a forwarded user Bearer now takes precedence over a proxy's secret API key, including failed user authentication; cross-user and invalid-user regressions pass. No replay bypass was confirmed. Deno static checking retains an unrelated X509 typing error in `_shared/storekit.ts`; these fixture tests use the repository's existing `--no-check` convention.

- Targeted diagnostic and consent suites: 18 tests passed; module function coverage 89.74% / 85.71%, branch coverage 85.45% / 87.5%. Independent Astra/low review found a legacy-payload gap; the follow-up fix and regression were re-reviewed without further P1/P2 findings in that slice.
- TypeScript, test metadata (parent 270), runtime alignment, and lint passed (lint retains existing warnings).
- Full Jest run: 239 suites passed, 4 failed. The failures in `coreDataLocalFirst`, `nativeUiContracts`, `languagePicker`, and `gatheringSessionOutbox` match baseline GitHub CI run `35376590165`; their source paths were not changed here.
- Expo compatibility check reports 11 existing patch-version mismatches. Expo doctor passed 19/21 checks, reporting those mismatches and the existing Hermes V1 regression. No gate was disabled and no native upgrade was silently introduced.

## Release boundary

The current checkout is runtime `0.1.8` and contains native location-module changes relative to the latest production OTA (`0.1.7`, commit `f6ea958369bc8c45197b60b24e579bf4fd71135f`). EAS build inventory did not establish a compatible `0.1.8` binary. Do not ship this checkout to the `0.1.7` runtime or describe a matching runtime string alone as compatibility proof. A compatible native build is required before an applicable OTA.

No production database migrations, Edge deployments, credential rotation, Git history rewriting, native build, or store submission are included in this source delivery. Database and Edge fixes require separate backend deployment before protecting the hosted service.
