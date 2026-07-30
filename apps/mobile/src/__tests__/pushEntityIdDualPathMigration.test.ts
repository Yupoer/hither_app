import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildAlignedNotificationEventId,
  eventIdFromPushData,
} from '../utils/notificationDeliveryPolicy';

const migrationsDir = join(__dirname, '../../../../supabase/migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

function latestFunctionBody(fnName: string): string {
  let body = '';
  for (const file of migrationFiles) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const re = new RegExp(
      `create or replace function public\\.${fnName}\\(\\)[\\s\\S]*?\\$\\$;`,
      'gi',
    );
    const matches = [...sql.matchAll(re)];
    for (const m of matches) body = m[0];
  }
  return body;
}

describe('push entity_id dual-path migrations (BUG-6 / SUG-4)', () => {
  it('on_command_insert keeps custom role-based category + entity_id', () => {
    const body = latestFunctionBody('on_command_insert');
    expect(body.length).toBeGreaterThan(0);
    // custom → membership role lookup (follower_requests vs leader_commands)
    expect(body).toContain("new.type = 'custom'");
    expect(body).toContain("when m.role = 'follower' then 'follower_requests'");
    expect(body).toContain("else 'leader_commands'");
    expect(body).toContain("coalesce(v_category, 'leader_commands')");
    // request_start still follower_requests
    expect(body).toContain("'request_start'");
    expect(body).toContain('follower_requests');
    // dual-path entity id
    expect(body).toContain("'entity_id', new.id");
  });

  it('on_group_alert_insert includes entity_id for straggler dual-path', () => {
    const body = latestFunctionBody('on_group_alert_insert');
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain("'entity_id', new.id");
    expect(body).toContain("'member_id', new.member_id");
    expect(body).toContain("'category', new.kind");
  });

  it('straggler Realtime row.id matches push data with entity_id', () => {
    const alertId = 'alert-uuid-1';
    const groupId = 'group-1';
    const senderId = 'leader-1';
    const fromRealtime = buildAlignedNotificationEventId({
      category: 'straggler',
      groupId,
      senderId,
      entityId: alertId,
    });
    const fromPush = eventIdFromPushData({
      category: 'straggler',
      groupId,
      senderId,
      memberId: 'member-fallen',
      entityId: alertId,
    });
    expect(fromPush).toBe(fromRealtime);
    expect(fromRealtime).toContain(alertId);
    // Must not prefer member_id when entity_id is present
    expect(fromRealtime).not.toContain('member-fallen');
  });

  it('straggler dual-path fails if Realtime uses unknown sender (BUG-7 regression)', () => {
    const alertId = 'alert-uuid-2';
    const groupId = 'g2';
    const leaderId = 'leader-real';
    const badRealtime = buildAlignedNotificationEventId({
      category: 'straggler',
      groupId,
      senderId: 'unknown', // former reporter_id miss
      entityId: alertId,
    });
    const goodPush = eventIdFromPushData({
      category: 'straggler',
      groupId,
      senderId: leaderId,
      entityId: alertId,
      memberId: 'm1',
    });
    expect(badRealtime).not.toBe(goodPush);
    const goodRealtime = buildAlignedNotificationEventId({
      category: 'straggler',
      groupId,
      senderId: leaderId,
      entityId: alertId,
    });
    expect(goodRealtime).toBe(goodPush);
  });
});

