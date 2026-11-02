const assert = require('node:assert/strict');

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const LEADER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PEER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DESTINATION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EPOCH = Date.parse('2026-10-22T00:00:00Z');
const domain = require('./backend-domain.cjs');

class Backend {
  constructor(emit) {
    this.emit = emit;
    this.now = EPOCH;
    this.trace = [];
    this.locations = new Map();
    this.locationEvents = new Map();
    this.locationReceipts = new Map();
    this.receipts = new Map();
    this.sessions = new Map();
    this.versions = new Map();
    this.groups = new Map([[GROUP_ID, {
      id: GROUP_ID, name: 'Headless team', invite_code: 'TEST42', created_by: LEADER,
      created_at: new Date(EPOCH).toISOString(), journey_status: 'paused', active_destination_id: null,
      trip_days: 1, departure_date: '2026-10-22',
    }]]);
    this.memberships = [{ group_id: GROUP_ID, user_id: LEADER, role: 'leader', status: 'active' },
      { group_id: GROUP_ID, user_id: PEER, role: 'member', status: 'active' }];
    this.itinerary = [{ id: DESTINATION, group_id: GROUP_ID, title: 'Meeting point', latitude: 25.04,
      longitude: 121.53, position: 0, day: 1, kind: 'destination', closed_at: null }];
    domain.initialize(this, { LEADER, PEER });
  }
  snapshot(groupId) {
    return structuredClone({ group: this.groups.get(groupId), memberships: this.memberships.filter(m => m.group_id === groupId),
      profiles: [...this.profiles.values()].filter(p => this.memberships.some(m => m.group_id === groupId && m.user_id === p.id)).map(domain.publicProfile),
      locations: [...this.locations.values()].filter(l => l.group_id === groupId && this.tables.member_privacy_settings.find(p => p.user_id === l.user_id)?.sharing_enabled !== false),
      location_sharing: this.memberships.filter(m => m.group_id === groupId).map(m => ({ user_id: m.user_id, sharing_enabled: this.tables.member_privacy_settings.find(p => p.user_id === m.user_id)?.sharing_enabled !== false })), itinerary: this.itinerary.filter(d => d.group_id === groupId).sort((a, c) => a.position - c.position),
      subgroups: this.tables.subgroups.filter(s => s.group_id === groupId), entity_versions: this.tables.core_entity_versions.filter(r => r.group_id === groupId),
      generated_at: new Date(this.now).toISOString(), realtime_revision: new Date(this.now).toISOString() });
  }
  publish(table, row, eventType = 'UPDATE', old = {}) {
    this.emit({ table, eventType, new: structuredClone(row), old: structuredClone(old), commit_timestamp: new Date(this.now).toISOString() });
  }
  configureAuth(fixtures) { require('./backend-auth.cjs').configure(this, fixtures); }
  failNext(match, error) { require('./backend-faults.cjs').failNext(this, match, error); }
  execute(deviceId, operation) {
    const { kind, name, args, steps, userId } = operation;
    const trace = structuredClone({ deviceId, ...operation, at: this.now });
    this.trace.push(trace);
    const ok = data => {
      const result = structuredClone({ data, error: null });
      trace.result = structuredClone(result);
      return result;
    };
    const additional = domain.execute(this, operation);
    if (additional !== undefined) {
      trace.result = structuredClone(additional);
      return additional;
    }
    if (kind === 'rpc') {
      assert.deepEqual(steps, [], `Unexpected RPC builder steps ${name}`);
      if (name === 'get_group_recovery_snapshot' || name === 'get_group_public_recovery_snapshot') {
        assert.deepEqual(Object.keys(args), ['p_group_id']);
        if (!userId) return domain.fail('not authenticated', '28000');
        if (!domain.member(this, args.p_group_id, userId)) return domain.fail('not_member');
        return ok(this.snapshot(args.p_group_id));
      }
      if (name === 'sync_group') {
        const result = require('./backend-sync.cjs').execute(this, operation);
        trace.result = structuredClone(result);
        return result;
      }
      if (name === 'ingest_location_batch') return ok(require('./backend-location.cjs').ingest(this, operation));
      if (name === 'apply_core_operation_v3') return require('./backend-core.cjs').apply(this, operation);
      throw new Error(`Unsupported backend RPC ${name}`);
    }
    assert.equal(kind, 'table', 'Unknown SDK request kind');
    throw new Error(`Unsupported backend table ${name} ${JSON.stringify(steps)}`);
  }
}
module.exports = { Backend, GROUP_ID, LEADER, PEER, DESTINATION, EPOCH };
