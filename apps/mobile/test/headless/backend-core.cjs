const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { ok, fail, keys, member, iso } = require('./backend-domain.cjs');
const { scopeAllowed, startSession, terminalSession } = require('./backend-workflows.cjs');

const payloadFields = {
  start_gathering: 'action subgroupId navigationSessionId expectedSessionStartedAt nextDestinationId activeDestinationId result navigationRequestId',
  switch_gathering: 'action subgroupId navigationSessionId expectedSessionStartedAt nextDestinationId activeDestinationId result navigationRequestId',
  end_gathering: 'action subgroupId navigationSessionId expectedSessionStartedAt nextDestinationId activeDestinationId result',
  add_destination: 'destinationId title address latitude longitude day subgroupId kind stayAnchor providerPlaceId placement',
  edit_destination: 'destinationId subgroupId patch', delete_destination: 'destinationId sessionId subgroupId',
  reorder_destinations: 'updates', set_destination_meet_time: 'destinationId meetAt subgroupId meetRedMinutes',
  complete_destination: 'destinationId sessionId reason subgroupId', set_solo: 'userId solo',
  set_trip_details: 'tripDays departureDate', set_daily_accommodation: 'stayDate daily day', clear_daily_accommodation: 'stayDate daily day',
  submit_gather_point_request: 'requestId subgroupId items', resolve_gather_point_request: 'requestId approve',
  record_arrival: 'actorId userId targetUserId destination arrived completeSolo arrivedAt navigationSessionId navigationSessionAliases sessionId deviceId occurredAt source note',
  leader_correct_arrival: 'actorId targetUserId userId arrived arrivedAt navigationSessionId sessionId deviceId occurredAt source note',
  set_navigation_response: 'sessionId userId response result',
  send_command: 'type message latitude longitude expiresAt',
};

function addDestination(b, groupId, payload, userId) {
  assert(typeof payload.title === 'string' && payload.title.trim(), 'Destination title contract');
  assert(Number.isFinite(payload.latitude) && Math.abs(payload.latitude) <= 90 && Number.isFinite(payload.longitude) && Math.abs(payload.longitude) <= 180, 'Destination coordinates contract');
  const row = { id: payload.destinationId ?? randomUUID(), group_id: groupId, title: payload.title, address: payload.address ?? null,
    latitude: payload.latitude, longitude: payload.longitude, day: payload.day ?? null, subgroup_id: payload.subgroupId ?? null,
    kind: payload.kind ?? 'stop', stay_anchor: payload.kind === 'accommodation' && (payload.stayAnchor ?? false), provider_place_id: payload.providerPlaceId ?? null,
    position: 0, closed_at: null, created_by: userId };
  const lane = b.itinerary.filter(d => d.group_id === groupId && (d.subgroup_id ?? null) === row.subgroup_id);
  const sameDay = lane.filter(d => d.day === row.day);
  row.position = Math.max(-1, ...(sameDay.length ? sameDay : lane.filter(d => (d.day ?? 0) < (row.day ?? 0))).map(d => d.position)) + 1;
  if (row.kind === 'accommodation' && !row.stay_anchor) {
    const tail = sameDay.filter(d => d.kind === 'accommodation' && d.stay_anchor).sort((a, c) => c.position - a.position)[0];
    if (tail) row.position = tail.position;
  }
  if (payload.placement === 'firstStop') {
    const scope = b.itinerary.filter(d => d.group_id === groupId && (d.subgroup_id ?? null) === row.subgroup_id && d.day === row.day && !d.closed_at && !d.stay_anchor);
    row.position = scope.length ? Math.min(...scope.map(d => d.position)) : row.position;
  }
  lane.filter(d => d.position >= row.position).forEach(d => { d.position++; b.publish('itinerary_items', d); });
  b.itinerary.push(row); b.publish('itinerary_items', row, 'INSERT'); return row;
}

