jest.mock('../api/services/_helpers', () => ({ requireUserId: async () => 'user-1' }));
jest.mock('react-native', () => ({ AppState: { currentState: 'active' } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'event' }));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('../api/services/LocationService', () => ({ ingestLocationBatch: jest.fn() }));
import { refreshTeamLocations } from '../utils/refreshTeamLocations';
import { requestWithDeadline } from '../utils/requestDeadline';
import { advanceStarfieldPhase } from '../utils/starfieldPhase';
import { createLocationOutbox, type LocationOutboxDatabase, type LocationOutboxEntry } from '../state/locationOutbox';
import { applyMemberLocationPatches } from '../utils/groupStatePatches';
import { mergeRemoteGroupStatePreservingOwnLocation } from '../utils/syncAuthority';
import type { GroupState } from '../types';

function database(): LocationOutboxDatabase {
  const entries = new Map<string, LocationOutboxEntry>();
  return {
    async initialize() {}, async insert(e) { entries.set(e.id, e); },
    async removeExpired(now) { for (const e of entries.values()) if (e.expiresAt <= now) entries.delete(e.id); },
    async getDue(now, limit) { return [...entries.values()].filter(e => e.nextAttemptAt <= now).sort((a,b) => b.capturedAt-a.capturedAt).slice(0,limit); },
    async resolveBatch(ids, failed) { for (const id of ids) entries.delete(id); for (const e of failed) entries.set(e.id, { ...entries.get(e.id)!, ...e }); },
    async count() { return entries.size; }, async purge() { entries.clear(); },
  };
}

test('six independent actors: failed upload persists across restart, read convergence, old snapshots and removal', async () => {
  let now = 1_000_000;
  const server = new Map<string, { coordinates: { latitude: number; longitude: number }; lastUpdated: string }>();
  const teams = ['A','A','A','A','B','B'];
  const stores = teams.map(() => database());
  const offline = new Set<number>();
  const send = (actor: number) => async (events: any[]) => {
    if (offline.has(actor)) throw new Error('offline');
    const acceptedIds: string[] = []; const rejected: { id: string; reason: string }[] = [];
    for (const e of events) {
      if (e.groupId !== teams[actor]) { rejected.push({ id: e.id, reason: 'forbidden' }); continue; }
      server.set(String(actor), { coordinates: e.coords, lastUpdated: new Date(++now).toISOString() }); acceptedIds.push(e.id);
    }
    return { acceptedIds, rejected };
  };
  const actors = stores.map((db, i) => createLocationOutbox(db, send(i), () => now));
  const snapshot = (team: string): GroupState => ({ group: { id: team } as any, destinations: [], subgroups: [], members: teams.flatMap((t,i) => t === team ? [{ userId: String(i), name: String(i), role: i === 0 || i === 4 ? 'leader' : 'follower', status: 'active', ...server.get(String(i)) }] : []) });
  const views = teams.map(snapshot);
  for (let i=0;i<6;i++) await actors[i].enqueue({ id: String(i), groupId: teams[i], capturedAt: now, coordinates: { latitude: 25+i/100, longitude:121 } });
  offline.add(2);
  const sent = await Promise.all(actors.map(a => a.flush()));
  expect(sent[2]).toMatchObject({ sent:0, remaining:1, retryScheduled:1 });
  expect(snapshot('A').members[2].coordinates).toBeUndefined();
  offline.delete(2); now+=3000;
  actors[2] = createLocationOutbox(stores[2], send(2), () => now);
  expect((await actors[2].flush()).acceptedIds).toEqual(['2']);
  for (let i=0;i<6;i++) views[i] = mergeRemoteGroupStatePreservingOwnLocation(views[i], snapshot(teams[i]), String(i));
  expect(views[0].members).toEqual(views[1].members);
  expect(views[1].members).toEqual(views[2].members);
  expect(views[4].members).toHaveLength(2);
  const old = snapshot('A');
  const patch = { userId:'1', coordinates:{latitude:26,longitude:121}, updatedAt:new Date(now+10).toISOString() };
  const newest = applyMemberLocationPatches(views[0], [patch])!;
  expect(mergeRemoteGroupStatePreservingOwnLocation(newest, old).members[1].coordinates?.latitude).toBe(26);
  server.delete('1');
  expect(mergeRemoteGroupStatePreservingOwnLocation(newest, snapshot('A')).members[1].coordinates).toBeUndefined();
});

test.each([true, false])('manual refresh reads despite failed GPS and cooldown=%s', async cooling => {
  const pull = jest.fn(async () => true);
  const requestPeers = jest.fn(async () => ({ accepted:true, retryAfterSeconds:60, recipientIds:[] }));
  const result = await refreshTeamLocations({ pull, uploadSelf:async () => { throw new Error('no fix'); }, requestPeers, getMembers:()=>[], cooling });
  expect(pull).toHaveBeenCalledTimes(2); expect(result.pulled).toBe(true); expect(result.selfUploaded).toBe(false);
  expect(requestPeers).toHaveBeenCalledTimes(cooling ? 0 : 1);
});

