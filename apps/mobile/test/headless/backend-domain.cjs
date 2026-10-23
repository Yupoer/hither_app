const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const schemas = {
  profiles: { fields: 'id nickname avatar avatar_color pro created_at pro_plan pro_purchased_at pro_expires_at anonymous_expires_at preferences onboarding', write: 'nickname avatar avatar_color preferences onboarding', owner: 'id', modes: ['select', 'update', 'upsert'], conflict: 'id' },
  memberships: { fields: 'group_id user_id role status solo subgroup_id created_at', modes: ['select', 'delete'] },
  groups: { fields: 'id name invite_code avatar avatar_color created_by created_at journey_status active_destination_id journey_started_at straggler_alerts straggler_threshold_m trip_days departure_date accommodation_auto_add', write: 'avatar avatar_color journey_status straggler_alerts straggler_threshold_m', modes: ['select', 'update'] },
  itinerary_items: { fields: 'id group_id title address latitude longitude position day meet_at meet_red_minutes subgroup_id closed_at closed_by_session_id emoji marker_color kind stay_anchor provider_place_id', write: 'emoji marker_color meet_at meet_red_minutes', modes: ['select', 'update'] },
  subgroups: { fields: 'id group_id name mode leader_id parent_subgroup_id', modes: ['select'] },
  subgroup_invites: { fields: 'id group_id subgroup_id inviter_id invitee_id status created_at', modes: ['select'] },
  member_locations: { fields: 'group_id user_id latitude longitude captured_at updated_at tracking_mode source navigation_session_id sequence', owner: 'user_id', modes: ['select', 'upsert'], conflict: 'group_id,user_id' },
  member_privacy_settings: { fields: 'user_id sharing_enabled local_navigation_enabled updated_at', owner: 'user_id', modes: ['select', 'upsert'] },
  notification_preferences: { fields: 'user_id add_gathering leader_commands follower_requests journey arrival updated_at', owner: 'user_id', modes: ['select', 'upsert'], conflict: 'user_id' },
  account_favorite_places: { fields: 'id user_id title address latitude longitude lat_norm lng_norm title_norm created_at updated_at', owner: 'user_id', modes: ['select', 'upsert', 'delete'], conflict: 'user_id,title_norm,lat_norm,lng_norm' },
  daily_accommodations: { fields: 'id group_id stay_date title address latitude longitude source_destination_id created_at updated_at', modes: ['select'] },
  destination_arrivals: { fields: 'id group_id destination_id user_id arrived_at navigation_session_id occurred_at source marked_by corrected_by corrected_at', modes: ['select'] },
  gather_point_requests: { fields: 'id group_id subgroup_id requester_id items status created_at resolved_at resolved_by', modes: ['select'] },
  coordination_requests: { fields: 'id group_id subgroup_id created_by subject subject_kind options deadline policy default_outcome status resolved_outcome resolution_source resolved_at resolved_by applied_operation_id created_at updated_at', modes: ['select'] },
  coordination_responses: { fields: 'id request_id user_id option_id responded_at updated_at', modes: ['select'] },
  itinerary_operations: { fields: 'id group_id subgroup_id version operation_type payload source_request_id created_by created_at', modes: ['select'] },
  navigation_sessions: { fields: 'id group_id scope_subgroup_id destination_id destination_name destination_latitude destination_longitude arrival_radius_m started_by request_id started_at expires_at status version navigation_member_states', modes: ['select'] },
  navigation_member_states: { fields: 'navigation_session_id user_id local_status detail latest_distance_m latest_accuracy_m live_activity_id acknowledged_at arrived_at updated_at', modes: ['select'] },
  push_tokens: { fields: 'user_id device_id token platform updated_at', owner: 'user_id', modes: ['upsert'], conflict: 'user_id,token' },
  device_live_activity_tokens: { fields: 'user_id device_id push_to_start_token live_activities_enabled accent_hex updated_at', owner: 'user_id', modes: ['select', 'upsert', 'update', 'delete'], conflict: 'user_id,device_id' },
  live_activity_sessions: { fields: 'user_id device_id activity_id group_id destination_id push_token accent_hex initial_distance_m current_distance_m eta_seconds travel_mode last_progress_bucket updated_at', owner: 'user_id', modes: ['upsert', 'update', 'delete'], conflict: 'user_id,group_id' },
  metric_payloads: { fields: 'id user_id device_id kind payload received_at', owner: 'user_id', modes: ['insert'] },
  performance_events: { fields: 'id user_id session_id occurred_at event_type operation payload', owner: 'user_id', modes: ['upsert'], conflict: 'id' },
  visited_waypoints: { fields: 'id user_id group_id destination_id name latitude longitude arrived_at', modes: ['select', 'insert', 'delete'] },
  core_entity_versions: { fields: 'group_id entity_type entity_id entity_version state', modes: ['select'] },
  commands: { fields: 'id group_id sender_id type message latitude longitude expires_at created_at', modes: ['select'] },
  group_alerts: { fields: 'id group_id kind sender_id member_id member_name distance_m created_at', modes: ['select'] },
};
const ok = data => ({ data: structuredClone(data), error: null });
const fail = (message, code = '42501') => ({ data: null, error: { message, code } });
const iso = b => new Date(b.now).toISOString();
function anonymousExpired(b, actor) {
  if (!b.authUsers?.get(actor)?.is_anonymous) return false;
  const firstJoin = Math.min(...b.memberships.filter(m => m.user_id === actor).map(m => Date.parse(m.created_at)).filter(Number.isFinite));
  const expires = Date.parse(b.profiles.get(actor)?.anonymous_expires_at) || firstJoin + 14 * 86400000;
  return expires <= b.now;
}
const member = (b, group, actor) => anonymousExpired(b, actor) ? undefined : b.memberships.find(m => m.group_id === group && m.user_id === actor);
const leader = (b, group, actor) => member(b, group, actor)?.role === 'leader';
const keys = (args, expected) => assert.deepEqual(Object.keys(args ?? {}).sort(), expected.split(' ').filter(Boolean).sort(), 'RPC argument contract');

