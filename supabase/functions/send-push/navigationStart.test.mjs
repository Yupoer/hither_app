import assert from 'node:assert/strict';
import test from 'node:test';
import { navigationRemoteRecipients, navigationStartRecipients } from './navigationStart.ts';

test('scheduled captain receives control, activity and alert; PTS recipients also receive alert', () => {
  assert.deepEqual(navigationRemoteRecipients({ origin: 'scheduled', senderId: 'captain',
    userIds: ['captain', 'pts', 'existing', 'android'] }), ['captain', 'pts', 'existing', 'android']);
  assert.deepEqual(navigationStartRecipients({ origin: 'scheduled', senderId: 'captain',
    userIds: ['captain', 'pts', 'existing', 'android'], usersWithHandle: new Set(['existing']),
    usersWithStartToken: new Set(['captain', 'pts', 'existing']) }), {
    existingUserIds: ['existing'],
    startUserIds: ['captain', 'pts'], alertUserIds: ['captain', 'pts', 'existing', 'android'],
  });
});

test('manual starter excluded; existing handle and PTS routing preserved', () => {
  assert.deepEqual(navigationRemoteRecipients({ origin: 'manual', senderId: 'captain',
    userIds: ['captain', 'pts', 'existing', 'android'] }), ['pts', 'existing', 'android']);
  assert.deepEqual(navigationStartRecipients({ origin: 'manual', senderId: 'captain',
    userIds: ['captain', 'pts', 'existing', 'android'], usersWithHandle: new Set(['captain', 'existing']),
    usersWithStartToken: new Set(['captain', 'pts', 'existing']) }), {
    existingUserIds: ['existing'],
    startUserIds: ['pts'], alertUserIds: ['existing', 'android'],
  });
});
