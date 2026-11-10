const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { keys, member, ok, fail } = require('./backend-domain.cjs');
const store = require('./backend-store.cjs');

function timestampMicros(value) {
  const milliseconds = Date.parse(value);
  assert(Number.isFinite(milliseconds), 'Refresh timestamp contract');
  const fraction = /\.(\d+)(?:Z|[+-]\d\d:\d\d)$/.exec(value)?.[1] ?? '';
  return BigInt(milliseconds) * 1000n + BigInt(fraction.slice(3, 6).padEnd(3, '0'));
}

function execute(b, { args: a, userId }) {
  keys(a, 'p_group_id p_actor_id p_core_operations p_location_events p_refresh');
  if (!userId) return fail('not authenticated', '28000');
  if (a.p_actor_id !== userId) return fail('account_changed', '28000');
  if (!member(b, a.p_group_id, userId)) return fail('not_member');
  assert(Array.isArray(a.p_core_operations) && a.p_core_operations.length <= 20, 'Core envelope contract');
  assert(Array.isArray(a.p_location_events) && a.p_location_events.length <= 50, 'Location envelope contract');
  assert(a.p_refresh && typeof a.p_refresh === 'object' && !Array.isArray(a.p_refresh), 'Refresh envelope contract');
  assert(Buffer.byteLength(JSON.stringify(a)) <= 262144, 'Group sync envelope byte limit');
  for (const key of Object.keys(a.p_refresh)) assert(['requestPeers', 'requestedAt', 'acknowledgements', 'includeSnapshot'].includes(key), `Unknown refresh field ${key}`);
  const acknowledgements = a.p_refresh.acknowledgements ?? [];
  assert(Array.isArray(acknowledgements) && acknowledgements.length <= 50, 'Refresh acknowledgement limit');
  for (const event of a.p_location_events) {
    if (event.actorId !== userId || event.groupId !== a.p_group_id) return fail('location actor/group mismatch');
  }
  const invoke = (name, args) => store.execute(b, { kind: 'rpc', name, args, userId });
  const coreResults = [];
  let stopped = false;
  let previousSequence = 0;
  for (const operation of a.p_core_operations) {
    keys(operation, 'operation_id entity_type entity_id entity_version operation_type payload sequence dependency_ids created_at');
    assert(Number.isSafeInteger(operation.sequence) && operation.sequence > previousSequence, 'Core prefix must preserve sequence');
    previousSequence = operation.sequence;
    if (stopped) {
      coreResults.push({ operation_id: operation.operation_id, status: 'not_submitted' });
      continue;
    }
    const result = require('./backend-core.cjs').apply(b, { userId, args: {
      p_operation_id: operation.operation_id, p_group_id: a.p_group_id, p_actor_id: a.p_actor_id,
      p_entity_type: operation.entity_type, p_entity_id: operation.entity_id, p_entity_version: operation.entity_version,
      p_operation_type: operation.operation_type, p_payload: operation.payload, p_sequence: operation.sequence,
      p_dependency_ids: operation.dependency_ids, p_created_at: operation.created_at,
    } });
    const value = result.error ? { operation_id: operation.operation_id, status: 'retry', code: result.error.code, message: result.error.message } : result.data;
    coreResults.push(value);
    stopped = !['accepted', 'duplicate'].includes(value.status);
  }
  const locationResult = require('./backend-location.cjs').ingest(b, { args: { p_events: a.p_location_events }, userId });
  const refreshAcknowledgements = acknowledgements.map(ack => {
    keys(ack, 'requestedAt eventId');
    const event = b.locationEvents.get(ack.eventId);
    const receipt = b.locationReceipts.get(ack.eventId);
    const requestedAt = timestampMicros(ack.requestedAt);
    const eligible = event && receipt && event.actorId === userId && event.groupId === a.p_group_id
      && BigInt(event.capturedAt * 1000) >= requestedAt && timestampMicros(receipt.receivedAt) >= requestedAt
      && event.capturedAt <= Date.parse(receipt.receivedAt) + 120000;
    return { ...ack, accepted: eligible ? invoke('ack_my_location_refresh', { p_group_id: a.p_group_id, p_requested_at: ack.requestedAt }).data : false };
  });
  const refreshRequest = a.p_refresh.requestPeers ? invoke('request_group_location_refresh', { p_group_id: a.p_group_id }).data : null;
  const pendingRefreshes = invoke('list_my_pending_location_refreshes', {}).data.filter(row => row.group_id === a.p_group_id);
  const acknowledgedIds = a.p_refresh.requestedAt ? invoke('get_group_location_refresh_acknowledgements', { p_group_id: a.p_group_id, p_requested_at: a.p_refresh.requestedAt }).data : [];
  const receiptIds = new Set([...locationResult.acceptedIds, ...acknowledgements.map(ack => ack.eventId)]);
  const locationReceipts = [...receiptIds].filter(id => b.locationEvents.get(id)?.actorId === userId
    && b.locationEvents.get(id)?.groupId === a.p_group_id).map(id => b.locationReceipts.get(id));
  return ok({ coreResults, locationResult, locationReceipts,
    snapshot: a.p_refresh.includeSnapshot === false ? null
      : { ...b.snapshot(a.p_group_id), daily_accommodations: b.tables.daily_accommodations.filter(row => row.group_id === a.p_group_id) },
    refreshRequest, pendingRefreshes, acknowledgedIds, refreshAcknowledgements });
}

module.exports = { execute };
