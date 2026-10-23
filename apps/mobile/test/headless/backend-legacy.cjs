const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ok, fail, keys, member, iso } = require('./backend-domain.cjs');
const { scopeAllowed, terminalSession } = require('./backend-workflows.cjs');

function changed(b, groupId) {
  const key = `${groupId}:itinerary:${groupId}`;
  const version = (b.versions.get(key) ?? 0) + 1;
  b.versions.set(key, version);
  const row = { group_id: groupId, entity_type: 'itinerary', entity_id: groupId, entity_version: version,
    state: require('./backend-core.cjs').itineraryState(b, groupId) };
  const previous = b.tables.core_entity_versions.find(r => r.group_id === groupId && r.entity_type === 'itinerary' && r.entity_id === groupId);
  if (previous) Object.assign(previous, row); else b.tables.core_entity_versions.push(row);
}

function execute(b, { kind, name, args: a = {}, userId }) {
  if (kind !== 'rpc') return undefined;
  if (name === 'reorder_itinerary_items') {
    keys(a, 'p_group_id p_updates');
    if (!Array.isArray(a.p_updates)) return fail('invalid reorder batch', '22023');
    const actor = member(b, a.p_group_id, userId);
    if (!actor) return fail('membership required');
    const rows = a.p_updates.map(update => b.itinerary.find(d => d.id === update.id && d.group_id === a.p_group_id));
    if (new Set(a.p_updates.map(u => u.id)).size !== rows.length) return fail('duplicate reorder id', '22023');
    for (const [index, update] of a.p_updates.entries()) {
      for (const key of Object.keys(update)) assert(['id', 'position', 'day', 'meet_at', 'stay_anchor'].includes(key), `Unknown reorder field ${key}`);
      if (!rows[index]) return fail('destination not found', 'P0002');
      if (actor.role !== 'leader' && (actor.subgroup_id == null || rows[index].subgroup_id !== actor.subgroup_id)) return fail('permission denied');
      if (rows[index].closed_at || update.day != null && (!Number.isInteger(update.day) || update.day < 1)) return fail('invalid reorder destination', '22023');
    }
    const slots = rows.map(row => row.position).sort((x, y) => x - y);
    for (const [index, update] of a.p_updates.entries()) {
      Object.assign(rows[index], { position: slots[index], day: update.day });
      if (Object.hasOwn(update, 'meet_at')) rows[index].meet_at = update.meet_at;
      if (Object.hasOwn(update, 'stay_anchor')) rows[index].stay_anchor = update.stay_anchor;
      b.publish('itinerary_items', rows[index]);
    }
    if (rows.length) changed(b, a.p_group_id); return ok(rows.length);
  }
  if (!['delete_destination', 'complete_gathering_stop'].includes(name)) return undefined;
  keys(a, 'p_group_id p_destination_id');
  const destination = b.itinerary.find(d => d.id === a.p_destination_id && d.group_id === a.p_group_id);
  if (!destination) return fail('destination not found', 'P0002');
  const canManage = scopeAllowed(b, a.p_group_id, destination.subgroup_id, userId);
  const scoped = b.memberships.filter(m => m.group_id === a.p_group_id && (m.subgroup_id ?? null) === (destination.subgroup_id ?? null));
  const actor = member(b, a.p_group_id, userId);
  const allArrived = actor && (actor.subgroup_id ?? null) === (destination.subgroup_id ?? null) && scoped.length > 0
    && scoped.every(m => b.tables.destination_arrivals.some(r => r.destination_id === destination.id && r.user_id === m.user_id));
  if (!canManage && !(name === 'complete_gathering_stop' && allArrived)) return fail('scope leader membership required');
  if (name === 'complete_gathering_stop' && destination.day == null) return fail('unscheduled destination', '22023');
  if (name === 'complete_gathering_stop' && destination.closed_at) return ok(null);
  const sessions = [...b.sessions.values()].filter(s => s.group_id === a.p_group_id && s.destination_id === destination.id && s.status === 'active');
  for (const session of sessions) {
    if (canManage) terminalSession(b, session.id, session.version, name === 'delete_destination' ? 'cancelled' : 'completed', userId);
    else { session.status = 'completed'; session.version++; session.ended_at = iso(b); b.publish('navigation_sessions', session); }
  }
  const group = b.groups.get(a.p_group_id);
  if (sessions.length || group.active_destination_id === destination.id) { Object.assign(group, { journey_status: 'paused', active_destination_id: null, journey_started_at: null }); b.publish('groups', group); }
  if (name === 'delete_destination') {
    b.itinerary = b.itinerary.filter(d => d !== destination);
    b.emit({ table: 'itinerary_items', eventType: 'DELETE', new: {}, old: destination, commit_timestamp: iso(b) });
  } else {
    destination.closed_at ??= iso(b); b.publish('itinerary_items', destination);
    for (const m of scoped) {
      const arrival = b.tables.destination_arrivals.find(r => r.destination_id === destination.id && r.user_id === m.user_id);
      const existing = b.tables.visited_waypoints.find(r => r.group_id === a.p_group_id && r.destination_id === destination.id && r.user_id === m.user_id);
      if (existing) Object.assign(existing, { name: destination.title, latitude: destination.latitude, longitude: destination.longitude, arrival_id: existing.arrival_id ?? arrival?.id ?? null });
      else b.tables.visited_waypoints.push({ id: randomUUID(), user_id: m.user_id, group_id: a.p_group_id, destination_id: destination.id, arrival_id: arrival?.id ?? null,
        name: destination.title, latitude: destination.latitude, longitude: destination.longitude, arrived_at: arrival?.arrived_at ?? destination.closed_at });
    }
  }
  changed(b, a.p_group_id); return ok(null);
}
module.exports = { execute, changed };
