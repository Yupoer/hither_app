import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(__dirname, '../../../../supabase/migrations/20260813100000_location_refresh_pending.sql'),
  'utf8',
);
const mapScreen = readFileSync(
  join(__dirname, '../screens/MapScreen.tsx'),
  'utf8',
);
const pushIndex = readFileSync(
  join(__dirname, '../../../../supabase/functions/send-push/index.ts'),
  'utf8',
);
const pushRecipients = readFileSync(
  join(__dirname, '../../../../supabase/functions/send-push/recipients.ts'),
  'utf8',
);

describe('durable location refresh contract (#191)', () => {
  it('keeps a per-recipient versioned ledger behind explicit RPCs', () => {
    expect(migration).toMatch(/create table if not exists public\.location_refresh_pending/);
    expect(migration).toContain('primary key (group_id, user_id)');
    expect(migration).toContain('alter table public.location_refresh_pending enable row level security');
    expect(migration).toContain('revoke all on table public.location_refresh_pending');
    expect(migration).toContain('create or replace function public.list_my_pending_location_refreshes()');
    expect(migration).toContain('create or replace function public.ack_my_location_refresh(');
    expect(migration).toMatch(/security definer[\s\S]*set search_path = ''/g);
    expect(migration).toContain('and public.anonymous_access_is_active(m.user_id)');
    expect(migration).toContain('and requested_at = p_requested_at');
    expect(migration).toContain('and extensions.is_member(p_group_id)');
  });

  it('shares the SQL expiry-aware recipient set with Edge and the initiator', () => {
    expect(migration).toContain('v_recipient_ids uuid[]');
    expect(migration).toContain("'recipient_ids', to_jsonb(v_recipient_ids)");
    expect(pushIndex).toContain('locationRefreshRecipientIds(payload)');
    expect(pushRecipients).toContain('payload.recipient_ids');
    expect(readFileSync(join(__dirname, '../utils/refreshTeamLocations.ts'), 'utf8')).toContain('result.recipientIds');
    expect(mapScreen).not.toContain('expectedLocationRefreshRecipientIds');
  });
});
