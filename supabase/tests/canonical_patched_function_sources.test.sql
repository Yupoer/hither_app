-- A full create or replace from a stale copy of these functions would silently
-- drop fixes that once arrived as catalog text patches. Pin one marker per fix,
-- plus the security attributes and grants the canonical migration re-applies.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(20);

create temporary table canonical_fn on commit drop as
select p.oid::regprocedure::text as signature, p.prosrc, p.prosecdef, p.proconfig, p.provolatile, l.lanname
from pg_proc p join pg_language l on l.oid = p.prolang
where p.oid in (
  'public.apply_core_operation_v3(uuid,uuid,uuid,text,text,integer,text,jsonb,bigint,uuid[],timestamptz)'::regprocedure,
  'public.core_itinerary_state(uuid)'::regprocedure
);

create temporary view v3 as select * from canonical_fn where signature like '%apply_core_operation_v3(%';
create temporary view itinerary_state as select * from canonical_fn where signature like '%core_itinerary_state(%';

select ok((select prosecdef and lanname = 'plpgsql' and provolatile = 'v' from v3),
  'v3 stays a volatile plpgsql security definer');
select is((select proconfig from v3), array['search_path=""'], 'v3 keeps an empty search_path');
select ok((select prosecdef and lanname = 'sql' and provolatile = 's' from itinerary_state),
  'core_itinerary_state stays a stable sql security definer');
select is((select proconfig from itinerary_state), array['search_path=""'], 'core_itinerary_state keeps an empty search_path');

select ok(has_function_privilege('authenticated',
  'public.apply_core_operation_v3(uuid,uuid,uuid,text,text,integer,text,jsonb,bigint,uuid[],timestamptz)', 'EXECUTE'),
  'authenticated can call v3');
select ok(not has_function_privilege('anon',
  'public.apply_core_operation_v3(uuid,uuid,uuid,text,text,integer,text,jsonb,bigint,uuid[],timestamptz)', 'EXECUTE'),
  'anon cannot call v3');
select ok(not has_function_privilege('authenticated', 'public.core_itinerary_state(uuid)', 'EXECUTE'),
  'authenticated cannot call core_itinerary_state directly');
select ok(not has_function_privilege('anon', 'public.core_itinerary_state(uuid)', 'EXECUTE'),
  'anon cannot call core_itinerary_state directly');

select ok((select position('where m.group_id = p_group_id and m.user_id = v_uid for key share;' in prosrc) > 0 from v3),
  '20261002061447: membership row is locked through the write');
select ok((select position('v_is_member := found and public.anonymous_access_is_active(v_uid);' in prosrc) > 0 from v3),
  '20261002061447: expired anonymous members are not members');
select ok((select position('p_operation_type <> ''record_arrival''' in prosrc) = 0 from v3),
  '20261002061447: former members can no longer upload arrivals');
select ok((select position('leader role required for main team trip details' in prosrc) > 0 from v3),
  '20261001115316: trip details are leader only');
select ok((select position('waiting for all session members to arrive' in prosrc) > 0 from v3),
  '20261001115316: all_arrived completion waits for every session member');
select ok((select position('''22023'',''22P02'',''22003'',''22007'',''22008''' in prosrc) > 0 from v3),
  '20261001115316: date parse errors become validation conflicts');
select ok((select position('perform public.promote_itinerary_first_stop(v_destination_id);' in prosrc) > 0 from v3),
  '20261002113231: quick add can place a stop first');
select ok((select position('solo status is user scoped' in prosrc) > 0 from v3),
  '20261004010000: set_solo is scoped to the caller');
select ok((select position('perform public.set_solo(p_group_id, (v_payload->>''solo'')::boolean);' in prosrc) > 0 from v3),
  '20261004010000: set_solo is applied');
select ok((select position('jsonb_build_object(''meet_at'', u->''meetAt'')' in prosrc) > 0 from v3),
  '20261009132855: reorder omits meet_at unless the client sent it');
select ok((select position('''stay_anchor'', case when u ? ''stayAnchor'' then u->''stayAnchor'' else ''null''::jsonb end' in prosrc) = 0 from v3),
  '20261009132855: reorder no longer nulls an omitted stay anchor');
select ok((select position('''dailyAccommodations''' in prosrc) > 0 from itinerary_state),
  '20261001115316: itinerary state includes daily accommodations');

select * from finish();
rollback;
