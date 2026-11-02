const { randomUUID } = require('node:crypto');
const { iso } = require('./backend-domain.cjs');
const { scopeAllowed } = require('./backend-workflows.cjs');

function changed(b, row, previous, userId) {
  if (row.meet_at === previous.meet_at && (row.subgroup_id ?? null) === (previous.subgroup_id ?? null)) return;
  row.meet_set_by = row.meet_at ? userId : null;
  row.meet_warn_pushed_at = null;
  row.meet_due_pushed_at = null;
  row.meet_schedule_revision = (previous.meet_schedule_revision ?? 0) + 1;
  row.meet_schedule_occurrence_id = row.meet_at ? randomUUID() : null;
  row.meet_schedule_consumed_at = null;
}

function processDue(b) {
  let count = 0;
  for (const row of [...b.itinerary].sort((a, c) => (a.meet_at ?? '').localeCompare(c.meet_at ?? '') || a.id.localeCompare(c.id))) {
    const meetAt = Date.parse(row.meet_at);
    if (!row.meet_schedule_occurrence_id || row.meet_schedule_consumed_at || !Number.isFinite(meetAt)
      || meetAt <= b.now - 7200000 || meetAt > b.now + (row.meet_red_minutes ?? 5) * 60000
      || row.closed_at || row.day == null || row.latitude == null || row.longitude == null
      || !scopeAllowed(b, row.group_id, row.subgroup_id, row.meet_set_by)) continue;
    if (meetAt > b.now) {
      if (!row.meet_warn_pushed_at) {
        row.meet_warn_pushed_at = iso(b);
        b.scheduledPushes.push({ category: 'meet_warning', group_id: row.group_id, sender_id: row.meet_set_by,
          destination_id: row.id, title: row.title, meet_at: row.meet_at, minutes: Math.ceil((meetAt - b.now) / 60000) });
        count++;
      }
      continue;
    }
    const active = [...b.sessions.values()].find(session => session.group_id === row.group_id
      && (session.scope_subgroup_id ?? null) === (row.subgroup_id ?? null) && session.status === 'active' && session.destination_id === row.id);
    if (!active) {
      const result = require('./backend-core.cjs').apply(b, { userId: row.meet_set_by, navigationOrigin: 'scheduled', args: {
        p_operation_id: row.meet_schedule_occurrence_id, p_group_id: row.group_id, p_actor_id: row.meet_set_by,
        p_entity_type: 'active_gathering', p_entity_id: row.group_id, p_entity_version: 0,
        p_operation_type: 'start_gathering', p_payload: { activeDestinationId: row.id, subgroupId: row.subgroup_id ?? null,
          navigationRequestId: row.meet_schedule_occurrence_id }, p_sequence: row.meet_schedule_revision,
        p_dependency_ids: [], p_created_at: row.meet_at,
      } });
      if (result.error || !['accepted', 'duplicate'].includes(result.data.status)) continue;
      const session = b.sessions.get(result.data.effects.navigationSessionId);
      b.scheduledPushes.push({ category: 'navigation_session', origin: 'scheduled', group_id: row.group_id,
        sender_id: row.meet_set_by, destination_id: row.id, session_id: session.id, entity_id: session.id,
        status: session.status, version: session.version });
      count++;
    }
    row.meet_schedule_consumed_at = iso(b);
    row.meet_due_pushed_at = iso(b);
  }
  return count;
}

module.exports = { changed, processDue };
