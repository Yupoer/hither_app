-- Ticket 3 scheduler contract notes (pgTAP-oriented).
-- 1. process_due_coordination_requests is service_role/cron-only.
-- 2. Claims at most 100 due rows with FOR UPDATE SKIP LOCKED.
-- 3. Existing atomic close policy remains the only outcome writer.
-- 4. Every run records claimed/resolved/error counts.
-- 5. Client fetch is read-only; no 45-second resolver write remains.
-- 6. Open requests recover by a 60-second read-only client pull when Realtime
--    misses an event; no open requests means zero periodic reads/writes.

select 'coordination_deadline_scheduler contract documented' as note;
