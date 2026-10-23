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
      profiles: [...this.profiles.values()].filter(p => this.memberships.some(m => m.group_id === groupId && m.user_id === p.id)),
      locations: [...this.locations.values()].filter(l => l.group_id === groupId),
      location_sharing: this.tables.member_privacy_settings, itinerary: this.itinerary.filter(d => d.group_id === groupId),
      subgroups: this.tables.subgroups.filter(s => s.group_id === groupId), entity_versions: [],
      generated_at: new Date(this.now).toISOString(), realtime_revision: new Date(this.now).toISOString() });
  }
  publish(table, row, eventType = 'UPDATE') {
    this.emit({ table, eventType, new: structuredClone(row), old: {}, commit_timestamp: new Date(this.now).toISOString() });
  }
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
      if (name === 'get_group_recovery_snapshot') {
        assert.deepEqual(Object.keys(args), ['p_group_id']);
        assert(this.memberships.some(m => m.group_id === args.p_group_id && m.user_id === userId), 'Fixture membership required');
        return ok(this.snapshot(args.p_group_id));
      }
      if (name === 'ingest_location_batch') {
        assert.deepEqual(Object.keys(args), ['p_events']);
        const acceptedIds = [];
        const rejected = [];
        for (const event of args.p_events) {
          assert.deepEqual(Object.keys(event).sort(), ['actorId', 'id', 'groupId', 'navigationSessionId', 'capturedAt',
            'coords', 'trackingMode', 'source', 'sequence'].sort());
          for (const key of Object.keys(event.coords)) assert(['latitude', 'longitude', 'accuracy', 'speed', 'course'].includes(key));
          assert.equal(event.actorId, userId, 'Wire actor ownership');
          assert(this.memberships.some(m => m.group_id === event.groupId && m.user_id === userId), 'Fixture membership required');
          assert(Number.isSafeInteger(event.sequence) && event.sequence > 0, 'Integer wire sequence');
          const row = { group_id: event.groupId, user_id: userId, latitude: event.coords.latitude,
            longitude: event.coords.longitude, captured_at: new Date(event.capturedAt).toISOString(),
            updated_at: new Date(this.now).toISOString(), tracking_mode: event.trackingMode, source: event.source,
            navigation_session_id: event.navigationSessionId, sequence: event.sequence };
          const key = `${event.groupId}:${userId}`;
          const previous = this.locations.get(key);
          const priorEvent = this.locationEvents.get(event.id);
          if (priorEvent) {
            if (priorEvent.actorId === userId && priorEvent.groupId === event.groupId
              && priorEvent.capturedAt === event.capturedAt && priorEvent.coords.latitude === event.coords.latitude
              && priorEvent.coords.longitude === event.coords.longitude) acceptedIds.push(event.id);
            else rejected.push({ id: event.id, reason: 'invalid_event' });
            continue;
          }
          if (previous && event.capturedAt <= Date.parse(previous.captured_at)) {
            rejected.push({ id: event.id, reason: 'stale_sample' });
            continue;
          }
          this.locationEvents.set(event.id, structuredClone(event));
          this.locations.set(key, row);
          this.publish('member_locations', row);
          acceptedIds.push(event.id);
        }
        return ok({ acceptedIds, rejected });
      }
      if (name === 'apply_core_operation_v3') {
        assert.deepEqual(Object.keys(args).sort(), ['p_operation_id', 'p_group_id', 'p_actor_id', 'p_entity_type', 'p_entity_id',
          'p_entity_version', 'p_operation_type', 'p_payload', 'p_sequence', 'p_dependency_ids', 'p_created_at'].sort());
        assert.equal(args.p_actor_id, userId);
        assert(this.memberships.some(m => m.group_id === args.p_group_id && m.user_id === userId && m.role === 'leader'));
        assert(Number.isSafeInteger(args.p_sequence) && args.p_sequence > 0);
        const existing = this.receipts.get(args.p_operation_id);
        if (existing) return ok({ ...existing, status: 'duplicate' });
        for (const dependency of args.p_dependency_ids) assert(this.receipts.has(dependency), `Missing dependency ${dependency}`);
        const group = this.groups.get(args.p_group_id);
        assert(group, 'Unknown group');
        const payload = args.p_payload;
        const versionKey = `${args.p_group_id}:${args.p_entity_type}`;
        const version = (this.versions.get(versionKey) ?? 0) + 1;
        let entity;
        let effects;
        const operationType = args.p_operation_type;
        if (operationType === 'start_gathering') {
          assert.equal(args.p_entity_type, 'active_gathering');
          assert.equal(payload.action, 'start');
          assert.equal(payload.subgroupId, null, 'Only main team fixture is enabled');
          const destination = this.itinerary.find(d => d.id === payload.activeDestinationId && d.group_id === args.p_group_id);
          assert(destination && destination.day != null && !destination.closed_at);
          const session = { id: args.p_operation_id, group_id: args.p_group_id, scope_subgroup_id: null,
            destination_id: destination.id, destination_name: destination.title,
            destination_latitude: destination.latitude, destination_longitude: destination.longitude,
            arrival_radius_m: 50, started_by: userId, request_id: payload.navigationRequestId,
            started_at: new Date(this.now).toISOString(), expires_at: new Date(this.now + 86400000).toISOString(),
            status: 'active', version: 1, navigation_member_states: this.memberships.map(m => ({ user_id: m.user_id })) };
          this.sessions.set(session.id, session);
          Object.assign(group, { journey_status: 'going', active_destination_id: destination.id, journey_started_at: session.started_at });
          entity = { groupId: group.id, sessionId: session.id, navigationSessionId: session.id,
            journeyPhase: 'en_route', journeyStatus: 'going', scope: 'team', status: 'active',
            destinationId: destination.id, activeDestinationId: destination.id,
            pointStatuses: { [destination.id]: 'en_route' }, phaseChangedAt: this.now, entityVersion: version, version: 1 };
          effects = { navigationSessionId: session.id, navigationSession: session };
          this.publish('navigation_sessions', session, 'INSERT');
          this.publish('groups', group);
        } else if (operationType === 'end_gathering') {
          assert.equal(payload.action, 'end');
          const session = this.sessions.get(payload.navigationSessionId);
          assert(session, `Unknown original session ${payload.navigationSessionId}`);
          session.status = 'cancelled';
          session.version++;
          Object.assign(group, { journey_status: 'paused', active_destination_id: null, journey_started_at: null });
          entity = { groupId: group.id, journeyPhase: 'staying', activeDestinationId: null,
            pointStatuses: { [session.destination_id]: 'pending' }, phaseChangedAt: this.now, entityVersion: version };
          effects = { navigationSessionId: session.id, navigationSession: session };
          this.publish('navigation_sessions', session);
          this.publish('groups', group);
        } else if (operationType === 'add_destination') {
          assert.equal(args.p_entity_type, 'itinerary');
          assert.equal(payload.kind, 'stop', 'Only ordinary stop fixtures are enabled');
          assert(payload.placement === undefined, 'Placement fixture is not enabled');
          const row = { id: payload.destinationId, group_id: group.id, title: payload.title, address: payload.address,
            latitude: payload.latitude, longitude: payload.longitude, day: payload.day, subgroup_id: payload.subgroupId,
            kind: payload.kind, stay_anchor: payload.stayAnchor, provider_place_id: payload.providerPlaceId,
            position: this.itinerary.filter(d => d.group_id === group.id).length, closed_at: null };
          this.itinerary.push(row);
          this.publish('itinerary_items', row, 'INSERT');
        } else if (operationType === 'delete_destination') {
          const row = this.itinerary.find(d => d.id === payload.destinationId && d.group_id === group.id);
          assert(row, 'Unknown destination');
          assert(![...this.sessions.values()].some(s => s.status === 'active' && s.destination_id === row.id), 'Active destination delete fixture is not enabled');
          this.itinerary = this.itinerary.filter(d => d !== row);
          this.emit({ table: 'itinerary_items', eventType: 'DELETE', new: {}, old: row, commit_timestamp: new Date(this.now).toISOString() });
        } else if (operationType === 'reorder_destinations') {
          for (const update of payload.updates) {
            const row = this.itinerary.find(d => d.id === update.id && d.group_id === group.id);
            assert(row, 'Unknown destination reorder');
            row.position = update.position;
            row.day = update.day;
            if (Object.hasOwn(update, 'meetAt')) row.meet_at = update.meetAt;
            if (Object.hasOwn(update, 'stayAnchor')) row.stay_anchor = update.stayAnchor;
          }
          this.itinerary.sort((a, b) => a.position - b.position);
          this.publish('itinerary_items', this.itinerary.find(d => d.group_id === group.id));
        } else throw new Error(`Unsupported core operation ${operationType}`);
        const receipt = { status: 'accepted', operation_id: args.p_operation_id, entity_version: version, entity, effects };
        this.versions.set(versionKey, version);
        this.receipts.set(args.p_operation_id, receipt);
        return ok(receipt);
      }
      throw new Error(`Unsupported backend RPC ${name}`);
    }
    assert.equal(kind, 'table', 'Unknown SDK request kind');
    const method = name => steps.filter(step => step[0] === name);
    const eq = field => method('eq').find(step => step[1] === field)?.[2];
    if (eq('group_id')) assert(this.memberships.some(m => m.group_id === eq('group_id') && m.user_id === userId), 'Fixture membership required');
    if (name === 'daily_accommodations') {
      assert.deepEqual(steps, [
        ['select', 'id, group_id, stay_date, title, address, latitude, longitude, source_destination_id, created_at, updated_at'],
        ['eq', 'group_id', eq('group_id')], ['order', 'stay_date', { ascending: true }],
      ]);
      assert(this.groups.has(eq('group_id')));
      return ok([]);
    }
    if (name === 'core_entity_versions') {
      assert.deepEqual(steps, [['select', 'group_id, entity_type, entity_id, entity_version, state'], ['eq', 'group_id', eq('group_id')]]);
      return ok([]);
    }
    if (name === 'navigation_sessions') {
      assert.deepEqual(steps, [['select', '*, navigation_member_states(user_id)'], ['eq', 'group_id', eq('group_id')],
        ['eq', 'status', 'active'], ['is', 'scope_subgroup_id', null], ['gt', 'expires_at', method('gt')[0]?.[2]],
        ['order', 'started_at', { ascending: false }], ['limit', 1], ['maybeSingle']]);
      return ok([...this.sessions.values()].find(row => row.group_id === eq('group_id') && row.status === 'active') ?? null);
    }
    if (name === 'navigation_member_states') {
      assert.deepEqual(steps, [['select', '*'], ['eq', 'navigation_session_id', eq('navigation_session_id')],
        ['eq', 'user_id', userId], ['maybeSingle']]);
      assert(this.sessions.has(eq('navigation_session_id')));
      return ok(null);
    }
    throw new Error(`Unsupported backend table ${name} ${JSON.stringify(steps)}`);
  }
}
module.exports = { Backend, GROUP_ID, LEADER, PEER, DESTINATION, EPOCH };
