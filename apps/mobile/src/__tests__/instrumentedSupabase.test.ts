jest.mock('../state/performance', () => ({
  traceApi: jest.fn((_: string, work: () => Promise<unknown>) => work()),
}));

import { traceApi } from '../state/performance';
import { withSupabasePerformanceTracing } from '../api/instrumentedSupabase';

describe('instrumented Supabase client', () => {
  it('traces awaited table builders without changing their result', async () => {
    const builder = {} as {
      select: jest.Mock;
      then: (resolve: (value: unknown) => unknown) => unknown;
    };
    builder.select = jest.fn((): typeof builder => builder);
    builder.then = (resolve) => resolve({ data: [], error: null });
    const client = { from: jest.fn((_table: string) => builder) };
    const result = await withSupabasePerformanceTracing(client).from('groups').select('*');

    expect(result).toEqual({ data: [], error: null });
    expect(traceApi).toHaveBeenCalledWith('api.from.groups', expect.any(Function));
  });

  it('traces RPC builders with a stable operation name', async () => {
    const builder = {
      then: (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null }),
    };
    const client = { rpc: jest.fn((_name: string, _args: unknown) => builder) };
    await withSupabasePerformanceTracing(client).rpc('ingest_diagnostic_batch', {});

    expect(traceApi).toHaveBeenCalledWith(
      'api.rpc.ingest_diagnostic_batch',
      expect.any(Function),
    );
  });
});
