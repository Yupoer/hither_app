import { uploadMetricPayload, uploadMetricPayloadBatch, ingestDiagnosticBatch } from '../api/services/DiagnosticService';
import { uploadPerformanceBatch } from '../api/services/PerformanceService';
import { __resetDiagnosticConsentForTests, hydrateDiagnosticConsent, setDiagnosticConsentEnabled } from '../state/diagnosticConsent';
import { requestWithDeadline } from '../utils/requestDeadline';

const mockInsert = jest.fn(async (..._args: unknown[]): Promise<{ error: null | Error }> => ({ error: null }));
const mockUpsert = jest.fn(async (..._args: unknown[]): Promise<{ error: null | Error }> => ({ error: null }));
const mockRpc = jest.fn(async () => ({ data: { acceptedIds: ['row'], rejected: [] }, error: null }));
const mockRequireUser = jest.fn(async () => 'actor');
const mockDeviceId = jest.fn(async () => 'device');
let mockRequestSignal: AbortSignal | undefined;
function mockBuilder<T>(pending: Promise<T>) {
  return { then: pending.then.bind(pending), abortSignal: (signal: AbortSignal) => { mockRequestSignal = signal; return pending; } };
}
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: { getItem: async () => null, setItem: async () => undefined },
}));
jest.mock('../api/supabase', () => ({
  supabase: { from: () => ({ insert: (...args: unknown[]) => mockBuilder(mockInsert(...args)) }), rpc: (..._args: unknown[]) => mockBuilder(mockRpc()) },
  baseSupabase: { from: () => ({ upsert: (...args: unknown[]) => mockBuilder(mockUpsert(...args)) }) },
}));
jest.mock('../api/services/_helpers', () => ({ requireUserId: () => mockRequireUser(), orThrow: (error: unknown) => { if (error) throw error; } }));
jest.mock('../api/services/LiveActivityService', () => ({ getOrCreateLiveActivityDeviceId: () => mockDeviceId() }));
const payloads = Array.from({ length: 7 }, (_, index) => ({ id: `payload-${index}`, kind: 'metric' as const, json: '{}', receivedAt: 1000 }));
const metadata = { deviceId: 'device', appVersion: 'test', buildNumber: 'test' };
const diagnostic = { id: 'row', timestamp: 1000, sessionId: 'session', event: 'test', navigationSessionId: null, payload: {} };
const performance = { id: 'row', timestamp: 1000, sessionId: 'session', eventType: 'sample' as const, operation: 'runtime.energy.sample', payload: {} };
async function settle() { for (let step = 0; step < 12; step++) await Promise.resolve(); }
beforeEach(() => {
  __resetDiagnosticConsentForTests(); hydrateDiagnosticConsent('true');
  mockRequestSignal = undefined;
  jest.clearAllMocks(); mockRequireUser.mockResolvedValue('actor'); mockDeviceId.mockResolvedValue('device'); mockInsert.mockResolvedValue({ error: null });
});

it.each([false, true])('stops the drained batch after revocation during payload one and cannot revive it on re-enable=%s', async (reEnable) => {
  let finish: (result: { error: null }) => void = () => undefined;
  mockInsert.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = uploadMetricPayloadBatch(payloads, () => true);
  await settle();
  expect(mockInsert).toHaveBeenCalledTimes(1);
  await setDiagnosticConsentEnabled(false);
  expect(mockRequestSignal?.aborted).toBe(true);
  if (reEnable) await setDiagnosticConsentEnabled(true);
  finish({ error: null });
  expect(await pending).toEqual(['payload-0']);
  expect(mockInsert).toHaveBeenCalledTimes(1);
});

it('aborts submission delayed inside transport token lookup and keeps it aborted after re-enable', async () => {
  let finishToken: () => void = () => undefined;
  const token = new Promise<void>(resolve => { finishToken = resolve; });
  const fetchBoundary = jest.fn(async () => ({ error: null }));
  mockInsert.mockImplementationOnce(async () => {
    await token;
    return requestWithDeadline(fetchBoundary, 10_000, mockRequestSignal);
  });
  const pending = uploadMetricPayloadBatch(payloads, () => true);
  await settle();
  await setDiagnosticConsentEnabled(false); await setDiagnosticConsentEnabled(true);
  finishToken();
  expect(await pending).toEqual([]);
  expect(fetchBoundary).not.toHaveBeenCalled();
  expect(mockInsert).toHaveBeenCalledTimes(1);
});

it.each(['auth', 'device'])('checks direct MetricKit submission again after the asynchronous %s boundary', async (boundary) => {
  let finish: (value: string) => void = () => undefined;
  (boundary === 'auth' ? mockRequireUser : mockDeviceId).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = uploadMetricPayload(payloads[0]);
  await settle();
  await setDiagnosticConsentEnabled(false); await setDiagnosticConsentEnabled(true);
  finish('ready');
  expect(await pending).toBe(false);
  expect(mockInsert).not.toHaveBeenCalled();
});

it('keeps five-payload batching and stops obsolete app lifecycles or failed submissions', async () => {
  expect(await uploadMetricPayloadBatch(payloads, () => true)).toHaveLength(5);
  expect(mockInsert).toHaveBeenCalledTimes(5);
  expect(await uploadMetricPayloadBatch(payloads, () => false)).toEqual([]);
  mockInsert.mockResolvedValueOnce({ error: new Error('upstream unavailable') });
  expect(await uploadMetricPayloadBatch(payloads, () => true)).toEqual([]);
  await expect(uploadMetricPayload({ ...payloads[0], json: '[]' })).rejects.toThrow('JSON object');
  await setDiagnosticConsentEnabled(false);
  expect(await uploadMetricPayload(payloads[0])).toBe(false);
  expect(await uploadMetricPayloadBatch(payloads, () => true)).toEqual([]);
});

it('fences diagnostic and performance API siblings after auth awaits without changing their results', async () => {
  expect(await ingestDiagnosticBatch([], metadata)).toEqual({ acceptedIds: [], rejected: [] });
  expect(await uploadPerformanceBatch([])).toEqual([]);
  expect(await ingestDiagnosticBatch([diagnostic], metadata)).toEqual({ acceptedIds: ['row'], rejected: [] });
  expect(await uploadPerformanceBatch([performance])).toEqual(['row']);
  for (const submit of [() => ingestDiagnosticBatch([diagnostic], metadata), () => uploadPerformanceBatch([performance])]) {
    let finish: (value: string) => void = () => undefined;
    mockRequireUser.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = submit(); await settle();
    await setDiagnosticConsentEnabled(false); await setDiagnosticConsentEnabled(true);
    finish('actor'); await pending;
  }
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockUpsert).toHaveBeenCalledTimes(1);
  await setDiagnosticConsentEnabled(false);
  expect(await ingestDiagnosticBatch([diagnostic], metadata)).toEqual({ acceptedIds: [], rejected: [] });
  expect(await uploadPerformanceBatch([performance])).toEqual([]);
});
