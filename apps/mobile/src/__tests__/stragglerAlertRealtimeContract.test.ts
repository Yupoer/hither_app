import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const migration = readFileSync(
  join(root, 'supabase/migrations/20260721100000_straggler_alert_realtime.sql'),
  'utf8',
);
const notifications = readFileSync(
  join(__dirname, '../state/useGroupNotifications.ts'),
  'utf8',
);

describe('straggler alert event delivery', () => {
  it('persists one realtime event and keeps the existing push category', () => {
    expect(migration).toContain('create table public.group_alerts');
    expect(migration).toContain("kind text not null default 'straggler'");
    expect(migration).toContain("'category', new.kind");
    expect(migration).toContain('alter publication supabase_realtime');
    expect(notifications).toContain("table: 'group_alerts'");
  });
});
