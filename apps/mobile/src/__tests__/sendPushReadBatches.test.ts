import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

type QueryResult = { data: unknown; error: Error | null };
type QueryResolver = (query: Query) => QueryResult | PromiseLike<QueryResult>;
type Handler = (request: Request) => Promise<Response>;
type Send = { kind: string; token: string; payload: Record<string, unknown> };

class Query implements PromiseLike<QueryResult> {
  columns = '';
  operation = 'select';
  filters: { column: string; value: unknown }[] = [];

  constructor(readonly table: string, private readonly execute: QueryResolver) {}

  select(columns: string) { this.columns = columns; return this; }
  eq(column: string, value: unknown) { this.filters.push({ column, value }); return this; }
  in(column: string, value: unknown) { return this.eq(column, value); }
  gt(column: string, value: unknown) { return this.eq(column, value); }
  not(column: string, _operator: string, value: unknown) { return this.eq(column, value); }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { return this; }
  update() { this.operation = 'update'; return this; }
  delete() { this.operation = 'delete'; return this; }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve().then(() => this.execute(this)).then(onfulfilled, onrejected);
  }
}

function deferred() {
  let resolveResponse: (value: QueryResult) => void = () => { throw new Error('not initialized'); };
  const promise = new Promise<QueryResult>(resolve => { resolveResponse = resolve; });
  return { promise, resolve: resolveResponse };
}

const members = [
  { user_id: 'leader', role: 'leader', subgroup_id: null, solo: false, status: 'active' },
  { user_id: 'peer', role: 'follower', subgroup_id: null, solo: false, status: 'active' },
];
const liveSession = {
  user_id: 'peer', group_id: 'group', destination_id: 'destination', push_token: 'activity-token',
  initial_distance_m: 1_000, current_distance_m: 320.4, eta_seconds: 120,
  travel_mode: 'walk', last_progress_bucket: 14, accent_hex: '#123456',
  updated_at: '2026-01-01T10:00:00.000Z',
};
const livePayload = {
  category: 'live_activity', group_id: 'group', sender_id: 'leader',
  target_user_id: 'peer', destination_id: 'destination', title: 'Station',
};
const navigationPayload = {
  ...livePayload, category: 'navigation_session', session_id: 'session', status: 'active', version: 1,
};
const arrivalPayload = { ...livePayload, category: 'arrival', member_name: 'Leader' };
const ok = (data: unknown): QueryResult => ({ data, error: null });

function responseFor(query: Query): QueryResult {
  if (query.operation !== 'select') throw new Error(`unexpected ${query.operation} on ${query.table}`);
  switch (query.table) {
    case 'memberships': return ok(members);
    case 'profiles': return query.columns === 'nickname'
      ? ok({ nickname: 'Leader' }) : ok([{ id: 'leader', avatar: '🦊' }, { id: 'peer', avatar: '🐑' }]);
    case 'notification_preferences': return ok([]);
    case 'push_tokens': return ok([]);
    case 'live_activity_sessions': return ok(query.columns === 'user_id' ? [] : [liveSession]);
    case 'navigation_sessions': return query.columns.includes('scope_key')
      ? ok({ id: 'session', scope_key: 'main', scope_subgroup_id: null, origin: 'manual' })
      : ok({ id: 'session', status: 'active', version: 1 });
    case 'device_live_activity_tokens': return ok([
      { user_id: 'peer', device_id: 'device', push_to_start_token: 'start-token', accent_hex: '#654321' },
    ]);
    case 'groups': return ok({ name: 'River Walk' });
    case 'itinerary_items': return query.columns === 'title'
      ? ok({ title: 'Station' }) : ok([{ id: 'destination', title: 'Station' }]);
    case 'destination_arrivals': return ok([{ destination_id: 'destination', user_id: 'leader' }]);
    default: throw new Error(`unexpected table ${query.table}`);
  }
}

const edgeDirectory = resolve(__dirname, '../../../../supabase/functions/send-push');
const compiledModules = new Map<string, string>();
const messages = jest.requireActual<Record<string, unknown>>('../../../../supabase/functions/send-push/messages.ts');

