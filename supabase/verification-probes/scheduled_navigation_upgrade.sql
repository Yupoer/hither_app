-- Requires scheduled_navigation_upgrade.seed.sql before migration 20261102152223.
-- CI runs this probe separately from post-migration *.test.sql regressions.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(5);
select ok((select meet_schedule_occurrence_id is not null and meet_schedule_consumed_at is not null from itinerary_items where title='Historical'),'migration consumes existing past clocks without replay');
select ok((select meet_schedule_occurrence_id is not null and meet_schedule_consumed_at is null from itinerary_items where title='Future'),'migration leaves existing future clocks eligible');
select is(public.process_meet_time_pushes(),0,'first deployment tick does not start historical clocks');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
update itinerary_items set meet_at=now()-interval '1 second' where title='Future';
select set_config('request.jwt.claim.sub','',true);
select is(public.process_meet_time_pushes(),1,'edited eligible future clock can start after migration');
select is((select destination_id from navigation_sessions),'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002'::uuid,'upgraded scheduler starts only the current eligible target');
select * from finish();
rollback;
