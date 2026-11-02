const assert = require('node:assert/strict');
const { Backend, GROUP_ID, LEADER, PEER, DESTINATION } = require('./backend.cjs');
const { processDue } = require('./backend-schedule.cjs');

const b = new Backend(() => {});
b.groups.get(GROUP_ID).straggler_alerts = true;
const report = () => b.execute('schedule-contract', { kind: 'rpc', name: 'report_straggler', steps: [],
  args: { p_group_id: GROUP_ID, p_member_id: PEER, p_distance_m: 1000 }, userId: LEADER });
report();
assert.equal(b.tables.group_alerts.length, 0, 'Standby cannot report separation');
const meetAt = new Date(b.now + 600000).toISOString();
b.execute('schedule-contract', { kind: 'table', name: 'itinerary_items', userId: LEADER,
  steps: [['update', { meet_at: meetAt, meet_red_minutes: 10 }], ['eq', 'id', DESTINATION]] });
const destination = b.itinerary[0];
const occurrence = destination.meet_schedule_occurrence_id;
assert(occurrence);
assert.equal(destination.meet_set_by, LEADER);
assert.equal(processDue(b), 1, 'Warning is explicit cron work');
assert.equal(b.sessions.size, 0);
b.now = Date.parse(meetAt) - 1;
assert.equal(processDue(b), 0);
assert.equal(b.sessions.size, 0);
b.now++;
assert.equal(b.sessions.size, 0, 'Advancing the clock alone never invokes cron');
assert.equal(processDue(b), 1);
assert.equal(b.sessions.get(occurrence).origin, 'scheduled');
assert.equal(b.scheduledPushes.at(-1).category, 'navigation_session');
assert.equal(b.scheduledPushes.at(-1).entity_id, occurrence);
assert.equal(b.receipts.get(occurrence).status, 'accepted');
assert.equal(processDue(b), 0);
assert.equal(b.sessions.size, 1);
report();
assert.equal(b.tables.group_alerts.length, 1, 'Active navigation admits separation');
b.execute('schedule-contract', { kind: 'table', name: 'itinerary_items', userId: LEADER,
  steps: [['update', { meet_at: new Date(b.now + 60000).toISOString() }], ['eq', 'id', DESTINATION]] });
assert.notEqual(destination.meet_schedule_occurrence_id, occurrence);
b.now += 60000;
assert.equal(processDue(b), 0, 'Same active target consumes without a replacement session');
assert.equal(b.sessions.size, 1);
assert(destination.meet_schedule_consumed_at);
console.log('Explicit scheduled navigation fixture contracts passed');