function loadHandler(resolveQuery: QueryResolver = responseFor) {
  const queries: Query[] = [];
  const sends: Send[] = [];
  const providerToken = jest.fn(async () => 'provider-token');
  let handler: Handler = async () => { throw new Error('handler was not registered'); };
  const environment: Record<string, string> = {
    SUPABASE_URL: 'https://fixture.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-admin-key',
    PUSH_WEBHOOK_SECRET: 'fixture-secret', APNS_KEY: 'fixture-key', APNS_KEY_ID: 'fixture-key-id',
    APNS_TEAM_ID: 'fixture-team', APNS_BUNDLE_ID: 'app.hither.mobile',
  };
  const client = {
    from: (table: string) => new Query(table, query => {
      queries.push(query);
      return resolveQuery(query);
    }),
  };
  const send = (kind: string) => async (
    _config: unknown, _auth: string, token: string, payload: Record<string, unknown>,
  ) => {
    sends.push({ kind, token, payload });
    return { token, status: 200, dead: false };
  };
  const loaded = new Map<string, Record<string, unknown>>();
  function load(filename: string): Record<string, unknown> {
    const cached = loaded.get(filename);
    if (cached) return cached;
    const exports: Record<string, unknown> = {};
    loaded.set(filename, exports);
    let compiled = compiledModules.get(filename);
    if (!compiled) {
      compiled = transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 }, fileName: filename,
      }).outputText;
      compiledModules.set(filename, compiled);
    }
    runInNewContext(compiled, {
      exports, Request, Response, TextEncoder, Error,
      console: { error: jest.fn(), warn: jest.fn() },
      Deno: {
        env: { get: (key: string) => environment[key] },
        serve: (callback: Handler) => { handler = callback; },
      },
      require: (specifier: string) => {
        if (specifier === 'https://esm.sh/@supabase/supabase-js@2') return { createClient: () => client };
        if (specifier === './messages.ts') return messages;
        if (!specifier.startsWith('./')) throw new Error(`unexpected import ${specifier}`);
        return load(resolve(dirname(filename), specifier));
      },
    }, { filename });
    if (filename === join(edgeDirectory, 'apns.ts')) {
      Object.assign(exports, {
        providerToken, sendApns: send('alert'), sendBackgroundLocationRefresh: send('refresh'),
        sendLiveActivityApns: send('update'), sendLiveActivityStartApns: send('start'),
      });
    }
    if (filename === join(edgeDirectory, 'fcm.ts')) {
      Object.assign(exports, {
        fcmAccessToken: providerToken, sendFcm: send('fcm-alert'), sendFcmData: send('fcm-refresh'),
      });
    }
    return exports;
  }
  load(join(edgeDirectory, 'index.ts'));
  return {
    queries, sends, providerToken,
    send: (payload: Record<string, unknown>, secret = 'fixture-secret') => handler(new Request(
      'https://fixture.test/send-push', {
        method: 'POST', headers: { 'x-hither-webhook-secret': secret }, body: JSON.stringify(payload),
      },
    )),
  };
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const queryNames = (queries: Query[]) => queries.map(query => `${query.table}:${query.columns}`);

