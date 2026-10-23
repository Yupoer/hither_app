const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ok, fail, keys, member, leader, iso } = require('./backend-domain.cjs');

function scopeAllowed(b, groupId, scope, userId) {
  const membership = member(b, groupId, userId);
  if (!membership) return false;
  if (scope == null) return membership.role === 'leader';
  const subgroup = b.tables.subgroups.find(s => s.id === scope && s.group_id === groupId);
  return Boolean(subgroup && membership.subgroup_id === scope && (subgroup.mode === 'collab' || subgroup.leader_id === userId));
}

function startSession(b, groupId, destinationId, requestId, userId, replace = false, sessionId = randomUUID()) {
  const destination = b.itinerary.find(d => d.id === destinationId && d.group_id === groupId);
  if (!destination || destination.day == null || destination.closed_at) return fail('invalid_destination', '22023');
  const scope = destination.subgroup_id ?? null;
  if (!scopeAllowed(b, groupId, scope, userId)) return fail('leader_required');
  const duplicate = [...b.sessions.values()].find(s => s.group_id === groupId && s.request_id === requestId);
  if (duplicate) return ok(duplicate);
  const active = [...b.sessions.values()].find(s => s.group_id === groupId && s.scope_subgroup_id === scope && s.status === 'active');
  if (active && !replace) return fail('active_session_exists', 'P0001');
  if (active) { active.status = 'cancelled'; active.version++; b.publish('navigation_sessions', active); }
  const roster = b.memberships.filter(m => m.group_id === groupId && !m.solo && (m.subgroup_id ?? null) === scope);
  const session = { id: sessionId, group_id: groupId, scope_subgroup_id: scope, destination_id: destination.id,
    destination_name: destination.title, destination_latitude: destination.latitude, destination_longitude: destination.longitude,
    arrival_radius_m: 50, started_by: userId, request_id: requestId, started_at: iso(b),
    expires_at: new Date(b.now + 86400000).toISOString(), status: 'active', version: 1,
    navigation_member_states: roster.map(m => ({ user_id: m.user_id })) };
  b.sessions.set(session.id, session);
  for (const m of roster) b.tables.navigation_member_states.push({ navigation_session_id: session.id, user_id: m.user_id,
    local_status: 'pending', detail: {}, latest_distance_m: null, latest_accuracy_m: null,
    live_activity_id: null, acknowledged_at: null, arrived_at: null, updated_at: iso(b) });
  if (scope == null) {
    const group = b.groups.get(groupId);
    Object.assign(group, { journey_status: 'going', active_destination_id: destination.id, journey_started_at: iso(b) });
    b.publish('groups', group);
  }
  b.publish('navigation_sessions', session, 'INSERT');
  return ok(session);
}

function terminalSession(b, sessionId, expected, status, userId) {
  const session = b.sessions.get(sessionId);
  if (!session) return fail('session_not_found', 'P0002');
  if (!scopeAllowed(b, session.group_id, session.scope_subgroup_id, userId)) return fail('leader_required');
  if (session.status === status) return ok(session);
  if (session.status !== 'active' || session.version !== expected) return fail('version_conflict', 'P0001');
  session.status = status; session.version++;
  if (status === 'completed') {
    const destination = b.itinerary.find(d => d.id === session.destination_id);
    destination.closed_at = iso(b); destination.closed_by_session_id = session.id;
    b.publish('itinerary_items', destination);
  }
  if (session.scope_subgroup_id == null) {
    const group = b.groups.get(session.group_id);
    Object.assign(group, { journey_status: 'paused', active_destination_id: null, journey_started_at: null });
    b.publish('groups', group);
  }
  b.publish('navigation_sessions', session);
  return ok(session);
}

function arrival(b, destinationId, targetId, arrived, arrivedAt, userId, sessionId) {
  const destination = b.itinerary.find(d => d.id === destinationId);
  if (!destination) return fail('destination_not_found', 'P0002');
  const actor = member(b, destination.group_id, userId);
  const target = member(b, destination.group_id, targetId);
  if (!actor || !target || userId !== targetId && !scopeAllowed(b, destination.group_id, destination.subgroup_id, userId)) return fail('not_authorized');
  if ((target.subgroup_id ?? null) !== (destination.subgroup_id ?? null)) return fail('scope_mismatch');
  const session = sessionId ? b.sessions.get(sessionId) : [...b.sessions.values()].find(s => s.destination_id === destinationId && s.status === 'active');
  if (sessionId && (!session || session.destination_id !== destinationId || !session.navigation_member_states.some(m => m.user_id === targetId))) return fail('session_mismatch');
  const existing = b.tables.destination_arrivals.find(r => r.destination_id === destinationId && r.user_id === targetId && r.navigation_session_id === (session?.id ?? null));
  if (!arrived) {
    b.tables.destination_arrivals = b.tables.destination_arrivals.filter(r => r !== existing);
    if (existing) b.emit({ table: 'destination_arrivals', eventType: 'DELETE', new: {}, old: existing, commit_timestamp: iso(b) });
  } else {
    const row = existing ?? { id: randomUUID(), group_id: destination.group_id, destination_id: destinationId, user_id: targetId, navigation_session_id: session?.id ?? null };
    Object.assign(row, { arrived_at: arrivedAt ?? iso(b), occurred_at: arrivedAt ?? iso(b) });
    if (!existing) b.tables.destination_arrivals.push(row);
    b.publish('destination_arrivals', row, existing ? 'UPDATE' : 'INSERT');
  }
  return ok(null);
}

