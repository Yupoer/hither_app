import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../../');
const migration = readFileSync(
  join(root, 'supabase/migrations/20260804020000_coordination_deadline_scheduler.sql'),
  'utf8',
).replace(/\r\n/g, '\n');
const service = readFileSync(
  join(__dirname, '../api/services/CoordinationRequestService.ts'),
  'utf8',
);
const hook = readFileSync(
  join(__dirname, '../screens/MapScreen/hooks/useCoordinationRequests.ts'),
  'utf8',
);

describe('Ticket 3 server-owned coordination deadline', () => {
  it('uses a bounded service scheduler with row locking and observability', () => {
    expect(migration).toContain('process_due_coordination_requests');
    expect(migration).toContain('for update');
    expect(migration).toContain('skip locked');
    expect(migration).toContain('limit 100');
    expect(migration).toContain('coordination_scheduler_runs');
    expect(migration).toContain('error_count');
    expect(migration).toContain('grant execute on function public.process_due_coordination_requests() to service_role');
  });

  it('does not resolve deadlines as a side effect of a client read', () => {
    const fetchFunction = service.slice(service.indexOf('export async function fetchCoordinationRequests'));
    expect(fetchFunction).not.toContain('resolveDueCoordinationRequests(groupId)');
    expect(hook).toContain('OPEN_REQUEST_RECOVERY_INTERVAL_MS = 60_000');
    expect(hook).toContain('openCount === 0');
    expect(hook).not.toContain('POLL_INTERVAL_MS = 45_000');
  });
});