describe('send-push independent read batches', () => {
  it('starts alert-token and live-session reads together after notification preferences', async () => {
    const preferences = deferred();
    const tokens = deferred();
    const sessions = deferred();
    const app = loadHandler(query => {
      if (query.table === 'notification_preferences') return preferences.promise;
      if (query.table === 'push_tokens') return tokens.promise;
      if (query.table === 'live_activity_sessions') return sessions.promise;
      return responseFor(query);
    });
    const response = app.send(arrivalPayload);
    await flush();
    expect(app.queries.map(query => query.table)).toEqual(['memberships', 'profiles', 'notification_preferences']);
    preferences.resolve(ok([]));
    await flush();
    expect(app.queries.map(query => query.table).sort()).toEqual([
      'memberships', 'profiles', 'notification_preferences', 'push_tokens', 'live_activity_sessions',
    ].sort());
    sessions.resolve(ok([liveSession]));
    await flush();
    expect(app.providerToken).not.toHaveBeenCalled();
    tokens.resolve(ok([{ user_id: 'peer', token: 'alert-token', platform: 'ios' }]));
    const result = await response;
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ sent: 1, total: 1, liveActivitySent: 1, liveActivityTotal: 1 });
    expect(app.queries.find(query => query.table === 'push_tokens')?.filters).toContainEqual({
      column: 'user_id', value: ['peer'],
    });
    expect(app.sends).toContainEqual({
      kind: 'alert', token: 'alert-token', payload: expect.objectContaining({
        title: 'Leader', body: '已抵達（Station）',
        data: expect.objectContaining({ recipientId: 'peer', groupId: 'group', category: 'arrival' }),
      }),
    });
    expect(app.sends.map(send => send.token).sort()).toEqual(['activity-token', 'alert-token']);
  });

  it('starts destination, profile and arrival reads together before delivering an activity update', async () => {
    const destinations = deferred();
    const profiles = deferred();
    const arrivals = deferred();
    const app = loadHandler(query => {
      if (query.table === 'itinerary_items') return destinations.promise;
      if (query.table === 'profiles' && query.columns === 'id, avatar') return profiles.promise;
      if (query.table === 'destination_arrivals') return arrivals.promise;
      return responseFor(query);
    });
    const response = app.send(livePayload);
    await flush();
    expect(queryNames(app.queries).slice(-3).sort()).toEqual([
      'itinerary_items:id, title', 'profiles:id, avatar', 'destination_arrivals:destination_id, user_id',
    ].sort());
    destinations.resolve(ok([{ id: 'destination', title: 'Station' }]));
    profiles.resolve(ok([{ id: 'leader', avatar: '🦊' }, { id: 'peer', avatar: '🐑' }]));
    await flush();
    expect(app.providerToken).not.toHaveBeenCalled();
    arrivals.resolve(ok([{ destination_id: 'destination', user_id: 'leader' }]));
    const result = await response;
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ sent: 0, total: 0, liveActivitySent: 1, liveActivityTotal: 1 });
    expect(app.sends).toEqual([{
      kind: 'update', token: 'activity-token', payload: {
        event: 'update', timestamp: 1_767_261_600,
        contentState: {
          destinationId: 'destination', navigationSessionId: undefined, status: undefined,
          gatheringTitle: 'Station', distanceMeters: 320, etaSeconds: 120,
          sampledAtMs: 1_767_261_600_000, etaTargetAtMs: 1_767_261_720_000,
          progress: 0.7, gatheredCount: 1, memberCount: 2, accentHex: '#123456', travelMode: 'walk',
          memberEmojis: ['🦊', '🐑'], memberArrived: [true, false], language: 'zh',
        },
      },
    }]);
  });

  it('starts all navigation-start reads together and then batches profiles with arrivals', async () => {
    const tokens = deferred();
    const group = deferred();
    const destination = deferred();
    const handles = deferred();
    const profiles = deferred();
    const arrivals = deferred();
    const app = loadHandler(query => {
      if (query.table === 'device_live_activity_tokens') return tokens.promise;
      if (query.table === 'groups') return group.promise;
      if (query.table === 'itinerary_items') return destination.promise;
      if (query.table === 'live_activity_sessions') return handles.promise;
      if (query.table === 'profiles' && query.columns === 'id, avatar') return profiles.promise;
      if (query.table === 'destination_arrivals') return arrivals.promise;
      return responseFor(query);
    });
    const response = app.send(navigationPayload);
    await flush();
    expect(queryNames(app.queries).slice(-4).sort()).toEqual([
      'device_live_activity_tokens:user_id, device_id, push_to_start_token, accent_hex',
      'groups:name', 'itinerary_items:title', 'live_activity_sessions:user_id',
    ].sort());
    tokens.resolve(ok([{ user_id: 'peer', device_id: 'device', push_to_start_token: 'start-token', accent_hex: '#654321' }]));
    group.resolve(ok({ name: 'River Walk' }));
    destination.resolve(ok({ title: 'Station' }));
    await flush();
    expect(app.providerToken).not.toHaveBeenCalled();
    expect(app.queries.some(query => query.columns === 'id, avatar')).toBe(false);
    handles.resolve(ok([]));
    await flush();
    expect(queryNames(app.queries).slice(-2).sort()).toEqual(['destination_arrivals:user_id', 'profiles:id, avatar']);
    profiles.resolve(ok([{ id: 'leader', avatar: '🦊' }, { id: 'peer', avatar: '🐑' }]));
    await flush();
    expect(app.providerToken).not.toHaveBeenCalled();
    arrivals.resolve(ok([{ user_id: 'leader' }]));
    const result = await response;
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      sent: 0, liveActivitySent: 1, liveActivityTotal: 1, fallbackTotal: 0, total: 1, controlTotal: 0,
    });
    expect(app.sends).toEqual([{
      kind: 'start', token: 'start-token', payload: {
        timestamp: expect.any(Number), attributesType: 'HitherGroupAttributes', attributes: { groupName: 'River Walk' },
        contentState: {
          navigationSessionId: 'session', status: 'starting', gatheringTitle: 'Station', progress: 0,
          distanceMeters: 0, etaSeconds: 0, gatheredCount: 1, memberCount: 2, accentHex: '#654321',
          memberEmojis: ['🦊', '🐑'], memberArrived: [true, false],
        },
      },
    }]);
  });

  it('keeps the earlier token-read failure when live-session lookup fails first', async () => {
    const tokens = deferred();
    const app = loadHandler(query => {
      if (query.table === 'push_tokens') return tokens.promise;
      if (query.table === 'live_activity_sessions') return { data: null, error: new Error('live lookup failed') };
      return responseFor(query);
    });
    let completed = false;
    const response = app.send(arrivalPayload).then(result => { completed = true; return result; });
    await flush();
    expect(app.queries.map(query => query.table)).toContain('live_activity_sessions');
    expect(completed).toBe(false);
    tokens.resolve({ data: null, error: new Error('token lookup failed') });
    const result = await response;
    expect(result.status).toBe(500);
    expect(await result.json()).toEqual({ error: 'token lookup failed' });
    expect(app.providerToken).not.toHaveBeenCalled();
    expect(app.sends).toEqual([]);
  });

  it.each([
    { label: 'navigation start', payload: navigationPayload, tables: ['device_live_activity_tokens', 'groups', 'itinerary_items', 'live_activity_sessions'], expected: 'device_live_activity_tokens' },
    { label: 'navigation content', payload: navigationPayload, tables: ['profiles', 'destination_arrivals'], expected: 'profiles' },
    { label: 'activity update', payload: livePayload, tables: ['itinerary_items', 'profiles', 'destination_arrivals'], expected: 'itinerary_items' },
  ])('preserves response-error priority and prevents sends for $label reads', async ({ payload, tables, expected }) => {
    const app = loadHandler(query => {
      if (tables.includes(query.table) && !(query.table === 'profiles' && query.columns === 'nickname')) {
        return { data: null, error: new Error(`${query.table} lookup failed`) };
      }
      return responseFor(query);
    });
    const result = await app.send(payload);
    expect(result.status).toBe(500);
    expect(await result.json()).toEqual({ error: `${expected} lookup failed` });
    expect(app.providerToken).not.toHaveBeenCalled();
    expect(app.sends).toEqual([]);
  });

  it('rejects an invalid webhook secret before any database read', async () => {
    const app = loadHandler();
    const result = await app.send(livePayload, 'wrong-secret');
    expect(result.status).toBe(401);
    expect(app.queries).toEqual([]);
    expect(app.sends).toEqual([]);
  });

  it('rejects a nonmember sender before reading notification data', async () => {
    const app = loadHandler(query => query.table === 'memberships' ? ok([]) : responseFor(query));
    const result = await app.send(livePayload);
    expect(result.status).toBe(403);
    expect(app.queries.map(query => query.table)).toEqual(['memberships']);
    expect(app.sends).toEqual([]);
  });

  it('ignores superseded navigation events before reading delivery data', async () => {
    const app = loadHandler(query => query.table === 'navigation_sessions' && query.columns === 'id, status, version'
      ? ok({ id: 'new-session', status: 'active', version: 1 }) : responseFor(query));
    const result = await app.send(navigationPayload);
    expect(await result.json()).toEqual({ sent: 0, ignored: 'superseded_session_event' });
    expect(app.queries.map(query => query.table)).toEqual([
      'memberships', 'profiles', 'navigation_sessions', 'navigation_sessions',
    ]);
    expect(app.sends).toEqual([]);
  });
});
