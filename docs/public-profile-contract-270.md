# Public profile contract for issue 270

This source change prepares the backend and client for an additive rollout. Issue 270 remains open while legacy co-member access to `profiles` and the full-row recovery RPC remain available. Applying the backend source requires explicit production approval. Client release and legacy cutoff remain separate operations.

## Contract and ownership

`public.public_profiles` contains exactly `id`, `nickname`, `avatar`, and `avatar_color`. The authoritative row remains in `public.profiles`. A transactionally installed server trigger synchronizes the projection. Client roles cannot write it. A foreign key removes the projection when its authoritative profile is deleted. The trigger changes the public row only when public values change, so preferences, onboarding, premium, and anonymous-expiry changes do not generate public identity updates.

Authenticated callers can read their own public identity and identities of co-members authorized by existing membership visibility. The policy preserves the existing expiry-aware membership semantics. The table name describes a restricted display contract, not unrestricted internet visibility. Anonymous and unrelated callers gain no additional SELECT access.

`get_group_public_recovery_snapshot(uuid)` emits an explicit four-key profile object. Its authentication and expiry-aware membership guards match the legacy endpoint. The `group-recovery-v1` envelope, revisions, locations, sharing settings, itinerary, subgroups, and version data remain in place. The existing `get_group_recovery_snapshot(uuid)` response, full profile rows, signature, function body, grants, and comment remain unchanged. The direct own-profile wildcard reads, lifecycle upserts, preference writes, onboarding, premium guards, and service functions continue to use `profiles`.

The new RPC explicitly revokes inherited PUBLIC, anonymous, and service-role execution before granting authenticated execution. Its ACL is deterministic under pre-existing function default privileges. This does not change any legacy grant or default privilege.

## Design decision

The client keeps its existing Postgres Changes UPDATE subscription and reload behavior. A four-column table supports that protocol and limits the published row shape at the database boundary. An invoker view would inherit future own-only base access and lose teammate visibility. A privileged view or RPC would need its own caller checks and a separate safe event mechanism because an ordinary view cannot join a logical publication. This larger interface has no benefit for the current four-field consumers.

The projection has one writer, the server trigger. This applies Model the Domain to express the display contract as a relation, and Boundary Discipline to enforce authorization and field limits at the database and RPC boundaries. Prove It Works and Test Behavior, Not Implementation shape the local role matrix and real-client scenarios.

The client uses `public_profiles` and `get_group_public_recovery_snapshot` directly. The public endpoint has a separate name because its profile contract differs from the legacy endpoint. The unchanged `group-recovery-v1` envelope still describes the other recovery state families. An independent function builds the public JSON directly instead of serializing legacy private rows and filtering them afterward. The client has no fallback when the public table or RPC is missing. Permission and network failures must not trigger legacy reads. A backend-first rollout gives a concrete compatibility boundary without broadening access.

## Rollout prerequisite and compatibility window

1. Hold client shipping and source merge until the additive backend rollout is authorized, applied, and verified. Adding this migration file does not apply it.
2. Deploy the additive backend before any client that requires `public_profiles` and `get_group_public_recovery_snapshot`. The migration adds the public recovery function and new publication table and preserves the old `profiles` SELECT policy, grants, and publication membership.
3. Ship the client through a separately authorized release path. Existing clients keep their original full-row recovery endpoint, direct base-table identity reads, and Realtime path during this compatibility window. Their existing full-row exposure also remains during that window.
4. Establish supported runtime and binary inventory, adoption evidence, and a separately authorized old-client cutoff. OTA availability alone does not establish adoption.
5. At that later cutoff, make base profile SELECT own-only, close the co-member base-event path, and retire or protect the original full-row recovery endpoint while retaining owner and server contracts. That SECURITY DEFINER endpoint bypasses base-table RLS, so base policy tightening alone cannot complete the privacy cutoff. This cutoff is deferred from this source change.

Before cutoff, an older client can continue its original recovery RPC and base reads and the updated client can use the projection. Before backend rollout, the updated client's public recovery and teammate reads fail visibly and notification lookups retain their existing fallback labels. The updated client has no legacy fallback. After the separately authorized full cutoff, older clients may lose their original recovery endpoint, teammate identity reads, and base profile events. No claim is made that every historic binary tolerates this loss.

The legacy recovery response remains full-row because parser tolerance in an inspected source version does not establish compatibility for every historic binary. No legacy endpoint shrink or cutoff is part of this migration. Installed-client adoption remains unverified.

Before cutoff, a client rollback can use the retained legacy contract. After cutoff, restoring the original full-row recovery endpoint or co-member base access restores private-field exposure and needs an explicit operational decision. Prefer a compatible client or forward repair.

## Verification scope

Local PostgreSQL tests exercise the actual migration and SQL role boundaries. The isolated PostgreSQL runtime uses test-only auth, storage, and cron schema fixtures. These fixtures do not validate GoTrue, Storage, or scheduler execution. Full Supabase CLI initialization and SQL tests remain required hosted CI checks. A fresh owned database replays the baseline before the revised migration. Catalog comparisons check the legacy function body, signature, execution ACL, and comment before and after. The original legacy SQL suite stays byte-identical to the baseline. Separate public recovery tests enforce exact public fields, the shared envelope, authentication, membership, and expiry fences. Strict headless fixtures exercise real application modules with controlled external adapters on iOS and Android. They cover both legacy full-row and public four-field fixture responses, public recovery failure propagation without legacy fallback, public identity reads, invitations, all four notification nickname paths, event-driven teammate reloads, private-only write suppression, and failure handling. Their Realtime delivery is a controlled fixture, not a live Supabase Realtime server. Separate real SDK tests exercise authentication, read classification, and refresh for both recovery RPCs.

Supabase Postgres Changes handles DELETE differently from UPDATE. Row policy does not establish confidentiality for arbitrary DELETE subscriptions, which may receive primary-key tombstones. This client subscribes only to public-profile UPDATE events. Malicious DELETE subscriptions and membership revocation on an already-open channel remain unverified.

Production payloads, physical devices, complete old-client adoption, and a live local Realtime socket remain separate verification work. The source acceptance map links issue 270 to executable checks. Local test commands and outcomes are recorded with the implementation handoff.
