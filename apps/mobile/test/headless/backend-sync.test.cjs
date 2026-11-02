const assert = require('node:assert/strict');
const { Backend, GROUP_ID, LEADER, PEER, DESTINATION } = require('./backend.cjs');

const b = new Backend(() => {});
const sync = (userId, core = [], events = [], refresh = {}) => b.execute('sync-contract', {
  kind: 'rpc', name: 'sync_group', steps: [], userId,
  args: { p_group_id: GROUP_ID, p_core_operations: core, p_location_events: events, p_refresh: refresh },
});
const core = (id, sequence, type, payload) => ({ operation_id: id, entity_type: 'itinerary', entity_id: DESTINATION,
  entity_version: 0, operation_type: type, payload, sequence, dependency_ids: [], created_at: new Date(b.now).toISOString() });
const event = (id, actorId) => ({ id, actorId, groupId: GROUP_ID, navigationSessionId: null, capturedAt: b.now,
  coords: { latitude: 25.03, longitude: 121.53, accuracy: 5 }, trackingMode: 'passive', source: 'foreground', sequence: 1 });

const mixed = sync(LEADER, [core('edit', 1, 'edit_destination', { destinationId: DESTINATION, subgroupId: null, patch: { title: 'Saved in exchange' } })], [event('leader-fix', LEADER)]);
assert.equal(mixed.error, null);
assert.equal(mixed.data.coreResults[0].status, 'accepted');
assert.equal(mixed.data.snapshot.itinerary[0].title, 'Saved in exchange');
assert.equal(mixed.data.snapshot.locations[0].latitude, 25.03);
assert.deepEqual(mixed.data.snapshot.daily_accommodations, []);
assert.equal(b.trace.length, 1, 'Internal SQL delegation is not a network round trip');
assert.deepEqual(mixed.data.locationResult.acceptedIds, ['leader-fix']);
const originalReceipt = mixed.data.locationReceipts[0];
b.now += 1000;
const request = sync(LEADER, [], [], { requestPeers: true }).data.refreshRequest;
assert.deepEqual(request.recipient_ids, [PEER]);
assert.equal(sync(PEER).data.pendingRefreshes[0].requested_at, request.requested_at);
const peerFix = event('peer-fix', PEER);
const accepted = sync(PEER, [], [peerFix], { acknowledgements: [{ requestedAt: request.requested_at, eventId: peerFix.id }] });
assert.deepEqual(accepted.data.refreshAcknowledgements, [{ requestedAt: request.requested_at, eventId: peerFix.id, accepted: true }]);
assert.deepEqual(sync(LEADER, [], [], { requestedAt: request.requested_at }).data.acknowledgedIds, [PEER]);
b.now += 61000;
const newRequest = sync(LEADER, [], [], { requestPeers: true }).data.refreshRequest;
const replay = sync(PEER, [], [peerFix], { acknowledgements: [{ requestedAt: newRequest.requested_at, eventId: peerFix.id }] });
assert.equal(replay.data.refreshAcknowledgements[0].accepted, false, 'Old accepted GPS does not satisfy a later request');
assert.equal(replay.data.locationReceipts[0].receivedAt, accepted.data.locationReceipts[0].receivedAt, 'Replay retains original receipt time');
const leaderReplay = sync(LEADER, [], [b.locationEvents.get('leader-fix')]);
assert.deepEqual(leaderReplay.data.locationReceipts[0], originalReceipt);
const fresh = event('peer-new-fix', PEER);
assert.equal(sync(PEER, [], [fresh], { acknowledgements: [{ requestedAt: request.requested_at, eventId: fresh.id }] }).data.refreshAcknowledgements[0].accepted, true);
assert.equal(b.locationRefreshPending.get(`${GROUP_ID}:${PEER}`).requested_at, newRequest.requested_at, 'Old ACK cannot clear new pending version');
assert.equal(sync(PEER, [], [], { acknowledgements: [{ requestedAt: newRequest.requested_at, eventId: fresh.id }] }).data.refreshAcknowledgements[0].accepted, true);
assert.deepEqual(sync(LEADER, [], [], { requestedAt: newRequest.requested_at }).data.acknowledgedIds, [PEER]);
const microRequest = newRequest.requested_at.replace(/(\.\d{3})Z$/, '$1001Z');
b.locationRefreshPending.set(`${GROUP_ID}:${PEER}`, { group_id: GROUP_ID, user_id: PEER, requested_by: LEADER, requested_at: microRequest });
assert.equal(sync(PEER, [], [], { acknowledgements: [{ requestedAt: microRequest, eventId: fresh.id }] }).data.refreshAcknowledgements[0].accepted,
  false, 'An earlier millisecond sample cannot satisfy a microsecond request');
assert.equal(b.locationRefreshPending.get(`${GROUP_ID}:${PEER}`).requested_at, microRequest, 'Exact request token is retained');

const denied = sync(PEER, [core('denied', 1, 'edit_destination', { destinationId: DESTINATION, subgroupId: null, patch: { title: 'Unauthorized' } }),
  core('suffix', 2, 'edit_destination', { destinationId: DESTINATION, subgroupId: null, patch: { title: 'Never submitted' } })]);
assert.equal(denied.data.coreResults[0].status, 'conflict');
assert.deepEqual(denied.data.coreResults[1], { operation_id: 'suffix', status: 'not_submitted' });
assert.equal(b.itinerary[0].title, 'Saved in exchange');
assert.equal(sync(PEER, [], [event('wrong-actor', LEADER)]).error.code, '42501');
assert.throws(() => sync(LEADER, [], [], { invented: true }), /Unknown refresh field/);
assert.throws(() => sync(LEADER, [core('backward-a', 2, 'set_solo', { userId: LEADER, solo: false }), core('backward-b', 1, 'set_solo', { userId: LEADER, solo: false })]), /Core prefix must preserve sequence/);
console.log('Mixed group sync fixture contracts passed');