function itineraryState(b, groupId) {
  const group = b.groups.get(groupId);
  return { groupId, group: { tripDays: group.trip_days, departureDate: group.departure_date, accommodationAutoAdd: group.accommodation_auto_add },
    destinations: b.itinerary.filter(d => d.group_id === groupId).sort((a, c) => (a.day ?? 0) - (c.day ?? 0) || a.position - c.position).map(d => ({ id: d.id, title: d.title, address: d.address ?? null,
      coordinates: { latitude: d.latitude, longitude: d.longitude }, order: d.position, day: d.day, subgroupId: d.subgroup_id ?? null,
      meetAt: d.meet_at ?? null, meetRedMinutes: d.meet_red_minutes ?? null, closedAt: d.closed_at ?? null, closedBySessionId: d.closed_by_session_id ?? null,
      emoji: d.emoji ?? null, markerColor: d.marker_color ?? null, kind: d.kind ?? 'stop', stayAnchor: d.stay_anchor ?? false, providerPlaceId: d.provider_place_id ?? null })),
    dailyAccommodations: b.tables.daily_accommodations.filter(d => d.group_id === groupId).map(d => ({ id: d.id, groupId, stayDate: d.stay_date, title: d.title, address: d.address,
      coordinates: { latitude: d.latitude, longitude: d.longitude }, sourceDestinationId: d.source_destination_id ?? null })) };
}

