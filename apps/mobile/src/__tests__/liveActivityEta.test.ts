import { resolveEtaSnapshot } from '../utils/liveActivityEta';

it('keeps the original deadline through identical estimates, resume, and GPS gaps', () => {
  const initial = resolveEtaSnapshot(null, { key: 'route-1:900m', etaSeconds: 600, sampledAtMs: 1000, nowMs: 1000 });
  expect(initial?.etaTargetAtMs).toBe(601000);
  expect(resolveEtaSnapshot(initial, { key: 'route-1:900m', etaSeconds: 600, sampledAtMs: 90000, nowMs: 90000 })).toBe(initial);
  expect(resolveEtaSnapshot(initial, { key: 'sticky', etaSeconds: 600, nowMs: 90000, fresh: false })).toBe(initial);
  const changed = resolveEtaSnapshot(initial, { key: 'route-2:900m', etaSeconds: 480, sampledAtMs: 90000, nowMs: 90000 });
  expect(changed?.etaTargetAtMs).toBe(570000);
  expect(resolveEtaSnapshot(null, { key: 'unknown', etaSeconds: null, nowMs: 1 })).toBeNull();
  expect(resolveEtaSnapshot(null, { key: 'stale', etaSeconds: 480, nowMs: 1, fresh: false })).toBeNull();
});

it('uses a coherent estimate time and safely represents a reached boundary', () => {
  const boundary = resolveEtaSnapshot(null, { key: 'boundary', etaSeconds: 0, sampledAtMs: 5000, nowMs: 50000 });
  expect(boundary?.etaTargetAtMs).toBe(5000);
  expect(resolveEtaSnapshot(null, { key: 'invalid', etaSeconds: Number.NaN, nowMs: 1 })).toBeNull();
});
