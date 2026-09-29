// Run explicitly: node scripts/location-smoke.cjs --live --admin --duration=300
// Creates ONLY tagged dummy users/groups; saves resource IDs before each subsequent step.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { fork, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { parseEnv } = require('node:util');
if (!process.argv.includes('--live') || !process.argv.includes('--admin')) throw new Error('Explicit --live --admin required for scoped setup and complete cleanup');
const seconds = Number(process.argv.find(x => x.startsWith('--duration='))?.split('=')[1] ?? 300);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hither-location-smoke-'));
const env = { ...parseEnv(fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8')), ...process.env, HITHER_SMOKE_DIR: directory };
assert.equal(new URL(env.EXPO_PUBLIC_SUPABASE_URL).hostname, 'htqrucnjafhhvxdqslbv.supabase.co', 'Smoke setup must target the configured Hither project');
const manifest = { directory, startedAt: new Date().toISOString(), actors: [], groups: [], checks: [], cleanup: [] };
const save = () => fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(manifest, null, 2));
// --admin is setup/cleanup only. Never pass the service role into a worker.
let admin;
if (process.argv.includes('--admin')) {
  const keys = JSON.parse(execFileSync('cmd.exe', ['/d', '/s', '/c', 'npx.cmd --yes supabase projects api-keys --project-ref htqrucnjafhhvxdqslbv --output json'], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const key = keys.find(k => k.name === 'service_role')?.api_key;
  if (!key) throw new Error('admin setup key unavailable');
  admin = createClient(env.EXPO_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  manifest.setup = 'admin; tested clients use password-authenticated sessions';
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let seq = 0;
function worker(index) {
  const child = fork(path.join(__dirname, 'location-smoke-worker.cjs'), [], { env: { ...env, HITHER_SMOKE_ACTOR: String(index) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const pending = new Map();
  child.stderr.on('data', data => { if (!String(data).includes('ExperimentalWarning')) fs.appendFileSync(path.join(directory, 'worker-errors.log'), data); });
  child.stdout.on('data', data => fs.appendFileSync(path.join(directory, 'worker.log'), data));
  child.on('message', ({ id, value, error }) => {
    fs.appendFileSync(path.join(directory, 'calls.jsonl'), JSON.stringify({ actor: index, id, at: new Date().toISOString(), value, error }) + '\n');
    const handler = pending.get(id); if (!handler) return;
    pending.delete(id); clearTimeout(handler.timer);
    error ? handler.reject(new Error(`actor ${index}: ${error}`)) : handler.resolve(value);
  });
  child.on('exit', () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('worker exited')); } pending.clear(); });
  return { index, child, call(action, args = {}) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`actor ${index} ${action} timeout`)); }, 45_000);
      fs.appendFileSync(path.join(directory, 'calls.jsonl'), JSON.stringify({ actor: index, id, at: new Date().toISOString(), action, args: action === 'auth' ? '[credentials omitted]' : args }) + '\n');
      pending.set(id, { resolve, reject, timer }); child.send({ id, action, args });
    });
  } };
}
const actors = Array.from({ length: 6 }, (_, i) => worker(i));
const check = (name, details = {}) => { manifest.checks.push({ name, at: new Date().toISOString(), ...details }); save(); console.log(`PASS ${name}`); };
const view = state => state.members.map(m => ({ id: m.userId, coordinates: m.coordinates, received: m.lastUpdated, captured: m.capturedAt })).sort((a, b) => a.id.localeCompare(b.id));
async function converge(team, count) {
  const deadline = Date.now() + 35_000;
  let last;
  do {
    assert((await Promise.all(team.map(a => a.call('pull')))).every(Boolean));
    const snapshots = await Promise.all(team.map(a => a.call('state')));
    try {
      for (const { state } of snapshots) { assert.equal(state.members.length, count); assert.deepEqual(view(state), view(snapshots[0].state)); }
      return snapshots;
    } catch (error) {
      last = error;
      manifest.transientDifferences ??= [];
      manifest.transientDifferences.push({ at: new Date().toISOString(), views: snapshots.map(s => view(s.state)) });
      save(); // Concurrent fresh writes may cross two reads; retain evidence and require bounded convergence.
      await sleep(500);
    }
  } while (Date.now() < deadline);
  throw last;
}

