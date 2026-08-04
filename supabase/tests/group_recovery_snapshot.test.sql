-- Ticket 2 recovery snapshot contract notes (pgTAP-oriented).
-- 1. One RPC returns group, memberships, profiles, subgroups, itinerary,
--    locations and entity_versions.
-- 2. Authenticated non-members receive not_member; no endpoint fallback.
-- 3. realtime_revision/entity_version markers prevent an old response from
--    overwriting a newer Realtime state.
-- 4. Existing Realtime and 60-second read recovery remain enabled.

select 'group_recovery_snapshot contract documented' as note;
