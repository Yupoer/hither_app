import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const map = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
const tools = map; // Tools is inline in MapScreen
const settings = readFileSync(
  join(__dirname, '../screens/MapScreen/components/SettingsOverlay.tsx'),
  'utf8',
);

describe('navigation response banner absence (#175)', () => {
  it('does not render navResponse banner or action labels on Map', () => {
    expect(map).not.toContain('navResponse.prompt');
    expect(map).not.toContain('navResponse.acknowledged');
    expect(map).not.toContain('navResponse.late');
    expect(map).not.toContain('navResponse.needsHelp');
    expect(map).not.toContain('respondToAnnouncement');
  });

  it('does not relocate response actions to Tools or Settings', () => {
    expect(tools).not.toContain('navResponse.');
    expect(settings).not.toContain('navResponse.');
  });

  it('documents removal comment for reviewers', () => {
    expect(map).toContain('#175: navigation response banner removed');
  });
});
