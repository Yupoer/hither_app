import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const migrations = readdirSync(join(root, 'supabase/migrations'))
  .filter((name) => name.endsWith('.sql'))
  .map((name) => readFileSync(join(root, 'supabase/migrations', name), 'utf8'))
  .join('\n');
const client = readFileSync(join(__dirname, '../api/client.ts'), 'utf8');
const mapScreen = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
const reorderList = readFileSync(
  join(__dirname, '../components/DestinationReorderList.tsx'),
  'utf8',
);
const pushIndex = readFileSync(
  join(root, 'supabase/functions/send-push/index.ts'),
  'utf8',
);
const pushMessages = readFileSync(
  join(root, 'supabase/functions/send-push/messages.ts'),
  'utf8',
);

describe('gathering approval, arrivals, history, and push contracts', () => {
  it('persists leader-approved gathering-point requests', () => {
    expect(migrations).toContain('create table public.gather_point_requests');
    expect(migrations).toContain('public.submit_gather_point_request');
    expect(migrations).toContain('public.resolve_gather_point_request');
    expect(migrations).toContain("status in ('pending', 'approved', 'rejected')");
    expect(migrations).toContain('subgroup does not belong to group');
    expect(client).toContain('submitGatherPointRequest');
    expect(client).toContain('resolveGatherPointRequest');
  });

  it('stores per-member destination arrivals and supports manual marking', () => {
    expect(migrations).toContain('create table public.destination_arrivals');
    expect(migrations).toContain('unique (destination_id, user_id)');
    expect(migrations).toContain('public.set_destination_arrival');
    expect(migrations).toContain("v_journey_status = 'paused'");
    expect(migrations).toContain('paused destination requires an existing arrival');
    expect(migrations).toContain('m.subgroup_id is not distinct from i.subgroup_id');
    expect(migrations).toMatch(
      /on_member_location_arrival[\s\S]*insert into public\.destination_arrivals/,
    );
    expect(client).toContain('setDestinationArrival');
    expect(mapScreen).toContain('destinationArrivals');
    expect(mapScreen).toContain("t('arrival.mark')");
  });

  it('keeps itinerary editing and flag colours leader-only', () => {
    expect(mapScreen).toContain('const canEditItinerary = !!isLeader');
    expect(reorderList).toContain('canEditColors={canReorder}');
    expect(migrations).toContain('drop policy if exists "itinerary_items: insert if in that subgroup"');
  });

  it('allows authorized history deletion without deleting arrival completion', () => {
    expect(migrations).toContain('arrival_id uuid');
    expect(migrations).toContain('destination_id uuid');
    expect(migrations).toContain('visited_waypoints: delete own or leader');
    expect(client).toContain('deleteVisitedWaypoint');
    expect(mapScreen).toContain('handleDeleteHistory');
  });

  it('fans quick commands to the whole group and names the sender', () => {
    expect(pushIndex).toContain('wholeGroupCommand');
    expect(pushIndex).toContain('senderName');
    expect(pushMessages).toContain('sender_name?: string');
    expect(pushMessages).toContain('${p.sender_name ?? "隊員"}：${label}');
    expect(pushMessages).toContain('gathering_request');
  });
});
