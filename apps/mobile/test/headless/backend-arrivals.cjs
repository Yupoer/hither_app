const { randomUUID } = require('node:crypto');
const { member, iso } = require('./backend-domain.cjs');
const { scopeAllowed } = require('./backend-workflows.cjs');

function apply(b, a, userId) {
  const p = a.p_payload;
  const sessionId = p.navigationSessionId ?? p.sessionId;
  if (!sessionId) return { conflict: 'session_required' };
  const session = b.sessions.get(sessionId);
  const correction = a.p_operation_type === 'leader_correct_arrival' || p.source === 'leader_correction' || p.targetUserId || p.userId != null && p.userId !== userId;
  if (!session || session.group_id !== a.p_group_id) {
    if (correction) return { conflict: 'history_not_correctable' };
    if (!b.itinerary.some(d => d.id === a.p_entity_id && d.group_id === a.p_group_id)) return { conflict: 'target_deleted' };
    if (p.subgroupId && !b.tables.subgroups.some(s => s.id === p.subgroupId && s.group_id === a.p_group_id)) return { conflict: 'scope_deleted' };
    return { conflict: 'dependency_missing' };
  }
  if (session.destination_id !== a.p_entity_id) return { conflict: 'session_mismatch' };
  const targetId = correction ? p.targetUserId ?? p.userId : userId;
  if (!b.tables.navigation_member_states.some(n => n.navigation_session_id === session.id && n.user_id === targetId)) return { conflict: 'not_session_member' };
  if (correction) {
    if (session.status !== 'completed' || session.scope_subgroup_id != null) return { conflict: 'history_not_correctable' };
    if (!scopeAllowed(b, session.group_id, null, userId)) return { conflict: 'unauthorized' };
  } else if (!member(b, session.group_id, userId)) return { conflict: 'unauthorized' };
  const occurredAt = Date.parse(p.occurredAt ?? p.arrivedAt ?? a.p_created_at);
  if (!Number.isFinite(occurredAt)) return { conflict: 'validation' };
  const arrivedAt = correction ? null : p.arrivedAt ?? null;
  if (arrivedAt !== null && !Number.isFinite(Date.parse(arrivedAt))) return { conflict: 'validation' };
  const event = { id: randomUUID(), event_sequence: b.arrivalEvents.length + 1, operation_id: a.p_operation_id,
    group_id: session.group_id, navigation_session_id: session.id, destination_id: session.destination_id, user_id: targetId, actor_id: userId,
    event_kind: correction ? 'leader_correction' : 'arrival', arrived: p.arrived !== false, arrived_at: arrivedAt,
    source: correction ? 'leader_correction' : p.source === 'automatic' ? 'automatic' : 'manual',
    device_id: p.deviceId ?? null, client_sequence: a.p_sequence, occurred_at: new Date(occurredAt).toISOString(), received_at: iso(b),
    ...(correction ? { corrected_at: iso(b), correction_note: p.note || null } : {}) };
  const order = e => e.event_kind === 'leader_correction' ? Date.parse(e.corrected_at) : Math.min(Date.parse(e.occurred_at), Date.parse(e.received_at));
  const shouldProject = !b.arrivalEvents.some(e => e.navigation_session_id === session.id && e.user_id === targetId
    && (event.device_id && e.device_id === event.device_id ? e.client_sequence > event.client_sequence
      : order(e) > order(event) || order(e) === order(event) && e.event_sequence > event.event_sequence));
  b.arrivalEvents.push(event);
  const current = b.tables.destination_arrivals.find(r => r.destination_id === session.destination_id && r.user_id === targetId);
  const live = [...b.sessions.values()].filter(s => s.group_id === session.group_id && s.destination_id === session.destination_id && s.scope_subgroup_id === session.scope_subgroup_id && s.status === 'active').sort((x, y) => y.started_at.localeCompare(x.started_at))[0];
  const currentSessionId = live?.id ?? current?.navigation_session_id;
  const ownsProjection = !currentSessionId || currentSessionId === session.id;
  const applyCurrent = shouldProject && ownsProjection && (correction || ['active', 'completed'].includes(session.status));
  if (applyCurrent) {
    if (event.arrived) {
      const row = current ?? { id: randomUUID(), group_id: session.group_id, destination_id: session.destination_id, user_id: targetId };
      Object.assign(row, { navigation_session_id: session.id, arrived_at: arrivedAt, source: event.source, marked_by: userId,
        ...(correction ? { corrected_at: iso(b), corrected_by: userId, correction_note: p.note || null } : {}) });
      if (!current) b.tables.destination_arrivals.push(row); b.publish('destination_arrivals', row, current ? 'UPDATE' : 'INSERT');
    } else if (current) {
      b.tables.destination_arrivals = b.tables.destination_arrivals.filter(r => r !== current);
      b.emit({ table: 'destination_arrivals', eventType: 'DELETE', new: {}, old: current, commit_timestamp: iso(b) });
    }
  }
  if (shouldProject && (!correction || ownsProjection)) {
    b.sessionHistory.set(`${session.id}:${targetId}`, { group_id: session.group_id, navigation_session_id: session.id,
      destination_id: session.destination_id, user_id: targetId, arrived: event.arrived, arrived_at: arrivedAt, recorded_at: iso(b),
      ...(correction ? { corrected_at: iso(b), corrected_by: userId, correction_note: p.note || null } : {}) });
    if (['active', 'completed'].includes(session.status)) {
      const state = b.tables.navigation_member_states.find(n => n.navigation_session_id === session.id && n.user_id === targetId);
      Object.assign(state, { local_status: event.arrived ? 'arrived' : 'pending', arrived_at: event.arrived ? arrivedAt : null, updated_at: iso(b) });
      b.publish('navigation_member_states', state);
    }
    if (session.scope_subgroup_id == null && ownsProjection) {
      const prior = b.tables.visited_waypoints.find(r => r.group_id === session.group_id && r.destination_id === session.destination_id && r.user_id === targetId);
      if (event.arrived) {
        const row = prior ?? { id: randomUUID(), group_id: session.group_id, destination_id: session.destination_id, user_id: targetId };
        Object.assign(row, { navigation_session_id: session.id, name: session.destination_name, latitude: session.destination_latitude, longitude: session.destination_longitude, arrived_at: arrivedAt });
        if (!prior) b.tables.visited_waypoints.push(row);
      } else if (!prior?.navigation_session_id || prior.navigation_session_id === session.id) b.tables.visited_waypoints = b.tables.visited_waypoints.filter(r => r !== prior);
    }
  }
  return { entity: { sessionId: session.id, destinationId: session.destination_id, userId: targetId, arrived: event.arrived, arrivedAt,
    ...(correction ? { correctedBy: userId, correctedAt: iso(b), source: 'leader_correction' } : {}), appliedToCurrentSession: applyCurrent } };
}
module.exports = { apply };