function execute(b, operation) {
  const { kind, name, args = {}, userId } = operation;
  if (kind === 'function') return executeFunction(b, operation);
  if (kind !== 'rpc') return undefined;
  if (['start_navigation_session', 'start_navigation_session_switch'].includes(name)) {
    keys(args, 'p_group_id p_destination_id p_request_id');
    return startSession(b, args.p_group_id, args.p_destination_id, args.p_request_id, userId, name.endsWith('_switch'));
  }
  if (['cancel_navigation_session', 'complete_navigation_session'].includes(name)) {
    keys(args, 'p_session_id p_expected_version');
    return terminalSession(b, args.p_session_id, args.p_expected_version, name.startsWith('cancel') ? 'cancelled' : 'completed', userId);
  }
  if (name === 'ack_navigation_session') {
    keys(args, 'p_session_id p_status p_detail');
    const session = b.sessions.get(args.p_session_id);
    const row = b.tables.navigation_member_states.find(r => r.navigation_session_id === args.p_session_id && r.user_id === userId);
    if (!session || !row || !member(b, session.group_id, userId)) return fail('not_session_member');
    assert(['pending', 'activity_started', 'tracking_active', 'permission_denied', 'location_disabled', 'app_force_quit_suspected', 'offline', 'push_unavailable', 'sharing_disabled', 'arriving', 'arrived', 'missed', 'cancelled'].includes(args.p_status), 'Navigation status contract');
    Object.assign(row, { local_status: args.p_status, detail: args.p_detail, acknowledged_at: iso(b), updated_at: iso(b),
      latest_distance_m: args.p_detail.latestDistanceMeters ?? row.latest_distance_m,
      latest_accuracy_m: args.p_detail.latestAccuracyMeters ?? row.latest_accuracy_m });
    b.publish('navigation_member_states', row); return ok(row);
  }
  if (name === 'self_split') {
    keys(args, 'p_group p_name'); const m = member(b, args.p_group, userId);
    if (!m) return fail('not_member');
    if (!args.p_name?.trim()) return fail('invalid_name', '22023');
    const row = { id: randomUUID(), group_id: args.p_group, name: args.p_name.trim(), mode: 'collab', leader_id: null, parent_subgroup_id: m.subgroup_id ?? null };
    b.tables.subgroups.push(row); m.subgroup_id = row.id; m.solo = false;
    b.publish('subgroups', row, 'INSERT'); b.publish('memberships', m); return ok(row);
  }
  if (name === 'self_merge') {
    keys(args, 'p_group'); const m = member(b, args.p_group, userId);
    if (!m) return fail('not_member');
    const subgroup = b.tables.subgroups.find(s => s.id === m.subgroup_id);
    m.subgroup_id = subgroup?.parent_subgroup_id ?? null; b.publish('memberships', m); return ok(null);
  }
  if (name === 'invite_to_subgroup') {
    keys(args, 'p_subgroup p_invitee');
    const subgroup = b.tables.subgroups.find(s => s.id === args.p_subgroup);
    const from = subgroup && member(b, subgroup.group_id, userId);
    const to = subgroup && member(b, subgroup.group_id, args.p_invitee);
    if (!from || from.subgroup_id !== subgroup.id || !to || to.subgroup_id === subgroup.id) return fail('not_eligible');
    let row = b.tables.subgroup_invites.find(i => i.subgroup_id === subgroup.id && i.invitee_id === to.user_id && i.status === 'pending');
    if (!row) { row = { id: randomUUID(), group_id: subgroup.group_id, subgroup_id: subgroup.id, inviter_id: userId, invitee_id: to.user_id, status: 'pending', created_at: iso(b) }; b.tables.subgroup_invites.push(row); }
    row.inviter_id = userId; b.publish('subgroup_invites', row, 'INSERT'); return ok(row);
  }
  if (['accept_subgroup_invite', 'decline_subgroup_invite'].includes(name)) {
    keys(args, 'p_invite'); const invite = b.tables.subgroup_invites.find(i => i.id === args.p_invite && i.invitee_id === userId && i.status === 'pending');
    if (!invite) return fail('invite_not_found', 'P0002');
    invite.status = name.startsWith('accept') ? 'accepted' : 'declined';
    if (invite.status === 'accepted') { const m = member(b, invite.group_id, userId); if (!m) return fail('not_member'); m.subgroup_id = invite.subgroup_id; b.publish('memberships', m); }
    b.publish('subgroup_invites', invite); return ok(null);
  }
  if (['set_destination_arrival', 'set_destination_arrival_at'].includes(name)) {
    keys(args, name.endsWith('_at') ? 'p_destination_id p_target_user_id p_arrived p_arrived_at' : 'p_destination_id p_target_user_id p_arrived');
    return arrival(b, args.p_destination_id, args.p_target_user_id, args.p_arrived, args.p_arrived_at, userId);
  }
  if (name === 'set_accommodation_auto_add' || name === 'set_journey_target') {
    keys(args, name === 'set_accommodation_auto_add' ? 'p_group_id p_enabled' : 'p_group_id p_destination_id');
    if (!leader(b, args.p_group_id, userId)) return fail('leader_required');
    const group = b.groups.get(args.p_group_id);
    if (name === 'set_journey_target' && args.p_destination_id && !b.itinerary.some(d => d.id === args.p_destination_id && d.group_id === group.id)) return fail('destination_not_found', 'P0002');
    group[name === 'set_accommodation_auto_add' ? 'accommodation_auto_add' : 'active_destination_id'] = name === 'set_accommodation_auto_add' ? args.p_enabled : args.p_destination_id;
    b.publish('groups', group); return ok(null);
  }
  if (name === 'ingest_diagnostic_batch') {
    keys(args, 'p_events'); const acceptedIds = [];
    for (const event of args.p_events) { assert(typeof event.id === 'string' && typeof event.event === 'string' && typeof event.deviceId === 'string'); b.diagnostics.set(`${userId}:${event.id}`, structuredClone(event)); acceptedIds.push(event.id); }
    return ok({ acceptedIds, rejected: [] });
  }
  if (name === 'submit_feedback') {
    keys(args, 'p_context_tag p_description'); if (!userId) return fail('not_authenticated');
    if (!args.p_description?.trim()) return fail('invalid_description', '22023');
    b.feedback.push({ user_id: userId, ...args }); return ok(null);
  }
  if (name === 'clear_anonymous_expiry_if_registered') {
    keys(args, 'p_uid'); if (args.p_uid !== userId) return fail('owner_mismatch');
    const profile = b.profiles.get(userId); if (profile && b.authUsers?.get(userId)?.is_anonymous === false) profile.anonymous_expires_at = null; return ok(null);
  }
  if (name === 'delete_anonymous_account' || name === 'delete_account') {
    keys(args, ''); b.profiles.delete(userId); b.memberships = b.memberships.filter(m => m.user_id !== userId);
    if (b.authUsers) require('./backend-auth.cjs').removeUser(b, userId);
    return ok(null);
  }
  if (name === 'revoke_installation_capabilities') {
    keys(args, 'p_device_id p_push_token p_activity_ids');
    for (const table of ['push_tokens', 'device_live_activity_tokens', 'live_activity_sessions']) b.tables[table] = b.tables[table].filter(r => r.user_id !== userId || !(r.device_id === args.p_device_id || r.token === args.p_push_token || args.p_activity_ids.includes(r.activity_id)));
    return ok(null);
  }
  return undefined;
}

