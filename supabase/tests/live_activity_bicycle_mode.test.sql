-- Clone the production CHECK constraints into a temporary table. No live
-- activity, token, notification, or production session fixture is written.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(1);

create temporary table live_activity_mode_test
  (like public.live_activity_sessions including constraints including defaults);
do $fixture$
declare column_name text;
begin
  for column_name in select attname from pg_attribute
    where attrelid = 'pg_temp.live_activity_mode_test'::regclass
      and attnum > 0 and not attisdropped and attnotnull and attname <> 'travel_mode'
  loop
    execute format('alter table pg_temp.live_activity_mode_test alter column %I drop not null', column_name);
  end loop;
end;
$fixture$;

select lives_ok($test$
do $bicycle_assertions$
begin
  insert into pg_temp.live_activity_mode_test(travel_mode) values ('walk'),('transit'),('drive'),('bicycle');
  assert (select count(*) = 4 from pg_temp.live_activity_mode_test), 'supported transport modes were rejected';
  begin
    insert into pg_temp.live_activity_mode_test(travel_mode) values ('scooter');
    raise exception 'unknown transport mode was accepted';
  exception when check_violation then
    null;
  end;
end;
$bicycle_assertions$;
$test$, 'production Live Activity constraint accepts bicycle and existing modes and rejects unknown modes');
select * from finish();
rollback;
