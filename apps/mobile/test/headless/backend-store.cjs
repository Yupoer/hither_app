const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ok, fail, keys, member, leader, iso, projection } = require('./backend-domain.cjs');
const { scopeAllowed } = require('./backend-workflows.cjs');
const catalog = [
  ['team_premium_1d', 5, 'team_premium_days', 1], ['team_premium_3d', 12, 'team_premium_days', 3], ['team_premium_7d', 25, 'team_premium_days', 7],
  ['team_extra_points_3', 4, 'team_extra_points', 3], ['team_extra_points_10', 12, 'team_extra_points', 10], ['personal_live_activity_lifetime', 10, 'personal_live_activity_lifetime', 0],
].map(([code, price, kind, amount], i) => ({ code, display_name: code, scope: code.startsWith('personal') ? 'personal' : 'team', price_tokens: price, effect_json: { kind, ...(kind === 'team_premium_days' ? { days: amount } : kind === 'team_extra_points' ? { credits: amount } : {}) }, sort_order: (i + 1) * 10, active: true }));

function execute(b, { kind, name, args: a = {}, userId }) {
  if (kind !== 'rpc') return undefined;
  if (name === 'get_kml_import_quota') { keys(a, ''); return ok(Math.max(0, 5 - (b.importUsage?.get(userId) ?? 0))); }
  if (name === 'import_itinerary_batch') {
    keys(a, 'p_group_id p_subgroup_id p_day p_items');
    if (!scopeAllowed(b, a.p_group_id, a.p_subgroup_id, userId)) return fail('permission denied');
    b.importUsage ??= new Map(); const used = b.importUsage.get(userId) ?? 0;
    if (used >= 5) return fail('import_quota_exceeded', 'P0004');
    if (!Array.isArray(a.p_items) || !a.p_items.length || a.p_items.length > 500) return fail('invalid_items', '22023');
    for (const p of a.p_items) if (!p.title?.trim() || !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90 || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180) return fail('invalid_item', '22023');
    for (const p of a.p_items) require('./backend-core.cjs').addDestination(b, a.p_group_id, { ...p, day: a.p_day, subgroupId: a.p_subgroup_id });
    b.importUsage.set(userId, used + 1); return ok(a.p_items.length);
  }
  if (['add_itinerary_item', 'quick_add_itinerary_item'].includes(name)) {
    keys(a, 'p_group_id p_subgroup_id p_title p_address p_latitude p_longitude p_day p_kind p_stay_anchor');
    if (!scopeAllowed(b, a.p_group_id, a.p_subgroup_id, userId)) return fail('permission denied');
    const row = require('./backend-core.cjs').addDestination(b, a.p_group_id, { title: a.p_title, address: a.p_address, latitude: a.p_latitude, longitude: a.p_longitude, day: a.p_day, subgroupId: a.p_subgroup_id, kind: a.p_kind, stayAnchor: a.p_stay_anchor, ...(name.startsWith('quick') ? { placement: 'firstStop' } : {}) }); return ok(row.id);
  }
  if (name === 'report_straggler') {
    keys(a, 'p_group_id p_member_id p_distance_m');
    if (!leader(b, a.p_group_id, userId) || !member(b, a.p_group_id, a.p_member_id)) return fail('leader_required');
    const row = { id: randomUUID(), group_id: a.p_group_id, sender_id: userId, type: 'straggler', message: JSON.stringify({ member_id: a.p_member_id, distance_m: a.p_distance_m }), latitude: null, longitude: null, created_at: iso(b) };
    b.tables.commands.push(row); b.publish('commands', row, 'INSERT'); return ok(null);
  }
  if (name === 'request_group_location_refresh') {
    keys(a, 'p_group_id'); if (!member(b, a.p_group_id, userId)) return fail('not_member');
    const recent = b.locationRefreshes.find(r => r.group_id === a.p_group_id && r.requested_by === userId && b.now - Date.parse(r.requested_at) < 30000);
    if (recent) return ok({ accepted: false, retry_after_seconds: Math.ceil((30000 - b.now + Date.parse(recent.requested_at)) / 1000), recipient_ids: [], requested_at: recent.requested_at });
    const recipients = b.memberships.filter(m => m.group_id === a.p_group_id && m.user_id !== userId).map(m => m.user_id);
    const row = { group_id: a.p_group_id, requested_by: userId, requested_at: iso(b), recipient_ids: recipients, acknowledgements: [] };
    b.locationRefreshes.push(row); return ok({ accepted: true, retry_after_seconds: 30, recipient_ids: recipients, requested_at: row.requested_at });
  }
  if (name === 'list_my_pending_location_refreshes') {
    keys(a, ''); return ok(b.locationRefreshes.filter(r => r.recipient_ids.includes(userId) && !r.acknowledgements.includes(userId) && b.now - Date.parse(r.requested_at) < 120000).map(({ group_id, requested_by, requested_at }) => ({ group_id, requested_by, requested_at })));
  }
  if (name === 'ack_my_location_refresh' || name === 'get_group_location_refresh_acknowledgements') {
    keys(a, 'p_group_id p_requested_at'); if (!member(b, a.p_group_id, userId)) return fail('not_member');
    const row = b.locationRefreshes.find(r => r.group_id === a.p_group_id && r.requested_at === a.p_requested_at);
    if (name.startsWith('get')) return ok(row?.acknowledgements ?? []);
    if (!row || !row.recipient_ids.includes(userId)) return ok(false);
    if (!row.acknowledgements.includes(userId)) row.acknowledgements.push(userId); return ok(true);
  }
  if (name === 'get_store_snapshot') {
    keys(a, 'p_group_id'); const group = b.groups.get(a.p_group_id);
    const active = [...b.rewardSessions.values()].find(r => r.user_id === userId && ['active', 'verifying'].includes(r.status) && Date.parse(r.expires_at) > b.now);
    return ok({ ok: true, anonymous: false, registration_required: false, balance: b.wallets.get(userId) ?? 0, catalog,
      can_create_reward_session: !active, can_redeem: true, group_id: group?.id ?? null, group_name: group?.name ?? null,
      is_member: Boolean(member(b, group?.id, userId)), member_count: b.memberships.filter(m => m.group_id === group?.id).length,
      trip_premium: b.teamPremium?.get(group?.id) ?? null, extra_point_credits: b.pointCredits?.get(group?.id) ?? 0,
      live_activity_personal: b.liveUnlocks?.has(userId) ?? false, live_activity_effective: projection(b, userId, group?.id).teamPremiumActive || (b.liveUnlocks?.has(userId) ?? false), active_reward_session: active ?? null });
  }
  if (name === 'create_reward_session') {
    keys(a, 'p_platform'); assert(['ios', 'android'].includes(a.p_platform), 'Reward platform contract');
    const active = [...b.rewardSessions.values()].find(r => r.user_id === userId && ['active', 'verifying'].includes(r.status) && Date.parse(r.expires_at) > b.now);
    if (active) return ok({ ok: false, error: 'active_session_exists', session_ref: active.session_ref, expires_at: active.expires_at });
    const row = { user_id: userId, session_ref: randomUUID(), platform: a.p_platform, status: 'active', created_at: iso(b), expires_at: new Date(b.now + 600000).toISOString() };
    b.rewardSessions.set(row.session_ref, row); return ok({ ok: true, ...row, reward_amount: 1, reward_item: 'hither_token', ad_unit: `fixture-${a.p_platform}-reward` });
  }
  if (name === 'update_reward_session_status') {
    keys(a, 'p_session_ref p_status'); assert(['failed', 'verifying'].includes(a.p_status));
    const row = b.rewardSessions.get(a.p_session_ref);
    if (!row || row.user_id !== userId) return ok({ ok: false, error: 'not_found' });
    if (row.status === 'credited') return ok({ ok: true, status: row.status });
    row.status = a.p_status; return ok({ ok: true, status: row.status });
  }
  if (name === 'redeem_store_product') {
    keys(a, 'p_product_code p_group_id p_client_request_key');
    const product = catalog.find(p => p.code === a.p_product_code);
    if (!product) return ok({ ok: false, error: 'product_not_found' });
    if (product.scope === 'team' && !member(b, a.p_group_id, userId)) return ok({ ok: false, error: 'not_member' });
    const key = a.p_client_request_key && `${userId}:${a.p_client_request_key}`;
    if (key && b.redemptions.has(key)) return ok(b.redemptions.get(key));
    const balance = b.wallets.get(userId) ?? 0;
    if (balance < product.price_tokens) return ok({ ok: false, error: 'insufficient_balance', balance, price: product.price_tokens, shortfall: product.price_tokens - balance });
    b.wallets.set(userId, balance - product.price_tokens);
    const result = { ok: true, product_code: product.code, balance: b.wallets.get(userId), redemption_id: randomUUID(), started_at: iso(b), source: 'token_store' };
    if (product.effect_json.kind === 'team_extra_points') { b.pointCredits ??= new Map(); result.extra_point_credits = (b.pointCredits.get(a.p_group_id) ?? 0) + product.effect_json.credits; b.pointCredits.set(a.p_group_id, result.extra_point_credits); }
    else if (product.scope === 'personal') { b.liveUnlocks ??= new Set(); b.liveUnlocks.add(userId); result.live_activity_personal = true; }
    else { b.teamPremium ??= new Map(); const prior = b.teamPremium.get(a.p_group_id); result.stacked = Boolean(prior && Date.parse(prior.expires_at) > b.now); result.expires_at = new Date(Math.max(b.now, Date.parse(prior?.expires_at ?? '') || 0) + product.effect_json.days * 86400000).toISOString(); b.teamPremium.set(a.p_group_id, { status: 'active', expires_at: result.expires_at }); }
    if (key) b.redemptions.set(key, result); return ok(result);
  }
  if (name === 'redeem_promo_code') { keys(a, 'p_code p_group_id'); return ok({ success: false, error: 'invalid_code' }); }
  return undefined;
}

function creditReward(b, sessionRef) {
  const row = b.rewardSessions.get(sessionRef);
  assert(row && ['active', 'verifying', 'credited'].includes(row.status), 'External SSV requires an issued reward session');
  if (row.status === 'credited') return;
  assert(Date.parse(row.expires_at) > b.now, 'External SSV session expired');
  row.status = 'credited'; b.wallets.set(row.user_id, (b.wallets.get(row.user_id) ?? 0) + 1);
}
module.exports = { execute, creditReward };
