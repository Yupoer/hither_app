import { buildLiveActivityRequest, liveActivityEtaFields, liveActivityOrderingTimestamp } from './apns.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}`);
  }
}

Deno.test('an older cloud snapshot cannot outrank newer native GPS or replace its deadline', () => {
  const eta = liveActivityEtaFields(120, '1970-01-01T00:00:02.000Z');
  equal(eta, { sampledAtMs: 2000, etaTargetAtMs: 122000 });
  // A teammate event occurs at 999s, after a native GPS update at 990s;
  // the cloud position/ETA is still the older sample taken at 2s.
  const timestamp = liveActivityOrderingTimestamp('update', '1970-01-01T00:00:02.000Z', 999000);
  equal(timestamp, 2);
  if (timestamp == null || timestamp >= 990) throw new Error('Old cloud sample incorrectly outranks native GPS');
  const request = buildLiveActivityRequest({ key: '', keyId: '', teamId: '', bundleId: 'test.hither', env: 'sandbox' },
    'fixture', 'fixture', { event: 'update', timestamp, contentState: {
      gatheringTitle: 'Test', destinationId: 'point-a', distanceMeters: 200, etaSeconds: 120, progress: 0.5,
      gatheredCount: 1, memberCount: 2, accentHex: '#F5B142', travelMode: 'walk',
      memberEmojis: ['🙂'], memberArrived: [true], ...eta,
    } });
  const aps = JSON.parse(request.init.body as string).aps;
  equal(aps.timestamp, 2);
  equal(aps['content-state'].destinationId, 'point-a');
  equal(aps['content-state'].etaTargetAtMs, 122000);
  equal(aps['content-state'].sampledAtMs, 2000);
  equal(aps['content-state'].gatheredCount, 1);
});

Deno.test('unknown or future sample times are skipped; authoritative end events still stop immediately', () => {
  equal(liveActivityOrderingTimestamp('update', null, 999000), null);
  equal(liveActivityOrderingTimestamp('update', 'invalid', 999000), null);
  equal(liveActivityOrderingTimestamp('update', '1970-01-01T00:20:00.000Z', 999000), null);
  equal(liveActivityOrderingTimestamp('update', '1969-12-31T23:59:59.000Z', 999000), null);
  equal(liveActivityOrderingTimestamp('end', null, 999000), 999);
  equal(liveActivityOrderingTimestamp('end', 'invalid', 999000), 999);
});

Deno.test('missing or invalid ETA snapshots do not invent fresh deadlines', () => {
  equal(liveActivityEtaFields(null, '1970-01-01T00:00:02.000Z'), {});
  equal(liveActivityEtaFields(120, 'invalid'), {});
  equal(liveActivityEtaFields(Number.NaN, '1970-01-01T00:00:02.000Z'), {});
  equal(liveActivityEtaFields(0, '1970-01-01T00:00:02.000Z'), { sampledAtMs: 2000, etaTargetAtMs: 2000 });
});