function initialize(b, { LEADER, PEER }) {
  b.profiles = new Map([LEADER, PEER].map((id, index) => [id, { id, nickname: index ? 'Peer' : 'Leader', created_at: iso(b), preferences: {}, pro: false }]));
  b.memberships.forEach(m => { if (m.role === 'member') m.role = 'follower'; m.solo = false; m.subgroup_id = null; m.created_at = iso(b); });
  b.tables = Object.fromEntries(Object.keys(schemas).map(name => [name, []]));
  b.premium = new Map();
  b.wallets = new Map();
  b.rewardSessions = new Map();
  b.redemptions = new Map();
  b.redemptionBindings = new Map();
  b.promoCodes = new Map();
  b.promoRedemptions = new Set();
  b.unavailableProducts = new Set();
  b.feedback = [];
  b.diagnostics = new Map();
  b.locationRefreshes = [];
  b.locationRefreshPending = new Map();
  b.locationRefreshAcks = new Map();
  b.verifiedPurchases = new Map();
  b.purchaseLedger = new Map();
  b.notificationOutbox = [];
  b.arrivalEvents = [];
  b.sessionHistory = new Map();
  b.failures = [];
  require('./backend-auth.cjs').initialize(b, { LEADER, PEER });
}

function tableRows(b, name) {
  if (name === 'profiles') return [...b.profiles.values()];
  if (name === 'groups') return [...b.groups.values()];
  if (name === 'memberships') return b.memberships;
  if (name === 'itinerary_items') return b.itinerary;
  if (name === 'member_locations') return [...b.locations.values()];
  if (name === 'navigation_sessions') return [...b.sessions.values()];
  return b.tables[name];
}
function storeRows(b, name, rows) {
  if (name === 'profiles') b.profiles = new Map(rows.map(r => [r.id, r]));
  else if (name === 'groups') b.groups = new Map(rows.map(r => [r.id, r]));
  else if (name === 'memberships') b.memberships = rows;
  else if (name === 'itinerary_items') b.itinerary = rows;
  else if (name === 'member_locations') b.locations = new Map(rows.map(r => [`${r.group_id}:${r.user_id}`, r]));
  else b.tables[name] = rows;
}

