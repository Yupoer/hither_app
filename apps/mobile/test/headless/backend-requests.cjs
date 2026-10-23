const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ok, fail, keys, member, iso } = require('./backend-domain.cjs');
const { scopeAllowed } = require('./backend-workflows.cjs');

function resolve(b, request, userId, optionId, source) {
  if (request.status !== 'open') return ok(request);
  const option = request.options.find(o => o.id === optionId);
  if (!option) return fail('invalid_option', '22023');
  const p = option.payload ?? {};
  let applied = false;
  if (option.kind === 'meet_time') {
    const destination = b.itinerary.find(d => d.id === p.destinationId && d.group_id === request.group_id && (d.subgroup_id ?? null) === request.subgroup_id && !d.closed_at);
    if (destination) { destination.meet_at = p.meetAt ?? null; b.publish('itinerary_items', destination); applied = true; }
  } else if (['gathering_point', 'itinerary', 'route'].includes(option.kind)) {
    if (p.destinationId) {
      const destination = b.itinerary.find(d => d.id === p.destinationId && d.group_id === request.group_id && (d.subgroup_id ?? null) === request.subgroup_id && !d.closed_at);
      if (destination) {
        for (const [key, value] of Object.entries(p)) if (key !== 'destinationId') destination[key === 'meetAt' ? 'meet_at' : key] = value;
        b.publish('itinerary_items', destination); applied = true;
      }
    } else if (p.title && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) {
      require('./backend-core.cjs').addDestination(b, request.group_id, { ...p, subgroupId: request.subgroup_id }); applied = true;
    }
  } else assert(['keep_current', 'reject', 'no_change'].includes(option.kind), 'Coordination option kind contract');
  const operation = { id: randomUUID(), group_id: request.group_id, subgroup_id: request.subgroup_id,
    version: 1 + Math.max(0, ...b.tables.itinerary_operations.filter(o => o.group_id === request.group_id).map(o => o.version)),
    operation_type: applied ? 'coordination_apply' : 'coordination_no_change', payload: { option_id: optionId, kind: option.kind, applied },
    source_request_id: request.id, created_by: userId, created_at: iso(b) };
  b.tables.itinerary_operations.push(operation); b.publish('itinerary_operations', operation, 'INSERT');
  Object.assign(request, { status: source === 'timeout_default' ? 'expired' : 'resolved', resolved_outcome: optionId, resolution_source: source, resolved_at: iso(b), resolved_by: userId, applied_operation_id: operation.id, updated_at: iso(b) });
  b.publish('coordination_requests', request); return ok(request);
}

function deadline(b, request, userId) {
  if (request.status !== 'open') return ok(request);
  if (Date.parse(request.deadline) > b.now) return fail('deadline_not_reached', 'P0001');
  const eligible = b.memberships.filter(m => m.group_id === request.group_id && member(b, request.group_id, m.user_id) && (request.subgroup_id == null || m.subgroup_id === request.subgroup_id || m.role === 'leader')).map(m => m.user_id);
  const responses = b.tables.coordination_responses.filter(r => r.request_id === request.id && eligible.includes(r.user_id));
  let option = request.default_outcome, source = 'timeout_default';
  const counts = new Map(); responses.forEach(r => counts.set(r.option_id, (counts.get(r.option_id) ?? 0) + 1));
  if (request.policy === 'unanimity' && eligible.length && responses.length === eligible.length && counts.size === 1) { option = responses[0].option_id; source = 'unanimity'; }
  if (request.policy === 'majority') for (const [id, count] of counts) if (count > responses.length / 2) { option = id; source = 'majority'; }
  return resolve(b, request, userId, option, source);
}