(async () => {
  console.log(`Evidence: ${directory}`); save();
  try {
    for (const a of actors) {
      if (admin) {
        const credentials = { email: `dummy-${crypto.randomUUID()}@hither.invalid`, password: crypto.randomBytes(32).toString('base64url') };
        const created = await admin.auth.admin.createUser({ ...credentials, email_confirm: true, user_metadata: { test_run: path.basename(directory) } });
        if (created.error) throw created.error;
        manifest.actors.push({ index: a.index, userId: created.data.user.id }); save();
        assert.equal((await a.call('auth', credentials)).userId, created.data.user.id);
      } else {
        const identity = await a.call('auth'); manifest.actors.push({ index: a.index, ...identity }); save();
      }
    }
    const A = await actors[0].call('create', { name: `Dummy sync A ${path.basename(directory)}` }); manifest.groups.push(A.id); save();
    const B = await actors[4].call('create', { name: `Dummy sync B ${path.basename(directory)}` }); manifest.groups.push(B.id); save();
    for (const i of [1, 2, 3]) await actors[i].call('join', { code: A.inviteCode });
    await actors[5].call('join', { code: B.inviteCode });
    await Promise.all(actors.map((a, i) => a.call('open', { groupId: i < 4 ? A.id : B.id })));
    const team = actors.slice(0, 4);
    const initial = await converge(team, 4);
    assert(initial[0].state.members.every(m => !m.coordinates));
    check('two isolated teams: 4 + 2 real authenticated clients');
    for (const a of actors) assert.equal((await a.call('upload')).confirmed, true);
    await sleep(5000);
    const first = await converge(team, 4);
    assert(first[0].state.members.every(m => m.coordinates && m.lastUpdated));
    const realtimeDeadline = Date.now() + 30_000;
    let realtimeEvidence = (await actors[2].call('state')).observed;
    while (realtimeEvidence.locations === 0 && Date.now() < realtimeDeadline) {
      assert.equal((await actors[1].call('upload')).confirmed, true);
      await sleep(1500);
      realtimeEvidence = (await actors[2].call('state')).observed;
    }
    manifest.realtime = realtimeEvidence; save();
    assert(realtimeEvidence.locations > 0, JSON.stringify(realtimeEvidence));
    check('missing positions appear; real Realtime received; roster convergence');
    await actors[2].call('drop', { enabled: true });
    await actors[1].call('upload', { lat: 25.02 });
    const destination = await actors[0].call('add');
    await sleep(5000);
    assert((await actors[2].call('state')).observed.itinerary > 0);
    await actors[0].call('delete', { id: destination });
    await sleep(1500); // Let itinerary-triggered reads settle before dropping only location events.
    const targetLat = 25.045;
    assert.equal((await actors[1].call('upload', { lat: targetLat })).confirmed, true);
    const recoveryStarted = Date.now();
    let repaired = false;
    while (Date.now() - recoveryStarted < 35_000) {
      const observed = await actors[2].call('state'); // No explicit pull: exercise periodic recovery.
      repaired = observed.state.members.find(m => m.userId === manifest.actors[1].userId)?.coordinates?.latitude === targetLat;
      if (repaired) break;
      await sleep(500);
    }
    assert(repaired, '30-second reconciliation failed');
    check('missed location automatically repaired within 30 seconds plus HTTP', { elapsedMs: Date.now() - recoveryStarted });
    await converge(team, 4);
    await actors[2].call('drop', { enabled: false });
    check('location event loss while itinerary events remain live; recovery converges');
    const refreshes = await Promise.all(team.slice(0, 3).map((a, i) => a.call('refresh', { gpsFailure: i === 1, cooling: i === 2 })));
    assert(refreshes.every(x => x.pulled)); assert.equal(refreshes[1].selfUploaded, false);
    await converge(team, 4); check('concurrent manual refresh; GPS failure and cooldown never block reads');
    await actors[3].call('offline', { enabled: true });
    const failed = await actors[3].call('upload', { lat: 25.03 }); assert.equal(failed.confirmed, false); assert(failed.remaining > 0);
    actors[3].child.kill(); await sleep(500); actors[3] = worker(3); team[3] = actors[3];
    await actors[3].call('auth'); await actors[3].call('open', { groupId: A.id }); await sleep(5000);
    const restarted = await converge(team, 4);
    assert.equal(restarted[0].state.members.find(m => m.userId === manifest.actors[3].userId).coordinates.latitude, 25.03);
    check('process death restores independent SQLite outbox and uploads without a new GPS sample');
    const before = view(restarted[0].state);
    const stale = await actors[3].call('upload', { lat: 24, capturedAt: Date.now() - 3_600_000 });
    assert.equal(stale.confirmed, false);
    const replay = await actors[3].call('raw', { name: 'ingest_location_batch', args: { p_events: [{ id: stale.eventId, groupId: A.id, navigationSessionId: null, capturedAt: Date.now() - 3_600_000, coords: { latitude: 24, longitude: 121, accuracy: 5 }, trackingMode: 'foreground', source: 'foreground', sequence: 1 }] } });
    assert.equal(replay.data.rejected[0].reason, 'stale_sample');
    const future = await actors[3].call('upload', { lat: 24, capturedAt: Date.now() + 3_600_000 }); assert.equal(future.confirmed, false);
    assert.deepEqual(view((await converge(team, 4))[0].state), before);
    check('old and future samples cannot poison current position');
    const denied = await actors[5].call('raw', { name: 'get_group_recovery_snapshot', args: { p_group_id: A.id } }); assert(denied.error);
    await actors[3].call('privacy', { enabled: false });
    assert.equal((await actors[3].call('upload')).confirmed, false);
    const hidden = await converge(team, 4); assert.equal(hidden[0].state.members.find(m => m.userId === manifest.actors[3].userId).coordinates, undefined);
    await actors[3].call('privacy', { enabled: true }); assert.equal((await actors[3].call('upload')).confirmed, true);
    check('cross-team read denied; disabled sharing hidden and uploads rejected');
    const started = Date.now(); let cycle = 0;
    while (Date.now() - started < seconds * 1000) {
      cycle++;
      const mover = team[cycle % 4];
      assert.equal((await mover.call('upload', { lat: 25.1 + cycle * 0.0001 })).confirmed, true);
      if (cycle % 3 === 0) {
        await team[2].call('disconnect'); await team[1].call('upload', { lat: 25.2 + cycle * 0.0001 }); await team[2].call('reconnect');
      }
      if (cycle % 2 === 0) {
        const refreshed = await Promise.all(team.slice(0, 3).map(a => a.call('refresh', { cooling: true, gpsFailure: cycle % 4 === 0 })));
        assert(refreshed.every(x => x.pulled));
      }
      await converge(team, 4); await converge(actors.slice(4), 2);
      check(`stability cycle ${cycle}`);
      await sleep(5000);
    }
    manifest.stabilityMs = Date.now() - started;
    check('stability completed', { cycles: cycle, durationMs: manifest.stabilityMs });
    await team[2].call('disconnect');
    await team[2].call('offline', { enabled: true });
    const stop = await team[0].call('add');
    await team[1].call('workflow', { kind: 'arrive', id: stop, arrived: true });
    await team[1].call('workflow', { kind: 'arrive', id: stop, arrived: false });
    await team[1].call('workflow', { kind: 'arrive', id: stop, arrived: true });
    const vote = await team[0].call('workflow', { kind: 'voteCreate' });
    await team[1].call('workflow', { kind: 'vote', id: vote.id, option: 'no' });
    await team[1].call('workflow', { kind: 'vote', id: vote.id, option: 'keep' });
    const request = await team[1].call('workflow', { kind: 'request' });
    assert((await team[0].call('workflow', { kind: 'requests' })).some(r => r.id === request));
    await team[2].call('offline', { enabled: false });
    await team[2].call('reconnect');
    const arrivals = await Promise.all(team.map(a => a.call('workflow', { kind: 'arrivals' })));
    arrivals.forEach(rows => assert.deepEqual(rows, arrivals[0]));
    assert(arrivals[0].some(r => r.destinationId === stop && r.userId === manifest.actors[1].userId));
    const votes = await Promise.all(team.map(a => a.call('workflow', { kind: 'votes', id: vote.id })));
    votes.forEach(rows => assert.deepEqual(rows, votes[0]));
    assert.equal(votes[0][0].optionId, 'keep');
    await team[0].call('delete', { id: stop });
    check('offline observer recovers last arrival, changed vote, gathering request and deleted stop');
    const subgroup = await team[1].call('workflow', { kind: 'split' });
    await team[1].call('workflow', { kind: 'invite', id: subgroup.id, userId: manifest.actors[2].userId });
    const invites = await team[2].call('workflow', { kind: 'invites' });
    assert(invites.length > 0);
    await team[2].call('workflow', { kind: 'accept', id: invites[0].id });
    await converge(team, 4);
    await team[2].call('workflow', { kind: 'merge' });
    await team[1].call('workflow', { kind: 'merge' });
    await converge(team, 4);
    check('subgroup invitation, acceptance and merge converge');
    await team[3].call('workflow', { kind: 'leave' });
    const revoked = await team[3].call('raw', { name: 'get_group_recovery_snapshot', args: { p_group_id: A.id } });
    assert(revoked.error);
    await team[3].call('join', { code: B.inviteCode });
    await team[3].call('open', { groupId: B.id });
    await converge(team.slice(0, 3), 3);
    await converge([actors[4], actors[5], team[3]], 3);
    check('leave revokes reads; switching teams clears old roster and cache');
    const oldAccount = await team[0].call('foreignQueue', { actorId: manifest.actors[1].userId });
    assert.equal(oldAccount.sent, 0); assert.equal(oldAccount.discarded, 1);
    check('persisted old-account SQLite event cannot upload as another member of the same team');
    manifest.passed = true;
  } catch (error) { manifest.passed = false; manifest.failure = error.stack; console.error(error.message); process.exitCode = 1; }
  finally {
    // Stop observers, then remove memberships before groups: the premium membership
    // trigger requires its parent group to still exist during its DELETE callback.
    if (admin && manifest.groups.length) {
      for (const actor of actors) await actor.call('cleanup', { managed: true }).catch(() => undefined);
      const members = await admin.from('memberships').delete().in('group_id', manifest.groups);
      const groups = members.error ? members : await admin.from('groups').delete().in('id', manifest.groups).select('id');
      manifest.cleanupGroups = { ids: groups.data?.map(row => row.id) ?? [], error: groups.error?.message ?? null };
      if (groups.error) process.exitCode = 1;
      save();
    }
    // Followers first; leaders last. Only identities returned by this run are eligible.
    for (const i of [3, 2, 1, 5, 0, 4]) {
      if (!manifest.actors.some(a => a.index === i)) { actors[i].child.kill(); continue; }
      try {
        if (admin) {
          await actors[i].call('cleanup', { managed: true }).catch(() => undefined);
          const identity = manifest.actors.find(a => a.index === i);
          const removed = await admin.auth.admin.deleteUser(identity.userId);
          if (removed.error) throw removed.error;
          manifest.cleanup.push({ deleted: identity.userId });
        } else manifest.cleanup.push(await actors[i].call('cleanup'));
      }
      catch (e) { manifest.cleanup.push({ index: i, error: e.message }); process.exitCode = 1; }
      actors[i].child.kill(); save();
    }
    console.log(JSON.stringify({ passed: manifest.passed, checks: manifest.checks.length, cleaned: manifest.cleanup.filter(x => x.deleted).length, report: path.join(directory, 'report.json') }));
  }
})();
