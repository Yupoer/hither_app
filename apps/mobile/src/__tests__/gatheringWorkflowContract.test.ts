import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const migrations = readdirSync(join(root, 'supabase/migrations'))
  .filter((name) => name.endsWith('.sql'))
  .map((name) => readFileSync(join(root, 'supabase/migrations', name), 'utf8'))
  .join('\n');
const client = readFileSync(join(__dirname, '../api/client.ts'), 'utf8');
const mapScreen = readFileSync(join(__dirname, '../screens/MapScreen.tsx'), 'utf8');
const groupState = readFileSync(join(__dirname, '../state/useGroupState.ts'), 'utf8');
const i18n = readFileSync(join(__dirname, '../i18n/index.ts'), 'utf8');
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
    expect(migrations).toContain("returns jsonb");
    expect(migrations).toContain("'inserted_count'");
    expect(migrations).toMatch(
      /create or replace function extensions\.notify_push[\s\S]*exception[\s\S]*when others then/i,
    );
    expect(client).toContain('submitGatherPointRequest');
    expect(client).toContain('resolveGatherPointRequest');
    expect(client).toContain('resolveGatherPointRequestResilient');
  });

  it('keeps gather-approve UI resilient to network blips', () => {
    expect(mapScreen).toContain('resolveGatherPointRequestResilient');
    expect(mapScreen).toContain('isNetworkRequestError');
    expect(mapScreen).toContain('gather_request_resolve');
    expect(mapScreen).toContain('resolvingGatherRequestId');
    expect(mapScreen).toContain("t('gatherRequest.networkFailed')");
  });

  it('stores per-member destination arrivals and supports manual marking', () => {
    expect(migrations).toContain('create table public.destination_arrivals');
    expect(migrations).toContain('unique (destination_id, user_id)');
    expect(migrations).toContain('public.set_destination_arrival');
    expect(migrations).toContain('public.set_destination_arrival_at');
    expect(migrations).toContain('p_arrived_at timestamptz');
    expect(migrations).toContain('set arrived_at = p_arrived_at');
    expect(migrations).toContain("v_journey_status = 'paused' and not p_arrived");
    expect(migrations).toContain("v_journey_status = 'paused'");
    expect(migrations).toContain('paused destination requires an existing arrival');
    expect(migrations).toContain('m.subgroup_id is not distinct from i.subgroup_id');
    // Sequential mark: earlier open stops for this user, not active_destination max.
    expect(migrations).toContain('i.position < v_destination.position');
    expect(migrations).toContain('i.closed_at is null');
    expect(migrations).toMatch(
      /on_member_location_arrival[\s\S]*insert into public\.destination_arrivals/,
    );
    expect(client).toContain('setDestinationArrival');
    expect(client).toContain('setDestinationArrivalAt');
    expect(mapScreen).toContain('destinationArrivals');
    expect(mapScreen).toContain("t('arrival.mark')");
    expect(mapScreen).toContain("t('common.confirm')");
    expect(mapScreen).toContain('arrivalErrorMessage');
    expect(mapScreen).toContain('future destination cannot be completed');
    expect(mapScreen).toContain('arrivalMemberRow');
    expect(mapScreen).toContain('checkmark-circle');
    expect(i18n).toContain("'arrival.errFuture'");
    expect(i18n).toContain("'arrival.failedTitle'");
  });

  it('keeps itinerary editing and flag colours leader-only', () => {
    expect(mapScreen).toContain('const canEditItinerary = !!isLeader');
    expect(reorderList).toContain('canEditColors={canReorder}');
    expect(migrations).toContain('drop policy if exists "itinerary_items: insert if in that subgroup"');
  });

  it('reconciles group state periodically even when Realtime misses an event', () => {
    expect(groupState).toContain('realtimeReadyRef');
    expect(groupState).toContain("status === 'SUBSCRIBED'");
    expect(groupState).toContain("status === 'TIMED_OUT'");
    expect(groupState).toContain("status === 'CHANNEL_ERROR'");
    expect(groupState).toContain("status === 'CLOSED'");
    expect(groupState).toContain('const timer = setInterval');
    expect(groupState).toContain('void loadRef.current()');
    expect(groupState).not.toContain('const profilesChannel');
  });

  it('coalesces workflow events and guards destination deletion to leaders', () => {
    expect(mapScreen).toContain('scheduleWorkflowReload');
    expect(mapScreen).toContain('if (!canEditItinerary) return;');
  });

  it('offers database reconciliation and refreshes before arrival writes', () => {
    expect(reorderList).toContain('onSync?: () => Promise<void>');
    expect(reorderList).toContain("t('map.syncDb')");
    expect(mapScreen).toContain('const syncFromDatabase = useCallback');
    expect(mapScreen).toContain('setOptimisticDestinations(null)');
    expect(mapScreen).toContain('syncFromDatabase()');
    expect(mapScreen).toContain('onSync={syncFromDatabaseAndUploadLogs}');
    expect(mapScreen).toContain('uploadLocalLogs');
    expect(mapScreen).toContain('const syncFromDatabaseAndUploadLogs');
    expect(i18n).toContain("'map.syncDb'");
  });

  it('gates foreground arrival ACK to session/status transitions', () => {
    expect(mapScreen).toContain('foregroundAckRef');
    expect(mapScreen).toContain("source: 'foreground_arrival_reducer'");
    expect(mapScreen).toContain('foregroundAckRef.current !== ackKey');
  });

  it('allows authorized history deletion without deleting arrival completion', () => {
    expect(migrations).toContain('arrival_id uuid');
    expect(migrations).toContain('destination_id uuid');
    expect(migrations).toContain('visited_waypoints: delete own or leader');
    expect(client).toContain('deleteVisitedWaypoint');
    expect(mapScreen).toContain('handleDeleteHistory');
  });

  it('projects history as own-or-leader and completes stops for the whole team', () => {
    expect(migrations).toContain('visited_waypoints: select own or leader');
    expect(migrations).toContain('complete_gathering_stop');
    expect(client).toContain('completeGatheringStop');
    expect(mapScreen).toContain('projectHistoryForViewer');
    expect(mapScreen).toContain('completeGatheringStop');
    expect(mapScreen).toContain('完成此行程');
    expect(pushMessages).toContain('gathering_completed');
    expect(pushMessages).toContain('隊長已完成此卡片');
  });

  it('fans quick commands to the whole group and names the sender', () => {
    expect(pushIndex).toContain('wholeGroupCommand');
    expect(pushIndex).toContain('senderName');
    expect(pushMessages).toContain('sender_name?: string');
    expect(pushMessages).toContain('${p.sender_name ?? "隊員"}：${label}');
    expect(pushMessages).toContain('gathering_request');
  });
});
