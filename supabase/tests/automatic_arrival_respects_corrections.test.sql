begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(84);

insert into auth.users(id, email) values
 ('11111111-1111-4111-8111-111111111111', 'auto-leader@example.test'),
 ('22222222-2222-4222-8222-222222222222', 'auto-member@example.test');
insert into public.groups(id, name, invite_code, created_by) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Automatic arrival', 'AUTOARR',
  '11111111-1111-4111-8111-111111111111');
insert into public.memberships(group_id, user_id, role) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'leader'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'follower');
insert into public.itinerary_items(id, group_id, title, latitude, longitude, position, day, kind) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Completed', 25, 121, 0, 1, 'stop'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Restarted', 25, 121, 1, 1, 'stop'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Legacy', 25, 121, 2, 1, 'stop'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Legacy restart', 25, 121, 3, 1, 'stop'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Legacy completed', 25, 121, 4, 1, 'stop');

create temporary table results(label text primary key, body jsonb);
grant select, insert on results to authenticated;

create function pg_temp.id(n integer) returns uuid language sql immutable as $$
 select ('aaaaaaaa-aaaa-4aaa-8aaa-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.call_arrival(
 n integer, op text, actor uuid, destination integer, session integer,
 extra jsonb default '{}'::jsonb, seq bigint default null
) returns jsonb language plpgsql as $$
declare
 payload jsonb;
 entity_type text := case when op = 'record_arrival' then 'itinerary' else 'active_gathering' end;
begin
 perform set_config('request.jwt.claim.sub', actor::text, true);
 payload := jsonb_build_object('activeDestinationId', pg_temp.id(destination),
   'navigationSessionId', pg_temp.id(session), 'deviceId', actor::text,
   'occurredAt', now(), 'arrived', true, 'arrivedAt', now() - interval '5 minutes');
 if op = 'start_gathering' then
   payload := payload || jsonb_build_object('navigationRequestId', pg_temp.id(session));
 end if;
 return public.apply_core_operation_v3(pg_temp.id(n),
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actor, entity_type,
   case when op = 'record_arrival' then pg_temp.id(destination)::text
        else 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' end,
   0, op, payload || extra, coalesce(seq, n), '{}'::uuid[]);
