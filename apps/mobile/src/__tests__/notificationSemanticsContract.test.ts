import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const messages = readFileSync(
  join(__dirname, '../../../../supabase/functions/send-push/messages.ts'),
  'utf8',
);
const sendPush = readFileSync(
  join(__dirname, '../../../../supabase/functions/send-push/index.ts'),
  'utf8',
);
const realtime = readFileSync(
  join(__dirname, '../state/useGroupNotifications.ts'),
  'utf8',
);
const quickCommands = readFileSync(
  join(__dirname, '../components/QuickCommandsCard.tsx'),
  'utf8',
);

describe('notification nickname and destination contract (#190)', () => {
  it('uses sender nickname as title and command message as body in send-push', () => {
    expect(messages).toMatch(/title:\s*nameOr\(p\.sender_name/);
    expect(messages).toContain('body: p.message?.trim() || label');
    expect(messages).toContain('placeOr(p.title)');
    expect(sendPush).toContain('from("profiles")');
    expect(sendPush).toContain('select("nickname")');
    expect(sendPush).toContain('enrichNotificationPayload');
  });

  it('keeps Realtime fallback copy and event identity aligned with the push path', () => {
    expect(realtime).toContain("row.message?.trim() || label");
    expect(realtime).toContain("select('nickname')");
    expect(realtime).toContain("select('title')");
    expect(realtime).toContain("`${senderName} ${tRef.current('notif.addGatheringTitle')}`");
    expect(realtime).toContain("tRef.current('group.travelerFallback')");
    expect(realtime).toContain('entityId: row.id ?? undefined');
    expect(realtime).toContain('entityId: row.destination_id ?? arriverId');
    expect(realtime).toContain('senderId: row.sender_id');
  });

  it('keeps the custom label UI-only while persisting the message body', () => {
    expect(quickCommands).toContain("sendCommand(groupId, 'custom', message.trim() || label)");
    expect(quickCommands).toContain('The label is UI-only');
  });
});
