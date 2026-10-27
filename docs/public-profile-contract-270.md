# Public profile contract for issue 270

This source change prepares the backend and client for an additive rollout. It does not finish issue 270 while legacy co-member access to `profiles` remains available. No production migration, policy, permission, account, publication, or release change is part of this work.

## Contract and ownership

`public.public_profiles` contains exactly `id`, `nickname`, `avatar`, and `avatar_color`. The authoritative row remains in `public.profiles`. A transactionally installed server trigger synchronizes the projection. Client roles cannot write it. A foreign key removes the projection when its authoritative profile is deleted. The trigger changes the public row only when public values change, so preferences, onboarding, premium, and anonymous-expiry changes do not generate public identity updates.

Authenticated callers can read their own public identity and identities of co-members authorized by existing membership visibility. The policy preserves the existing expiry-aware membership semantics. The table name describes a restricted display contract, not unrestricted internet visibility. Anonymous and unrelated callers gain no identity access.

The recovery RPC emits an explicit four-key profile object. Its existing authorization, `group-recovery-v1` envelope, revisions, locations, sharing settings, itinerary, subgroups, and version data remain in place. The direct own-profile wildcard reads, lifecycle upserts, preference writes, onboarding, premium guards, and service functions continue to use `profiles`.

## Design decision

The client keeps its existing Postgres Changes UPDATE subscription and reload behavior. A four-column table supports that protocol and limits the published row shape at the database boundary. An invoker view would inherit future own-only base access and lose teammate visibility. A privileged view or RPC would need its own caller checks and a separate safe event mechanism because an ordinary view cannot join a logical publication. This larger interface has no benefit for the current four-field consumers.

The projection has one writer, the server trigger. This applies Model the Domain to express the display contract as a relation, and Boundary Discipline to enforce authorization and field limits at the database and RPC boundaries. Prove It Works and Test Behavior, Not Implementation shape the local role matrix and real-client scenarios.

The client uses `public_profiles` directly. A fallback for a missing table was considered and rejected because it adds a second identity endpoint to retire later. Permission and network failures must not trigger legacy reads. A backend-first rollout gives a concrete compatibility boundary without broadening access.

## Rollout prerequisite and compatibility window

1. Hold client shipping and source merge until the additive backend rollout is authorized, applied, and verified. Adding this migration file does not apply it.
2. Deploy the additive backend before any client that requires `public_profiles`. The migration adds the new publication table and preserves the old `profiles` SELECT policy, grants, and publication membership.
3. Ship the client through a separately authorized release path. Existing clients keep their direct base-table identity reads and Realtime path during this compatibility window. Their existing full-row exposure also remains during that window.
4. Establish supported runtime and binary inventory, adoption evidence, and a separately authorized old-client cutoff. OTA availability alone does not establish adoption.
5. At that later cutoff, make base profile SELECT own-only and close the co-member base-event path while retaining owner and server contracts. This cutoff is deferred from this source change.

Before cutoff, an older client can continue its base reads and the updated client can use the projection. Before backend rollout, the updated client's teammate reads fail visibly and notification lookups retain their existing fallback labels. The updated client has no legacy fallback. After a later own-only cutoff, older clients lose teammate identity reads and base profile events. No claim is made that every historic binary tolerates this loss.

The inspected older recovery parser consumes the four public fields and ignores extra profile keys. Narrowing those objects preserves that observed parser. Other historic binaries and installed-client adoption are not verified here.

Before cutoff, a client rollback can use the retained legacy contract. After cutoff, restoring co-member base access restores private-field exposure and needs an explicit operational decision. Prefer a compatible client or forward repair.

## Verification scope

Local PostgreSQL tests exercise the actual migration and SQL role boundaries. Strict headless fixtures exercise real application modules with controlled external adapters on iOS and Android. They cover public identity reads, invitations, all four notification nickname paths, event-driven teammate reloads, private-only write suppression, and failure handling. Their Realtime delivery is a controlled fixture, not a live Supabase Realtime server.

Production payloads, physical devices, complete old-client adoption, and a live local Realtime socket remain separate verification work. The source acceptance map links issue 270 to executable checks. Local test commands and outcomes are recorded with the implementation handoff.
