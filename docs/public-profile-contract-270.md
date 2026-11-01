# Public profile contract for issue 270

The source now closes the co-member private-profile exposure. Migration `20261101183240_private_profile_owner_boundary.sql` restricts full-profile reads to the owner and protects the legacy recovery RPC. This implementation does not apply a production migration or release a client.

## Contract and ownership

`public.public_profiles` contains exactly `id`, `nickname`, `avatar`, and `avatar_color`. The authoritative row remains in `public.profiles`. Its server trigger synchronizes identity changes transactionally. Client roles cannot write the projection. Profile or account deletion removes the projection through its foreign key. Private-only writes and unchanged identities emit no public identity update.

Authenticated users retain their full own-profile wildcard reads, lifecycle upserts, preferences, onboarding, and server-owned metadata reads. Existing write privileges and premium guards remain in force. Co-members cannot SELECT or UPDATE another user's authoritative profile, including through membership joins. Public identities remain readable for the owner and co-members allowed by the existing expiry-aware membership rules. Unrelated users and expired anonymous requesters cannot read peer identities.

Both `get_group_recovery_snapshot(uuid)` and `get_group_public_recovery_snapshot(uuid)` now return the same safe four-field profile objects. The legacy endpoint delegates as SECURITY INVOKER to the existing guarded public endpoint. The public endpoint owns authentication and expiry-aware membership checks. Both retain authenticated-only execution. The `group-recovery-v1` envelope and its revisions, locations, sharing settings, itinerary, subgroups, and entity versions are preserved.

## Client and Realtime

Current group rosters, subgroup names, notification names, and profile UPDATE subscriptions use the public contract. Own-profile reads use `profiles`. The client has no fallback to private peer reads when a public read fails.

The four-column table supports the existing Postgres Changes UPDATE subscription. Full `profiles` remains in the publication for owner-authorized access, and its SELECT policy excludes peer full-row UPDATE visibility. The public trigger emits only identity fields, including when a private field changes in the same transaction. A live Supabase Realtime socket has not been exercised in this work. DELETE primary-key tombstones are outside the private-field contract; row policy alone does not guarantee their confidentiality.

## Rollout and compatibility

1. Inspect target migration history. The additive `20261027051556_public_profile_contract.sql` must exist before applying the cutoff. Do not repair unrelated history or apply unrelated pending migrations automatically.
2. Verify the supported released client uses the public contract and establish installed-client adoption. Source presence and OTA availability alone do not prove adoption.
3. Under separate production authorization, apply only the reviewed cutoff migration. Verify owner wildcard/upsert/private writes, denied peer full-row reads, public identities, both recovery RPCs, and current client interactions against that target.

The cutoff intentionally removes direct peer `profiles` reads and their full-row Realtime UPDATE access. Older binaries using those paths can lose teammate identity updates until upgraded. The original recovery endpoint remains available with safe roster identities, but callers requiring its former private fields are no longer supported. No claim is made that every historic binary tolerates this change. Do not restore co-member private reads as a compatibility fallback. Forward repair or a compatible client preserves the privacy boundary.

Production database mutation, credential rotation, history rewriting, OTA publication, and store releases remain outside this issue's implementation scope. Deployment and installed-client acceptance must be reported separately.

## Verification

Real PostgreSQL 17.11 with upstream pgTAP 1.3.4 replayed all 125 migrations in an isolated local database. The corrected profile suite passed 54 assertions and the security role matrix passed 46. Unchanged anonymous-expiry, legacy recovery authorization, and public recovery suites passed 17, 8, and 17 assertions in the prior run against the identical migration manifest. The runner validates TAP numbering/plans and rejects an intentional negative control. Its auth, Storage, cron, and external HTTP bootstrap does not validate hosted infrastructure.

The headless backend now enforces owner-only private reads and safe profiles through both recovery names. Its contract script passes. Four focused mobile suites passed 40 tests, including real group, notification, and Realtime hook behavior through controlled external adapters on iOS and Android. Live Realtime delivery, production data, physical devices, and installed-client adoption remain unverified. Detailed commands and artifact paths are saved in the local issue handoff.
