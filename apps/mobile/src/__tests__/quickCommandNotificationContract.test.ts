import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(__dirname, '../components/QuickCommandsCard.tsx'),
  'utf8',
);

describe('quick command sender feedback', () => {
  it('uses the in-app alert only and never schedules a sender notification', () => {
    expect(source).toContain("Alert.alert(t('command.sent'))");
    expect(source).not.toContain('scheduleLocalNotification');
    expect(source).not.toContain('requestPermission');
  });
});
