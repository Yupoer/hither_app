import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(__dirname, '../../../../supabase/migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

/** Latest definition of diagnostic_events.event CHECK body (if any). */
function latestEventCheckBody(): string {
  let body = '';
  for (const file of migrationFiles) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    // Match both inline create-table check and later add constraint.
    const matches = [
      ...sql.matchAll(
        /check\s*\(\s*event\s+in\s*\(([\s\S]*?)\)\s*\)/gi,
      ),
    ];
    for (const match of matches) {
      body = match[1];
    }
  }
  return body;
}

function parseAllowedEvents(checkBody: string): Set<string> {
  const events = new Set<string>();
  for (const match of checkBody.matchAll(/'([a-z0-9_]+)'/g)) {
    events.add(match[1]);
  }
  return events;
}

/** Events the mobile client currently emits into diagnostics.write / remote upload path. */
const CLIENT_EMITTED_EVENTS = [
  'background_op_timeline',
  'background_op_near_watchdog',
  'metric_payload_classified',
  'live_activity_token_register',
  'previous_launch_incomplete',
  'navigation_terminal_conflict',
  'location_upload_discarded',
  'location_callback',
  'location_outbox_enqueued',
  'location_upload_failed',
  'location_rejected_sharing_disabled',
  'location_rejected_distance',
  'refresh_request_received',
  'refresh_request_completed',
  'refresh_request_timeout',
  'diagnostic_error',
] as const;

describe('diagnostic_events event allow-list', () => {
  it('has a migration that expands the CHECK for performance-stability events', () => {
    const expansion = migrationFiles.find((name) =>
      name.includes('diagnostic_events_performance_stability'),
    );
    expect(expansion).toBeTruthy();
    const sql = readFileSync(join(migrationsDir, expansion!), 'utf8');
    expect(sql).toContain('drop constraint if exists diagnostic_events_event_check');
    expect(sql).toContain('add constraint diagnostic_events_event_check');
    expect(sql).toContain("'background_op_timeline'");
    expect(sql).toContain("'background_op_near_watchdog'");
    expect(sql).toContain("'metric_payload_classified'");
    expect(sql).toContain("'live_activity_token_register'");
  });

  it('allows every client-emitted diagnostic event name', () => {
    const body = latestEventCheckBody();
    expect(body.length).toBeGreaterThan(0);
    const allowed = parseAllowedEvents(body);
    for (const event of CLIENT_EMITTED_EVENTS) {
      expect(allowed.has(event)).toBe(true);
    }
  });
});
