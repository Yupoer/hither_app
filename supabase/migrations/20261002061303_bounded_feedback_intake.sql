-- Feedback is text-only. Preserve historical records and objects, but retire
-- all direct client allocation paths (legacy activity logging is unused).
revoke insert on public.activity_logs, public.feedback_reports from anon, authenticated;
drop policy if exists "feedback screenshots: upload own" on storage.objects;
create index if not exists idx_feedback_reports_user_created
  on public.feedback_reports (user_id, created_at);

create or replace function public.submit_feedback(p_context_tag text, p_description text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_count bigint;
  v_recent bigint;
begin
  if v_uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if p_context_tag is null or p_context_tag not in ('bug', 'suggestion', 'ui', 'other')
     or p_description is null or length(trim(p_description)) = 0
     or octet_length(p_description) > 8192 then
    raise exception 'invalid_feedback' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('feedback:' || v_uid::text, 0));
  select count(*), count(*) filter (where created_at > now() - interval '1 hour')
    into v_count, v_recent from public.feedback_reports where user_id = v_uid;
  -- ponytail: 100 retained reports/account; add explicit archival if support
  -- needs more. Never delete historical user reports to make quota room.
  if v_count >= 100 or v_recent >= 5 then
    raise exception 'feedback_quota_exceeded' using errcode = 'P0001';
  end if;
  insert into public.feedback_reports(user_id, context_tag, description)
    values(v_uid, p_context_tag, trim(p_description)) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_feedback(text,text) from public, anon;
grant execute on function public.submit_feedback(text,text) to authenticated;
