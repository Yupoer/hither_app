const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { World } = require('./world.cjs');
async function runTokyoTrip({ output: requestedOutput, quiet = false } = {}) {
const output = requestedOutput ? path.resolve(requestedOutput) : null;
if (output) fs.mkdirSync(output);
const save = (name, content) => { if (output) fs.writeFileSync(path.join(output, name), content); };
const log = value => { if (!quiet) console.log(value); };
const world = new World({ recordInput: record => {
  if (output) fs.appendFileSync(path.join(output, 'inputs.jsonl'), `${JSON.stringify(record)}\n`);
} });
const devices = {};
const checks = [];
const records = [];
const cursors = {};
const samples = {};
const points = {
  asakusa: { title: 'Day 1 Asakusa Senso-ji', latitude: 35.7148, longitude: 139.7967 },
  skytree: { title: 'Day 1 Tokyo Skytree', latitude: 35.7101, longitude: 139.8107 },
  hotel: { title: 'Night 1 Ueno Hotel', latitude: 35.7138, longitude: 139.7773 },
  ueno: { title: 'Day 2 Ueno Park', latitude: 35.7156, longitude: 139.7745 },
};
let groupId;
let failure;
const has = (o, id) => o.presentation.hosts.some(h => h.testId === id);
const field = (o, id) => o.presentation.hosts.find(h => h.testId === id);
const destinations = o => o.durable.snapshot?.destinations || [];
const notifications = o => o.native.scheduled.map(row => row.input.content);
const member = (o, id) => o.presentation.mapMembers.find(row => row.userId === id);
function check(name, condition, evidence) {
  try { assert.ok(condition, name); checks.push({ name, pass: true, evidence }); }
  catch (error) { if (!(error instanceof assert.AssertionError)) throw error; checks.push({ name, pass: false, evidence }); }
}
async function capture(actor, operation, input = {}, result = null, verify) {
  await world.settle();
  const observations = { leader: null, memberA: null, memberB: null };
  const notificationsDelta = {};
  for (const [name, device] of Object.entries(devices)) {
    if (!device.child?.connected) continue;
    observations[name] = await device.observe();
    assert.equal(observations[name].now, world.now, `${name} actor clock matches the World`);
    observations[name].derivedLocationEvidence = (observations[name].presentation.mapMembers || []).map(row => ({
      userId: row.userId, name: row.name, coordinates: row.coordinates, capturedAt: row.capturedAt,
      uploadedAt: row.uploadedAt, ageMs: row.capturedAt ? observations[name].now - Date.parse(row.capturedAt) : null,
      locationAvailability: row.locationAvailability }));
    const received = notifications(observations[name]);
    notificationsDelta[name] = received.slice(cursors[name] || 0);
    cursors[name] = received.length;
  }
  const first = checks.length;
  if (verify) verify(observations, notificationsDelta);
  const record = { step: records.length + 1, time: new Date(world.now).toISOString(), actor, operation, input, result,
    observations, notificationsDelta, checks: checks.slice(first) };
  records.push(record);
  if (output) fs.appendFileSync(path.join(output, 'observations.jsonl'), `${JSON.stringify(record)}\n`);
  log(`${record.step}. ${actor} ${operation} ${record.checks.map(c => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}`).join('; ')}`);
  return record;
}
async function inject(actor, input) {
  const result = await devices[actor].input(input);
  return capture(actor, `external.${input.kind}`, input, result ?? null);
}
async function act(actor, operation, input = {}, verify) {
  let result;
  try { result = await devices[actor].perform(operation, input); }
  catch (error) { await capture(actor, operation, input, { error: error.message }); throw error; }
  if (result?.invoked === false) throw new Error(`${actor} ${operation} did not invoke: ${JSON.stringify(result)}`);
  return capture(actor, operation, input, result ?? null, verify);
}
async function press(actor, testId) {
  let result;
  try { result = await devices[actor].host.call({ kind: 'press', testId }); }
  catch (error) { await capture(actor, 'host.press', { testId }, { error: error.message }); throw error; }
  assert.equal(result.invoked, true, `${actor} press ${testId}`);
  return capture(actor, 'host.press', { testId }, result);
}
async function advance(ms, reason) {
  await world.advance(ms);
  return capture('world', 'clock.advance', { ms, reason });
}
async function expand(actor) {
  for (const phase of ['onBegin', 'onUpdate', 'onEnd']) await devices[actor].host.call({ kind: 'gesture', testId: 'map-bottom-sheet', phase,
    value: phase === 'onBegin' ? {} : { translationY: -250, velocityY: 0 }, success: true });
  await capture(actor, 'sheet.gesture.expand', { testId: 'map-bottom-sheet', events: [{ phase: 'onBegin', value: {} }, ...['onUpdate','onEnd'].map(phase => ({ phase, value: { translationY: -250, velocityY: 0 }, success: true }))] });
}
async function route(actor) {
  await expand(actor);
  await act(actor, 'map.tab', { index: 1 });
  await act(actor, 'map.route.open');
  await inject(actor, { kind: 'animation', finished: true });
  await capture(actor, 'external.animation.completed', { finished: true });
}
async function done(actor, label = '完成') {
  await act(actor, 'map.overlay.done', { label });
  await inject(actor, { kind: 'animation', finished: true });
  await capture(actor, 'external.animation.completed', { finished: true });
}
async function add(actor, point, first = true, muted = []) {
  await act(actor, 'map.pin.drop', { latitude: point.latitude, longitude: point.longitude });
  await advance(0, 'Dropped pin address lookup');
  await act(actor, 'map.place.rename', { value: point.title });
  const before = {};
  for (const [name, device] of Object.entries(devices)) before[name] = notifications(await device.observe()).length;
  await act(actor, first ? 'map.place.first-stop' : 'map.place.pool');
  await advance(300, 'Foreground destination debounce');
  await capture(actor, 'recipient.destination-reaction', { title: point.title }, null, o => {
    if (actor !== 'leader') return;
    for (const name of ['memberA', 'memberB']) {
      const received = notifications(o[name]).slice(before[name]);
      check(`${name} ${muted.includes(name) ? 'mutes' : 'receives'} added ${point.title}`,
        received.some(row => row.data?.category === 'addGathering' && row.body.includes(point.title)) === !muted.includes(name), received);
      check(`${name} sees ${point.title}`, destinations(o[name]).some(row => row.title === point.title), destinations(o[name]));
    }
    check(`author receives no add notification for ${point.title}`, !notifications(o.leader).slice(before.leader).some(row => row.data?.category === 'addGathering'), notifications(o.leader).slice(before.leader));
  });
  return world.backend.itinerary.find(row => row.group_id === groupId && row.title === point.title)?.id;
}
async function showCard(actor, destinationId) {
  for (const phase of ['onBegin', 'onUpdate', 'onEnd']) await devices[actor].host.call({ kind: 'gesture', testId: 'map-bottom-sheet', phase, value: phase === 'onBegin' ? {} : { translationY: 500, velocityY: 0 }, success: true });
  await capture(actor, 'sheet.gesture.collapse', { testId: 'map-bottom-sheet', events: [{ phase: 'onBegin', value: {} }, ...['onUpdate','onEnd'].map(phase => ({ phase, value: { translationY: 500, velocityY: 0 }, success: true }))] });
  await inject(actor, { kind: 'animation', finished: true });
  await world.settle();
  if (!has(await devices[actor].observe(), `gather-nav-${destinationId}`)) await act(actor, 'map.card.toggle', { destinationId });
}
async function start(destinationId, label) {
  await showCard('leader', destinationId);
  const old = await devices.leader.observe();
  const before = {};
  for (const [name, device] of Object.entries(devices)) before[name] = notifications(await device.observe()).length;
  await act('leader', 'map.journey.command', { destinationId });
  await world.waitFor(devices.leader, o => o.external.watches > old.external.watches, 'fresh Start GPS watcher');
  await advance(1000, 'Fresh fix after Start watcher');
  const input = { latitude: 35.7000, longitude: 139.7700, accuracy: 5, timestamp: world.now };
  await devices.leader.gps(input.latitude, input.longitude, input);
  await capture('leader', 'gps.start-fix', input);
  await advance(5000, 'Shared journey polling');
  await capture('leader', 'journey.start.reactions', { destinationId, label }, null, o => {
    check(`${label} leader sees active target`, field(o.leader, `gather-nav-${destinationId}`)?.label === '結束導航', field(o.leader, `gather-nav-${destinationId}`));
    for (const name of ['memberA', 'memberB']) {
      const received = notifications(o[name]).slice(before[name]);
      const target = destinations(o.leader).find(row => row.id === destinationId).title;
      check(`${label} ${name} receives new journey notification`, received.some(row => row.data?.category === 'journey' && row.body.includes(`已開始前往「${target}」`) && row.data.senderId === o.leader.actorId), received);
      check(`${label} ${name} sees active shared target`, o[name].durable.snapshot.group.journeyStatus === 'going' && o[name].durable.snapshot.activeGathering.activeDestinationId === destinationId, o[name].durable.snapshot.activeGathering);
    }
  });
}
async function gps(actor, point) {
  await advance(1000, 'Next GPS sample timestamp');
  const input = { latitude: point.latitude, longitude: point.longitude, accuracy: 5, timestamp: world.now };
  samples[actor] = input;
  await devices[actor].gps(point.latitude, point.longitude, input);
  if (devices[actor].spec.platform === 'ios') await devices[actor].perform('map.location.native-sample', input);
  await capture(actor, 'gps.sample', { ...input, sources: devices[actor].spec.platform === 'ios' ? ['expoWatch','MapKit'] : ['expoWatch'] });
  return advance(300, 'Location projection debounce');
}
async function arriveAll(destinationId, point) {
  for (const actor of ['leader', 'memberA', 'memberB']) await gps(actor, point);
  await advance(2500, 'Automatic completion leader hold');
  await capture('leader', 'arrival.leader-hold', { destinationId });
  await advance(2800, 'Completion shared journey cadence');
  await capture('world', 'arrival.completion.reactions', { destinationId }, null, o => {
    for (const actor of Object.keys(devices)) check(`${actor} sees completed ${point.title}`, !!destinations(o[actor]).find(row => row.id === destinationId)?.closedAt, destinations(o[actor]).find(row => row.id === destinationId));
  });
  await advance(3640, 'Completion card hold and exit animation duration');
  await capture('world', 'arrival.card-transition', { destinationId }, null, o => {
    check(`leader completed card exits ${point.title}`, !has(o.leader, `gather-card-${destinationId}`), o.leader.presentation.hosts.filter(h => h.testId?.startsWith('gather-card-')));
  });
}
async function enterRestored(actor) {
  await world.settle();
  if (has(await devices[actor].observe(), 'onboarding-skip')) await press(actor, 'onboarding-skip');
  await press(actor, 'role-my-teams');
  await press(actor, `team-card-${groupId}`);
  await press(actor, 'team-enter');
}
async function main() {
  save('observations.jsonl', '');
  try {
    for (const [actor, platform, name] of [['leader', 'ios', 'Tokyo Leader'], ['memberA', 'android', 'Tokyo A'], ['memberB', 'ios', 'Tokyo B']]) {
      devices[actor] = await world.device({ id: actor, userId: null, platform, mode: 'app' });
      await capture(actor, 'app.boot', { platform, mode: 'app', userId: null });
      await press(actor, 'onboarding-skip');
      await press(actor, 'login-guest');
      await press(actor, 'guest-confirm-button');
      await advance(100, 'Guest navigation transition');
      await press(actor, actor === 'leader' ? 'role-create' : 'role-join');
      await act(actor, 'team.name', { value: name });
      if (actor === 'leader') {
        await act(actor, 'team.group-name', { value: 'Tokyo two days one night' });
        await act(actor, 'team.create');
        await world.waitFor(devices[actor], o => o.presentation.route.route === 'Map', 'created team Map');
        groupId = (await devices[actor].observe()).presentation.session.membership.group.id;
      } else {
        await act(actor, 'team.code', { value: world.backend.groups.get(groupId).invite_code });
        await act(actor, 'team.join');
        await world.waitFor(devices[actor], o => o.presentation.route.route === 'Map', 'joined team Map');
      }
      await capture(actor, 'membership.confirmed', { groupId }, null, o => check(`${actor} enters actual Map with group`, o[actor].presentation.session.membership.group.id === groupId && has(o[actor], 'map-search'), o[actor].presentation.session.membership));
    }
    await advance(300, 'Three joined member projections');
    await capture('world', 'trio.roster', {}, null, o => {
      for (const actor of Object.keys(devices)) check(`${actor} sees trio`, o[actor].durable.snapshot?.members.length === 3, o[actor].durable.snapshot?.members);
    });
    for (const actor of Object.keys(devices)) await gps(actor, { latitude: 35.7000, longitude: 139.7700 });
    await advance(5000, 'Initial location recipient convergence at shared refresh cadence');
    await capture('world', 'initial.location-recipient-reactions', {}, null, o => {
      for (const source of Object.keys(devices)) for (const receiver of Object.keys(devices).filter(name => name !== source)) {
        const expectedCapturedAt = new Date(samples[source].timestamp).toISOString();
        const received = member(o[receiver], o[source].actorId);
        check(`${receiver} receives ${source} coordinates and capture time`, received?.coordinates?.latitude === 35.7 && received?.coordinates?.longitude === 139.77 && received.capturedAt === expectedCapturedAt, received);
      }
    });
    const asakusa = await add('leader', points.asakusa);
    const skytree = await add('leader', points.skytree);
    const hotel = await add('leader', points.hotel);
    const ueno = await add('leader', points.ueno);
    await route('leader');
    await act('leader', 'map.route.trip.open');
    await act('leader', 'map.route.trip.more-days');
    await done('leader', 'commit');
    await act('leader', 'map.route.move.open', { destinationId: ueno });
    await act('leader', 'map.route.move.day', { day: 2 });
    await act('leader', 'map.route.stay.set', { day: 1 });
    await act('leader', 'map.route.stay.select', { destinationId: hotel });
    await act('leader', 'map.route.stay.set', { day: 1 });
    await done('leader');
    await advance(300, 'Trip and hotel synchronize');
    await capture('leader', 'itinerary.two-days-hotel', {}, null, o => {
      for (const actor of Object.keys(devices)) {
        check(`${actor} sees day two destination`, destinations(o[actor]).find(row => row.id === ueno)?.day === 2, destinations(o[actor]));
        check(`${actor} sees overnight hotel`, o[actor].durable.snapshot.dailyAccommodations.some(row => row.title === points.hotel.title), o[actor].durable.snapshot.dailyAccommodations);
      }
    });
    await add('memberA', { title: 'Day 1 Member suggested Sumida riverside', latitude: 35.7110, longitude: 139.8020 }, false);
    await expand('leader');
    await act('leader', 'map.tab', { index: 1 });
    await advance(2500, 'Leader suggestion inbox');
    const request = world.backend.tables.gather_point_requests.find(row => row.group_id === groupId && row.status === 'pending');
    assert.ok(request, 'member suggestion exists');
    await act('leader', 'map.suggestion.approve', { requestId: request.id });
    await advance(2800, 'Approved suggestion recipient projections');
    await capture('leader', 'suggestion.approval.reactions', { requestId: request.id }, null, o => {
      for (const actor of Object.keys(devices)) check(`${actor} sees approved member suggestion`, destinations(o[actor]).some(row => row.title.includes('Sumida riverside')), destinations(o[actor]));
    });
    await start(asakusa, 'Day one first leg');
    await showCard('leader', asakusa);
    const pauseBefore = {};
    for (const actor of ['memberA','memberB']) pauseBefore[actor] = notifications(await devices[actor].observe()).length;
    await act('leader', 'map.journey.command', { destinationId: asakusa });
    await advance(5000, 'Pause group projection');
    await capture('leader', 'journey.pause.reactions', { destinationId: asakusa }, null, o => {
      check('pause preserves destination open', !destinations(o.leader).find(row => row.id === asakusa)?.closedAt, destinations(o.leader));
      check('pause returns leader Start', field(o.leader, `gather-nav-${asakusa}`)?.label === '開始', field(o.leader, `gather-nav-${asakusa}`));
      for (const actor of ['memberA','memberB']) {
        check(`${actor} sees shared pause`, o[actor].durable.snapshot.group.journeyStatus === 'paused', o[actor].durable.snapshot.group);
        const received = notifications(o[actor]).slice(pauseBefore[actor]);
        check(`${actor} receives pause notification`, received.some(row => row.data?.category === 'journey' && row.body === `Tokyo Leader 已暫停前往「${points.asakusa.title}」`), received);
      }
    });
    await start(asakusa, 'Day one same-leg restart');
    await arriveAll(asakusa, points.asakusa);
    await start(skytree, 'Day one second distinct leg');
    await arriveAll(skytree, points.skytree);
    await expand('memberB');
    const soloBefore = {};
    for (const receiver of ['leader','memberA']) soloBefore[receiver] = await devices[receiver].observe();
    await act('memberB', 'map.presence.select', { value: 'solo' });
    await advance(300, 'Solo roster projection');
    await capture('memberB', 'solo.roster.reactions', {}, null, o => {
      check('solo retains member identity and sharing', o.memberB.presentation.preferences.sharingEnabled === true && o.memberB.presentation.session.membership.group.id === groupId, o.memberB.presentation.preferences);
      check('leader sees member B solo', member(o.leader, o.memberB.actorId)?.solo === true, member(o.leader, o.memberB.actorId));
      for (const receiver of ['leader','memberA']) {
        const received = notifications(o[receiver]).slice(notifications(soloBefore[receiver]).length);
        const alerts = o[receiver].external.alertDetails.filter(row => !soloBefore[receiver].external.alertDetails.some(old => JSON.stringify(old) === JSON.stringify(row)));
        const visibleNotices = o[receiver].presentation.hosts.filter(row => /notice|toast|banner|alert/i.test(row.testId || '') && !soloBefore[receiver].presentation.hosts.some(old => JSON.stringify(old) === JSON.stringify(row)));
        check(receiver + ' receives member B solo departure notice', received.some(row => row.data?.category === 'journey' && row.data.senderId === o.memberB.actorId && row.body.includes('Tokyo B') && /離開|脫隊|自由行動|left|solo/i.test(row.body)), { received, newAlerts: alerts, newVisibleNotices: visibleNotices, expected: 'Named local journey notice from the acting member' });
      }
    });
    await add('leader', { title: 'Solo-time Shibuya idea', latitude: 35.6595, longitude: 139.7005 }, false, ['memberB']);
    await act('memberB', 'map.presence.select', { value: 'follow' });
    await advance(300, 'Follow roster projection');
    await capture('memberB', 'follow.roster.reactions', {}, null, o => check('leader sees member B follow', member(o.leader, o.memberB.actorId)?.solo === false, member(o.leader, o.memberB.actorId)));
    const identity = (await devices.memberA.observe()).actorId;
    const oldMemberA = member(await devices.leader.observe(), identity);
    await expand('leader');
    await act('leader', 'map.tab', { index: 0 });
    await expand('memberB');
    await act('memberB', 'map.tab', { index: 0 });
    devices.memberA.online = false;
    await capture('memberA', 'external.online', { value: false });
    await gps('memberA', { latitude: 35.7138, longitude: 139.7773 });
    await capture('memberA', 'offline.queue.reactions', { online: false }, null, o => {
      check('offline GPS is durable', o.memberA.durable.locations.length > 0, o.memberA.durable.locations);
      check('leader retains last member A fix', JSON.stringify(member(o.leader, identity)?.coordinates) === JSON.stringify(oldMemberA?.coordinates), member(o.leader, identity));
    });
    await advance(121000, 'Offline observer freshness ages across threshold');
    await capture('memberA', 'offline.freshness.reactions', {}, null, o => {
      for (const receiver of ['leader','memberB']) {
        const received = member(o[receiver], identity);
        check(`${receiver} preserves offline member A capture time`, received?.capturedAt === oldMemberA?.capturedAt, received);
        check(`${receiver} offline member A fix is older than 120s`, world.now - Date.parse(received.capturedAt) > 120000, o[receiver].derivedLocationEvidence);
        const row = o[receiver].presentation.flockRows.find(row => row.userId === identity);
        check(`${receiver} renders aged member A location`, row?.lastUpdated === received.capturedAt && /分鐘前更新/.test(row.text), row);
        check(`${receiver} uses synchronized server time for member A age`, row?.serverTimeOffsetMs === 0, { actorTime: o[receiver].now, worldTime: world.now, row });
      }
    });
    save('memberA-generation1.log', devices.memberA.logs);
    await capture('memberA', 'process.force-stop.request', { online: false, ReactUnmount: false });
    await world.settle();
    world.check();
    assert.equal(devices.memberA.pending.size, 0, 'No pending actor commands before intentional process stop');
    devices.memberA.child.kill();
    let exitTimer;
    try {
      await Promise.race([devices.memberA.exited, new Promise((_, reject) => {
        exitTimer = setTimeout(() => reject(new Error('Intentional process stop deadline')), 5000);
      })]);
    } finally { clearTimeout(exitTimer); }
    devices.memberA.child = null;
    await capture('memberA', 'process.force-stopped', { online: false, ReactUnmount: false });
    await devices.memberA.boot();
    cursors.memberA = 0;
    await capture('memberA', 'offline.process.abrupt-relaunch', {}, null, o => {
      check('abrupt offline relaunch preserves identity', o.memberA.actorId === identity, o.memberA.actorId);
      check('abrupt offline relaunch preserves GPS queue', o.memberA.durable.locations.length > 0, o.memberA.durable.locations);
    });
    devices.memberA.online = true;
    await capture('memberA', 'external.online', { value: true });
    await advance(5000, 'Reconnect location retry');
    await enterRestored('memberA');
    await advance(5000, 'Reconnect recipient debounce');
    await capture('memberA', 'online.retry.reactions', { online: true }, null, o => {
      check('reconnect drains location queue', o.memberA.durable.locations.length === 0, o.memberA.durable.locations);
      for (const receiver of ['leader','memberB']) {
        const received = member(o[receiver], identity);
        const expectedCapturedAt = new Date(samples.memberA.timestamp).toISOString();
        check(`${receiver} receives recovered member A coordinates and capture time`, received?.coordinates?.latitude === 35.7138 && received?.coordinates?.longitude === 139.7773 && received.capturedAt === expectedCapturedAt, received);
      }
    });
    await showCard('leader', ueno);
    const beforeDrop = member(await devices.memberB.observe(), (await devices.leader.observe()).actorId);
    devices.memberB.realtime = false;
    await capture('memberB', 'external.realtime', { value: false });
    await gps('leader', { latitude: 35.7138, longitude: 139.7773 });
    await capture('leader', 'realtime.source-accepted', {}, null, o => check('leader accepts fallback test fix', member(o.leader, o.leader.actorId)?.coordinates?.latitude === 35.7138 && member(o.leader, o.leader.actorId)?.capturedAt === new Date(samples.leader.timestamp).toISOString(), member(o.leader, o.leader.actorId)));
    await capture('memberB', 'realtime.drop.before-poll', { realtime: false }, null, o => check('member B still shows old fix before fallback', member(o.memberB, o.leader.actorId)?.capturedAt === beforeDrop.capturedAt, member(o.memberB, o.leader.actorId)));
    await advance(120000, 'Missed Realtime configured fallback and stale-fix interval');
    await capture('memberB', 'realtime.fallback.reactions', {}, null, o => check('member B recovers leader fix by poll', member(o.memberB, o.leader.actorId)?.coordinates?.latitude === 35.7138 && member(o.memberB, o.leader.actorId)?.capturedAt === new Date(samples.leader.timestamp).toISOString(), member(o.memberB, o.leader.actorId)));
    devices.memberB.realtime = true;
    await capture('memberB', 'external.realtime', { value: true });
    await capture('world', 'night.power-off', { reason: 'Bounded powered-off overnight clock gap, not background endurance' });
    for (const [actor, device] of Object.entries(devices)) {
      save(`${actor}-before-night.log`, device.logs);
      await device.dispose();
    }
    const gap = 24 * 60 * 60 * 1000;
    world.now += gap;
    world.backend.now = world.now;
    for (const [name, device] of Object.entries(devices)) { cursors[name] = 0; await device.boot(); }
    await capture('world', 'night.power-on', { gap, mode: 'powered-off clock gap' });
    for (const actor of Object.keys(devices)) await enterRestored(actor);
    await advance(0, 'Commit deferred profile restoration before identity verification');
    await capture('world', 'day-two.identity-preserved', {}, null, o => {
      for (const actor of Object.keys(devices)) {
        const expectedName = { leader: 'Tokyo Leader', memberA: 'Tokyo A', memberB: 'Tokyo B' }[actor];
        check(`${actor} preserves traveler display identity on day two`, o[actor].presentation.session.user.name === expectedName, o[actor].presentation.session);
        for (const receiver of Object.keys(devices)) check(`${receiver} still sees ${actor} display name on day two`, member(o[receiver], o[actor].actorId)?.name === expectedName, member(o[receiver], o[actor].actorId));
      }
    });
    await start(ueno, 'Day two final distinct leg');
    await arriveAll(ueno, points.ueno);
    await capture('world', 'journey.end', {}, null, o => {
      for (const actor of Object.keys(devices)) check(`${actor} final durable operation queue empty`, o[actor].durable.operations.length === 0, o[actor].durable.operations);
    });
    await act('memberB', 'map.settings.open');
    await inject('memberB', { kind: 'animation', finished: true });
    await capture('memberB', 'settings.opened');
    const leaveBefore = {};
    for (const receiver of ['leader','memberA']) leaveBefore[receiver] = await devices[receiver].observe();
    await act('memberB', 'map.group.leave');
    await inject('memberB', { kind: 'alert', index: 1 });
    await capture('memberB', 'external.leave-confirmation', { alertIndex: 1 });
    await advance(300, 'Leave recipient roster debounce');
    await capture('memberB', 'leave.reactions', {}, null, o => {
      check('leaver returns home', o.memberB.presentation.route.route === 'RoleSelect', o.memberB.presentation.route);
      for (const receiver of ['leader','memberA']) {
        check(receiver + ' sees two-member roster after leave', o[receiver].durable.snapshot.members.length === 2 && !member(o[receiver], o.memberB.actorId), o[receiver].durable.snapshot.members);
        const received = notifications(o[receiver]).slice(notifications(leaveBefore[receiver]).length);
        const alerts = o[receiver].external.alertDetails.filter(row => !leaveBefore[receiver].external.alertDetails.some(old => JSON.stringify(old) === JSON.stringify(row)));
        const visibleNotices = o[receiver].presentation.hosts.filter(row => /notice|toast|banner|alert/i.test(row.testId || '') && !leaveBefore[receiver].presentation.hosts.some(old => JSON.stringify(old) === JSON.stringify(row)));
        check(receiver + ' receives member B group departure notice', received.some(row => row.data?.category === 'journey' && row.data.senderId === o.memberB.actorId && row.body.includes('Tokyo B') && /離開|脫隊|退出|left|leave/i.test(row.body)), { received, newAlerts: alerts, newVisibleNotices: visibleNotices, expected: 'Named local journey notice from the departing member' });
      }
    });
  } catch (error) {
    failure = error.stack || String(error);
    save('harness-error.txt', failure);
    console.error(failure);
  } finally {
    try { await capture('world', 'pre-cleanup', {}, { failure: failure || null }); }
    catch (error) { failure = [failure, error.stack || String(error)].filter(Boolean).join('\n'); }
    for (const [name, device] of Object.entries(devices)) save(`${name}.log`, device.logs || '');
    save('backend-evidence.json', JSON.stringify({ groups: [...world.backend.groups.values()], memberships: world.backend.memberships, itinerary: world.backend.itinerary, locations: [...world.backend.locations.values()], sessions: [...world.backend.sessions.values()], notificationOutbox: world.backend.notificationOutbox, trace: world.backend.trace, realtimeTrace: world.realtimeTrace }, null, 2));
    try { await world.close(); }
    catch (error) { failure = [failure, error.stack || String(error)].filter(Boolean).join('\n'); }
    const limits = ['Real production App/providers/screens/hooks in isolated child React runtimes; external native views and SDK/backend contracts are fixtures.',
      'Notifications prove local scheduling/content, not APNs/FCM. Server notificationOutbox is routing only.',
      'Overnight is a powered-off 24-hour clock gap, not 24-hour OS/background endurance.',
      'No simulator/device, GPU/MapKit, native Swift/Kotlin, real SQL/RLS, GPS hardware, external network, or live services.',
      'Route-tour behavior is verified in its dedicated discoverable scenario. This trip records actual host notices/toasts/alerts separately from tour controls.',
      'Solo/leave receiver notices are required behavior. Empty sender queues alone never count as delivery.'];
    const summary = { output, command: `node test/headless/tokyo-trip.cjs ${output}`, platforms: { leader: 'ios', memberA: 'android', memberB: 'ios' }, overnight: 'powered-off 24h clock gap', checks, passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length,
      harnessFailure: failure || null, steps: records.length, finalTime: new Date(world.now).toISOString(), limits };
    save('summary.json', JSON.stringify(summary, null, 2));
    const lines = ['# Tokyo two-day / one-night headless journey', '', `Passed ${summary.passed}; failed ${summary.failed}; steps ${summary.steps}.`,
      `Harness failure: ${failure ? failure.split('\n')[0] : 'none'}.`, '', '## Independent behavior checks', '',
      ...checks.map(c => `- ${c.pass ? 'PASS' : 'FAIL'} ${c.name}. Evidence ${JSON.stringify(c.evidence)}`), '', '## Chronological actor transcript', ''];
    for (const r of records) {
      lines.push(`### ${r.step}. ${r.time} ${r.actor} ${r.operation}`, '', `Input ${JSON.stringify(r.input)}`, '', `Result ${JSON.stringify(r.result)}`, '');
      for (const [actor, o] of Object.entries(r.observations)) {
        if (!o) continue;
        const hosts = o.presentation.hosts.map(h => ({ testId: h.testId, text: h.text, label: h.label, value: h.value, disabled: h.disabled })).filter(h => h.text || h.label || h.value !== undefined);
        lines.push(`${actor}: route ${o.presentation.route.route}; identity ${o.actorId}; hosts ${JSON.stringify(hosts)}; live map members ${JSON.stringify(o.presentation.mapMembers)}; live flock ${JSON.stringify(o.presentation.flockRows)}; durable locations ${o.durable.locations.length}, operations ${o.durable.operations.length}; alerts ${JSON.stringify(o.external.alertDetails)}.`, '');
        if (r.notificationsDelta[actor]?.length) lines.push(`Received local notifications ${JSON.stringify(r.notificationsDelta[actor])}`, '');
      }
    }
    lines.push('## Limits', '', ...limits.map(l => `- ${l}`));
    save('transcript.md', lines.join('\n'));
    log(JSON.stringify({ passed: summary.passed, failed: summary.failed, harnessFailure: summary.harnessFailure?.split('\n')[0], output }));
    return summary;
  }
}
return main();
}
module.exports = { runTokyoTrip };
if (require.main === module) {
  const output = process.argv[2] || path.join('C:/Users/alexs/Desktop/BZ/hither/qa-runs/2026-10-30-tokyo-headless', `run-${Date.now()}`);
  runTokyoTrip({ output }).then(summary => { if (summary.harnessFailure || summary.failed) process.exitCode = 1; })
    .catch(error => { console.error(error); process.exitCode = 1; });
}