function executeFunction(b, { name, args = {}, userId }) {
  if (!['verify-and-apply-purchase', 'sync-app-store-subscription'].includes(name)) return undefined;
  keys(args, 'body'); const body = args.body;
  const allowed = name === 'sync-app-store-subscription' ? ['signed_transaction', 'original_transaction_id'] : ['signed_transaction', 'transaction_id', 'product_id', 'group_id', 'source', 'purchase_token', 'groupId', 'transactionId', 'productId', 'purchaseToken'];
  for (const key of Object.keys(body)) assert(allowed.includes(key), `Unknown ${name} body ${key}`);
  const proof = body.signed_transaction ?? body.purchase_token ?? body.original_transaction_id;
  const verified = b.verifiedPurchases.get(proof);
  if (!verified || verified.user_id !== userId) return ok({ ok: false, error: 'invalid', message: 'fixture purchase has no external verification' });
  if (verified.group_id && verified.group_id !== (body.group_id ?? body.groupId)) return ok({ ok: false, error: 'invalid' });
  const id = body.transaction_id ?? body.transactionId ?? proof;
  const existing = b.purchaseLedger.get(id);
  if (existing) return existing.userId === userId ? ok({ ...existing.result, duplicate: true }) : ok({ ok: false, error: 'transaction_bound_elsewhere' });
  b.premium.set(userId, { ...verified, status: 'active' });
  const result = { ok: true, status: 'active', product_id: verified.product_id, expires_at: verified.expires_at ?? null, personal_premium_active: !verified.group_id, group_id: verified.group_id ?? null };
  b.purchaseLedger.set(id, { userId, result }); return ok(result);
}

module.exports = { execute, startSession, terminalSession, arrival, scopeAllowed };
