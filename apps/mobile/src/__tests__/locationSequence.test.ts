import { normalizeLocationSequence } from '../utils/locationSequence';

describe('location RPC bigint sequence', () => {
  it.each([0, 1, 1791020129260, Number.MAX_SAFE_INTEGER])('preserves integer %s', value => {
    expect(normalizeLocationSequence(value)).toBe(value);
  });

  it.each([1791020129260.424, 1791020129260.999])('truncates GPS milliseconds %s', value => {
    const sequence = normalizeLocationSequence(value);
    expect(sequence).toBe(1791020129260);
    expect(BigInt(JSON.stringify(sequence))).toBe(1791020129260n);
  });

  it.each([-1, -0.1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid sequence %s', value => {
    expect(() => normalizeLocationSequence(value)).toThrow('invalid_location_sequence');
  });
});
