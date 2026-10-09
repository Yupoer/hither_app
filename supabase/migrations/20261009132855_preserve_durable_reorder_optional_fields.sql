-- Preserve field omission when adapting durable camelCase updates to the
-- existing locked reorder RPC. An explicit JSON null still clears the field.
-- Patch the current definition so later authorization/receipt changes and the
-- function owner, ACL, SECURITY DEFINER and search_path remain intact.
do $migration$
declare
  definition text;
  old_bridge text := $old$        jsonb_build_object(
          'id', u->>'id',
          'position', coalesce((u->>'position')::integer, 0),
          'day', case when u ? 'day' then u->'day' else 'null'::jsonb end,
          'meet_at', case when u ? 'meetAt' then u->'meetAt' else 'null'::jsonb end,
          'stay_anchor', case when u ? 'stayAnchor' then u->'stayAnchor' else 'null'::jsonb end
        )$old$;
  new_bridge text := $new$        jsonb_build_object(
          'id', u->>'id',
          'position', coalesce((u->>'position')::integer, 0),
          'day', case when u ? 'day' then u->'day' else 'null'::jsonb end
        )
        || case when u ? 'meetAt' then jsonb_build_object('meet_at', u->'meetAt') else '{}'::jsonb end
        || case when u ? 'stayAnchor' then jsonb_build_object('stay_anchor', u->'stayAnchor') else '{}'::jsonb end$new$;
  old_count integer;
  new_count integer;
begin
  definition := replace(pg_get_functiondef(
    'public.apply_core_operation_v3(uuid,uuid,uuid,text,text,integer,text,jsonb,bigint,uuid[],timestamptz)'::regprocedure
  ), E'\r\n', E'\n');
  old_count := (length(definition) - length(replace(definition, old_bridge, ''))) / length(old_bridge);
  new_count := (length(definition) - length(replace(definition, new_bridge, ''))) / length(new_bridge);
  if old_count = 0 and new_count = 1 then
    return; -- Reapplying the reviewed migration is harmless.
  end if;
  if old_count <> 1 or new_count <> 0 then
    raise exception 'durable reorder bridge anchor is missing or ambiguous';
  end if;
  execute replace(definition, old_bridge, new_bridge);
end;
$migration$;
