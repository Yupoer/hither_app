const assert = require('node:assert/strict');

function ingest(b, { args, userId }) {
  assert.deepEqual(Object.keys(args), ['p_events']);
  const acceptedIds = [];
  const rejected = [];
  for (const event of args.p_events) {
    assert.deepEqual(Object.keys(event).sort(), ['actorId', 'id', 'groupId', 'navigationSessionId', 'capturedAt',
      'coords', 'trackingMode', 'source', 'sequence'].sort());
    for (const key of Object.keys(event.coords)) assert(['latitude', 'longitude', 'accuracy', 'speed', 'course'].includes(key));
    assert.equal(event.actorId, userId, 'Wire actor ownership');
    assert(b.memberships.some(m => m.group_id === event.groupId && m.user_id === userId), 'Fixture membership required');
    assert(Number.isSafeInteger(event.sequence) && event.sequence > 0, 'Integer wire sequence');
    if (b.tables.member_privacy_settings.some(r => r.user_id === userId && r.sharing_enabled === false)) {
      rejected.push({ id: event.id, reason: 'sharing_disabled' });
      continue;
    }
    const row = { group_id: event.groupId, user_id: userId, latitude: event.coords.latitude,
      longitude: event.coords.longitude, captured_at: new Date(event.capturedAt).toISOString(),
      updated_at: new Date(b.now).toISOString(), tracking_mode: event.trackingMode, source: event.source,
      navigation_session_id: event.navigationSessionId, sequence: event.sequence };
    const key = `${event.groupId}:${userId}`;
    const previous = b.locations.get(key);
    const priorEvent = b.locationEvents.get(event.id);
    if (priorEvent) {
      if (priorEvent.actorId === userId && priorEvent.groupId === event.groupId
        && priorEvent.capturedAt === event.capturedAt && priorEvent.coords.latitude === event.coords.latitude
        && priorEvent.coords.longitude === event.coords.longitude) acceptedIds.push(event.id);
      else rejected.push({ id: event.id, reason: 'invalid_event' });
      continue;
    }
    if (previous && event.capturedAt <= Date.parse(previous.captured_at)) {
      rejected.push({ id: event.id, reason: 'stale_sample' });
      continue;
    }
    b.locationEvents.set(event.id, structuredClone(event));
    b.locationReceipts.set(event.id, { id: event.id, groupId: event.groupId, capturedAt: event.capturedAt, receivedAt: new Date(b.now).toISOString() });
    b.locations.set(key, row);
    b.publish('member_locations', row);
    acceptedIds.push(event.id);
  }
  return { acceptedIds, rejected };
}

module.exports = { ingest };
