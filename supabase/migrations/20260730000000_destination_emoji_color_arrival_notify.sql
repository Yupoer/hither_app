-- Ticket 07: per-itinerary-item emoji + palette color (nullable, stable fallback client-side).
-- Ticket 03: first successful destination_arrivals insert notifies leaders (idempotent via INSERT only).

-- ── Schema ──────────────────────────────────────────────────────────────────

alter table public.itinerary_items
  add column if not exists emoji text,
  add column if not exists marker_color text;

comment on column public.itinerary_items.emoji is
  'Optional single Unicode emoji grapheme for map/list chrome; null = client fallback';
comment on column public.itinerary_items.marker_color is
  'Optional product palette hex (#RRGGBB); null = client fallback';

-- Soft check: palette-ish hex or null (authoritative validation is client trust boundary + service).
alter table public.itinerary_items
  drop constraint if exists itinerary_items_marker_color_hex;
alter table public.itinerary_items
  add constraint itinerary_items_marker_color_hex
  check (
    marker_color is null
    or marker_color ~ '^#[0-9A-Fa-f]{6}$'
  );

-- Best-effort rejection of ordinary text at the DB boundary (length alone is
-- not enough). Full emoji acceptance remains the client/service trust boundary
-- (Extended_Pictographic / ZWJ / VS). This CHECK only blocks obvious non-emoji
-- letter runs (ASCII, Latin-1 letters, CJK / kana / hangul).
alter table public.itinerary_items
  drop constraint if exists itinerary_items_emoji_len;
alter table public.itinerary_items
  drop constraint if exists itinerary_items_emoji_shape;
alter table public.itinerary_items
  add constraint itinerary_items_emoji_shape
  check (
    emoji is null
    or (
      char_length(emoji) between 1 and 32
      -- pure ASCII alnum / spaces
      and emoji !~ '^[A-Za-z0-9[:space:]]+$'
      -- pure Latin letters (incl. common accented) with optional marks
      and emoji !~ '^[A-Za-zÀ-ÖØ-öø-ÿ]+$'
      -- pure CJK unified / kana / hangul runs
      and emoji !~ '^[一-龥々〆ヶぁ-ゖァ-ヺー가-힣]+$'
    )
  );

-- Existing RLS (leader write / member read) already covers new columns on itinerary_items.
-- No policy change required for same-table columns.

-- ── Arrival notify (first insert only — ON CONFLICT DO NOTHING skips trigger) ─

create or replace function public.on_destination_arrival_insert_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Notify leaders of the group (send-push excludes sender; category arrival).
  -- Idempotent: only fires on INSERT. record_destination_arrival uses
  -- ON CONFLICT DO NOTHING so re-saves never re-insert / re-notify.
  perform extensions.notify_push(jsonb_build_object(
    'category', 'arrival',
    'group_id', new.group_id,
    'sender_id', new.user_id,
    'member_id', new.user_id,
    'destination_id', new.destination_id,
    'type', coalesce(new.source, 'manual')
  ));
  return new;
end;
$$;

drop trigger if exists trg_destination_arrival_insert_notify on public.destination_arrivals;
create trigger trg_destination_arrival_insert_notify
  after insert on public.destination_arrivals
  for each row execute function public.on_destination_arrival_insert_notify();

revoke all on function public.on_destination_arrival_insert_notify() from public, anon, authenticated;
