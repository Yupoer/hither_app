-- Cross-layer wire contract: use the same payload keys as the mobile queue.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(10);

insert into auth.users(id, email, is_anonymous) values
 ('f1111111-1111-4111-8111-111111111111', 'sync-leader@example.test', false),
 ('f2222222-2222-4222-8222-222222222222', 'sync-member@example.test', false);
insert into public.groups(id, name, invite_code, created_by) values
 ('f3333333-3333-4333-8333-333333333333', 'Sync acceptance', 'SYN001', 'f1111111-1111-4111-8111-111111111111');
insert into public.memberships(group_id, user_id, role) values
 ('f3333333-3333-4333-8333-333333333333', 'f1111111-1111-4111-8111-111111111111', 'leader'),
 ('f3333333-3333-4333-8333-333333333333', 'f2222222-2222-4222-8222-222222222222', 'follower');
insert into public.itinerary_items(id, group_id, title, latitude, longitude, position, day) values
 ('f4444444-4444-4444-8444-444444444444', 'f3333333-3333-4333-8333-333333333333', 'First stop', 25, 121, 0, 1);

create function pg_temp.apply_sync_test(p_name text, p_actor uuid, p_entity text, p_type text, p_payload jsonb, p_seq bigint)
returns jsonb language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub', p_actor::text, true);
 return public.apply_core_operation_v3(md5(p_name)::uuid,
   'f3333333-3333-4333-8333-333333333333', p_actor,
   case when p_type in ('start_gathering','end_gathering') then 'active_gathering' else 'itinerary' end,
   p_entity, 0, p_type, p_payload, p_seq, '{}'::uuid[], now());
end;
$$;

select is(pg_temp.apply_sync_test('start', 'f1111111-1111-4111-8111-111111111111',
 'f3333333-3333-4333-8333-333333333333', 'start_gathering',
 '{"activeDestinationId":"f4444444-4444-4444-8444-444444444444","navigationRequestId":"f5555555-5555-4555-8555-555555555555","subgroupId":null}', 1)->>'status',
 'accepted', 'offline start uses mobile request/session identity');
select ok(exists(select 1 from public.navigation_sessions where id='f5555555-5555-4555-8555-555555555555' and status='active'),
 'session id matches local navigationRequestId');
select is(pg_temp.apply_sync_test('leader-arrival', 'f1111111-1111-4111-8111-111111111111',
 'f4444444-4444-4444-8444-444444444444', 'record_arrival',
 jsonb_build_object('actorId','f1111111-1111-4111-8111-111111111111','userId','f1111111-1111-4111-8111-111111111111',
 'navigationSessionId','f5555555-5555-4555-8555-555555555555','arrived',true,'arrivedAt',now(),'occurredAt',now(),'deviceId','leader-device'), 2)->>'status',
 'accepted', 'leader arrival is session bound');
select is(pg_temp.apply_sync_test('complete', 'f1111111-1111-4111-8111-111111111111',
 'f3333333-3333-4333-8333-333333333333', 'complete_destination',
 '{"destinationId":"f4444444-4444-4444-8444-444444444444","sessionId":"f5555555-5555-4555-8555-555555555555","subgroupId":null}', 3)->>'status',
 'accepted', 'complete accepts stale version without waiting for other members');
update public.navigation_sessions set ended_at=now()-interval '10 minutes' where id='f5555555-5555-4555-8555-555555555555';
select is(pg_temp.apply_sync_test('late-arrival', 'f2222222-2222-4222-8222-222222222222',
 'f4444444-4444-4444-8444-444444444444', 'record_arrival',
 jsonb_build_object('actorId','f2222222-2222-4222-8222-222222222222','userId','f2222222-2222-4222-8222-222222222222',
 'navigationSessionId','f5555555-5555-4555-8555-555555555555','arrived',true,'arrivedAt',now()-interval '5 minutes',
 'occurredAt',now()-interval '5 minutes','deviceId','member-device'), 1)->>'status',
 'accepted', 'arrival after completion time can be reported later');
select ok((select arrived and arrived_at > s.ended_at from public.navigation_session_history h
 join public.navigation_sessions s on s.id=h.navigation_session_id
 where h.navigation_session_id='f5555555-5555-4555-8555-555555555555' and h.user_id='f2222222-2222-4222-8222-222222222222'),
 'late arrival preserves actual time in original history');
select is(pg_temp.apply_sync_test('correct', 'f1111111-1111-4111-8111-111111111111',
 'f4444444-4444-4444-8444-444444444444', 'leader_correct_arrival',
 '{"targetUserId":"f2222222-2222-4222-8222-222222222222","sessionId":"f5555555-5555-4555-8555-555555555555","arrived":true}', 4)->>'status',
 'accepted', 'leader can correct completed history');
select ok((select arrived and arrived_at is null and corrected_by='f1111111-1111-4111-8111-111111111111'
 from public.navigation_session_history where navigation_session_id='f5555555-5555-4555-8555-555555555555'
 and user_id='f2222222-2222-4222-8222-222222222222'), 'correction has audit actor and null arrival time');
select is(pg_temp.apply_sync_test('late-undo', 'f2222222-2222-4222-8222-222222222222',
 'f4444444-4444-4444-8444-444444444444', 'record_arrival',
 jsonb_build_object('actorId','f2222222-2222-4222-8222-222222222222','userId','f2222222-2222-4222-8222-222222222222',
 'navigationSessionId','f5555555-5555-4555-8555-555555555555','arrived',false,'arrivedAt',now()-interval '4 minutes',
 'occurredAt',now()-interval '4 minutes','deviceId','member-device'), 2)->>'status', 'accepted', 'older delayed undo is retained as an event');
select ok((select arrived and arrived_at is null from public.navigation_session_history
 where navigation_session_id='f5555555-5555-4555-8555-555555555555' and user_id='f2222222-2222-4222-8222-222222222222'),
 'older delayed event cannot override a newer leader correction');
select diag(payload->'_conflict') from public.core_operations
 where group_id='f3333333-3333-4333-8333-333333333333' and status='conflict';
select * from finish();
rollback;