end;
$$;
do $$
begin
 execute format('grant usage on schema %I to authenticated',
   (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end;
$$;
set local role authenticated;

select is(pg_temp.call_arrival(100, 'start_gathering',
 '11111111-1111-4111-8111-111111111111', 1, 100)->>'status', 'accepted', 'start original session');
select is(pg_temp.call_arrival(101, 'complete_gathering',
 '11111111-1111-4111-8111-111111111111', 1, 100)->>'status', 'accepted', 'complete before delayed GPS arrives');
insert into results values ('late', pg_temp.call_arrival(102, 'record_arrival',
 '22222222-2222-4222-8222-222222222222', 1, 100, '{"source":"automatic"}'));
select is((select body->>'status' from results where label = 'late'), 'accepted', 'delayed completed arrival accepted');
select is((select body#>>'{entity,arrivalDisposition}' from results where label = 'late'), 'applied', 'completed original session can update current projection');
select is((select (body#>'{entity,effectiveArrival}') - array['updatedAt', 'correctedAt'] from results where label = 'late'),
 jsonb_build_object('sessionId', pg_temp.id(100), 'destinationId', pg_temp.id(1),
 'userId', '22222222-2222-4222-8222-222222222222', 'arrived', true,
 'arrivedAt', now() - interval '5 minutes', 'source', 'automatic',
 'markedBy', '22222222-2222-4222-8222-222222222222'), 'ACK describes original effective automatic arrival');
select is((select arrived_at from public.visited_waypoints where destination_id = pg_temp.id(1)
 and user_id = '22222222-2222-4222-8222-222222222222'), now() - interval '5 minutes', 'delayed arrival reaches permanent history');
insert into results values ('late_duplicate', pg_temp.call_arrival(102, 'record_arrival',
 '22222222-2222-4222-8222-222222222222', 1, 100, '{"source":"automatic"}'));
select is((select body->>'status' from results where label = 'late_duplicate'), 'duplicate', 'applied arrival retry is duplicate');
select is((select body->'entity' from results where label = 'late_duplicate'),
 (select body->'entity' from results where label = 'late'), 'applied arrival retry returns original effective state');
select is((select count(*) from public.navigation_arrival_events where operation_id = pg_temp.id(102)), 1::bigint,
 'applied duplicate never repeats arrival event');
insert into results values ('again', pg_temp.call_arrival(103, 'record_arrival',
 '22222222-2222-4222-8222-222222222222', 1, 100,
 jsonb_build_object('source', 'automatic', 'arrivedAt', now(), 'occurredAt', now() + interval '1 hour'), 999));
select is((select body#>>'{entity,arrivalDisposition}' from results where label = 'again'), 'already_arrived', 'higher sequence automatic keeps first arrival');
select is((select body#>'{entity,effectiveArrival}' from results where label = 'again'),
 (select body#>'{entity,effectiveArrival}' from results where label = 'late'), 'already arrived ACK preserves time source and actor');
select is((select arrived_at from public.destination_arrivals where destination_id = pg_temp.id(1)
 and user_id = '22222222-2222-4222-8222-222222222222'), now() - interval '5 minutes', 'second automatic does not rewrite current timestamp');
select is((select count(*) from public.navigation_arrival_events where operation_id = pg_temp.id(103)), 0::bigint,
 'already arrived no-op does not enter event ordering');
select is((select count(*) from public.core_operations where operation_id = pg_temp.id(103)), 1::bigint,
 'already arrived no-op retains durable audit receipt');

select is(pg_temp.call_arrival(104, 'record_arrival', '11111111-1111-4111-8111-111111111111', 1, 100,
 '{"source":"leader_correction","targetUserId":"22222222-2222-4222-8222-222222222222","arrived":false,"note":"not there"}')->>'status',
 'accepted', 'leader can correct arrival to false');
insert into results values ('false', pg_temp.call_arrival(105, 'record_arrival',
 '22222222-2222-4222-8222-222222222222', 1, 100,
 jsonb_build_object('source', 'automatic', 'occurredAt', now() + interval '1 hour'), 1000));
select is((select body#>>'{entity,arrivalDisposition}' from results where label = 'false'), 'leader_corrected', 'newer automatic cannot reverse false correction');
select is((select (body#>'{entity,effectiveArrival}') - array['updatedAt', 'correctedAt'] from results where label = 'false'),
 jsonb_build_object('sessionId', pg_temp.id(100), 'destinationId', pg_temp.id(1),
 'userId', '22222222-2222-4222-8222-222222222222', 'arrived', false,
 'arrivedAt', null, 'source', 'leader_correction', 'markedBy', '11111111-1111-4111-8111-111111111111'),
 'false correction returns authoritative absence with correction actor');
select ok(not exists (select 1 from public.destination_arrivals where destination_id = pg_temp.id(1)
 and user_id = '22222222-2222-4222-8222-222222222222'), 'automatic does not recreate false current arrival');
select ok(not exists (select 1 from public.visited_waypoints where destination_id = pg_temp.id(1)
 and user_id = '22222222-2222-4222-8222-222222222222'), 'automatic does not recreate false permanent history');
select ok((select not arrived and arrived_at is null and correction_note = 'not there'
 from public.navigation_session_history where navigation_session_id = pg_temp.id(100)
 and user_id = '22222222-2222-4222-8222-222222222222'), 'false history and correction audit remain intact');
select is((select count(*) from public.navigation_arrival_events where operation_id = pg_temp.id(105)), 0::bigint,
 'leader-corrected no-op stays outside event ordering');

select is(pg_temp.call_arrival(106, 'record_arrival', '11111111-1111-4111-8111-111111111111', 1, 100,
 '{"source":"leader_correction","targetUserId":"22222222-2222-4222-8222-222222222222","arrived":true}')->>'status',
 'accepted', 'later leader can correct to true after no-op');
insert into results values ('duplicate', pg_temp.call_arrival(105, 'record_arrival',
 '22222222-2222-4222-8222-222222222222', 1, 100,
 jsonb_build_object('source', 'automatic', 'occurredAt', now() + interval '1 hour'), 1000));
select is((select body->>'status' from results where label = 'duplicate'), 'duplicate', 'repeat operation returns duplicate');
select is((select body->'entity' from results where label = 'duplicate'),
 (select body->'entity' from results where label = 'false'), 'duplicate preserves original false receipt after later true correction');
insert into results values ('true', pg_temp.call_arrival(107, 'record_arrival',
 '22222222-2222-4222-8222-222222222222', 1, 100,
 jsonb_build_object('source', 'automatic', 'occurredAt', now() + interval '2 hours'), 1001));
select is((select body#>>'{entity,arrivalDisposition}' from results where label = 'true'), 'leader_corrected', 'later automatic respects true correction');
select ok((select source = 'leader_correction' and arrived_at is null
 and marked_by = '11111111-1111-4111-8111-111111111111'::uuid
 from public.destination_arrivals where destination_id = pg_temp.id(1)
 and user_id = '22222222-2222-4222-8222-222222222222'), 'true correction preserves unknown time source and leader');

select is(pg_temp.call_arrival(108, 'record_arrival', '11111111-1111-4111-8111-111111111111', 1, 100,
 '{"source":"leader_correction","targetUserId":"11111111-1111-4111-8111-111111111111","arrived":false}', 10)->>'status',
 'accepted', 'leader corrects own arrival false');
insert into results values ('self', pg_temp.call_arrival(109, 'record_arrival',
 '11111111-1111-4111-8111-111111111111', 1, 100,
 jsonb_build_object('source', 'automatic', 'occurredAt', now() + interval '1 hour'), 9000));
select is((select body#>>'{entity,arrivalDisposition}' from results where label = 'self'), 'leader_corrected',
 'same device higher sequence cannot replace own correction');
select is(pg_temp.call_arrival(110, 'record_arrival', '11111111-1111-4111-8111-111111111111', 1, 100,
 '{"source":"leader_correction","targetUserId":"11111111-1111-4111-8111-111111111111","arrived":true}', 11)->>'status',
 'accepted', 'lower sequence than ignored GPS still permits next leader correction');
select ok((select arrived from public.navigation_session_history where navigation_session_id = pg_temp.id(100)
 and user_id = '11111111-1111-4111-8111-111111111111'), 'ignored GPS never blocks next correction projection');

select is(pg_temp.call_arrival(200, 'start_gathering',
 '11111111-1111-4111-8111-111111111111', 2, 200)->>'status', 'accepted', 'start session to end');
select is(pg_temp.call_arrival(201, 'end_gathering',
 '11111111-1111-4111-8111-111111111111', 2, 200)->>'status', 'accepted', 'end leaves destination open');
select is(pg_temp.call_arrival(202, 'start_gathering',
 '11111111-1111-4111-8111-111111111111', 2, 202)->>'status', 'accepted', 'restart same destination in new session');
insert into results values ('old', pg_temp.call_arrival(203, 'record_arrival',
 '22222222-2222-4222-8222-222222222222', 2, 200, '{"source":"automatic"}'));
select is((select body#>>'{entity,arrivalDisposition}' from results where label = 'old'), 'history_only', 'late old event accepted as history only');
select is((select body#>>'{entity,appliedToCurrentSession}' from results where label = 'old'), 'false', 'history acceptance differs from current projection');
select is((select body#>>'{entity,effectiveArrival,sessionId}' from results where label = 'old'), pg_temp.id(200)::text,
 'history-only ACK retains original session');
select ok((select arrived from public.navigation_session_history where navigation_session_id = pg_temp.id(200)
 and user_id = '22222222-2222-4222-8222-222222222222'), 'old arrival remains in original history');
select ok(not exists (select 1 from public.destination_arrivals where destination_id = pg_temp.id(2)),
 'old arrival cannot create new session current arrival');
select ok(not exists (select 1 from public.visited_waypoints where destination_id = pg_temp.id(2)
 and user_id = '22222222-2222-4222-8222-222222222222'), 'old arrival cannot overwrite newer destination summary');
insert into results values ('old_again', pg_temp.call_arrival(206, 'record_arrival',
 '22222222-2222-4222-8222-222222222222', 2, 200,
 jsonb_build_object('source', 'automatic', 'arrivedAt', now(), 'occurredAt', now() + interval '1 hour')));
select is((select body#>>'{entity,arrivalDisposition}' from results where label = 'old_again'), 'already_arrived',
 'historical arrival is preserved even without a current arrival row');
select is((select body#>'{entity,effectiveArrival}' from results where label = 'old_again'),
 (select body#>'{entity,effectiveArrival}' from results where label = 'old'),
 'historical no-op preserves original source timestamp actor and version');
insert into results values ('new', pg_temp.call_arrival(204, 'record_arrival',
 '22222222-2222-4222-8222-222222222222', 2, 202, '{"source":"automatic"}'));
select is((select body#>>'{entity,arrivalDisposition}' from results where label = 'new'), 'applied', 'new session arrival is independent of old session');
select is((select navigation_session_id from public.destination_arrivals where destination_id = pg_temp.id(2)
 and user_id = '22222222-2222-4222-8222-222222222222'), pg_temp.id(202), 'current row belongs to new session');
select is(pg_temp.call_arrival(205, 'record_arrival', '22222222-2222-4222-8222-222222222222', 2, 202,
 '{"source":"manual","arrived":false,"arrivedAt":null}')->>'status', 'accepted', 'legacy manual undo remains accepted');
select ok(not exists (select 1 from public.destination_arrivals where destination_id = pg_temp.id(2)
 and user_id = '22222222-2222-4222-8222-222222222222'), 'legacy manual undo still removes arrival');
insert into results values ('superseded', pg_temp.call_arrival(207, 'record_arrival',
 '22222222-2222-4222-8222-222222222222', 2, 202, '{"source":"automatic"}', 100));
select is((select body#>>'{entity,arrivalDisposition}' from results where label = 'superseded'), 'superseded',
 'older automatic cannot override a later manual undo');
select is((select count(*) from public.navigation_arrival_events where operation_id = pg_temp.id(207)), 0::bigint,
 'superseded automatic no-op does not enter later event ordering');
select is((select (body#>>'{entity,effectiveArrival,updatedAt}')::timestamptz
 from results where label = 'false'),
 (select corrected_at from public.navigation_arrival_events where operation_id = pg_temp.id(104)),
 'no-op effective version is original correction time, not receipt time');
select is((select body#>>'{entity,effectiveArrival,correctedAt}' from results where label = 'false'),
 (select body#>>'{entity,effectiveArrival,updatedAt}' from results where label = 'false'),
 'correction version is comparable to remote corrected_at');
select is(pg_temp.call_arrival(300, 'start_gathering',
 '11111111-1111-4111-8111-111111111111', 3, 300)->>'status', 'accepted', 'start legacy arrival session');
select public.set_destination_arrival_at(pg_temp.id(3),
 '22222222-2222-4222-8222-222222222222', true, now() - interval '12 minutes');
insert into results select 'legacy_row', to_jsonb(a) from public.destination_arrivals a
 where destination_id = pg_temp.id(3) and user_id = '22222222-2222-4222-8222-222222222222';
select ok((select navigation_session_id is null and source = 'manual'
 and marked_by = '11111111-1111-4111-8111-111111111111'::uuid
 from public.destination_arrivals where destination_id = pg_temp.id(3)
 and user_id = '22222222-2222-4222-8222-222222222222'), 'legacy RPC creates sessionless manual arrival with original marker');
select ok(not exists (select 1 from public.navigation_session_history where navigation_session_id = pg_temp.id(300))
 and not exists (select 1 from public.navigation_arrival_events where navigation_session_id = pg_temp.id(300)),
 'legacy arrival has neither session history nor arrival event');
insert into results values ('legacy', pg_temp.call_arrival(301, 'record_arrival',
 '22222222-2222-4222-8222-222222222222', 3, 300, '{"source":"automatic"}'));
select is((select body#>>'{entity,arrivalDisposition}' from results where label = 'legacy'),
 'already_arrived', 'automatic preserves active legacy arrival');
select is((select (body#>'{entity,effectiveArrival}') - array['updatedAt', 'correctedAt'] from results where label = 'legacy'),
 jsonb_build_object('sessionId', pg_temp.id(300), 'destinationId', pg_temp.id(3),
 'userId', '22222222-2222-4222-8222-222222222222', 'arrived', true,
 'arrivedAt', now() - interval '12 minutes', 'source', 'manual',
 'markedBy', '11111111-1111-4111-8111-111111111111'), 'legacy ACK retains original timestamp source and marker');
select is((select to_jsonb(a) from public.destination_arrivals a where destination_id = pg_temp.id(3)
 and user_id = '22222222-2222-4222-8222-222222222222'),
 (select body from results where label = 'legacy_row'), 'automatic leaves entire legacy row unchanged');
select is((select arrived_at from public.visited_waypoints where destination_id = pg_temp.id(3)
 and user_id = '22222222-2222-4222-8222-222222222222'), now() - interval '12 minutes', 'automatic preserves legacy permanent history time');
select is((select count(*) from public.navigation_arrival_events where operation_id = pg_temp.id(301)),
 0::bigint, 'legacy no-op does not create ordering event');
insert into results values ('legacy_duplicate', pg_temp.call_arrival(301, 'record_arrival',
 '22222222-2222-4222-8222-222222222222', 3, 300, '{"source":"automatic"}'));
select is((select body->>'status' from results where label = 'legacy_duplicate'), 'duplicate', 'legacy no-op retry is duplicate');
select is((select body->'entity' from results where label = 'legacy_duplicate'),
 (select body->'entity' from results where label = 'legacy'), 'legacy duplicate returns original decision and metadata');
select is(pg_temp.call_arrival(302, 'complete_gathering',
 '11111111-1111-4111-8111-111111111111', 3, 300)->>'status', 'accepted', 'complete legacy arrival session');
insert into results values ('legacy_completed', pg_temp.call_arrival(303, 'record_arrival',
 '22222222-2222-4222-8222-222222222222', 3, 300, '{"source":"automatic"}'));
select is((select body#>>'{entity,arrivalDisposition}' from results where label = 'legacy_completed'),
 'already_arrived', 'closed-by session identifies completed legacy arrival');
select is((select to_jsonb(a) from public.destination_arrivals a where destination_id = pg_temp.id(3)
 and user_id = '22222222-2222-4222-8222-222222222222'),
 (select body from results where label = 'legacy_row'), 'completed automatic preserves entire legacy row');

select is(pg_temp.call_arrival(400, 'start_gathering',
 '11111111-1111-4111-8111-111111111111', 4, 400)->>'status', 'accepted', 'start old session for legacy isolation');
select public.set_destination_arrival_at(pg_temp.id(4),
 '22222222-2222-4222-8222-222222222222', true, now() - interval '15 minutes');
select is(pg_temp.call_arrival(401, 'end_gathering',
 '11111111-1111-4111-8111-111111111111', 4, 400)->>'status', 'accepted', 'end old legacy session');
select is(pg_temp.call_arrival(402, 'start_gathering',
 '11111111-1111-4111-8111-111111111111', 4, 402)->>'status', 'accepted', 'start new session clears old legacy arrival');
select ok(not exists (select 1 from public.destination_arrivals where destination_id = pg_temp.id(4)),
 'new session does not inherit old sessionless arrival');
select public.set_destination_arrival_at(pg_temp.id(4),
 '22222222-2222-4222-8222-222222222222', true, now() - interval '2 minutes');
insert into results select 'new_legacy_row', to_jsonb(a) from public.destination_arrivals a
 where destination_id = pg_temp.id(4) and user_id = '22222222-2222-4222-8222-222222222222';
insert into results values ('old_with_legacy', pg_temp.call_arrival(403, 'record_arrival',
 '22222222-2222-4222-8222-222222222222', 4, 400, '{"source":"automatic"}'));
select is((select body#>>'{entity,arrivalDisposition}' from results where label = 'old_with_legacy'),
 'history_only', 'old session cannot absorb new active legacy arrival');
select is((select (body#>>'{entity,effectiveArrival,arrivedAt}')::timestamptz from results where label = 'old_with_legacy'),
 now() - interval '5 minutes', 'old ACK uses its own receipt time rather than new legacy time');
select is((select to_jsonb(a) from public.destination_arrivals a where destination_id = pg_temp.id(4)
 and user_id = '22222222-2222-4222-8222-222222222222'),
 (select body from results where label = 'new_legacy_row'), 'old receipt cannot rewrite new active legacy row');
insert into results values ('new_with_legacy', pg_temp.call_arrival(404, 'record_arrival',
 '22222222-2222-4222-8222-222222222222', 4, 402, '{"source":"automatic"}'));
select is((select body#>>'{entity,arrivalDisposition}' from results where label = 'new_with_legacy'),
 'already_arrived', 'new session preserves its own legacy arrival');
select is(pg_temp.call_arrival(405, 'complete_gathering',
 '11111111-1111-4111-8111-111111111111', 4, 402)->>'status', 'accepted', 'finish active legacy isolation session');

select is(pg_temp.call_arrival(500, 'start_gathering',
 '11111111-1111-4111-8111-111111111111', 5, 500)->>'status', 'accepted', 'start old completed session');
select is(pg_temp.call_arrival(501, 'complete_gathering',
 '11111111-1111-4111-8111-111111111111', 5, 500)->>'status', 'accepted', 'complete old session without arrival');
reset role;
update public.itinerary_items set closed_at = null, closed_by_session_id = null where id = pg_temp.id(5);
set local role authenticated;
select is(pg_temp.call_arrival(502, 'start_gathering',
 '11111111-1111-4111-8111-111111111111', 5, 502)->>'status', 'accepted', 'start reopened destination session');
select public.set_destination_arrival_at(pg_temp.id(5),
 '22222222-2222-4222-8222-222222222222', true, now() - interval '1 minute');
insert into results select 'completed_legacy_row', to_jsonb(a) from public.destination_arrivals a
 where destination_id = pg_temp.id(5) and user_id = '22222222-2222-4222-8222-222222222222';
select is(pg_temp.call_arrival(503, 'complete_gathering',
 '11111111-1111-4111-8111-111111111111', 5, 502)->>'status', 'accepted', 'complete reopened destination session');
insert into results values ('old_completed_legacy', pg_temp.call_arrival(504, 'record_arrival',
 '22222222-2222-4222-8222-222222222222', 5, 500, '{"source":"automatic"}'));
select is((select body#>>'{entity,arrivalDisposition}' from results where label = 'old_completed_legacy'),
 'history_only', 'old completed session cannot absorb later closed legacy arrival');
select is((select body#>>'{entity,appliedToCurrentSession}' from results where label = 'old_completed_legacy'),
 'false', 'closed legacy owner prevents old completed receipt projecting');
select is((select to_jsonb(a) from public.destination_arrivals a where destination_id = pg_temp.id(5)
 and user_id = '22222222-2222-4222-8222-222222222222'),
 (select body from results where label = 'completed_legacy_row'), 'old completed receipt preserves newer legacy row');
select is((select arrived_at from public.visited_waypoints where destination_id = pg_temp.id(5)
 and user_id = '22222222-2222-4222-8222-222222222222'), now() - interval '1 minute', 'old completed receipt preserves newer permanent history');
insert into results values ('new_completed_legacy', pg_temp.call_arrival(505, 'record_arrival',
 '22222222-2222-4222-8222-222222222222', 5, 502, '{"source":"automatic"}'));
select is((select body#>>'{entity,arrivalDisposition}' from results where label = 'new_completed_legacy'),
 'already_arrived', 'new completed session preserves its own sessionless arrival');

select is(pg_temp.call_arrival(506, 'record_arrival',
 '11111111-1111-4111-8111-111111111111', 5, 502,
 jsonb_build_object('source', 'manual', 'arrivedAt', now() - interval '30 seconds'))#>>'{entity,arrivalDisposition}',
 'applied', 'newer completed session can create explicitly bound arrival');
insert into results select 'bound_row', to_jsonb(a) from public.destination_arrivals a
 where destination_id = pg_temp.id(5) and user_id = '11111111-1111-4111-8111-111111111111';
insert into results values ('old_bound', pg_temp.call_arrival(507, 'record_arrival',
 '11111111-1111-4111-8111-111111111111', 5, 500, '{"source":"automatic"}'));
select is((select body#>>'{entity,arrivalDisposition}' from results where label = 'old_bound'),
 'history_only', 'old receipt does not absorb explicitly bound newer arrival');
select is((select to_jsonb(a) from public.destination_arrivals a where destination_id = pg_temp.id(5)
 and user_id = '11111111-1111-4111-8111-111111111111'),
 (select body from results where label = 'bound_row'), 'old receipt leaves newer session-bound row unchanged');
select is((select body#>>'{entity,effectiveArrival,sessionId}' from results where label = 'old_bound'),
 pg_temp.id(500)::text, 'bound-row isolation keeps ACK on original session');

select * from finish();
rollback;