function apply(b, { args: a, userId }) {
  keys(a, 'p_operation_id p_group_id p_actor_id p_entity_type p_entity_id p_entity_version p_operation_type p_payload p_sequence p_dependency_ids p_created_at');
  assert.equal(a.p_actor_id, userId, 'Wire actor ownership');
  assert(Number.isSafeInteger(a.p_sequence) && a.p_sequence > 0, 'Integer core sequence');
  const type = a.p_operation_type, p = a.p_payload;
  assert(Object.hasOwn(payloadFields, type), `Unsupported core operation ${type}`);
  for (const field of Object.keys(p)) assert(field === 'rebase' || payloadFields[type].split(' ').includes(field), `Unknown ${type} payload ${field}`);
  if (type === 'record_arrival' && Object.hasOwn(p, 'destination')) {
    const d = p.destination;
    assert(d && typeof d === 'object' && !Array.isArray(d), 'Arrival destination object contract');
    assert.equal(d.id, a.p_entity_id, 'Arrival destination identity contract');
    assert(typeof d.title === 'string' && d.title.trim(), 'Arrival destination title contract');
    assert(Number.isFinite(d.coordinates?.latitude) && Math.abs(d.coordinates.latitude) <= 90
      && Number.isFinite(d.coordinates?.longitude) && Math.abs(d.coordinates.longitude) <= 180, 'Arrival destination coordinates contract');
  }
  const conflict = (code, message = code) => ok({ status: 'conflict', operation_id: a.p_operation_id, conflict: { code, message } });
  const { rebase: _rebase, ...identityPayload } = p;
  const signature = { actorId: userId, groupId: a.p_group_id, entityType: a.p_entity_type, entityId: a.p_entity_id,
    operationType: type, dependencies: a.p_dependency_ids, payload: structuredClone(identityPayload) };
  const previous = b.receipts.get(a.p_operation_id);
  if (previous) return isDeepStrictEqual(b.operationSignatures?.get(a.p_operation_id), signature) ? ok({ ...previous, status: 'duplicate' }) : conflict('operation_identity_mismatch');
  const m = member(b, a.p_group_id, userId);
  if (!m) return conflict('unauthorized');
  for (const dependency of a.p_dependency_ids) if (!b.receipts.has(dependency)) return conflict('dependency_missing');
  const group = b.groups.get(a.p_group_id);
  const destination = b.itinerary.find(d => d.id === p.destinationId && d.group_id === group.id);
  const scope = p.subgroupId ?? null;
  const ownCommands = ['set_solo', 'record_arrival', 'leader_correct_arrival', 'set_navigation_response', 'submit_gather_point_request', 'resolve_gather_point_request', 'reorder_destinations', 'send_command'];
  if (!ownCommands.includes(type) && !scopeAllowed(b, group.id, scope, userId)) return conflict('unauthorized');
  if (destination && (destination.subgroup_id ?? null) !== scope) return conflict('scope_mismatch');
  const versionKey = `${group.id}:${a.p_entity_type}:${a.p_entity_id}`;
  const version = (b.versions.get(versionKey) ?? 0) + 1;
  let entity, effects;
  if (['start_gathering', 'switch_gathering'].includes(type)) {
    const target = b.itinerary.find(d => d.id === p.activeDestinationId && d.group_id === group.id);
    if ((target?.subgroup_id ?? null) !== scope) return conflict('scope_mismatch');
    const requestId = p.navigationRequestId ?? a.p_operation_id;
    const result = startSession(b, group.id, p.activeDestinationId, requestId, userId, true, requestId);
    if (result.error) return conflict('invalid_transition', result.error.message);
    const session = result.data;
    entity = { groupId: group.id, sessionId: session.id, navigationSessionId: session.id, journeyPhase: 'en_route', journeyStatus: 'going', scope: scope ?? 'main', status: 'active', destinationId: session.destination_id, activeDestinationId: session.destination_id, pointStatuses: { [session.destination_id]: 'en_route' }, phaseChangedAt: b.now, entityVersion: version, version: session.version };
    effects = { navigationSessionId: session.id, navigationSession: session };
  } else if (type === 'end_gathering') {
    const session = b.sessions.get(p.navigationSessionId) ?? [...b.sessions.values()].find(s => s.request_id === p.navigationSessionId);
    if (!session) return conflict('session_required');
    const result = terminalSession(b, session.id, session.version, 'cancelled', userId);
    if (result.error) return conflict('invalid_transition', result.error.message);
    entity = { groupId: group.id, journeyPhase: 'staying', activeDestinationId: null, pointStatuses: { [session.destination_id]: 'pending' }, phaseChangedAt: b.now, entityVersion: version };
    effects = { navigationSessionId: session.id, navigationSession: result.data };
  } else if (type === 'add_destination') {
    if (b.itinerary.some(d => d.id === p.destinationId)) return conflict('validation', 'duplicate destination id');
    addDestination(b, group.id, p, userId);
  } else if (type === 'edit_destination' || type === 'set_destination_meet_time') {
    if (!destination) return conflict('target_deleted');
    const patch = type === 'edit_destination' ? p.patch : { meetAt: p.meetAt, meetRedMinutes: p.meetRedMinutes };
    const fields = { title: 'title', address: 'address', day: 'day', subgroupId: 'subgroup_id', kind: 'kind', stayAnchor: 'stay_anchor', providerPlaceId: 'provider_place_id', meetAt: 'meet_at', meetRedMinutes: 'meet_red_minutes', emoji: 'emoji', markerColor: 'marker_color' };
    for (const key of Object.keys(patch)) assert(fields[key], `Unknown destination patch ${key}`);
    for (const [key, value] of Object.entries(patch)) destination[fields[key]] = value;
    b.publish('itinerary_items', destination);
  } else if (type === 'delete_destination' || type === 'complete_destination') {
    if (!destination) return conflict('target_deleted');
    const active = [...b.sessions.values()].find(s => s.destination_id === destination.id && s.status === 'active');
    if (type === 'delete_destination' && active && p.sessionId !== active.id) return conflict('validation', 'active destination requires the original sessionId before deletion');
    let completion;
    if (type === 'complete_destination') {
      const session = p.sessionId ? b.sessions.get(p.sessionId) : active;
      if (!session || session.destination_id !== destination.id || session.scope_subgroup_id !== scope || ['cancelled', 'expired'].includes(session.status)) return conflict('validation', 'invalid completion session');
      if (!['all_arrived', 'forced'].includes(p.reason ?? 'forced')) return conflict('validation', 'invalid completion reason');
      const eligible = b.memberships.filter(m => m.group_id === group.id && !m.solo && (m.subgroup_id ?? null) === scope && b.tables.navigation_member_states.some(n => n.navigation_session_id === session.id && n.user_id === m.user_id));
      if (p.reason === 'all_arrived' && session.status === 'active' && (!eligible.length || eligible.some(m => !b.tables.destination_arrivals.some(r => r.destination_id === destination.id && r.user_id === m.user_id && r.navigation_session_id === session.id && r.arrived_at != null)))) return fail('waiting for all session members to arrive', '40001');
      completion = session;
    }
    const terminal = type === 'delete_destination' ? active : completion;
    if (terminal?.status === 'active') terminalSession(b, terminal.id, terminal.version, type === 'delete_destination' ? 'cancelled' : 'completed', userId);
    if (type === 'delete_destination') { b.itinerary = b.itinerary.filter(d => d !== destination); b.emit({ table: 'itinerary_items', eventType: 'DELETE', new: {}, old: destination, commit_timestamp: iso(b) }); }
    else { destination.closed_at ??= iso(b); destination.closed_by_session_id ??= completion.id; b.publish('itinerary_items', destination); }
  } else if (type === 'reorder_destinations') {
    for (const update of p.updates) {
      const d = b.itinerary.find(r => r.id === update.id && r.group_id === group.id);
      if (!d || !scopeAllowed(b, group.id, d.subgroup_id, userId)) return conflict('unauthorized');
    }
    const slots = p.updates.map(update => b.itinerary.find(d => d.id === update.id).position).sort((x, y) => x - y);
    for (const [index, update] of p.updates.entries()) {
      const d = b.itinerary.find(r => r.id === update.id);
      d.position = slots[index]; d.day = update.day;
      d.meet_at = update.meetAt ?? null;
      d.stay_anchor = update.stayAnchor ?? false;
      b.publish('itinerary_items', d);
    }
    b.itinerary.sort((x, y) => x.position - y.position);
  } else if (type === 'set_solo') {
    if (p.userId !== userId || a.p_entity_type !== 'itinerary' || a.p_entity_id !== userId) return conflict('unauthorized');
    if (typeof p.solo !== 'boolean') return conflict('validation');
    m.solo = p.solo; entity = { userId, solo: p.solo }; b.publish('memberships', m);
  } else if (type === 'set_trip_details') {
    const oldGroup = structuredClone(group);
    group.trip_days = p.tripDays; group.departure_date = p.departureDate; b.publish('groups', group, 'UPDATE', oldGroup);
  } else if (type === 'set_daily_accommodation' || type === 'clear_daily_accommodation') {
    const before = b.tables.daily_accommodations.find(r => r.group_id === group.id && r.stay_date === p.stayDate);
    if (type === 'clear_daily_accommodation') {
      b.tables.daily_accommodations = b.tables.daily_accommodations.filter(r => r !== before);
      if (before) b.emit({ table: 'daily_accommodations', eventType: 'DELETE', new: {}, old: before, commit_timestamp: iso(b) });
      for (const d of b.itinerary) if (d.group_id === group.id && d.day === p.day && d.stay_anchor) { d.stay_anchor = false; b.publish('itinerary_items', d); }
    } else {
      const d = p.daily; assert(d && d.coordinates && d.stayDate === p.stayDate);
      const row = before ?? { id: d.id, group_id: group.id, stay_date: p.stayDate, created_at: iso(b) };
      Object.assign(row, { title: d.title, address: d.address ?? null, latitude: d.coordinates.latitude, longitude: d.coordinates.longitude, source_destination_id: d.sourceDestinationId ?? null, updated_at: iso(b) });
      if (!before) b.tables.daily_accommodations.push(row); b.publish('daily_accommodations', row, before ? 'UPDATE' : 'INSERT');
      const oldGroup = structuredClone(group);
      group.accommodation_auto_add = false; b.publish('groups', group, 'UPDATE', oldGroup);
    }
  } else if (type === 'record_arrival' || type === 'leader_correct_arrival') {
    const result = require('./backend-arrivals.cjs').apply(b, a, userId);
    if (result.conflict) return conflict(result.conflict);
    entity = result.entity;
    effects = result.effects;
  } else if (type === 'submit_gather_point_request' || type === 'resolve_gather_point_request') {
    const name = type;
    const args = type === 'submit_gather_point_request' ? { p_group_id: group.id, p_subgroup_id: scope, p_items: p.items } : { p_request_id: p.requestId, p_approve: p.approve };
    const result = require('./backend-requests.cjs').execute(b, { kind: 'rpc', name, args, userId, requestId: p.requestId });
    if (result.error) return conflict('validation', result.error.message);
    entity = structuredClone(b.tables.gather_point_requests.find(r => r.id === p.requestId));
  } else if (type === 'set_navigation_response') {
    if (p.userId !== userId) return conflict('unauthorized');
    entity = { ...p, entityVersion: version, updatedAt: b.now };
  } else if (type === 'send_command') {
    const leaderCommands = ['gather', 'find_gathering', 'depart', 'rest', 'be_careful', 'go_left', 'go_right', 'stop', 'hurry_up'];
    assert([...leaderCommands, 'need_restroom', 'need_break', 'need_help', 'found_something', 'request_start', 'custom'].includes(p.type), 'Command type contract');
    if (leaderCommands.includes(p.type) && m.role !== 'leader') return conflict('unauthorized');
    const expiresAt = new Date(Math.min(b.now + 300000, Date.parse(p.expiresAt) || b.now + 300000)).toISOString();
    const category = m.role === 'leader' ? 'leader_commands' : 'follower_requests';
    const targets = Date.parse(expiresAt) <= b.now ? [] : b.memberships.filter(target => target.group_id === group.id && target.user_id !== userId
      && (m.subgroup_id == null || target.subgroup_id === m.subgroup_id || target.role === 'leader')
      && (p.type === 'request_start' ? target.role === 'leader' : !target.solo)
      && b.tables.notification_preferences.find(pref => pref.user_id === target.user_id)?.[category] !== false);
    const rows = targets.map(target => ({ id: randomUUID(), operation_id: a.p_operation_id, group_id: group.id, sender_id: userId, target_user_id: target.user_id,
      category, target_role: target.role === 'leader' ? 'leader' : 'member', payload: { ...p, category, groupId: group.id, senderId: userId, targetUserId: target.user_id, expiresAt }, created_at: iso(b), expires_at: expiresAt }));
    b.notificationOutbox.push(...rows);
    effects = { category, targetRole: p.type === 'request_start' ? 'leader' : 'member', targetCount: rows.length, notificationIds: rows.map(r => r.id), expiresAt, expired: Date.parse(expiresAt) <= b.now };
    entity = { operationId: a.p_operation_id, accepted: true, expired: effects.expired };
  }
  if (entity === undefined) entity = itineraryState(b, group.id);
  const receipt = { status: 'accepted', operation_id: a.p_operation_id, entity_version: version, entity, effects };
  b.versions.set(versionKey, version); b.receipts.set(a.p_operation_id, receipt);
  b.operationSignatures ??= new Map(); b.operationSignatures.set(a.p_operation_id, signature);
  const versionRow = b.tables.core_entity_versions.find(r => r.group_id === group.id && r.entity_type === a.p_entity_type && r.entity_id === a.p_entity_id);
  const row = { group_id: group.id, entity_type: a.p_entity_type, entity_id: a.p_entity_id, entity_version: version, state: entity ?? {} };
  if (versionRow) Object.assign(versionRow, row); else b.tables.core_entity_versions.push(row);
  return ok(receipt);
}

module.exports = { apply, addDestination, itineraryState };