function executeTable(b, operation) {
  const { name, steps, userId } = operation;
  const schema = schemas[name];
  if (!schema) return undefined;
  const fields = schema.fields.split(' ');
  const mode = steps.find(s => ['insert', 'upsert', 'update', 'delete'].includes(s[0]))?.[0] ?? 'select';
  assert(schema.modes.includes(mode), `Unsupported ${name}.${mode}`);
  for (const [method, field] of steps) {
    assert(['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'in', 'is', 'gt', 'gte', 'lt', 'lte', 'order', 'limit', 'single', 'maybeSingle', 'abortSignal'].includes(method), `Unsupported builder ${method}`);
    if (['eq', 'in', 'is', 'gt', 'gte', 'lt', 'lte', 'order'].includes(method)) assert(fields.includes(field) || schema.fields === '*', `Unknown ${name} filter ${field}`);
    if (method === 'select' && field !== '*') for (const selected of field.split(',').map(v => v.trim())) {
      assert(selected === '*' || fields.includes(selected) || name === 'navigation_sessions' && selected === 'navigation_member_states(user_id)', `Unknown ${name} selection ${selected}`);
    }
  }
  const mutation = steps.find(s => s[0] === mode);
  if (mutation && mode !== 'select' && mode !== 'delete') for (const input of Array.isArray(mutation[1]) ? mutation[1] : [mutation[1]]) {
    for (const field of Object.keys(input)) assert(fields.includes(field), `Unknown ${name} write ${field}`);
    if (mode === 'update' && schema.write) for (const field of Object.keys(input)) assert(schema.write.split(' ').includes(field), `Forbidden ${name} write ${field}`);
    if (name === 'profiles' && mode === 'upsert') for (const field of Object.keys(input)) assert(field === 'id' || schema.write.split(' ').includes(field), `Forbidden profiles write ${field}`);
  }
  const fault = require('./backend-faults.cjs').take(b, operation, mode);
  if (fault) return fault;
  const filters = steps.filter(s => ['eq', 'in', 'is', 'gt', 'gte', 'lt', 'lte'].includes(s[0]));
  const matches = row => filters.every(([op, field, value]) => op === 'in' ? value.includes(row[field]) : op === 'eq' ? row[field] === value : op === 'is' ? (row[field] ?? null) === value : op === 'gt' ? row[field] > value : op === 'gte' ? row[field] >= value : op === 'lt' ? row[field] < value : row[field] <= value);
  let all = tableRows(b, name);
  let rows = all.filter(matches);
  if (schema.owner && name !== 'profiles' && mode === 'select') rows = rows.filter(row => row[schema.owner] === userId);
  if (name === 'profiles' && mode === 'select') rows = rows.filter(p => p.id === userId || b.memberships.some(m => m.user_id === userId && b.memberships.some(n => n.group_id === m.group_id && n.user_id === p.id)));
  if (name === 'subgroup_invites') rows = rows.filter(r => r.invitee_id === userId || r.inviter_id === userId);
  if (name === 'coordination_responses') rows = rows.filter(r => member(b, b.tables.coordination_requests.find(q => q.id === r.request_id)?.group_id, userId));
  if (name === 'navigation_member_states') rows = rows.filter(r => member(b, b.sessions.get(r.navigation_session_id)?.group_id, userId));
  if (name === 'visited_waypoints') rows = rows.filter(r => r.user_id === userId || member(b, r.group_id, userId));
  if (['groups', 'memberships', 'itinerary_items', 'subgroups', 'daily_accommodations', 'member_locations', 'coordination_requests', 'itinerary_operations', 'destination_arrivals', 'gather_point_requests', 'navigation_sessions', 'core_entity_versions', 'commands', 'group_alerts'].includes(name)) {
    rows = rows.filter(r => name === 'memberships' && r.user_id === userId || member(b, name === 'groups' ? r.id : r.group_id, userId));
  }
  if (mode !== 'select') {
    if (schema.owner && ['update', 'delete'].includes(mode) && !filters.some(s => s[0] === 'eq' && s[1] === schema.owner && s[2] === userId)) return fail('owner_required');
    if (name === 'visited_waypoints' && mode === 'delete' && rows.some(r => r.user_id !== userId && !leader(b, r.group_id, userId))) return fail('owner_required');
    if (name === 'memberships' && !filters.some(s => s[0] === 'eq' && s[1] === 'user_id' && s[2] === userId)) return fail('owner_required');
    if (name === 'groups' && rows.some(r => !leader(b, r.id, userId))) return fail('leader_required');
    if (name === 'itinerary_items' && rows.some(r => !require('./backend-workflows.cjs').scopeAllowed(b, r.group_id, r.subgroup_id, userId))) return fail('leader_required');
    if (mode === 'delete') {
      all = all.filter(row => !rows.includes(row));
      rows.forEach(row => b.emit({ table: name, eventType: 'DELETE', new: {}, old: structuredClone(row), commit_timestamp: iso(b) }));
    } else {
      const inputs = Array.isArray(mutation[1]) ? mutation[1] : [mutation[1]];
      if (mode !== 'update') rows = [];
      for (const input of inputs) {
        if (schema.owner && Object.hasOwn(input, schema.owner) && input[schema.owner] !== userId) return fail('owner_mismatch');
        if (mode === 'upsert') {
          const conflict = mutation[2]?.onConflict ?? schema.conflict ?? schema.owner;
          assert(conflict && (!mutation[2]?.onConflict || !schema.conflict || conflict === schema.conflict), `Unknown ${name} conflict`);
          const found = all.find(row => conflict.split(',').every(key => row[key] === input[key]));
          if (found) { if (!mutation[2]?.ignoreDuplicates) Object.assign(found, input); rows.push(found); }
          else { const row = { id: randomUUID(), created_at: iso(b), ...structuredClone(input) }; all.push(row); rows.push(row); }
        } else if (mode === 'insert') {
          if (input.id && all.some(row => row.id === input.id)) return fail('duplicate key', '23505');
          if (name === 'visited_waypoints' && (input.user_id !== userId || !member(b, input.group_id, userId))) return fail('not_member');
          const row = { id: randomUUID(), created_at: iso(b), ...(name === 'visited_waypoints' ? { arrived_at: iso(b) } : {}), ...structuredClone(input) }; all.push(row); rows.push(row);
        } else rows.forEach(row => Object.assign(row, structuredClone(input)));
      }
      rows.forEach(row => b.publish(name, row, mode === 'update' ? 'UPDATE' : 'INSERT'));
    }
    storeRows(b, name, all);
    if (name === 'member_privacy_settings') for (const row of rows) if (!row.sharing_enabled) {
      for (const [key, location] of b.locations) if (location.user_id === row.user_id) b.locations.delete(key);
    }
  }
  for (const [, field, opts] of steps.filter(s => s[0] === 'order').reverse()) rows.sort((a, c) => (a[field] > c[field] ? 1 : a[field] < c[field] ? -1 : 0) * (opts?.ascending === false ? -1 : 1));
  const limit = steps.find(s => s[0] === 'limit')?.[1];
  if (limit !== undefined) rows = rows.slice(0, limit);
  const select = steps.find(s => s[0] === 'select');
  if (mode !== 'select' && !select) return ok(null);
  if (select && select[1] !== '*') rows = rows.map(row => {
    const selected = select[1].split(',').map(v => v.trim());
    return { ...(selected.includes('*') ? row : {}), ...Object.fromEntries(selected.filter(field => field !== '*').map(field => field === 'navigation_member_states(user_id)' ? ['navigation_member_states', row.navigation_member_states ?? []] : [field, row[field] ?? null])) };
  });
  if (steps.some(s => s[0] === 'single' || s[0] === 'maybeSingle')) {
    if (rows.length > 1 || rows.length === 0 && steps.some(s => s[0] === 'single')) return fail('JSON object requested, multiple (or no) rows returned', 'PGRST116');
    return ok(rows[0] ?? null);
  }
  return ok(rows);
}

function projection(b, userId, groupId) {
  const personal = b.premium.get(userId);
  const active = grant => Boolean(grant && grant.status === 'active' && (!grant.expires_at || Date.parse(grant.expires_at) > b.now));
  return { ok: active(personal), ...(!active(personal) ? { error: 'subscription_required' } : {}), personalPremiumActive: active(personal), teamPremiumActive: groupId ? active(b.teamPremium?.get(groupId)) || b.memberships.some(m => m.group_id === groupId && active(b.premium.get(m.user_id))) : false,
    status: active(personal) ? 'active' : personal?.status ?? 'none', productId: personal?.product_id ?? null, expiresAt: personal?.expires_at ?? null,
    sourceVersion: personal?.source_version ?? null, entitlementVersion: personal?.entitlement_version ?? 1, lastSyncedAt: iso(b) };
}

function execute(b, operation) {
  const { kind, name, userId, args = {}, steps = [] } = operation;
  if (kind === 'auth') return require('./backend-auth.cjs').execute(b, operation);
  if (kind === 'table') return executeTable(b, operation);
  if (kind === 'rpc') assert(steps.every(step => name === 'ingest_diagnostic_batch' && step[0] === 'abortSignal'), `Unexpected RPC builder steps ${name}`);
  const fault = require('./backend-faults.cjs').take(b, operation);
  if (fault) return fault;
  const workflow = require('./backend-workflows.cjs').execute(b, operation);
  if (workflow !== undefined) return workflow;
  const request = require('./backend-requests.cjs').execute(b, operation);
  if (request !== undefined) return request;
  const store = require('./backend-store.cjs').execute(b, operation);
  if (store !== undefined) return store;
  if (kind !== 'rpc') return undefined;
  if (name === 'create_group') {
    keys(args, 'p_name');
    if (!userId) return fail('not_authenticated');
    if (anonymousExpired(b, userId)) return fail('anonymous access expired', 'P0401');
    if (typeof args.p_name !== 'string' || !args.p_name.trim()) return fail('invalid_name', '22023');
    const group = { id: randomUUID(), name: args.p_name.trim(), invite_code: randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase(), created_by: userId, created_at: iso(b), journey_status: 'paused', active_destination_id: null, journey_started_at: null, trip_days: 1, departure_date: iso(b).slice(0, 10), accommodation_auto_add: true };
    b.groups.set(group.id, group);
    b.memberships.push({ group_id: group.id, user_id: userId, role: 'leader', status: 'active', solo: false, subgroup_id: null, created_at: iso(b) });
    if (b.authUsers?.get(userId)?.is_anonymous && b.profiles.has(userId) && !b.profiles.get(userId).anonymous_expires_at) b.profiles.get(userId).anonymous_expires_at = new Date(b.now + 14 * 86400000).toISOString();
    b.publish('groups', group, 'INSERT');
    return ok(group);
  }
  if (name === 'join_group') {
    keys(args, 'p_code');
    if (!userId) return fail('not_authenticated');
    if (anonymousExpired(b, userId)) return fail('anonymous access expired', 'P0401');
    const group = [...b.groups.values()].find(g => g.invite_code === args.p_code.trim().toUpperCase());
    if (!group) return fail('invalid_invite_code', 'P0002');
    if (!member(b, group.id, userId)) {
      if (b.memberships.filter(m => m.group_id === group.id).length >= 5) return b.authUsers?.get(group.created_by)?.is_anonymous ? fail('leader registration required before adding member 6', 'P0406') : fail('member_limit', 'P0003');
      const row = { group_id: group.id, user_id: userId, role: 'follower', status: 'active', solo: false, subgroup_id: null, created_at: iso(b) };
      b.memberships.push(row); b.publish('memberships', row, 'INSERT');
      if (b.authUsers?.get(userId)?.is_anonymous && b.profiles.has(userId) && !b.profiles.get(userId).anonymous_expires_at) b.profiles.get(userId).anonymous_expires_at = new Date(b.now + 14 * 86400000).toISOString();
    }
    return ok(group);
  }
  if (name === 'get_premium_projection') {
    keys(args, 'p_group_id');
    if (args.p_group_id && !member(b, args.p_group_id, userId)) return fail('not_member');
    return ok(projection(b, userId, args.p_group_id));
  }
  if (name === 'get_trip_entitlement' || name === 'restore_entitlements') {
    keys(args, 'p_group_id');
    if (args.p_group_id && !member(b, args.p_group_id, userId)) return ok({ ok: false, error: 'not_member' });
    const premium = projection(b, userId, args.p_group_id);
    const trip = { ok: true, is_premium: premium.teamPremiumActive, status: premium.teamPremiumActive ? 'active' : 'none', plan_code: premium.teamPremiumActive ? 'premium_subscription' : 'free', member_count: b.memberships.filter(m => m.group_id === args.p_group_id).length, member_limit: 5, destination_limit: premium.teamPremiumActive ? null : 5 };
    return ok(name === 'get_trip_entitlement' ? trip : { ...trip, user_pro: premium.personalPremiumActive, trip });
  }
  if (name === 'get_or_create_premium_app_account_token') { keys(args, ''); return ok(userId); }
  if (name === 'apply_verified_purchase') { keys(args, 'p_group_id p_transaction_id p_product_id'); return fail('permission denied for function apply_verified_purchase'); }
  if (name === 'kick_group_member') {
    keys(args, 'p_group_id p_user_id');
    if (!leader(b, args.p_group_id, userId) || args.p_user_id === userId) return fail('leader_required');
    b.memberships = b.memberships.filter(m => !(m.group_id === args.p_group_id && m.user_id === args.p_user_id));
    const group = b.groups.get(args.p_group_id); group.invite_code = randomUUID().slice(0, 6).toUpperCase(); b.publish('groups', group); return ok(group.invite_code);
  }
  return undefined;
}

module.exports = { initialize, execute, schemas, ok, fail, keys, member, leader, iso, projection, anonymousExpired };