function execute(b, { kind, name, args: a = {}, userId, requestId }) {
  if (kind !== 'rpc') return undefined;
  if (name === 'submit_gather_point_request') {
    keys(a, 'p_group_id p_subgroup_id p_items');
    const m = member(b, a.p_group_id, userId);
    if (!m || (m.subgroup_id ?? null) !== a.p_subgroup_id) return fail('not_member');
    if (!Array.isArray(a.p_items) || !a.p_items.length) return fail('invalid_items', '22023');
    for (const item of a.p_items) assert(item.title?.trim() && Number.isFinite(item.latitude) && Number.isFinite(item.longitude), 'Gather item contract');
    const row = { id: requestId ?? randomUUID(), group_id: a.p_group_id, subgroup_id: a.p_subgroup_id, requester_id: userId, items: structuredClone(a.p_items), status: 'pending', created_at: iso(b) };
    b.tables.gather_point_requests.push(row); b.publish('gather_point_requests', row, 'INSERT'); return ok(row.id);
  }
  if (name === 'resolve_gather_point_request') {
    keys(a, 'p_request_id p_approve');
    const row = b.tables.gather_point_requests.find(r => r.id === a.p_request_id);
    if (!row) return fail('request_not_found', 'P0002');
    if (!scopeAllowed(b, row.group_id, row.subgroup_id, userId)) return fail('leader_required');
    if (row.status !== 'pending') return ok({ status: row.status, inserted_count: 0 });
    const inserted = a.p_approve ? row.items.map(item => require('./backend-core.cjs').addDestination(b, row.group_id, { ...item, subgroupId: row.subgroup_id })) : [];
    Object.assign(row, { status: a.p_approve ? 'approved' : 'rejected', resolved_at: iso(b), resolved_by: userId });
    b.publish('gather_point_requests', row); return ok({ status: row.status, inserted_count: inserted.length });
  }
  if (name === 'create_coordination_request') {
    keys(a, 'p_group_id p_subgroup_id p_subject p_subject_kind p_options p_deadline p_policy p_default_outcome');
    if (!scopeAllowed(b, a.p_group_id, a.p_subgroup_id, userId)) return fail('leader_required');
    if (!a.p_subject?.trim() || !Array.isArray(a.p_options) || a.p_options.length < 2 || !a.p_options.some(o => o.id === a.p_default_outcome) || Date.parse(a.p_deadline) <= b.now) return fail('invalid_request', '22023');
    assert(['timeout_default', 'organizer_override', 'unanimity', 'majority'].includes(a.p_policy), 'Coordination policy contract');
    const row = { id: randomUUID(), group_id: a.p_group_id, subgroup_id: a.p_subgroup_id, created_by: userId,
      subject: a.p_subject, subject_kind: a.p_subject_kind, options: structuredClone(a.p_options), deadline: a.p_deadline, policy: a.p_policy, default_outcome: a.p_default_outcome,
      status: 'open', resolved_outcome: null, resolution_source: null, resolved_at: null, resolved_by: null, applied_operation_id: null, created_at: iso(b), updated_at: iso(b) };
    b.tables.coordination_requests.push(row); b.publish('coordination_requests', row, 'INSERT'); return ok(row);
  }
  if (name === 'resolve_due_coordination_requests') {
    keys(a, 'p_group_id'); return fail('permission denied for function resolve_due_coordination_requests');
  }
  if (!['respond_to_coordination_request', 'override_coordination_request', 'resolve_coordination_request_deadline', 'cancel_coordination_request'].includes(name)) return undefined;
  keys(a, ['respond_to_coordination_request', 'override_coordination_request'].includes(name) ? 'p_request_id p_option_id' : 'p_request_id');
  if (name === 'resolve_coordination_request_deadline') return fail('permission denied for function resolve_coordination_request_deadline');
  const request = b.tables.coordination_requests.find(r => r.id === a.p_request_id);
  if (!request) return fail('request_not_found', 'P0002');
  const m = member(b, request.group_id, userId);
  if (!m || request.subgroup_id != null && m.subgroup_id !== request.subgroup_id && m.role !== 'leader') return fail('not_member');
  if (name !== 'respond_to_coordination_request' && !scopeAllowed(b, request.group_id, request.subgroup_id, userId)) return fail('leader_required');
  if (name === 'cancel_coordination_request') { if (request.status === 'open') { request.status = 'cancelled'; request.updated_at = iso(b); b.publish('coordination_requests', request); } return ok(request); }
  if (request.status !== 'open' || Date.parse(request.deadline) <= b.now) return fail('request_closed', 'P0001');
  if (!request.options.some(o => o.id === a.p_option_id)) return fail('invalid_option', '22023');
  if (name === 'override_coordination_request') return resolve(b, request, userId, a.p_option_id, 'organizer_override');
  let response = b.tables.coordination_responses.find(r => r.request_id === request.id && r.user_id === userId);
  const existing = Boolean(response);
  if (!response) { response = { id: randomUUID(), request_id: request.id, user_id: userId }; b.tables.coordination_responses.push(response); }
  Object.assign(response, { option_id: a.p_option_id, responded_at: iso(b), updated_at: iso(b) });
  b.publish('coordination_responses', response, existing ? 'UPDATE' : 'INSERT'); return ok(response);
}

function processDue(b) {
  return b.tables.coordination_requests.filter(r => r.status === 'open' && Date.parse(r.deadline) <= b.now).sort((a, c) => a.deadline.localeCompare(c.deadline)).slice(0, 100).map(r => deadline(b, r, r.created_by).data);
}
module.exports = { execute, processDue };