test('manual read starts before GPS resolves; peer accounting uses server time', async () => {
  const members: any[] = [{ userId:'peer', lastUpdated:'2026-01-01T00:00:00Z' }];
  let release!: (value: boolean) => void;
  const pull = jest.fn(async () => true);
  const run = refreshTeamLocations({ pull, uploadSelf:()=>new Promise(r=>{release=r;}), cooling:false,
    requestPeers:async () => { members[0].lastUpdated='2026-01-01T00:00:01Z'; return {accepted:true,retryAfterSeconds:60,recipientIds:['peer'],requestedAt:'2026-01-01T00:00:01Z'}; }, getMembers:()=>members });
  expect(pull).toHaveBeenCalledTimes(1); release(true);
  expect(await run).toMatchObject({ selfUploaded:true, respondedUserIds:['peer'] });
});

test('request timeout releases caller even when transport never settles', async () => {
  jest.useFakeTimers();
  const promise = requestWithDeadline(() => new Promise(() => {}), 100);
  const assertion = expect(promise).rejects.toThrow('request_timeout');
  await jest.advanceTimersByTimeAsync(100); await assertion;
  expect(await requestWithDeadline(async () => 'recovered')).toBe('recovered'); jest.useRealTimers();
});

test('starfield wraps for thousands of cycles and resumes without an end frame', () => {
  let phase=0; let wraps=0;
  for(let i=0;i<5_000_000;i++) { const next=advanceStarfieldPhase(phase,50); if(next<phase) wraps++; if (!(next>=0 && next<1)) throw new Error('phase out of range'); phase=next; }
  expect(wraps).toBeGreaterThan(1000);
  expect(advanceStarfieldPhase(phase,0)).toBe(phase);
  expect(advanceStarfieldPhase(phase,16)).not.toBe(phase);
});

test('empty snapshots cannot erase newer fixes or fence transactions that commit later', () => {
  const base = { group: { id: 'g', name: 'Dummy', inviteCode: 'DUMMY1', createdBy: 'm', createdAt: '2026-01-01T00:00:00Z', journeyStatus: 'paused', stragglerAlerts: true, stragglerThresholdM: 500 }, destinations: [], subgroups: [], members: [{ userId: 'm', name: 'm', role: 'follower', status: 'active', locationObservedAt: '2026-01-01T00:00:00Z' }] } as GroupState;
  const live = applyMemberLocationPatches(base, [{ userId: 'm', coordinates: { latitude: 25, longitude: 121 }, updatedAt: '2026-01-01T00:00:01Z' }])!;
  expect(mergeRemoteGroupStatePreservingOwnLocation(live, base).members[0].coordinates).toEqual(live.members[0].coordinates);
  const removed = { ...base, members: [{ ...base.members[0], locationObservedAt: '2026-01-01T00:00:02Z' }] };
  expect(mergeRemoteGroupStatePreservingOwnLocation(removed, live).members[0].coordinates).toEqual(live.members[0].coordinates);
  expect(applyMemberLocationPatches(removed, [{ userId: 'm', coordinates: { latitude: 25, longitude: 121 }, updatedAt: '2026-01-01T00:00:01Z' }])!.members[0].coordinates).toEqual(live.members[0].coordinates);
  const stopped = { ...removed, members: [{ ...removed.members[0], sharingEnabled: false }] };
  expect(applyMemberLocationPatches(stopped, [{ userId: 'm', coordinates: { latitude: 25, longitude: 121 }, updatedAt: '2026-01-01T00:00:03Z' }])!.members[0].coordinates).toBeUndefined();
});

test.each([0x5eed, 20260930, 731])('seed %s: scrambled snapshots and realtime never regress confirmed positions', seed => {
  let random = seed;
  const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random; };
  const fixtures = Array.from({ length: 40 }, (_, i) => ({ userId: 'm', coordinates: { latitude: 25 + i / 1000, longitude: 121 }, updatedAt: new Date(1_800_000_000_000 + i * 1000).toISOString() }));
  const events = fixtures.flatMap(patch => [{ kind: 'snapshot', patch }, { kind: 'event', patch }]);
  for (let i = events.length - 1; i > 0; i--) { const j = next() % (i + 1); [events[i], events[j]] = [events[j], events[i]]; }
  let state = { group: { id: 'g' } as GroupState['group'], destinations: [], subgroups: [], members: [{ userId: 'm', name: 'Dummy', role: 'follower', status: 'active' }] } as GroupState;
  let newest = '';
  for (const { kind, patch } of events) {
    if (kind === 'event') state = applyMemberLocationPatches(state, [patch])!;
    else state = mergeRemoteGroupStatePreservingOwnLocation(state, { ...state, members: [{ ...state.members[0], coordinates: patch.coordinates, lastUpdated: patch.updatedAt, uploadedAt: patch.updatedAt }] });
    newest = patch.updatedAt > newest ? patch.updatedAt : newest;
    expect(state.members[0].lastUpdated).toBe(newest);
  }
  expect(state.members[0].coordinates).toEqual(fixtures[39].coordinates);
});

test('manual refresh terminates if permission or session never settles', async () => {
  jest.useFakeTimers();
  const pull = jest.fn(async () => true);
  const pending = refreshTeamLocations({ pull, uploadSelf: () => new Promise(() => {}), requestPeers: () => new Promise(() => {}), getMembers: () => [], cooling: false });
  await jest.advanceTimersByTimeAsync(35_000);
  expect(await pending).toMatchObject({ pulled: true, selfUploaded: false, request: null });
  expect(pull).toHaveBeenCalledTimes(2);
  jest.useRealTimers();
});
