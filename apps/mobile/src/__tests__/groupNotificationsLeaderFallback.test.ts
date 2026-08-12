import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(__dirname, '../state/useGroupNotifications.ts'),
  'utf8',
);

describe('useGroupNotifications leader fallback + dual-path (BUG-5 / SUG-3)', () => {
  it('falls back to isLeaderRef when memberships row is missing', () => {
    expect(source).toContain('isLeaderRef.current');
    expect(source).toMatch(
      /roleFromRow[\s\S]*isLeaderRef\.current \? 'leader' : 'follower'/,
    );
  });

  it('does not invent solo=true on memberships select error', () => {
    expect(source).toContain('solo: soloErr ? false : Boolean(meRow?.solo)');
  });

  it('marks FG push deliveries into process seen set', () => {
    expect(source).toContain('addForegroundListener');
    expect(source).toContain('eventIdFromPushData');
    expect(source).toContain("markNotificationDelivered(myUserId, eventId, 'push')");
  });

  it('builds dual-path event identity via buildAlignedNotificationEventId', () => {
    expect(source).toContain('buildAlignedNotificationEventId');
    expect(source).toContain('resolveCommandNotificationClass');
    expect(source).toContain('classified.pushCategory');
    expect(source).toContain("pushCategory: 'journey'");
  });

  it('does not treat missing custom sender role as leader (#170)', () => {
    expect(source).toContain("role === 'leader' ? 'leader'");
    expect(source).not.toMatch(/role !== 'follower'/);
    expect(source).toContain('resolveCommandNotificationClass');
  });

  it('straggler Realtime uses sender_id (not reporter_id) for dual-path (BUG-7)', () => {
    const alertsStart = source.indexOf("table: 'group_alerts'");
    expect(alertsStart).toBeGreaterThanOrEqual(0);
    const alertsBlock = source.slice(alertsStart, alertsStart + 1200);
    expect(alertsBlock).toContain('sender_id');
    expect(alertsBlock).toContain('senderId: row.sender_id');
    expect(alertsBlock).not.toContain('reporter_id');
    expect(alertsBlock).toContain("pushCategory: 'straggler'");
    expect(alertsBlock).toContain('entityId: row.id');
  });

  it('subscribes to destination_arrivals INSERT for leader Realtime arrival fallback', () => {
    expect(source).toContain("table: 'destination_arrivals'");
    expect(source).toContain("eventKind: 'member_arrival'");
    expect(source).toContain("pushCategory: 'arrival'");
    expect(source).toContain("isLeaderOnlyEvent = opts.eventKind === 'member_arrival'");
  });
});


